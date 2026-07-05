# Cross-venue asset map — Hyperliquid (analytics) × Lighter (execution)

**Generated 2026-07-05** from live APIs: HL `meta` (main perps, delisted excluded) + `meta dex:xyz` (HIP-3, xyz only per decision) × Lighter `/api/v1/orderBooks` (status=active, market_type=perp).

**Purpose:** analytics come from HL; execution is planned on Lighter — this is the tradeable intersection. ★ = proposed **Majors** set (noise-cancel filter). ⚠ = same ticker, possibly different instrument across venues — verify by price cross-check before use.

**Normalization:** HL `kX` ↔ Lighter `1000X` (e.g. kPEPE↔1000PEPE); HL `xyz:SYM` ↔ Lighter bare `SYM`. Lighter spot pairs (`X/USDC`) excluded.

## Counts
- HL main perps (active): 176 · HL xyz: 84 · Lighter perps (active): 197
- **Overlap: 96 crypto + 46 equities/commodities = 142 symbol-matched + 14 verified aliases = 156**

## Proposed Majors (noise-cancel) — 36

Crypto (20): BTC, ETH, SOL, XRP, DOGE, BNB, ADA, AVAX, LINK, SUI, HYPE, LTC, BCH, TRX, DOT, NEAR, APT, UNI, AAVE, TAO

Equities/commodities (16): NVDA, TSLA, AAPL, MSFT, AMZN, META, GOOGL, AMD, PLTR, COIN, MSTR, HOOD, TSM, AVGO, BRENTOIL, NATGAS

Criteria: deep liquidity + recognition on both venues. SP500, GOLD and SILVER ARE tradeable on Lighter via verified aliases (US500, XAU, XAG — see alias table); consider adding them to Majors. Lighter-only extras (FX crosses, SPY/QQQ ETFs, ANTHROPIC) have no HL analytics.

## Crypto overlap (HL main ∩ Lighter) — 96

| Symbol | HL name | Lighter market_id | min_base |
|---|---|---|---|
| 0G  | `0G` | 84 | 1.00 |
| 1000BONK  | `kBONK` | 18 | 500 |
| 1000FLOKI  | `kFLOKI` | 19 | 100 |
| 1000PEPE  | `kPEPE` | 4 | 500 |
| 1000SHIB  | `kSHIB` | 17 | 500 |
| 2Z  | `2Z` | 88 | 15.0 |
| AAVE ★ | `AAVE` | 27 | 0.050 |
| ADA ★ | `ADA` | 39 | 10.0 |
| AERO  | `AERO` | 65 | 10.0 |
| APEX  | `APEX` | 86 | 5.0 |
| APT ★ | `APT` | 31 | 2.00 |
| ARB  | `ARB` | 50 | 20.0 |
| ASTER  | `ASTER` | 83 | 20.0 |
| AVAX ★ | `AVAX` | 9 | 0.50 |
| AVNT  | `AVNT` | 82 | 10.0 |
| AXS  | `AXS` | 131 | 2.00 |
| AZTEC  | `AZTEC` | 144 | 400 |
| BCH ★ | `BCH` | 58 | 0.010 |
| BERA  | `BERA` | 20 | 3.0 |
| BIO  | `BIO` | 171 | 150 |
| BNB ★ | `BNB` | 25 | 0.02 |
| BTC ★ | `BTC` | 1 | 0.00020 |
| CC ⚠ | `CC` | 101 | 30.0 |
| CHIP ⚠ | `CHIP` | 163 | 10.0 |
| CRV  | `CRV` | 36 | 20.0 |
| DASH  | `DASH` | 127 | 0.100 |
| DOGE ★ | `DOGE` | 3 | 10 |
| DOT ★ | `DOT` | 11 | 2.0 |
| DYDX  | `DYDX` | 62 | 15.0 |
| EIGEN  | `EIGEN` | 49 | 5.0 |
| ENA  | `ENA` | 29 | 20.0 |
| ETH ★ | `ETH` | 0 | 0.0050 |
| ETHFI  | `ETHFI` | 64 | 10.0 |
| FARTCOIN  | `FARTCOIN` | 21 | 20.0 |
| FIL  | `FIL` | 103 | 5.0 |
| FOGO  | `FOGO` | 124 | 200 |
| GMX  | `GMX` | 61 | 0.30 |
| GRAM  | `GRAM` | 12 | 2.0 |
| GRASS  | `GRASS` | 52 | 10.0 |
| HBAR  | `HBAR` | 59 | 20.0 |
| HYPE ★ | `HYPE` | 24 | 0.50 |
| ICP  | `ICP` | 102 | 0.60 |
| JTO  | `JTO` | 134 | 20.0 |
| JUP  | `JUP` | 26 | 15.0 |
| KAITO  | `KAITO` | 33 | 10.0 |
| LDO  | `LDO` | 46 | 5.0 |
| LINEA  | `LINEA` | 76 | 100 |
| LINK ★ | `LINK` | 8 | 1.0 |
| LIT ⚠ | `LIT` | 120 | 2.00 |
| LTC ★ | `LTC` | 35 | 0.100 |
| MEGA  | `MEGA` | 94 | 15.0 |
| MET ⚠ | `MET` | 95 | 15.0 |
| MNT  | `MNT` | 63 | 10.0 |
| MON  | `MON` | 91 | 50.0 |
| MORPHO  | `MORPHO` | 68 | 3.0 |
| NEAR ★ | `NEAR` | 10 | 2.0 |
| ONDO  | `ONDO` | 38 | 10.0 |
| OP  | `OP` | 55 | 10.0 |
| PAXG  | `PAXG` | 48 | 0.0025 |
| PENDLE  | `PENDLE` | 37 | 3.00 |
| PENGU  | `PENGU` | 47 | 200 |
| POL  | `POL` | 14 | 40 |
| POPCAT  | `POPCAT` | 23 | 40.0 |
| PROVE  | `PROVE` | 57 | 10.0 |
| PUMP  | `PUMP` | 45 | 2000 |
| PYTH  | `PYTH` | 78 | 40.0 |
| RESOLV  | `RESOLV` | 51 | 40 |
| S ⚠ | `S` | 40 | 20.0 |
| SEI  | `SEI` | 32 | 50.0 |
| SKR  | `SKR` | 130 | 200 |
| SKY  | `SKY` | 79 | 100 |
| SOL ★ | `SOL` | 2 | 0.050 |
| SPX ⚠ | `SPX` | 42 | 5.0 |
| STABLE  | `STABLE` | 118 | 300 |
| STBL  | `STBL` | 85 | 15.0 |
| STRK  | `STRK` | 104 | 50.0 |
| SUI ★ | `SUI` | 16 | 3.0 |
| SYRUP  | `SYRUP` | 44 | 20.0 |
| TAO ★ | `TAO` | 13 | 0.050 |
| TIA  | `TIA` | 67 | 3.0 |
| TRUMP  | `TRUMP` | 15 | 0.20 |
| TRX ★ | `TRX` | 43 | 40.0 |
| UNI ★ | `UNI` | 30 | 1.00 |
| VIRTUAL  | `VIRTUAL` | 41 | 5.0 |
| VVV  | `VVV` | 69 | 3.00 |
| WIF  | `WIF` | 5 | 5.0 |
| WLD  | `WLD` | 6 | 5.0 |
| WLFI  | `WLFI` | 72 | 25.0 |
| XLM  | `XLM` | 119 | 30.0 |
| XMR  | `XMR` | 77 | 0.020 |
| XPL  | `XPL` | 71 | 10.0 |
| XRP ★ | `XRP` | 7 | 20 |
| ZEC  | `ZEC` | 90 | 0.100 |
| ZK  | `ZK` | 56 | 100 |
| ZORA  | `ZORA` | 53 | 100 |
| ZRO  | `ZRO` | 60 | 3.0 |

## Equities/commodities overlap (HL xyz ∩ Lighter) — 46

| Symbol | HL name | Lighter market_id | min_base |
|---|---|---|---|
| AAPL ★ | `xyz:AAPL` | 113 | 0.050 |
| AMD ★ | `xyz:AMD` | 138 | 0.0300 |
| AMZN ★ | `xyz:AMZN` | 114 | 0.050 |
| ARM  | `xyz:ARM` | 206 | 0.0300 |
| ASML  | `xyz:ASML` | 151 | 0.00400 |
| AVGO ★ | `xyz:AVGO` | 210 | 0.0300 |
| BABA  | `xyz:BABA` | 177 | 0.0400 |
| BB  | `xyz:BB` | 211 | 1.00 |
| BE  | `xyz:BE` | 196 | 0.0300 |
| BOT ⚠ | `xyz:BOT` | 185 | 0.200 |
| BRENTOIL ★ | `xyz:BRENTOIL` | 159 | 0.0500 |
| CBRS  | `xyz:CBRS` | 175 | 0.0100 |
| COIN ★ | `xyz:COIN` | 109 | 0.025 |
| CRCL  | `xyz:CRCL` | 121 | 0.100 |
| CRWV  | `xyz:CRWV` | 167 | 0.0400 |
| DELL  | `xyz:DELL` | 187 | 0.0150 |
| DRAM  | `xyz:DRAM` | 195 | 0.100 |
| EWY  | `xyz:EWY` | 166 | 0.0350 |
| GME  | `xyz:GME` | 176 | 0.250 |
| GOOGL ★ | `xyz:GOOGL` | 116 | 0.0300 |
| HOOD ★ | `xyz:HOOD` | 108 | 0.100 |
| IBM  | `xyz:IBM` | 188 | 0.0200 |
| INTC  | `xyz:INTC` | 137 | 0.100 |
| LITE  | `xyz:LITE` | 178 | 0.0100 |
| META ★ | `xyz:META` | 117 | 0.0200 |
| MINIMAX  | `xyz:MINIMAX` | 199 | 0.100 |
| MRVL  | `xyz:MRVL` | 174 | 0.0350 |
| MSFT ★ | `xyz:MSFT` | 115 | 0.0200 |
| MSTR ★ | `xyz:MSTR` | 122 | 0.0350 |
| MU  | `xyz:MU` | 164 | 0.0100 |
| NATGAS ★ | `xyz:NATGAS` | 158 | 2.00 |
| NBIS  | `xyz:NBIS` | 189 | 0.0200 |
| NOK  | `xyz:NOK` | 208 | 0.500 |
| NOW  | `xyz:NOW` | 191 | 0.0200 |
| NVDA ★ | `xyz:NVDA` | 110 | 0.050 |
| ORCL  | `xyz:ORCL` | 165 | 0.0400 |
| PLTR ★ | `xyz:PLTR` | 111 | 0.050 |
| QCOM  | `xyz:QCOM` | 209 | 0.0300 |
| QNT  | `xyz:QNT` | 190 | 0.080 |
| RKLB  | `xyz:RKLB` | 186 | 0.0400 |
| SNDK  | `xyz:SNDK` | 139 | 0.0100 |
| SPCX  | `xyz:SPCX` | 194 | 0.0400 |
| STRC  | `xyz:STRC` | 156 | 0.050 |
| TSLA ★ | `xyz:TSLA` | 112 | 0.0200 |
| TSM ★ | `xyz:TSM` | 168 | 0.0200 |
| ZHIPU  | `xyz:ZHIPU` | 205 | 0.0250 |

## Verification (2026-07-05, live mark-price cross-check)

All 142 symbol-matched pairs were price-checked HL-mid vs Lighter last-trade:
- **135 verified identical** (<2% divergence) — including every ⚠-flagged ticker, so
  those are CONFIRMED same-instrument (Lighter's SPX = SPX6900 memecoin, same as HL).
- **0 mismatches.**
- **7 unverifiable** (Lighter listing active but no recent trade): ARM, AVGO, BE, GME,
  NOK, QCOM, QNT — same-name equities, near-certainly the same instruments; re-check
  price at execution time before first order.

## Verified aliases (price-fingerprint matched, <0.4% divergence) — 14

Different names, same instrument — recovers the index/metal/FX markets, including the
three the sentiment UI leans on (SP500, GOLD, SILVER):

| HL name | Lighter symbol | Instrument |
|---|---|---|
| `xyz:SP500` | US500 | S&P 500 index |
| `xyz:XYZ100` | US100 | Nasdaq-100 index |
| `xyz:GOLD` | XAU | gold |
| `xyz:SILVER` | XAG | silver |
| `xyz:PLATINUM` | XPT | platinum |
| `xyz:PALLADIUM` | XPD | palladium |
| `xyz:COPPER` | XCU | copper |
| `xyz:CL` | WTI | WTI crude |
| `xyz:EUR` | EURUSD | EUR/USD |
| `xyz:GBP` | GBPUSD | GBP/USD |
| `xyz:JPY` | USDJPY | USD/JPY |
| `xyz:HYUNDAI` | HYUNDAIUSD | Hyundai |
| `xyz:SMSN` | SAMSUNGUSD | Samsung |
| `xyz:SKHX` | SKHYNIXUSD | SK Hynix |

**Total matched pairs: 142 + 14 = 156.**

Beware price-coincidence false friends found during matching (REJECTED, not aliases):
CAKE≈USDCAD, MELANIA≈MYX, BLUR≈ROBO, xyz:KR200≈OPENAI, xyz:SOFTBANK≈BOTZ — same price,
unrelated instruments. Fingerprint matching requires name semantics to agree too.

## Genuinely unmatched (no Lighter counterpart / no HL analytics)
- **HL-xyz only (~24):** AMAT, BX, COST, DKNG, EBAY, EWJ/EWT/EWZ, HIMS, JP225, KIOXIA,
  KR200, LLY, NFLX, RIVN, SMH, URNM (Lighter's URA is a *different* uranium ETF), USAR,
  WDC, XLE, ZM, SOFTBANK, BIRD, PURRDAT.
- **Lighter only:** SPY/QQQ/IWM ETFs (index *ETFs* — HL has the indexes; different
  instruments), USDKRW/CHF/HKD/CAD + AUDUSD/NZDUSD FX, WHEAT, TENCENT, XIAOMI, BYD,
  POPMART, SMIC, OPENAI, ANTHROPIC, H100, and assorted small caps/memes. No HL
  analytics → excluded.

## Execution-side fields (Lighter)
`orderBooks` carries per-market `market_id` (order routing key), `min_base_amount`, `taker_fee`/`maker_fee`, `liquidation_fee` — the constants the execution layer needs. Re-fetch on deploy rather than hardcoding.

## Next steps
1. ~~Confirm the ⚠ ambiguous tickers~~ DONE 2026-07-05 — all 135 tradeable pairs verified, 0 mismatches; aliases resolved.
2. Decide the final Majors set (trim/extend the ★ proposal).
3. Encode the map as a versioned constant (e.g. `packages/shared/src/asset-map.ts`) with `{symbol, hlName, hlDex, lighterMarketId, major}` once execution work starts — this doc is the source until then.
