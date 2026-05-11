/**
 * calibrate-curves.ts — metric-distribution research / curve-calibration tool.
 *
 * Replays the J-1 scoring data path (master+agents → daily series → daily
 * returns) over a sample of Hyperliquid wallets and dumps the distribution of
 * the 7 raw basket metrics (plus the two track-record-scaled Sharpe/Sortino).
 * (`expectancy` was dropped from the basket in the 2026-05-11 calibration —
 * raw-USD, scale-dependent, undiscriminating near zero — so it is no longer
 * summarised here.)
 * The point: replace the PROVISIONAL eyeballed knots in
 * packages/scoring/src/curves.ts with values grounded in the real
 * distribution — pick curve knots near the p10/p25/p50/p75/p90 of each metric.
 *
 * This is a runbook script, not production code. Per-wallet failures are
 * logged and skipped.
 *
 * Usage:
 *   tsx src/scripts/calibrate-curves.ts [--source=db|leaderboard] [--limit=N] [--out=PATH]
 *
 *   --source=db          (default) addresses from `wallets` where
 *                        ingest_state in ('scored','ingested'), is_agent=false.
 *   --source=leaderboard addresses from the `leader_cache` table.
 *   --limit=N            cap wallets processed (default 300).
 *   --out=PATH           also write a per-wallet CSV.
 */
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { fills, fundings, ledgerUpdates, leaderCache, wallets } from '@copytrade/db';
import {
  annualizedSortino,
  buildDailySeries,
  dailySharpe,
  maxDrawdownPct,
  medianComposite,
  monthlyConsistency,
  probabilisticSharpe,
  profitFactor,
  recoveryTimeDays,
  toDailyReturns,
  trackRecordMultiplier,
} from '@copytrade/scoring';
import { quantile } from 'simple-statistics';
import { db, closeDb } from '../db.js';
import { log } from '../log.js';
import { writeFileSync } from 'node:fs';

const MS_DAY = 24 * 60 * 60 * 1000;
const MIN_FILLS_FOR_SCORING = 10;
const CURATED_THRESHOLD = 70;
const SQRT_365 = Math.sqrt(365);

interface CliFlags {
  source: 'db' | 'leaderboard';
  limit: number;
  out: string | null;
}

function parseFlags(argv: string[]): CliFlags {
  const raw: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) raw[arg.slice(2)] = 'true';
    else raw[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
  }
  const source = raw['source'] === 'leaderboard' ? 'leaderboard' : 'db';
  const limit =
    raw['limit'] !== undefined && Number.isFinite(Number.parseInt(raw['limit'], 10))
      ? Math.max(1, Number.parseInt(raw['limit'], 10))
      : 300;
  const out = raw['out'] && raw['out'] !== 'true' ? raw['out'] : null;
  return { source, limit, out };
}

async function collectMasterAndAgents(masterAddress: string): Promise<string[]> {
  const rows = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(or(eq(wallets.address, masterAddress), eq(wallets.masterAddress, masterAddress)));
  return rows.map((r) => r.address);
}

function estimateInitialDeposit(rows: Array<{ usdc: string | null; type: string }>): number {
  for (const r of rows) {
    if (r.type === 'deposit' && r.usdc !== null) return Number.parseFloat(r.usdc);
  }
  return 1000;
}

async function loadCandidateAddresses(flags: CliFlags): Promise<string[]> {
  if (flags.source === 'leaderboard') {
    const rows = await db().select({ address: leaderCache.address }).from(leaderCache);
    return rows.map((r) => r.address).slice(0, flags.limit);
  }
  // Order by total_fills desc so a small --limit hits wallets that actually
  // have a history (the calibration target), not freshly-ingested stubs.
  const rows = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(
      and(inArray(wallets.ingestState, ['scored', 'ingested']), eq(wallets.isAgent, false)),
    )
    .orderBy(desc(wallets.totalFills))
    .limit(flags.limit);
  return rows.map((r) => r.address);
}

/** The 9 quantities we summarise, in display order. */
const QUANTITY_KEYS = [
  'sharpe',
  'sortino',
  'psr',
  'profitFactor',
  'maxDrawdownPct',
  'recoveryTimeDays',
  'monthlyConsistency',
  'sharpeScaled',
  'sortinoScaled',
] as const;
type QuantityKey = (typeof QUANTITY_KEYS)[number];

interface WalletRow {
  address: string;
  daysOfData: number;
  activeDays: number;
  metrics: Record<QuantityKey, number | null>;
  composite: number | null;
}

interface FetchedData {
  fillsRows: Array<{
    blockTimeMs: number;
    closedPnl: string;
    fee: string;
    sz: string;
    px: string;
  }>;
  fundingsRows: Array<{ blockTimeMs: number; usdc: string }>;
  ledgerRows: Array<{ blockTimeMs: number; type: string; usdc: string | null }>;
}

async function fetchWalletData(masterAddress: string): Promise<FetchedData | null> {
  const addresses = await collectMasterAndAgents(masterAddress);
  if (addresses.length === 0) return null;
  const fillsRows = await db()
    .select({
      blockTimeMs: fills.blockTimeMs,
      closedPnl: fills.closedPnl,
      fee: fills.fee,
      sz: fills.sz,
      px: fills.px,
    })
    .from(fills)
    .where(inArray(fills.userAddress, addresses));
  if (fillsRows.length < MIN_FILLS_FOR_SCORING) return null;
  const fundingsRows = await db()
    .select({ blockTimeMs: fundings.blockTimeMs, usdc: fundings.usdc })
    .from(fundings)
    .where(inArray(fundings.userAddress, addresses));
  const ledgerRows = await db()
    .select({ blockTimeMs: ledgerUpdates.blockTimeMs, type: ledgerUpdates.type, usdc: ledgerUpdates.usdc })
    .from(ledgerUpdates)
    .where(inArray(ledgerUpdates.userAddress, addresses));
  return { fillsRows, fundingsRows, ledgerRows };
}

function buildSeriesAndReturns(data: FetchedData): {
  series: ReturnType<typeof buildDailySeries>;
  returns: number[];
  perTradePnl: number[];
  daysOfData: number;
} {
  const series = buildDailySeries({
    fills: data.fillsRows.map((f) => ({
      blockTimeMs: f.blockTimeMs,
      closedPnl: f.closedPnl,
      fee: f.fee,
      sz: f.sz,
      px: f.px,
    })),
    fundings: data.fundingsRows.map((f) => ({ blockTimeMs: f.blockTimeMs, usdc: f.usdc })),
    ledger: data.ledgerRows.map((l) => ({ blockTimeMs: l.blockTimeMs, type: l.type, usdc: l.usdc })),
  });
  const initialDeposit = estimateInitialDeposit(data.ledgerRows);
  const returns = toDailyReturns(series, initialDeposit);
  const perTradePnl = data.fillsRows.map(
    (f) => Number.parseFloat(f.closedPnl) - Number.parseFloat(f.fee),
  );
  const daysOfData =
    series.firstEventMs !== null && series.lastEventMs !== null
      ? Math.max(0, (series.lastEventMs - series.firstEventMs) / MS_DAY)
      : 0;
  return { series, returns, perTradePnl, daysOfData };
}

function fmtNum(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1000) return x.toFixed(0);
  if (Math.abs(x) >= 1) return x.toFixed(3);
  return x.toFixed(4);
}

function summarise(label: string, values: Array<number | null>): string {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const count = finite.length;
  if (count === 0) {
    return `${label.padEnd(20)} ${String(count).padStart(6)}  (no finite values)`;
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const q = (p: number) => quantile(sorted, p);
  const cols = [
    sorted[0]!,
    q(0.1),
    q(0.25),
    q(0.5),
    q(0.75),
    q(0.9),
    q(0.99),
    sorted[sorted.length - 1]!,
  ];
  return (
    `${label.padEnd(20)} ${String(count).padStart(6)}  ` +
    cols.map((c) => fmtNum(c).padStart(11)).join('')
  );
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  log.info({ ...flags }, 'calibrate.start');

  const addresses = await loadCandidateAddresses(flags);
  log.info({ candidateCount: addresses.length }, 'calibrate.candidates_loaded');
  if (addresses.length === 0) {
    console.log('No candidate wallets found. Nothing to do.');
    return;
  }

  // Single pass: each wallet's PSR uses its own daily Sharpe vs a 0 benchmark,
  // so no population statistics are needed.
  const rows: WalletRow[] = [];
  for (const address of addresses) {
    try {
      const data = await fetchWalletData(address);
      if (data === null) continue;
      const { series, returns, perTradePnl, daysOfData } = buildSeriesAndReturns(data);
      const ds = dailySharpe(returns);
      const sortinoDaily = (() => {
        const ann = annualizedSortino(returns);
        return ann === null ? null : ann / SQRT_365;
      })();
      const trm = trackRecordMultiplier(daysOfData);
      const sharpeScaled = ds === null ? null : ds * trm;
      const sortinoScaled = sortinoDaily === null ? null : sortinoDaily * trm;
      const psr = ds !== null && Number.isFinite(ds) ? probabilisticSharpe(returns, ds, 0) : null;
      const metrics: Record<QuantityKey, number | null> = {
        sharpe: ds,
        sortino: sortinoDaily,
        psr,
        // Same input as score.ts: per-trade pnl net of fees.
        profitFactor: profitFactor(perTradePnl),
        maxDrawdownPct: maxDrawdownPct(returns),
        recoveryTimeDays: recoveryTimeDays(returns),
        monthlyConsistency: monthlyConsistency(
          series.daily.map((r) => ({ dayKey: r.dayKey, pnl: r.pnl })),
        ),
        sharpeScaled,
        sortinoScaled,
      };
      const comp = medianComposite({
        metrics: {
          sharpe: sharpeScaled,
          sortino: sortinoScaled,
          psr,
          profitFactor: metrics.profitFactor,
          maxDrawdownPct: metrics.maxDrawdownPct,
          recoveryTimeDays: metrics.recoveryTimeDays,
          monthlyConsistency: metrics.monthlyConsistency,
        },
        daysOfData,
      });
      rows.push({
        address,
        daysOfData,
        activeDays: series.activeDays,
        metrics,
        composite: comp.score,
      });
    } catch (err: unknown) {
      log.warn(
        { address, err: err instanceof Error ? err.message : String(err) },
        'calibrate.wallet_failed',
      );
    }
  }

  log.info({ processed: rows.length }, 'calibrate.processed');

  // ---- Summary table ----
  console.log('');
  console.log(`=== Raw metric distribution over ${rows.length} wallets (source=${flags.source}, limit=${flags.limit}) ===`);
  console.log(
    'quantity'.padEnd(20) +
      ' '.repeat(7) +
      ['min', 'p10', 'p25', 'p50', 'p75', 'p90', 'p99', 'max'].map((h) => h.padStart(11)).join(''),
  );
  for (const key of QUANTITY_KEYS) {
    console.log(summarise(key, rows.map((r) => r.metrics[key])));
  }
  // Also: activeDays and daysOfData distributions (useful for the confidence cap).
  console.log(summarise('activeDays', rows.map((r) => r.activeDays)));
  console.log(summarise('daysOfData', rows.map((r) => r.daysOfData)));

  // ---- Composite under the current PROVISIONAL curves ----
  const composites = rows.map((r) => r.composite).filter((c): c is number => c !== null);
  console.log('');
  console.log('=== medianComposite().score under CURRENT PROVISIONAL curves ===');
  console.log(summarise('composite', composites));
  const clearing = composites.filter((c) => c >= CURATED_THRESHOLD).length;
  const pct = composites.length > 0 ? ((clearing / composites.length) * 100).toFixed(1) : '0.0';
  console.log(
    `Wallets with composite >= ${CURATED_THRESHOLD}: ${clearing} / ${composites.length} (${pct}%)`,
  );

  // ---- CSV ----
  if (flags.out) {
    const header = [
      'address',
      'daysOfData',
      'activeDays',
      'sharpe',
      'sortino',
      'psr',
      'profitFactor',
      'maxDrawdownPct',
      'recoveryTimeDays',
      'monthlyConsistency',
      'sharpeScaled',
      'sortinoScaled',
      'compositeProvisional',
    ];
    const csvNum = (x: number | null): string => (x === null || !Number.isFinite(x) ? '' : String(x));
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.address,
          csvNum(r.daysOfData),
          csvNum(r.activeDays),
          csvNum(r.metrics.sharpe),
          csvNum(r.metrics.sortino),
          csvNum(r.metrics.psr),
          csvNum(r.metrics.profitFactor),
          csvNum(r.metrics.maxDrawdownPct),
          csvNum(r.metrics.recoveryTimeDays),
          csvNum(r.metrics.monthlyConsistency),
          csvNum(r.metrics.sharpeScaled),
          csvNum(r.metrics.sortinoScaled),
          csvNum(r.composite),
        ].join(','),
      );
    }
    writeFileSync(flags.out, lines.join('\n') + '\n', 'utf8');
    console.log('');
    console.log(`Wrote per-wallet CSV: ${flags.out} (${rows.length} rows)`);
  }
}

main()
  .catch((err: unknown) => {
    log.error({ err: err instanceof Error ? err.stack : err }, 'calibrate.fatal');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
