/**
 * Cross-venue asset map — the canonical bridge between HL analytics and
 * Lighter execution. **Lighter symbols are the canonical ids** (orders route
 * on them); `hlCoin` is the exact coin string the HL analytics side uses
 * (main-dex name, `kX` kilo-prefix, or `xyz:` HIP-3 prefix).
 *
 * Provenance: generated 2026-07-05 from live HL `meta`(+dex:xyz) × Lighter
 * `/api/v1/orderBooks`; every pair mark-price verified (<2% divergence) or
 * price-fingerprint alias-matched (<0.4%) — see docs/asset-map.md. 156 pairs.
 *
 * `major` marks the curated noise-cancel set (39). `untraded` marks Lighter
 * listings that were active but had no trades at verification time — re-verify
 * price before first order. `lighterMarketId` is the routing key; re-validate
 * ids against the live orderBooks endpoint on boot rather than trusting them
 * blindly across venue redeployments.
 */

export interface VenueAsset {
  /** Canonical id — Lighter's symbol. */
  symbol: string;
  /** Lighter order-routing market id (verify on boot). */
  lighterMarketId: number;
  /** HL coin string for the analytics side ('BTC', 'kPEPE', 'xyz:SP500'). */
  hlCoin: string;
  /** Curated majors set — the noise-cancel filter. */
  major?: boolean;
  /** Active on Lighter but untraded at generation time. */
  untraded?: boolean;
}

export const VENUE_ASSETS: readonly VenueAsset[] = [
  { symbol: '0G', lighterMarketId: 84, hlCoin: '0G' },
  { symbol: '1000BONK', lighterMarketId: 18, hlCoin: 'kBONK' },
  { symbol: '1000FLOKI', lighterMarketId: 19, hlCoin: 'kFLOKI' },
  { symbol: '1000PEPE', lighterMarketId: 4, hlCoin: 'kPEPE' },
  { symbol: '1000SHIB', lighterMarketId: 17, hlCoin: 'kSHIB' },
  { symbol: '2Z', lighterMarketId: 88, hlCoin: '2Z' },
  { symbol: 'AAVE', lighterMarketId: 27, hlCoin: 'AAVE', major: true },
  { symbol: 'ADA', lighterMarketId: 39, hlCoin: 'ADA', major: true },
  { symbol: 'AERO', lighterMarketId: 65, hlCoin: 'AERO' },
  { symbol: 'APEX', lighterMarketId: 86, hlCoin: 'APEX' },
  { symbol: 'APT', lighterMarketId: 31, hlCoin: 'APT', major: true },
  { symbol: 'ARB', lighterMarketId: 50, hlCoin: 'ARB' },
  { symbol: 'ASTER', lighterMarketId: 83, hlCoin: 'ASTER' },
  { symbol: 'AVAX', lighterMarketId: 9, hlCoin: 'AVAX', major: true },
  { symbol: 'AVNT', lighterMarketId: 82, hlCoin: 'AVNT' },
  { symbol: 'AXS', lighterMarketId: 131, hlCoin: 'AXS' },
  { symbol: 'AZTEC', lighterMarketId: 144, hlCoin: 'AZTEC' },
  { symbol: 'BCH', lighterMarketId: 58, hlCoin: 'BCH', major: true },
  { symbol: 'BERA', lighterMarketId: 20, hlCoin: 'BERA' },
  { symbol: 'BIO', lighterMarketId: 171, hlCoin: 'BIO' },
  { symbol: 'BNB', lighterMarketId: 25, hlCoin: 'BNB', major: true },
  { symbol: 'BTC', lighterMarketId: 1, hlCoin: 'BTC', major: true },
  { symbol: 'CC', lighterMarketId: 101, hlCoin: 'CC' },
  { symbol: 'CHIP', lighterMarketId: 163, hlCoin: 'CHIP' },
  { symbol: 'CRV', lighterMarketId: 36, hlCoin: 'CRV' },
  { symbol: 'DASH', lighterMarketId: 127, hlCoin: 'DASH' },
  { symbol: 'DOGE', lighterMarketId: 3, hlCoin: 'DOGE', major: true },
  { symbol: 'DOT', lighterMarketId: 11, hlCoin: 'DOT', major: true },
  { symbol: 'DYDX', lighterMarketId: 62, hlCoin: 'DYDX' },
  { symbol: 'EIGEN', lighterMarketId: 49, hlCoin: 'EIGEN' },
  { symbol: 'ENA', lighterMarketId: 29, hlCoin: 'ENA' },
  { symbol: 'ETH', lighterMarketId: 0, hlCoin: 'ETH', major: true },
  { symbol: 'ETHFI', lighterMarketId: 64, hlCoin: 'ETHFI' },
  { symbol: 'FARTCOIN', lighterMarketId: 21, hlCoin: 'FARTCOIN' },
  { symbol: 'FIL', lighterMarketId: 103, hlCoin: 'FIL' },
  { symbol: 'FOGO', lighterMarketId: 124, hlCoin: 'FOGO' },
  { symbol: 'GMX', lighterMarketId: 61, hlCoin: 'GMX' },
  { symbol: 'GRAM', lighterMarketId: 12, hlCoin: 'GRAM' },
  { symbol: 'GRASS', lighterMarketId: 52, hlCoin: 'GRASS' },
  { symbol: 'HBAR', lighterMarketId: 59, hlCoin: 'HBAR' },
  { symbol: 'HYPE', lighterMarketId: 24, hlCoin: 'HYPE', major: true },
  { symbol: 'ICP', lighterMarketId: 102, hlCoin: 'ICP' },
  { symbol: 'JTO', lighterMarketId: 134, hlCoin: 'JTO' },
  { symbol: 'JUP', lighterMarketId: 26, hlCoin: 'JUP' },
  { symbol: 'KAITO', lighterMarketId: 33, hlCoin: 'KAITO' },
  { symbol: 'LDO', lighterMarketId: 46, hlCoin: 'LDO' },
  { symbol: 'LINEA', lighterMarketId: 76, hlCoin: 'LINEA' },
  { symbol: 'LINK', lighterMarketId: 8, hlCoin: 'LINK', major: true },
  { symbol: 'LIT', lighterMarketId: 120, hlCoin: 'LIT' },
  { symbol: 'LTC', lighterMarketId: 35, hlCoin: 'LTC', major: true },
  { symbol: 'MEGA', lighterMarketId: 94, hlCoin: 'MEGA' },
  { symbol: 'MET', lighterMarketId: 95, hlCoin: 'MET' },
  { symbol: 'MNT', lighterMarketId: 63, hlCoin: 'MNT' },
  { symbol: 'MON', lighterMarketId: 91, hlCoin: 'MON' },
  { symbol: 'MORPHO', lighterMarketId: 68, hlCoin: 'MORPHO' },
  { symbol: 'NEAR', lighterMarketId: 10, hlCoin: 'NEAR', major: true },
  { symbol: 'ONDO', lighterMarketId: 38, hlCoin: 'ONDO' },
  { symbol: 'OP', lighterMarketId: 55, hlCoin: 'OP' },
  { symbol: 'PAXG', lighterMarketId: 48, hlCoin: 'PAXG' },
  { symbol: 'PENDLE', lighterMarketId: 37, hlCoin: 'PENDLE' },
  { symbol: 'PENGU', lighterMarketId: 47, hlCoin: 'PENGU' },
  { symbol: 'POL', lighterMarketId: 14, hlCoin: 'POL' },
  { symbol: 'POPCAT', lighterMarketId: 23, hlCoin: 'POPCAT' },
  { symbol: 'PROVE', lighterMarketId: 57, hlCoin: 'PROVE' },
  { symbol: 'PUMP', lighterMarketId: 45, hlCoin: 'PUMP' },
  { symbol: 'PYTH', lighterMarketId: 78, hlCoin: 'PYTH' },
  { symbol: 'RESOLV', lighterMarketId: 51, hlCoin: 'RESOLV' },
  { symbol: 'S', lighterMarketId: 40, hlCoin: 'S' },
  { symbol: 'SEI', lighterMarketId: 32, hlCoin: 'SEI' },
  { symbol: 'SKR', lighterMarketId: 130, hlCoin: 'SKR' },
  { symbol: 'SKY', lighterMarketId: 79, hlCoin: 'SKY' },
  { symbol: 'SOL', lighterMarketId: 2, hlCoin: 'SOL', major: true },
  { symbol: 'SPX', lighterMarketId: 42, hlCoin: 'SPX' },
  { symbol: 'STABLE', lighterMarketId: 118, hlCoin: 'STABLE' },
  { symbol: 'STBL', lighterMarketId: 85, hlCoin: 'STBL' },
  { symbol: 'STRK', lighterMarketId: 104, hlCoin: 'STRK' },
  { symbol: 'SUI', lighterMarketId: 16, hlCoin: 'SUI', major: true },
  { symbol: 'SYRUP', lighterMarketId: 44, hlCoin: 'SYRUP' },
  { symbol: 'TAO', lighterMarketId: 13, hlCoin: 'TAO', major: true },
  { symbol: 'TIA', lighterMarketId: 67, hlCoin: 'TIA' },
  { symbol: 'TRUMP', lighterMarketId: 15, hlCoin: 'TRUMP' },
  { symbol: 'TRX', lighterMarketId: 43, hlCoin: 'TRX', major: true },
  { symbol: 'UNI', lighterMarketId: 30, hlCoin: 'UNI', major: true },
  { symbol: 'VIRTUAL', lighterMarketId: 41, hlCoin: 'VIRTUAL' },
  { symbol: 'VVV', lighterMarketId: 69, hlCoin: 'VVV' },
  { symbol: 'WIF', lighterMarketId: 5, hlCoin: 'WIF' },
  { symbol: 'WLD', lighterMarketId: 6, hlCoin: 'WLD' },
  { symbol: 'WLFI', lighterMarketId: 72, hlCoin: 'WLFI' },
  { symbol: 'XLM', lighterMarketId: 119, hlCoin: 'XLM' },
  { symbol: 'XMR', lighterMarketId: 77, hlCoin: 'XMR' },
  { symbol: 'XPL', lighterMarketId: 71, hlCoin: 'XPL' },
  { symbol: 'XRP', lighterMarketId: 7, hlCoin: 'XRP', major: true },
  { symbol: 'ZEC', lighterMarketId: 90, hlCoin: 'ZEC' },
  { symbol: 'ZK', lighterMarketId: 56, hlCoin: 'ZK' },
  { symbol: 'ZORA', lighterMarketId: 53, hlCoin: 'ZORA' },
  { symbol: 'ZRO', lighterMarketId: 60, hlCoin: 'ZRO' },
  { symbol: 'AAPL', lighterMarketId: 113, hlCoin: 'xyz:AAPL', major: true },
  { symbol: 'AMD', lighterMarketId: 138, hlCoin: 'xyz:AMD', major: true },
  { symbol: 'AMZN', lighterMarketId: 114, hlCoin: 'xyz:AMZN', major: true },
  { symbol: 'ARM', lighterMarketId: 206, hlCoin: 'xyz:ARM', untraded: true },
  { symbol: 'ASML', lighterMarketId: 151, hlCoin: 'xyz:ASML' },
  { symbol: 'AVGO', lighterMarketId: 210, hlCoin: 'xyz:AVGO', major: true, untraded: true },
  { symbol: 'BABA', lighterMarketId: 177, hlCoin: 'xyz:BABA' },
  { symbol: 'BB', lighterMarketId: 211, hlCoin: 'xyz:BB' },
  { symbol: 'BE', lighterMarketId: 196, hlCoin: 'xyz:BE', untraded: true },
  { symbol: 'BOT', lighterMarketId: 185, hlCoin: 'xyz:BOT' },
  { symbol: 'BRENTOIL', lighterMarketId: 159, hlCoin: 'xyz:BRENTOIL', major: true },
  { symbol: 'CBRS', lighterMarketId: 175, hlCoin: 'xyz:CBRS' },
  { symbol: 'COIN', lighterMarketId: 109, hlCoin: 'xyz:COIN', major: true },
  { symbol: 'CRCL', lighterMarketId: 121, hlCoin: 'xyz:CRCL' },
  { symbol: 'CRWV', lighterMarketId: 167, hlCoin: 'xyz:CRWV' },
  { symbol: 'DELL', lighterMarketId: 187, hlCoin: 'xyz:DELL' },
  { symbol: 'DRAM', lighterMarketId: 195, hlCoin: 'xyz:DRAM' },
  { symbol: 'EURUSD', lighterMarketId: 96, hlCoin: 'xyz:EUR' },
  { symbol: 'EWY', lighterMarketId: 166, hlCoin: 'xyz:EWY' },
  { symbol: 'GBPUSD', lighterMarketId: 97, hlCoin: 'xyz:GBP' },
  { symbol: 'GME', lighterMarketId: 176, hlCoin: 'xyz:GME', untraded: true },
  { symbol: 'GOOGL', lighterMarketId: 116, hlCoin: 'xyz:GOOGL', major: true },
  { symbol: 'HOOD', lighterMarketId: 108, hlCoin: 'xyz:HOOD', major: true },
  { symbol: 'HYUNDAIUSD', lighterMarketId: 160, hlCoin: 'xyz:HYUNDAI' },
  { symbol: 'IBM', lighterMarketId: 188, hlCoin: 'xyz:IBM' },
  { symbol: 'INTC', lighterMarketId: 137, hlCoin: 'xyz:INTC' },
  { symbol: 'LITE', lighterMarketId: 178, hlCoin: 'xyz:LITE' },
  { symbol: 'META', lighterMarketId: 117, hlCoin: 'xyz:META', major: true },
  { symbol: 'MINIMAX', lighterMarketId: 199, hlCoin: 'xyz:MINIMAX' },
  { symbol: 'MRVL', lighterMarketId: 174, hlCoin: 'xyz:MRVL' },
  { symbol: 'MSFT', lighterMarketId: 115, hlCoin: 'xyz:MSFT', major: true },
  { symbol: 'MSTR', lighterMarketId: 122, hlCoin: 'xyz:MSTR', major: true },
  { symbol: 'MU', lighterMarketId: 164, hlCoin: 'xyz:MU' },
  { symbol: 'NATGAS', lighterMarketId: 158, hlCoin: 'xyz:NATGAS', major: true },
  { symbol: 'NBIS', lighterMarketId: 189, hlCoin: 'xyz:NBIS' },
  { symbol: 'NOK', lighterMarketId: 208, hlCoin: 'xyz:NOK', untraded: true },
  { symbol: 'NOW', lighterMarketId: 191, hlCoin: 'xyz:NOW' },
  { symbol: 'NVDA', lighterMarketId: 110, hlCoin: 'xyz:NVDA', major: true },
  { symbol: 'ORCL', lighterMarketId: 165, hlCoin: 'xyz:ORCL' },
  { symbol: 'PLTR', lighterMarketId: 111, hlCoin: 'xyz:PLTR', major: true },
  { symbol: 'QCOM', lighterMarketId: 209, hlCoin: 'xyz:QCOM', untraded: true },
  { symbol: 'QNT', lighterMarketId: 190, hlCoin: 'xyz:QNT', untraded: true },
  { symbol: 'RKLB', lighterMarketId: 186, hlCoin: 'xyz:RKLB' },
  { symbol: 'SAMSUNGUSD', lighterMarketId: 162, hlCoin: 'xyz:SMSN' },
  { symbol: 'SKHYNIXUSD', lighterMarketId: 161, hlCoin: 'xyz:SKHX' },
  { symbol: 'SNDK', lighterMarketId: 139, hlCoin: 'xyz:SNDK' },
  { symbol: 'SPCX', lighterMarketId: 194, hlCoin: 'xyz:SPCX' },
  { symbol: 'STRC', lighterMarketId: 156, hlCoin: 'xyz:STRC' },
  { symbol: 'TSLA', lighterMarketId: 112, hlCoin: 'xyz:TSLA', major: true },
  { symbol: 'TSM', lighterMarketId: 168, hlCoin: 'xyz:TSM', major: true },
  { symbol: 'US100', lighterMarketId: 181, hlCoin: 'xyz:XYZ100' },
  { symbol: 'US500', lighterMarketId: 180, hlCoin: 'xyz:SP500', major: true },
  { symbol: 'USDJPY', lighterMarketId: 98, hlCoin: 'xyz:JPY' },
  { symbol: 'WTI', lighterMarketId: 145, hlCoin: 'xyz:CL' },
  { symbol: 'XAG', lighterMarketId: 93, hlCoin: 'xyz:SILVER', major: true },
  { symbol: 'XAU', lighterMarketId: 92, hlCoin: 'xyz:GOLD', major: true },
  { symbol: 'XCU', lighterMarketId: 136, hlCoin: 'xyz:COPPER' },
  { symbol: 'XPD', lighterMarketId: 146, hlCoin: 'xyz:PALLADIUM' },
  { symbol: 'XPT', lighterMarketId: 147, hlCoin: 'xyz:PLATINUM' },
  { symbol: 'ZHIPU', lighterMarketId: 205, hlCoin: 'xyz:ZHIPU' },
] as const;

const bySymbol = new Map(VENUE_ASSETS.map((a) => [a.symbol, a]));
const byHlCoin = new Map(VENUE_ASSETS.map((a) => [a.hlCoin, a]));

/** Lighter-canonical lookup. */
export function venueAssetBySymbol(symbol: string): VenueAsset | undefined {
  return bySymbol.get(symbol);
}

/** HL→canonical lookup (feed the analytics coin string, get the tradeable id). */
export function venueAssetByHlCoin(hlCoin: string): VenueAsset | undefined {
  return byHlCoin.get(hlCoin);
}

/** The noise-cancel majors, Lighter-canonical order. */
export const MAJOR_ASSETS: readonly VenueAsset[] = VENUE_ASSETS.filter((a) => a.major);
