# Lighter — Task 0 discovery spike

**Date:** 2026-06-24 · **Status:** 🚦 Awaiting owner decision. **No production code written.**
**Brief:** `docs/plans/2026-06-23-lighter-leaderboard-mvp.md` · **Samples:** `./samples/*.json`
**Module path note:** the brief said `src/lib/server/lighter/`, but per owner decision #4 the fetch/score job lives in `apps/worker`, so this spike lives at `apps/worker/src/lighter/`. (The read route still goes in the `apps/api` BFF.)

All probes were unauthenticated GETs against `https://mainnet.zklighter.elliot.ai`. SDK reference cross-checked against `github.com/elliottech/lighter-python`.

---

## TL;DR — ⚠️ the chosen path is blocked by the public API

**The public API exposes only realtime + current-snapshot data. There is no public historical trade or PnL access.** That means owner decision #2 ("reconstruct ~90d from trades") **cannot be done from public data** as-is. The 90-day window the scorer needs (`weeksProfitableRatio`, `maxDrawdownPct`) has no public source today. This needs an owner call before Task 1 — see **Decision needed** at the bottom.

What *is* public and works: market-level **realtime** trades (with both account ids, fees, position-before fields) and rich **current** per-account snapshots (positions, equity, collateral, unrealized PnL, funding paid).

---

## (a) Is there a sortable/pageable list of accounts? → **No.**

- Confirmed: no leaderboard/top-accounts endpoint exists (matches the brief).
- No endpoint returns a ranked or full account list. Accounts are addressable only one-at-a-time by index (`/api/v1/account?by=index&value=N`) or by L1 address (`/api/v1/accountsByL1Address`).
- **The only public way to discover *active* accounts is to read market-level realtime trades** (`/api/v1/recentTrades?market_id=N`) and harvest `ask_account_id` / `bid_account_id`. There are **214 markets** (`exchangeStats`). So the candidate set is built by sweeping live trades, not fetched. → This is **Path B (enumerate)**, not Path A.

## (b) Time-series depth — can we get 30d / 90d? → **No public history at all.**

This is the blocker. Findings:

- **`/api/v1/pnl`** (the per-account PnL chart): params confirmed via SDK (`by, value, resolution, start_timestamp, end_timestamp, count_back, ignore_transfers`). Unauthenticated it returns **`{"code":21100,"account not found"}` for every account tried** — including active ones and small indices 2–79. The SDK method also carries an `authorization` param. → **PnL history is auth-gated / not publicly served.** (`samples/pnl-unauth.json`)
- **`/api/v1/trades`** (per-account trade history): **auth-gated.** Explicit error: `"auth query param and Authorization header are empty"`, and the SDK signature has `authorization: StrictStr` as a **required** parameter. (`samples/trades-authgated.json`)
- **`/api/v1/recentTrades`** (public, market-scoped): accepts `market_id`, `account_index`, and *nominally* `between_timestamps`, `cursor`, `sort_dir` — **but the public endpoint silently ignores the time/pagination params.** Every variant (latest / a 60–90-day-ago window / `sort_dir=asc`) returned the **same ~100 trades from the last ~11 seconds**, no cursor in the response. → **Realtime-only; no historical reach, no pagination.**

**Conclusion:** 90d (and even 30d) history is not obtainable from the public API. Reconstruction would require either auth or forward-collection (see Decision needed).

## (c) Field mapping → scorer inputs

Scorer (`packages/scoring/src/score.ts`) needs `roi30d` (30d), `weeksProfitableRatio` (90d), `maxDrawdownPct` (90d), all derived from raw fills/funding/ledger; plus gate inputs (account value, last-fill time, MM signals).

| Scorer need | Lighter source | Status |
|---|---|---|
| account value (gate) | `account.total_asset_value` / `collateral` | ✅ public snapshot |
| open positions, entry, unrealized PnL, funding | `account.positions[]` (`avg_entry_price`, `position_value`, `unrealized_pnl`, `realized_pnl`, `total_funding_paid_out`) | ✅ public snapshot (current only) |
| per-fill realized PnL / fees / size / px (→ daily series, weekly ratio, drawdown) | realtime `recentTrades` carries `usd_amount`, `taker_fee`/`maker_fee`, `*_position_size_before`, `*_entry_quote_before`, `*_position_sign_changed`, `timestamp`, both account ids | ⚠️ realtime-only — **no history** |
| `roi30d` (30d) | no reported field; would need reconstruction | ❌ no 30d source |
| `weeksProfitableRatio` (90d) | needs 90d of closed-PnL fills | ❌ **no 90d source** |
| `maxDrawdownPct` (90d) | needs 90d daily equity series | ❌ **no 90d source** |
| deposits/withdrawals (ledger, for ROI base & drawdown) | `/api/v1/txs` / bridge (not yet probed in depth) | ❓ likely auth/limited |

So the three scorer inputs have **no public historical source**; only the gate's account-value input is cleanly available.

Note: `recentTrades` gives **realized PnL by reconstruction**, not directly — when a trade closes/reduces a position you derive realized PnL from `*_position_size_before` + `*_entry_quote_before` + price + size (sign change marks a close). Doable, but only on data you've collected.

## (d) Rate limits / pagination caps

- No auth, no obvious hard rate limit hit during the spike (dozens of sequential GETs, no 429s). Pace anyway.
- `recentTrades` / `account` cap at `limit ≤ 100`. No working pagination cursor on the public endpoints. `exchangeStats` returns all 214 markets in one call.

---

## Samples (committed)

- `samples/exchangeStats.json` — market list (trimmed to 3) + daily stats.
- `samples/recentTrades-market1.json` — one full BTC trade object (note `*_account_id`, fees, `*_position_size_before`, `*_entry_quote_before`, `timestamp`).
- `samples/account-snapshot.json` — full account incl. `positions[]`, `collateral`, `total_asset_value` (acct 702384, ~$1.7M).
- `samples/pnl-unauth.json` — the "account not found" PnL response.
- `samples/trades-authgated.json` — the auth-required error.

---

## 🚦 Decision needed before Task 1

Public data can't supply the scorer's 30d/90d inputs. Pick a path:

- **Path 1 — Get Lighter API auth.** Verify whether a Lighter API key can read *arbitrary* accounts' `/api/v1/trades` + `/api/v1/pnl` history (vs only its own — common exchange restriction, and a dealbreaker for a leaderboard if so). If arbitrary reads work, reconstruct-from-trades (decision #2) becomes viable. **Lowest-effort if the key grants broad reads.** Needs: an API key + a 5-min auth probe.
- **Path 2 — Forward-collection.** Run a realtime collector over the 214 markets' trade streams (WS or polled `recentTrades`), bucket by `account_id`, accumulate ≥90d going forward. No backfill → no 90d leaderboard until ~90d of collection. Heavy ingest; storage pressure on the 512 MB DB.
- **Path 3 — Snapshot-only interim board.** Rank by *current* signals (equity, open-position unrealized PnL) using `account` snapshots now; defer the real scorer until history exists. Ships something this week but does **not** use the existing 90d scorer.

My recommendation: **probe Path 1 first** (cheap, and if a key reads arbitrary accounts it unblocks the original plan); fall back to **Path 2** (start collecting now so 90d data exists later) if auth only reads own-account.
