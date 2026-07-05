# Lighter WS live data — plan for the HL→Lighter price/ticker switch

**Status:** Research verified live (2026-07-05). The venue split is decided:
**HL = analytics** (latest trades, top traders, sentiment — the EP/Hyperdash side),
**Lighter = everything executable** (prices, tickers, books, candles at execution
surfaces, and eventually orders). This doc covers the live-data half; signing/order
flow is the separate execution track (TS WASM signer verified viable 2026-07-01).

## Verified facts (probed live + official WS reference)

- **Endpoint:** `wss://mainnet.zklighter.elliot.ai/stream` (testnet same host pattern).
  Append `?readonly=true` for market-data-only connections.
- **Subscribe:** `{"type":"subscribe","channel":"<name>"}`; unsubscribe mirrors it.
- **Keepalive:** any frame at least every **2 minutes** or the server drops the
  connection. `permessage-deflate` supported.
- **`market_stats/all` — the workhorse.** One subscription → snapshot + updates for
  **all 214 markets**: `symbol`, `market_id`, `index_price`, `mark_price`,
  `mid_price`, `best_ask/bid_price`, `open_interest`, funding fields, daily stats.
  Measured: connect ~0.9s, snapshot+4 updates within 1.5s.
- **Candles:** `candle/{MARKET_ID}/{RES}` (1m…1d) and `mark_price_candle/...` — OHLCV
  push per market, matches our chart ranges.
- **Trades:** `trade/{MARKET_ID}` — public, includes both account ids, fees, position
  deltas (the channel the Lighter-native analytics plan would collect).
- **Ticker/BBO:** `ticker/{MARKET_ID}`; **order book:** `order_book/{MARKET_ID}` (50ms).
- **Account channels** (auth): `account_all/{id}`, `user_stats/{id}`,
  `account_all_positions/{id}`, orders/trades/tx variants — the execution track's
  live position/fill feedback.
- **Pool channels:** `pool_info/{id}` exposes operator_fee, APY, share prices — worth
  a look for the Conviction Vault share-accounting comparison.
- **WS tx submission exists** (`jsonapi/sendtx`, batch up to 15) — orders can go over
  the same socket (needs SignerClient-built tx_info).
- **No SDK needed for market data** — plain WebSocket + JSON. The SDK (WASM signer)
  is only needed for signing/account channels.

## Architecture: swap the upstream, keep the contract

Today: `apps/api/src/lib/server/live-prices.ts` — a singleton that REST-polls HL
`allMids` every 1s and fans out deltas to `/api/stream/prices` (SSE). Mobile never
touches a venue socket (BFF invariant).

Target: same singleton pattern, same SSE contract, new upstream:

```
Lighter WS market_stats/all ──┐
                              ├─→ livePrices {symbol → price} ─→ SSE /api/stream/prices
HL allMids poll (fallback) ───┘
```

- One shared `readonly=true` WS in the BFF (`$lib/server/lighter-ws.ts`): connect,
  subscribe `market_stats/all`, translate `market_id/symbol` → canonical symbol via
  `@copytrade/shared` `VENUE_ASSETS` (Lighter symbols ARE canonical), emit deltas.
- Price identity: use `mark_price` (execution-truth) for tradeable symbols.
- **Coverage rule:** symbols in the asset map stream from Lighter; HL-only coins
  (analytics pages for unmatched assets) keep the HL poll as fallback. The two merge
  in livePrices with venue precedence: Lighter > HL.
- Reconnect: exponential backoff + resubscribe; ping every 60s (2-min rule); on socket
  loss fall back to the HL poll so the ticker never blanks.
- `lighterMarketId` re-validated against `/api/v1/orderBooks` on boot (map rule).

## Phases

1. **P1 — dual-source livePrices.** Add `lighter-ws.ts`; livePrices merges Lighter WS
   (mapped symbols) over HL poll (rest). No client change — same SSE payloads keyed
   by the coin names the UI already uses (translate via `venueAssetBySymbol().hlCoin`
   so the mobile app is untouched).
2. **P2 — execution surfaces read Lighter truth.** Asset-page price readout + trade
   ticket (when built) show Lighter mark/mid + BBO (`ticker/{id}` on demand).
3. **P3 — candles (optional).** Switch asset charts to `candle/{id}/{res}` for mapped
   symbols; HL `candleSnapshot` remains for unmapped/xyz-only markets.
4. **P4 — execution channels.** Account WS (positions/fills feedback) + `sendtx` — the
   vault executor's loop. Depends on the signer track.

## Risks / notes
- market_id drift across venue redeploys → boot-time re-validation (already the map's rule).
- Untraded/thin Lighter markets: mark_price still streams (index-anchored); fine for display.
- Single BFF connection serves all SSE clients — no per-client venue sockets; respects
  the mobile "BFF-only" invariant.
- Rate/conn limits undocumented for WS; one shared readonly conn is well within norms.
