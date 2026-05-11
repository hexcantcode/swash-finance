import { d, Decimal, dSum } from '@copytrade/shared';

/**
 * Inputs to the daily-return series builder. Mirrors the database row shapes
 * but accepts plain numbers/strings to avoid a tight coupling to drizzle types.
 */
export interface DailyReturnInputs {
  fills: Array<{
    blockTimeMs: number;
    closedPnl: Decimal.Value;
    fee: Decimal.Value;
    sz: Decimal.Value;
    px: Decimal.Value;
  }>;
  fundings: Array<{
    blockTimeMs: number;
    usdc: Decimal.Value;
  }>;
  ledger: Array<{
    blockTimeMs: number;
    type: string;
    usdc: Decimal.Value | null;
  }>;
}

export interface DailySeries {
  /** Per-day net PnL in USDC (deposits/withdrawals excluded). */
  daily: Array<{ dayKey: string; pnl: Decimal; deposits: Decimal; tradedNotional: Decimal }>;
  /** Sum of per-day pnls (already excludes deposits). */
  netPnl: Decimal;
  /** Sum of deposits minus withdrawals. */
  netDeposits: Decimal;
  /** Distinct active days (any fill, funding, or ledger event). */
  activeDays: number;
  firstEventMs: number | null;
  lastEventMs: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayKeyFromMs(ms: number): string {
  // UTC ISO date (yyyy-mm-dd) is timezone-stable and sorts lexicographically.
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Build a daily PnL series from on-chain events.
 *
 * Net PnL formula (spec [CRITICAL] section 9):
 *   gross = Σ(fills.closedPnl) + Σ(fundings.usdc) - Σ(fills.fee)
 *   netDeposits = Σ(deposit.usdc) - Σ(withdraw.usdc)
 *   netPnl = gross - netDeposits
 */
export function buildDailySeries(inputs: DailyReturnInputs): DailySeries {
  type Bucket = { pnl: Decimal; deposits: Decimal; tradedNotional: Decimal };
  const buckets = new Map<string, Bucket>();

  let firstEventMs: number | null = null;
  let lastEventMs: number | null = null;

  const observe = (ms: number) => {
    if (firstEventMs === null || ms < firstEventMs) firstEventMs = ms;
    if (lastEventMs === null || ms > lastEventMs) lastEventMs = ms;
  };

  const ensureBucket = (key: string): Bucket => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const fresh: Bucket = { pnl: d(0), deposits: d(0), tradedNotional: d(0) };
    buckets.set(key, fresh);
    return fresh;
  };

  for (const f of inputs.fills) {
    observe(f.blockTimeMs);
    const key = dayKeyFromMs(f.blockTimeMs);
    const bucket = ensureBucket(key);
    bucket.pnl = bucket.pnl.plus(d(f.closedPnl)).minus(d(f.fee));
    bucket.tradedNotional = bucket.tradedNotional.plus(d(f.px).times(d(f.sz)));
  }

  for (const fn of inputs.fundings) {
    observe(fn.blockTimeMs);
    const key = dayKeyFromMs(fn.blockTimeMs);
    const bucket = ensureBucket(key);
    bucket.pnl = bucket.pnl.plus(d(fn.usdc));
  }

  for (const l of inputs.ledger) {
    observe(l.blockTimeMs);
    if (l.usdc === null) continue;
    if (l.type !== 'deposit' && l.type !== 'withdraw') continue;
    const key = dayKeyFromMs(l.blockTimeMs);
    const bucket = ensureBucket(key);
    const signed = l.type === 'deposit' ? d(l.usdc) : d(l.usdc).negated();
    bucket.deposits = bucket.deposits.plus(signed);
  }

  const daily = Array.from(buckets.entries())
    .map(([dayKey, b]) => ({ dayKey, ...b }))
    .sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));

  const netPnl = dSum(daily.map((row) => row.pnl));
  const netDeposits = dSum(daily.map((row) => row.deposits));

  return {
    daily,
    netPnl,
    netDeposits,
    activeDays: daily.length,
    firstEventMs,
    lastEventMs,
  };
}

/** Floor on per-day returns. A daily return more negative than -99% is almost
 * always a sign that our capital-base estimate is wrong (e.g. trader was
 * funded by sub-account transfers we don't see), not a real -1000% day. We
 * clamp to keep downstream geometric-compounding metrics finite. */
const MIN_DAILY_RETURN = -0.99;

/**
 * Convert per-day PnL to per-day return ratio against a rolling capital base.
 *
 * Capital base is approximated as initial deposit + cumulative net deposits.
 * This is a defensible approximation when account-value snapshots are sparse;
 * a future improvement is to use clearinghouseState snapshots.
 */
export function toDailyReturns(
  series: DailySeries,
  initialDepositUsd: Decimal.Value = 0,
): number[] {
  const start = d(initialDepositUsd);
  if (series.daily.length === 0) return [];

  const returns: number[] = [];
  let capital = start;
  for (const row of series.daily) {
    capital = capital.plus(row.deposits);
    if (capital.lte(0)) {
      capital = capital.plus(row.pnl);
      continue;
    }
    const raw = row.pnl.div(capital).toNumber();
    if (!Number.isFinite(raw)) {
      capital = capital.plus(row.pnl);
      continue;
    }
    returns.push(raw < MIN_DAILY_RETURN ? MIN_DAILY_RETURN : raw);
    capital = capital.plus(row.pnl);
  }
  return returns;
}

/** Number of distinct days a series spans (calendar). */
export function spanDays(firstMs: number, lastMs: number): number {
  return Math.max(1, Math.ceil((lastMs - firstMs) / MS_PER_DAY) + 1);
}
