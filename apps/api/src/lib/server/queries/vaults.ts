/**
 * Conviction Vaults — read the live vault signal from the backtest Postgres.
 *
 * The vault data (positions, signal_track, quality) is produced by the
 * `vault-snapshots` service and lives in a separate Railway Postgres. The BFF
 * reaches it over `VAULT_PG_URL` (private networking in the cloud; the public
 * proxy URL for local dev). Read-only, small queries — no Drizzle, just `pg`.
 *
 * This powers the /vaults SHOWCASE page (data-stage: live positioning, no invest
 * contracts). See docs/plans/2026-07-01-vaults-showcase-design.md.
 */

import pg from 'pg';

const VAULT_PG_URL = process.env.VAULT_PG_URL;

let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!VAULT_PG_URL) throw new Error('VAULT_PG_URL is not set');
  if (!pool) {
    // Internal Railway networking is plaintext; the public proxy needs TLS.
    const internal = VAULT_PG_URL.includes('.railway.internal');
    pool = new pg.Pool({
      connectionString: VAULT_PG_URL,
      max: 3,
      ssl: internal ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export interface VaultSummary {
  coin: string;
  traders: number;
  longs: number;
  shorts: number;
  volumeUsd: number;
  /** signed skew ∈ [-1,1]; null if no signal yet. */
  skew: number | null;
  contributors: number | null;
  /** 'long' | 'short' | 'flat' */
  direction: 'long' | 'short' | 'flat';
  updatedAtMs: number | null;
}

export interface VaultSkewPoint {
  ts: number;
  skew: number;
  contributors: number;
}

export interface VaultContributor {
  address: string;
  displayName: string | null;
  direction: 'long' | 'short';
  /** position notional as a % of the trader's own account equity (conviction). */
  convictionPct: number;
  notionalUsd: number;
  /** placeholder quality (copyScore 0–100) until vault-grade q is live. */
  score: number | null;
}

export interface VaultNavPoint {
  ts: number;
  /** paper vault NAV, indexed to 100 at inception. */
  vaultNav: number;
  /** buy-and-hold asset NAV, indexed to 100. */
  assetNav: number;
}

export interface VaultDetail {
  summary: VaultSummary;
  skewHistory: VaultSkewPoint[];
  contributors: VaultContributor[];
  navHistory: VaultNavPoint[];
}

/** One vault's detail: latest signal summary + skew history + contributing traders. */
export async function getVaultDetail(coin: string): Promise<VaultDetail | null> {
  const pool = getPool();

  // Summary (latest positions aggregate + latest signal) for this coin.
  const { rows: sumRows } = await pool.query(
    `WITH latest_pos AS (SELECT max(ts) AS t FROM positions),
     vol AS (
       SELECT coin, count(*) AS traders,
              count(*) FILTER (WHERE szi > 0) AS longs,
              count(*) FILTER (WHERE szi < 0) AS shorts,
              sum(position_value) AS volume
       FROM positions, latest_pos WHERE ts = latest_pos.t AND szi <> 0 AND coin = $1 GROUP BY coin
     ),
     sig AS (SELECT s, contributors, actionable, ts FROM signal_track WHERE coin = $1 ORDER BY ts DESC LIMIT 1)
     SELECT v.coin, v.traders, v.longs, v.shorts, v.volume, s.s, s.contributors, s.actionable, s.ts
     FROM vol v LEFT JOIN sig s ON true`,
    [coin],
  );
  if (sumRows.length === 0) return null;
  const r = sumRows[0];
  const summary: VaultSummary = {
    coin: r.coin,
    traders: Number(r.traders),
    longs: Number(r.longs),
    shorts: Number(r.shorts),
    volumeUsd: Number(r.volume),
    skew: r.s === null ? null : Number(r.s),
    contributors: r.contributors === null ? null : Number(r.contributors),
    direction: r.actionable === 'LONG' ? 'long' : r.actionable === 'SHORT' ? 'short' : 'flat',
    updatedAtMs: r.ts === null ? null : Number(r.ts),
  };

  // Skew history.
  const { rows: histRows } = await pool.query(
    `SELECT ts, s, contributors FROM signal_track WHERE coin = $1 ORDER BY ts ASC`,
    [coin],
  );
  const skewHistory = histRows.map((h): VaultSkewPoint => ({
    ts: Number(h.ts), skew: Number(h.s), contributors: Number(h.contributors),
  }));

  // Contributing traders (latest snapshot), sorted by conviction × score.
  const { rows: cRows } = await pool.query(
    `WITH latest_pos AS (SELECT max(ts) AS t FROM positions),
     latest_roster AS (SELECT max(ts) AS t FROM roster)
     SELECT p.wallet, p.szi, p.position_value, p.account_value, ro.display_name, ro.copy_score
     FROM positions p
     CROSS JOIN latest_pos
     LEFT JOIN roster ro ON ro.address = p.wallet AND ro.ts = (SELECT t FROM latest_roster)
     WHERE p.ts = latest_pos.t AND p.coin = $1 AND p.szi <> 0 AND p.account_value > 0
     ORDER BY (COALESCE(ro.copy_score, 0) / 100.0) * LEAST(p.position_value / p.account_value, 3) DESC
     LIMIT 20`,
    [coin],
  );
  const contributors = cRows.map((c): VaultContributor => ({
    address: c.wallet,
    displayName: c.display_name ?? null,
    direction: Number(c.szi) > 0 ? 'long' : 'short',
    convictionPct: Math.round((Number(c.position_value) / Number(c.account_value)) * 100),
    notionalUsd: Number(c.position_value),
    score: c.copy_score === null ? null : Math.round(Number(c.copy_score)),
  }));

  // Paper NAV comparison (vault vs buy-and-hold), if computed yet.
  let navHistory: VaultNavPoint[] = [];
  try {
    const { rows: navRows } = await pool.query(
      `SELECT ts, vault_nav, asset_nav FROM vault_nav WHERE coin = $1 ORDER BY ts ASC`,
      [coin],
    );
    navHistory = navRows.map((n): VaultNavPoint => ({
      ts: Number(n.ts), vaultNav: Number(n.vault_nav), assetNav: Number(n.asset_nav),
    }));
  } catch {
    // vault_nav not created yet — comparison chart stays gated.
  }

  return { summary, skewHistory, contributors, navHistory };
}

/** Top-12 vaults by EP-cohort volume, each with its latest signal. */
export async function getVaults(limit = 12): Promise<VaultSummary[]> {
  const sql = `
    WITH latest_pos AS (SELECT max(ts) AS t FROM positions),
    vol AS (
      SELECT coin,
             count(*) AS traders,
             count(*) FILTER (WHERE szi > 0) AS longs,
             count(*) FILTER (WHERE szi < 0) AS shorts,
             sum(position_value) AS volume
      FROM positions, latest_pos
      WHERE ts = latest_pos.t AND szi <> 0
      GROUP BY coin
    ),
    latest_sig AS (
      SELECT DISTINCT ON (coin) coin, s, contributors, actionable, ts
      FROM signal_track ORDER BY coin, ts DESC
    )
    SELECT v.coin, v.traders, v.longs, v.shorts, v.volume,
           s.s, s.contributors, s.actionable, s.ts
    FROM vol v LEFT JOIN latest_sig s USING (coin)
    ORDER BY v.volume DESC
    LIMIT $1`;
  const { rows } = await getPool().query(sql, [limit]);
  return rows.map((r): VaultSummary => ({
    coin: r.coin,
    traders: Number(r.traders),
    longs: Number(r.longs),
    shorts: Number(r.shorts),
    volumeUsd: Number(r.volume),
    skew: r.s === null ? null : Number(r.s),
    contributors: r.contributors === null ? null : Number(r.contributors),
    direction: r.actionable === 'LONG' ? 'long' : r.actionable === 'SHORT' ? 'short' : 'flat',
    updatedAtMs: r.ts === null ? null : Number(r.ts),
  }));
}
