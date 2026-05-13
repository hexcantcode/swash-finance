# Real-time tracked-wallet propagation — plan

**Date:** 2026-05-13
**Status:** Designed; not implemented.
**Related code:** `apps/worker/src/jobs/ws-live-subscriber.ts`, `apps/web/src/routes/assets/[coin]/+page.svelte` (live price already done).

---

## Where we are

- HL exposes WS streams per user (`webData2` / `userFills` / `userFundings` / `userNonFundingLedgerUpdates`). Each WS connection caps at ~10 users.
- `ws-live-subscriber` already runs the per-user subscription pattern, sharded across connections, **for the 10 `winner=true` wallets only**. It writes `leader_cache.{accountValue, leverage, positionsJson, lastTradeMs, source='ws', lastRefreshedAt}` on every `webData2` push and appends to `fills` / `fundings` / `ledger_updates` on the per-user streams.
- The UI is now polling-based: the asset page reloads `data.openPositions` on full page load + a 12s candle re-pull; the trader page does the same. `leader_cache` rows for non-winners are REST snapshots from "when somebody last viewed the trader page" — often hours/days stale.
- Asset detail now has a **client-side WS** to HL's `allMids` channel (added 2026-05-13) — live price + per-row PnL flash. No server change for that one.

## What "everything real-time" requires

Two parts, both server-shaped:

### 1. Expand the tracked set on `ws-live-subscriber`

Today's selector is `wallets.winner = true` (10 rows). Change it to the same set the leaderboard listing uses — `wallets.account_value >= MIN_ACCOUNT_VALUE_USD AND wallets.is_agent = false AND wallets.hl_pnl_7d_usd IS NOT NULL`, ordered by `hl_pnl_7d_usd desc`, top 250. That matches the wallets we keep `fills` for after the trim.

Shard math: 250 users / 9 per conn = **28 WS connections**. The subscriber already supports sharding (see `targetShards` / `MAX_USERS_PER_CONN` in `ws-live-subscriber.ts`). It's a config bump + the selector swap. HL's WS infra holds up to multiples of that on staging per their docs; we'll watch reconnect rates.

Consequence: every `leader_cache` row stays fresh; `fills` / `fundings` / `ledger` append in real time for the tracked set.

### 2. Push deltas to the browser

The browser doesn't poll `leader_cache` today — it reads it once via SSR `getOpenPositionsOnAsset(coin)`. After we have fresh DB rows, we need to surface the deltas to open browser tabs.

Two designs:

**(a) Server-Sent Events (SSE) — recommended.** A SvelteKit `+server.ts` endpoint at `/api/asset/<coin>/stream` opens an `EventSource`-compatible stream. Internally it taps into the `ws-live-subscriber`'s event bus (a tiny in-process `EventEmitter`) and emits one line per relevant position change:
  ```
  event: position
  data: { "address": "0x…", "coin": "BTC", "szi": "-97.1", "entryPx": "101884", "unrealizedPnl": "2171680", "side": "ws" }
  ```
  Browser subscribes; updates the matching row in `openPositions` reactively. SSE works through HTTP infra (no upgrade), survives Cloudflare/Railway proxies, auto-reconnects.

**(b) WebSocket fan-out.** Server runs a single WS endpoint; browser connects; server forwards filtered events. Symmetric to SSE but more code (binary frame handling, reconnect logic). Pick this only if we need browser → server messages (filters, subscriptions). For one-way push, SSE is simpler.

Going with **(a)**.

## Implementation outline

1. **`ws-live-subscriber` changes (apps/worker/src/jobs/ws-live-subscriber.ts):**
   - Replace `eq(wallets.winner, true)` with the 250-by-7d-PnL selector. Keep it parameterizable via env (`WS_TRACKED_LIMIT`, default 250).
   - On every `webData2` upsert, also emit `tracker.emit('position', { address, …positionFields })` into a process-local `EventEmitter` exported from a new `apps/worker/src/services/tracker-stream.ts`. (The worker process is the same process the web server can import from, since they share a Node runtime on Railway.)

2. **`/api/asset/[coin]/stream/+server.ts` (apps/web):**
   - SSE endpoint. Imports the tracker `EventEmitter`. On request, subscribes to `position` events, filters by `event.coin === params.coin`, writes each as `event: position\ndata: …`. Heartbeats with `: ping\n\n` every 15s to keep proxies alive. Closes cleanly on client disconnect.

3. **Asset page (apps/web/src/routes/assets/[coin]/+page.svelte):**
   - Replace the `data.openPositions` SSR-only state with a live-merging map. On mount, open `new EventSource(`/api/asset/${coin}/stream`)`. On each `position` event, update the row by `address`; if it's a new wallet, prepend; if `szi === 0`, remove the row.

4. **Trader page (apps/web/src/routes/trader/[address]/+page.svelte):**
   - Same pattern: `/api/trader/[address]/stream/+server.ts`, listening to the same `EventEmitter` but filtered by `event.address`.

## Open questions

- **Process topology.** The web server (`apps/web`, SvelteKit + Node adapter) and the worker (`apps/worker`, tsx run) are separate processes on Railway today. The `EventEmitter` approach assumes a shared runtime — won't work cross-process. Two options:
  - Merge worker into the web server process (run `ws-live-subscriber` as a SvelteKit `hooks.server.ts`-triggered background task). Single process, simplest.
  - Keep them separate, glue them with a tiny Redis pub/sub (cheap, ~$5/mo on Railway). More moving parts but no cross-cutting impact.
  Recommend the merge for v1 — sample size of one host on Railway already, and we can split later if traffic warrants.

- **Reconnect storm.** 28 outbound WS connections on a fresh worker boot all hand-shake at once. HL probably tolerates this fine but we should add a small jitter (10-100ms per shard) before the initial subscribe.

- **Per-event deduplication.** `webData2` pushes the *full* clearinghouse state every change, not deltas. We probably want to compute the delta server-side (`leader_cache` vs incoming) and only emit changed positions — otherwise the SSE stream is chatty.

## Non-goals

- Live chart candles (separate WS: `subscribe / candle`). The 12s poll is fine for v1.
- Per-user authentication on the SSE endpoint. Public data, no need.
- Browser-side WS direct to HL. Server-side is cleaner: one set of subs per tracked set, fan out to many tabs.

## Acceptance

Open `/assets/BTC` in one tab. Open `/trader/0x…` for a known tracked wallet in another. Trigger a manual trade on that wallet on HL's UI. Within ~1 second, both Swash pages reflect the new position (added row on the asset page; updated open-position card on the trader page). No tab refresh needed.
