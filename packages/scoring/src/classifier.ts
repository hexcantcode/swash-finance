import type {
  AssetTag,
  CadenceTag,
  HeatTag,
  MainTag,
  RiskTag,
  SizeTag,
} from '@copytrade/shared';

export interface ClassifierInputs {
  totalTrades: number;
  activeDays: number;
  firstSeenDaysAgo: number;
  lastTradeDaysAgo: number;
  psr: number | null;
  maxDrawdownPct: number | null;
  assetConcentration: number;
  tradesPerDayAvg: number;
  primaryAsset: string | null;
  primaryAssetClass: AssetTag | null;
  avgHoldSeconds: number | null;
  totalVolumeUsd: number;
  recentRollingSharpe: number | null;
  peakRollingSharpe: number | null;
  longShortRatio: number | null;
  fundingPnlPct: number | null;
}

/**
 * Main behavioral tag.
 *
 * Quality tags (alpha_hunter, veteran) get priority over behavioral patterns
 * (specialist, insider): a high-PSR concentrated trader is primarily an alpha
 * hunter, even if their concentration would also flag them as specialist.
 *
 * Thresholds are tuned for our 90-day ingest window:
 *   - alpha_hunter `active_days >= 30` (sustained activity over ~a month).
 *   - veteran uses `active_days >= 60` instead of the 365 the spec calls for —
 *     we only see 90 days of history, so 60 active days = "active 2/3 of the
 *     window" is the strongest "long-term presence" signal we can compute.
 *   - dark_horse `total_trades < 200` (instead of 50) so the tag actually fires
 *     against discovery-sweep populations where every wallet has hundreds of fills.
 *
 * Returns null when none of the rules match — the wallet won't appear in /browse.
 */
export function classifyMainTag(m: ClassifierInputs): MainTag | null {
  // 1. Alpha hunter — proven directional skill at significant sample.
  //    `active_days >= 14` lets short-window high-frequency traders qualify
  //    too; the PSR > 0.95 floor and 100-trade minimum already filter noise.
  if (
    m.psr !== null &&
    m.psr > 0.95 &&
    m.totalTrades >= 100 &&
    m.activeDays >= 14 &&
    m.maxDrawdownPct !== null &&
    m.maxDrawdownPct < 0.3
  ) {
    return 'alpha_hunter';
  }

  // 2. Veteran — sustained presence and skill over the observable window.
  if (
    m.totalTrades >= 500 &&
    m.activeDays >= 60 &&
    m.psr !== null &&
    m.psr >= 0.8
  ) {
    return 'veteran';
  }

  // 3. Insider — fresh wallet, concentrated, event-driven cadence.
  if (
    m.firstSeenDaysAgo < 60 &&
    m.assetConcentration > 0.6 &&
    m.tradesPerDayAvg < 10 &&
    m.totalTrades >= 5
  ) {
    return 'insider';
  }

  // 4. Dark horse — small sample, high signal, recently active.
  if (
    m.totalTrades < 200 &&
    m.psr !== null &&
    m.psr > 0.85 &&
    m.lastTradeDaysAgo <= 30
  ) {
    return 'dark_horse';
  }

  // 5. Specialist — concentrated trader who didn't earn a quality tag.
  if (m.assetConcentration > 0.6 && m.totalTrades >= 50) {
    return 'specialist';
  }

  return null;
}

export function classifyCadence(avgHoldSeconds: number | null): CadenceTag | null {
  if (avgHoldSeconds === null) return null;
  const minute = 60;
  const hour = 60 * 60;
  const day = 24 * hour;
  if (avgHoldSeconds < 5 * minute) return 'scalp';
  if (avgHoldSeconds < day) return 'intraday';
  if (avgHoldSeconds < 7 * day) return 'swing';
  return 'position';
}

export function classifyRisk(
  maxDrawdownPct: number | null,
  longShortRatio: number | null,
): RiskTag | null {
  if (maxDrawdownPct === null) return null;
  if (maxDrawdownPct < 0.15) return 'conservative';
  if (maxDrawdownPct < 0.4) return 'balanced';
  return 'aggressive';
  // longShortRatio reserved for future tuning of risk classification
  void longShortRatio;
}

export function classifyHeat(
  recentSharpe: number | null,
  peakSharpe: number | null,
): HeatTag | null {
  if (recentSharpe === null || peakSharpe === null || peakSharpe <= 0) return null;
  const ratio = recentSharpe / peakSharpe;
  if (ratio >= 0.85) return 'hot';
  if (ratio >= 0.5) return 'steady';
  return 'cooling';
}

export function classifySize(totalVolumeUsd: number): SizeTag {
  if (totalVolumeUsd >= 100_000_000) return 'whale';
  if (totalVolumeUsd >= 10_000_000) return 'mid';
  if (totalVolumeUsd >= 1_000_000) return 'small';
  return 'micro';
}

/**
 * Map a coin (with optional HIP-3 prefix) to an asset class tag.
 * Used both for per-fill classification (during ingestion) and for the
 * wallet-level "primary asset class" derived from primaryAsset.
 */
export function classifyAssetClass(
  coin: string,
  hip3Dexes: Set<string>,
): AssetTag {
  const colon = coin.indexOf(':');
  if (colon !== -1) {
    const dex = coin.slice(0, colon);
    if (hip3Dexes.has(dex)) {
      const lowerDex = dex.toLowerCase();
      if (lowerDex.includes('stock')) return 'stocks';
    }
  }
  const symbol = colon === -1 ? coin : coin.slice(colon + 1);
  const upper = symbol.toUpperCase();
  if (upper === 'BTC' || upper === 'ETH' || upper === 'SOL') return 'bluechip';
  if (
    upper.includes('PEPE') ||
    upper.includes('DOGE') ||
    upper.includes('SHIB') ||
    upper.includes('WIF') ||
    upper.includes('BONK') ||
    upper.includes('TRUMP') ||
    upper.includes('MEME')
  ) {
    return 'meme';
  }
  return 'altcoin';
}
