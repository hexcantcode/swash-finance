import type { MetaResponse, PerpDexsResponse, SpotMetaResponse } from './types.js';

export interface AssetMeta {
  /** Coin symbol as it appears in fills (includes HIP-3 prefix when applicable). */
  coin: string;
  /** HL asset id used in order requests. */
  assetId: number;
  /** Decimal places for size. */
  szDecimals: number;
  /** Maximum allowed leverage. */
  maxLeverage: number;
  /** Source dex name; null for the main perp dex. */
  dex: string | null;
  /** Asset class: 'perp' on main dex, 'hip3' for HIP-3, 'spot' for spot. */
  kind: 'perp' | 'hip3' | 'spot';
  /** Whether the asset is delisted. */
  isDelisted: boolean;
}

export interface AssetLookup {
  /** Main-dex perp + spot assets keyed by their bare symbol. */
  byCoin: Map<string, AssetMeta>;
  /** All HIP-3 dex names known at lookup time (for fast `dex:SYMBOL` classification). */
  hip3Dexes: Set<string>;
}

/**
 * Build a coin-keyed lookup table for known assets.
 *
 * Asset id rules:
 * - Main perp dex: index in `meta.universe`
 * - Spot pair: 10000 + spotIndex
 *
 * HIP-3 perp metadata isn't returned by `perpDexs` directly (it lists dexes,
 * not their universes). Slice A doesn't place orders, so we keep `dex:SYMBOL`
 * coins as informational only — kind=hip3, dex set, no asset id. Order
 * placement (v1) will fetch each dex's meta on demand.
 */
export function buildAssetLookup(input: {
  meta: MetaResponse;
  perpDexs: PerpDexsResponse;
  spotMeta: SpotMetaResponse;
}): AssetLookup {
  const byCoin = new Map<string, AssetMeta>();

  input.meta.universe.forEach((u, i) => {
    byCoin.set(u.name, {
      coin: u.name,
      assetId: i,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      dex: null,
      kind: 'perp',
      isDelisted: u.isDelisted === true,
    });
  });

  input.spotMeta.universe.forEach((u, i) => {
    byCoin.set(u.name, {
      coin: u.name,
      assetId: 10_000 + i,
      szDecimals: 0,
      maxLeverage: 1,
      dex: null,
      kind: 'spot',
      isDelisted: false,
    });
  });

  const hip3Dexes = new Set<string>();
  for (const dex of input.perpDexs) {
    if (dex) hip3Dexes.add(dex.name);
  }

  return { byCoin, hip3Dexes };
}

export function classifyCoin(
  coin: string,
  lookup: AssetLookup,
): AssetMeta {
  const split = splitHip3Coin(coin);
  if (split.dex !== null) {
    return {
      coin,
      assetId: -1,
      szDecimals: 0,
      maxLeverage: 1,
      dex: split.dex,
      kind: 'hip3',
      isDelisted: false,
    };
  }
  const direct = lookup.byCoin.get(coin);
  if (direct) return direct;
  return {
    coin,
    assetId: -1,
    szDecimals: 0,
    maxLeverage: 1,
    dex: null,
    kind: 'perp',
    isDelisted: false,
  };
}

export function isHip3Coin(coin: string): boolean {
  return coin.includes(':');
}

export function splitHip3Coin(coin: string): { dex: string | null; symbol: string } {
  const idx = coin.indexOf(':');
  if (idx === -1) return { dex: null, symbol: coin };
  return { dex: coin.slice(0, idx), symbol: coin.slice(idx + 1) };
}
