# HL-native backend — replacing Hyperdash (comprehensive plan)

**Status:** Design (2026-07-01). Supersedes the stale, uncommitted
`2026-06-25-hyperdash-independence-migration.md` (that draft assumed the pre-pivot
pipeline still existed — it was deleted). **Hyperdash keeps running in the meantime**;
this is the migration off it.

## Why this is now foundational (not cleanup)

Two forcing functions:
1. **Real money.** The product is becoming **Conviction Vaults**
   (`2026-07-01-conviction-vault-master-plan.md`) — 12 per-asset 1× perp vaults on HL
   driven by **Skill-Weighted Net Positioning (SWNP)** + a quant **quality score `q`**.
   Real-money execution cannot depend on Hyperdash, whose per-trade **prices are
   corrupt** (the incident that started all this: one wallet's BTC exits scattering
   $61k–$110k in a day). The vault signal *is* our backend; it must be HL-native.
2. **Everything Hyperdash gives us is derivable from Hyperliquid** — trades, positions,
   equity, cohort positioning — at the cost of building the ingest + derivation
   ourselves.

## What "our backend" must produce (two consumers, one data layer)

| Consumer | Needs |
|---|---|
| **Analytics UI** (`apps/api/src/lib/server/ep/*`, already live on Hyperdash) | roster, per-market positions, recent trades, cohort sentiment — the existing output shapes (`MarketPositions`, `SmartTrade`, `CohortFeed`, `EpTrader`, `EpTraderDetail`) |
| **Conviction Vaults** (SWNP) | per (trader, asset): position sign `d`, notional `n`, equity `E`, conviction `c=n/E`, quality `q` → `s_a = Σ q·c·d / Σ q·c` |

Both reduce to the same primitives: **per-wallet fills → reconstructed positions +
round-trips + equity + a quality score, over a curated wallet universe.** Build that
once; the analytics `ep/` outputs and the vault signal are both views on it.

## Current state (post-EP-pivot — what exists vs deleted)

- **Kept:** `packages/hl-client` (read-only `InfoClient` via `@nktkas/hyperliquid` — `userFillsByTime`, `userFunding`, `userNonFundingLedgerUpdates`, `clearinghouseState` w/ `dex` param for HIP-3, `candleSnapshot`, leaderboard); `packages/db` (now only `cohort_sentiment_history`); `apps/api/.../ep/*` (Hyperdash consumers, shape-stable); `apps/worker` (only `cohort-snapshot`); Neon DB (now ~8 MB, lots of headroom).
- **DELETED in the pivot (must be rebuilt, leaner):** `packages/scoring`; the ingest/scoring worker jobs (`leaderboard-poll`, `hyperdash-ingest`, `leader-cache-poll`, WS/coin subscribers, `ingest-wallet`); DB tables `wallets/fills/fundings/ledger_updates/scores/wallet_tags/leader_cache/discovery_queue`. **They live in git history** (pre-`976039b`) — mine them for patterns (the round-trip note, HL client usage, leaderboard poll), but rebuild to today's needs, don't blindly resurrect.
- **@nktkas/hyperliquid `ExchangeClient`** (writes) is for the vault execution track — out of scope here (this plan is data only).

## Target architecture — layered, HL-native

```
(1) Universe        HL leaderboard + manual allowlist  → tracked_wallets
(2) Ingest (worker) userFillsByTime / userFunding / userNonFundingLedgerUpdates
                    / clearinghouseState(dex)          → fills, funding, ledger, positions
(3) Derive          round-trip reconstructor; equity/flows; per-(wallet,asset) net pos
(4) Score           quality q (master-plan Part II: honest TWR, risk-adj, PSR/DSR,
                    alpha, persistence)                → scores
(5) Serve  ┌ analytics: ep/ reads native (same output shapes) ─→ existing API/mobile
           └ vaults:    SWNP s_a = Σ q·c·d / Σ q·c   ─→ vault operator
```

Everything new sits behind a module boundary and carries a **`venue`** discriminator
(HL today; composes with the postponed Lighter pivot).

## Component design (maps to the 5 Hyperdash deps + the new scoring need)

### A. Positions (Hyperdash #4) — easiest, do first
`clearinghouseState(address,{dex})` per tracked wallet → `assetPositions` (coin, szi,
entryPx, notional, unrealizedPnl). Fan-out + group to the existing `MarketPositions` /
`SmartPosition` shape so `ep/positions.ts` swaps its data source with **no API/mobile
change**. Iterate main dex + the HIP-3 dexes we surface (`xyz`, …). Also the raw input
for SWNP's `d` and `n`. **Effort: Low.**

### B. Trades (Hyperdash #3) — the round-trip reconstructor
`userFillsByTime(address, startMs)` → pair entries/exits per (wallet, coin) into
completed round-trips (`entryPx` size-wtd, `exitPx`, `closedAtMs`, `direction`, `szBase`,
`notionalUsd`, `netPnlUsd`). HL fills carry `closedPnl` — sum it from closing fills as the
authoritative realized P/L (built-in correctness anchor; kills the price-corruption bug).
Output = existing `SmartTrade` shape. Also gives a real **round-trip count** for scoring.
**Decision to pin:** pairing rule (FIFO vs net-flat) — one canonical definition.
**Effort: Medium.**

### C. Universe / roster (Hyperdash #1 + #2)
- **Universe:** rebuild the HL leaderboard poll (`stats-data.hyperliquid.xyz/.../leaderboard`) into `tracked_wallets` + a small **manual allowlist** (replaces Hyperdash's human-curated copytraders list). 
- **EP cohort:** define by **our** realized-PnL band (compute all-time realized PnL from ingested fills+ledger; apply the "+$1M" threshold Hyperdash used) and/or by quality `q`. Replaces `exploreTraders`. Output = `EpTrader`/roster shape. **Effort: Med** (gated by universe breadth — see risks).

### D. Quality score `q` (new — the scoring engine)
Per `2026-07-01-conviction-vault-master-plan` Part II: honest time-weighted returns
(flows stripped), risk-adjust (Sharpe/Sortino/Calmar/Ulcer), luck-correct (PSR + DSR +
Bayesian shrinkage), alpha-vs-market (strip leverage), persistence-validated (walk-forward
IC). This is a **superset** of the deleted 3-ingredient scorer — build fresh as a new
`packages/scoring` (venue-agnostic, feeds `q∈[0,1]`). Drives both the roster ranking and
SWNP weighting. **Effort: High** (it's the quant core; backtest-validated in master-plan
Part VII).

### E. Cohort sentiment (Hyperdash #5) + SWNP
Aggregate our universe's live positions (from A) by market into long/short trader counts +
notional, bucketed by our PnL/quality cohort → existing `CohortFeed`, keep
`cohort_sentiment_history` + the 5-min `cohort-snapshot` cadence (just change its source
from Hyperdash to native). The **same aggregation, weighted by `q·c`**, is the vault SWNP
signal. **Open decision A vs B:** (A) curated smart-money set only — native, cheap, on-brand;
(B) broad leaderboard sweep for whole-market breadth — heavier fan-out. Recommend **A**.
**Effort: Med (A).**

## DB schema to rebuild (Drizzle) + capacity

Recreate lean, `venue`-tagged: `tracked_wallets`, `fills`, `funding`, `ledger`,
`positions` (latest snapshot per wallet/coin), `round_trips` (derived), `scores`, plus the
kept `cohort_sentiment_history`. **Capacity:** Neon is at ~8 MB now (post-pivot) with room,
but `fills` was the historic bloat against the 512 MB cap — set a retention window
(e.g. rolling 90–180d) from day one; round-trips + scores are small. Migrations are
hand-authored (`db:generate` is broken — see `CLAUDE.md`).

## Workers / cadence (Railway)

New worker jobs (Railway cron services, same pattern as `cohort-snapshot` — see
`docs/RAILWAY.md`): `universe-poll` (leaderboard, hourly), `ingest` (fills/funding/ledger
per wallet, paced), `positions-poll` (clearinghouseState fan-out, ~60–180s), `score`
(nightly), `cohort-snapshot` (repointed to native, 5-min). Mind the `clearinghouseState`
fan-out cost; cache/pace to match today's Hyperdash budget.

## Cutover strategy (shape-preserving, phase-by-phase)

Every `ep/*` consumer keeps its output type, so each surface flips Hyperdash→native
independently behind the module boundary — deploy one phase at a time, verify parity
against Hyperdash before removing the Hyperdash call. Decommission last: delete the
`ep/` Hyperdash fetches, the `hyperdash-top-traders` skill's API role, and the
`hyperdash-trader-sourcing` memory; `grep hyperdash` across `apps/`+`packages/` returns
nothing live.

## Open decisions (need your call at build time)
1. **Universe breadth** — is HL leaderboard + allowlist enough +$1M / high-`q` wallets to make cohorts + vault signal well-populated? (Drives sentiment A vs B.)
2. **Scoring scope for v1** — full master-plan `q` (PSR/DSR/alpha/persistence) up front, or ship a simpler risk-adjusted score first and layer the luck/alpha corrections before real money?
3. **Manual curation** — keep a human allowlist alongside the quantitative universe, or go purely quantitative?
4. **Retention/capacity** — fills history depth vs Neon budget (may want a Neon tier bump before deep history).
5. **Round-trip pairing rule** — FIFO vs net-position-flat; `closedPnl`-sum authoritative.

## Sequencing
1. **DB schema + universe poll + ingest** (the foundation nothing else works without).
2. **Positions (A)** → repoint `ep/positions.ts` + feed positions; verify parity.
3. **Trades (B)** round-trip reconstructor → repoint `ep/trades.ts`; kills the price bug.
4. **Scoring `q` (D)** → roster/EP cohort native (C); repoint `ep/roster.ts` + leaders.
5. **Sentiment (E)** native → repoint `cohort-snapshot` + `ep/sentiment.ts`; **then SWNP** for the vaults.
6. **Decommission Hyperdash.**

Phases 1–3 already remove the corruption for the analytics feed; 4–5 unlock the vault
signal on trustworthy, skill-weighted, HL-native data.

## Non-goals
- Vault execution / custody / ERC-4626 contract work (that's the conviction-vault track).
- Scorer *formula* changes beyond master-plan Part II.
- Lighter multi-venue (postponed; compose via `venue` when it lands).
