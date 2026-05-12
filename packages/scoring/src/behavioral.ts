import { d, Decimal } from '@copytrade/shared';

export interface BehavioralFill {
  blockTimeMs: number;
  coin: string;
  side: 'B' | 'A';
  px: Decimal.Value;
  sz: Decimal.Value;
  startPosition: Decimal.Value | null;
  crossed: boolean;
}

export interface BehavioralMetrics {
  avgHoldSeconds: number | null;
  tradesPerDayAvg: number;
  makerTakerRatio: number; // maker_volume / total_volume
  assetConcentration: number; // Herfindahl on volume
  primaryAsset: string | null;
  longShortRatio: number | null; // sum(buy_sz) / sum(sell_sz)
  uniqueAssets: number;
  totalNotional: Decimal;
  /** Real round-trip count: per-coin position open→flat (or flip-through-zero)
   *  events. A far better sample-size proxy than raw fill count. */
  roundTrips: number;
}

export function computeBehavioral(
  fills: BehavioralFill[],
  args: { activeDays: number },
): BehavioralMetrics {
  if (fills.length === 0) {
    return {
      avgHoldSeconds: null,
      tradesPerDayAvg: 0,
      makerTakerRatio: 0,
      assetConcentration: 0,
      primaryAsset: null,
      longShortRatio: null,
      uniqueAssets: 0,
      totalNotional: d(0),
      roundTrips: 0,
    };
  }

  const sortedByTime = [...fills].sort((a, b) => a.blockTimeMs - b.blockTimeMs);

  let totalNotional = d(0);
  let makerNotional = d(0);
  const perCoinNotional = new Map<string, Decimal>();
  let buySize = d(0);
  let sellSize = d(0);

  for (const f of sortedByTime) {
    const notional = d(f.px).times(d(f.sz));
    totalNotional = totalNotional.plus(notional);
    if (!f.crossed) makerNotional = makerNotional.plus(notional);
    perCoinNotional.set(f.coin, (perCoinNotional.get(f.coin) ?? d(0)).plus(notional));
    if (f.side === 'B') buySize = buySize.plus(d(f.sz));
    else sellSize = sellSize.plus(d(f.sz));
  }

  const makerTakerRatio = totalNotional.gt(0)
    ? makerNotional.div(totalNotional).toNumber()
    : 0;

  let primaryAsset: string | null = null;
  let primaryNotional = d(0);
  let herfindahl = 0;
  for (const [coin, notional] of perCoinNotional.entries()) {
    if (notional.gt(primaryNotional)) {
      primaryAsset = coin;
      primaryNotional = notional;
    }
    if (totalNotional.gt(0)) {
      const share = notional.div(totalNotional).toNumber();
      herfindahl += share * share;
    }
  }

  const longShortRatio = sellSize.gt(0) ? buySize.div(sellSize).toNumber() : null;

  const tradesPerDayAvg = args.activeDays > 0 ? fills.length / args.activeDays : fills.length;

  const avgHoldSeconds = computeAvgHoldSeconds(sortedByTime);
  const roundTrips = countRoundTrips(sortedByTime);

  return {
    avgHoldSeconds,
    tradesPerDayAvg,
    makerTakerRatio,
    assetConcentration: herfindahl,
    primaryAsset,
    longShortRatio,
    uniqueAssets: perCoinNotional.size,
    totalNotional,
    roundTrips,
  };
}

/**
 * Count completed round trips: per coin, every fill that takes a non-zero
 * position to flat — or flips it through zero to the other side — closes one
 * round trip. Partial reductions don't count; only the fill that hits/crosses
 * zero does. Uses HL's `startPosition` (position *before* the fill) so no
 * running-position reconstruction is needed; null `startPosition` ⇒ treated as
 * flat (the fill is an open, not a close).
 */
function countRoundTrips(sorted: BehavioralFill[]): number {
  let count = 0;
  for (const f of sorted) {
    const start = f.startPosition !== null ? d(f.startPosition) : d(0);
    if (start.isZero()) continue; // opening from flat — no round trip closed
    const signed = f.side === 'B' ? d(f.sz) : d(f.sz).negated();
    const result = start.plus(signed);
    // Closed if it lands exactly flat, or crosses zero (sign flip).
    const startedLong = start.gt(0);
    if (result.isZero() || (startedLong ? result.lt(0) : result.gt(0))) count += 1;
  }
  return count;
}

/**
 * Approximate average position-hold duration via FIFO matching of opens
 * against closes per coin. When startPosition flips sign, that's an open.
 * When position returns to zero on the same coin, that's a close.
 *
 * This is a heuristic — exact hold matching requires position-aware accounting
 * across the whole fill history.
 */
function computeAvgHoldSeconds(sorted: BehavioralFill[]): number | null {
  type OpenBucket = { openMs: number; sizeRemaining: Decimal };
  const queues = new Map<string, OpenBucket[]>();
  const holds: number[] = [];

  for (const f of sorted) {
    const q = queues.get(f.coin) ?? [];
    const fillSz = d(f.sz);
    const start = f.startPosition !== null ? d(f.startPosition) : d(0);
    const sideSign = f.side === 'B' ? 1 : -1;
    const startSign = start.gt(0) ? 1 : start.lt(0) ? -1 : 0;

    if (startSign === 0 || startSign === sideSign) {
      // Opening or adding to existing position
      q.push({ openMs: f.blockTimeMs, sizeRemaining: fillSz });
    } else {
      // Reducing/closing the position; match FIFO against opens
      let remaining = fillSz;
      while (remaining.gt(0) && q.length > 0) {
        const head = q[0]!;
        if (head.sizeRemaining.lte(remaining)) {
          remaining = remaining.minus(head.sizeRemaining);
          holds.push((f.blockTimeMs - head.openMs) / 1000);
          q.shift();
        } else {
          head.sizeRemaining = head.sizeRemaining.minus(remaining);
          holds.push((f.blockTimeMs - head.openMs) / 1000);
          remaining = d(0);
        }
      }
      // Any remainder flips the position the other way
      if (remaining.gt(0)) {
        q.push({ openMs: f.blockTimeMs, sizeRemaining: remaining });
      }
    }
    queues.set(f.coin, q);
  }

  if (holds.length === 0) return null;
  return holds.reduce((acc, h) => acc + h, 0) / holds.length;
}
