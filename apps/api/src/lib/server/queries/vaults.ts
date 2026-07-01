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
