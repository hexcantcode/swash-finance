import { d, Decimal } from '@copytrade/shared';

export interface BehavioralFill {
  blockTimeMs: number;
  coin: string;
  side: 'B' | 'A';
  px: Decimal.Value;
  sz: Decimal.Value;
  startPosition: Decimal.Value | null;
  crossed: boolean;
  /** HL-reported booked PnL on the *closing* portion of this fill. Zero on
   *  opens; signed on partial/full closes. We carry it here so behavioral
   *  can attribute fill-level PnL to the round-trip cycle it belongs to. */
  closedPnl: Decimal.Value;
  /** Fee paid on this fill — also rolled into the cycle's running PnL. */
  fee: Decimal.Value;
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
  /** Net PnL (Σ closedPnl − Σ fee across every fill inside the cycle) per
   *  completed round trip. One entry per `roundTrips`. The right input for
   *  per-trade win-rate / profit-factor / expectancy — `winRate(arr)` here
   *  produces "% of round trips that were profitable", the convention every
   *  hedge-fund factsheet means by "win rate". */
  roundTripPnls: number[];
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
      roundTripPnls: [],
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
  const roundTripPnls = computeRoundTripPnls(sortedByTime);

  return {
    avgHoldSeconds,
    tradesPerDayAvg,
    makerTakerRatio,
    assetConcentration: herfindahl,
    primaryAsset,
    longShortRatio,
    uniqueAssets: perCoinNotional.size,
    totalNotional,
    roundTrips: roundTripPnls.length,
    roundTripPnls,
  };
}

/**
 * For each per-coin round trip — position open→flat (or flip-through-zero
 * counts as one close + one new open) — return the cycle's net PnL:
 *
 *     Σ (closedPnl − fee) across every fill inside the cycle, opens included.
 *
 * The opening fill has `closedPnl = 0` so it contributes only its `−fee`;
 * intermediate adds same; reducing/closing fills contribute HL's booked
 * `closedPnl − fee`. Summing them gives the realized PnL for the whole
 * trade as the user experienced it.
 *
 * Uses HL's `startPosition` (position *before* the fill) so no running-
 * position reconstruction is needed; null `startPosition` ⇒ treated as flat
 * (the fill is an open). Cycles that haven't closed yet (position still open
 * at the end of the fills window) are intentionally excluded — their PnL is
 * not yet decided.
 *
 * Returns one entry per completed round trip; `roundTrips = arr.length`.
 */
function computeRoundTripPnls(sorted: BehavioralFill[]): number[] {
  const cycles: number[] = [];
  // Per-coin running net PnL for the currently-open cycle. Coin is removed
  // from the map when the cycle closes flat; reset to 0 when it crosses
  // zero (the new direction is a fresh cycle starting from this fill).
  const openCycle = new Map<string, number>();

  for (const f of sorted) {
    const start = f.startPosition !== null ? d(f.startPosition) : d(0);
    const fillNet =
      Number.parseFloat(String(f.closedPnl)) - Number.parseFloat(String(f.fee));

    if (start.isZero()) {
      // Opening from flat — start a new cycle on this coin. Stack onto any
      // residual entry (shouldn't exist for a clean dataset, but be safe).
      openCycle.set(f.coin, (openCycle.get(f.coin) ?? 0) + fillNet);
      continue;
    }

    // Fill modifies an existing position. Roll its PnL into the open cycle.
    const running = (openCycle.get(f.coin) ?? 0) + fillNet;

    const signed = f.side === 'B' ? d(f.sz) : d(f.sz).negated();
    const result = start.plus(signed);
    const startedLong = start.gt(0);
    const closedFlat = result.isZero();
    const crossed = startedLong ? result.lt(0) : result.gt(0);

    if (closedFlat) {
      cycles.push(running);
      openCycle.delete(f.coin);
    } else if (crossed) {
      // Old cycle closes here (with running PnL); a new one opens on the
      // other side from the same fill. The fee was attributed entirely to
      // the closing cycle above (slight pessimism — typically immaterial,
      // and avoids fragile fee-splitting between the two halves of one
      // fill).
      cycles.push(running);
      openCycle.set(f.coin, 0);
    } else {
      // Partial reduce or add — cycle keeps running.
      openCycle.set(f.coin, running);
    }
  }
  return cycles;
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
