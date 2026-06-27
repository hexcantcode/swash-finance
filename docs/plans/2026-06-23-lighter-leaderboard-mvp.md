# Lighter Trader Leaderboard — MVP brief

**Date:** 2026-06-23
**Status:** Scope aligned with owner (decisions below). Task 0 (discovery spike) pending explicit go.
**Source:** owner handoff. First concrete step of the multi-venue pivot (see `CLAUDE.md`).

> **Runtime:** Claude Code, inside the existing SvelteKit repo.
> **Owner review gates are marked 🚦. Do not pass a gate without explicit sign-off.**

---

## ⚠️ ASSUMPTION TO CONFIRM BEFORE STARTING

This brief assumes **"current wallets" = currently-active Lighter accounts** (the live active set), filtered down by a 30-day-PnL pre-filter, then ranked by the **existing scoring system**.

If instead you meant *the wallets already stored in our system* (e.g. HL wallets we already track), STOP — Tasks 0 and 1 change and the data source is different. Confirm with the owner before writing code.

---

## Objective

Produce a cached **top-100 Lighter trader leaderboard** by:
1. Acquiring a candidate set of active Lighter accounts, pre-filtered by 30-day PnL (cheap filter).
2. Normalizing each candidate's stats into the shape our **existing scorer** consumes.
3. Running the existing scorer (unchanged) over candidates.
4. Persisting the ranked top 100 to Neon.
5. Serving it via one SvelteKit read route, refreshed on a slow schedule.

**This is analytics only.** No order execution, no copy-trading, no HL changes, no UI rebuild.

---

## Hard scope boundaries (DO NOT TOUCH)

- ❌ Do **not** modify the existing scoring system. Consume it as-is via its public interface.
- ❌ Do **not** add or change any order-routing / execution / copy-trade code.
- ❌ Do **not** modify existing Hyperliquid integration code or pipelines.
- ❌ Do **not** rebuild or restyle UI. One read endpoint only; rendering is out of scope.
- ❌ Do **not** build on any third-party leaderboard frontend as a data *source*. (Allowed only as a read-only QA cross-check in Task 3.)
- ✅ Keep all new code additive and behind a clear module boundary (e.g. `src/lib/server/lighter/`).

---

## Reference facts (verified)

- Lighter public REST base: `https://mainnet.zklighter.elliot.ai`
- Public read endpoints keyed by **account index** (not raw address):
  - `GET /api/v1/account?by=index&value=N` — any account
  - `GET /api/v1/pnl` — per-account PnL (`AccountPnL` / `PnLEntry`)
  - `GET /api/v1/accountsByL1Address` — address → account index bridge
  - `GET /api/v1/accountInactiveOrders`, `/api/v1/trades`, `/api/v1/txs` — history
  - `GET /api/v1/exchangeStats`, `/api/v1/orderBookDetails` — market-level
- **There is NO leaderboard / top-accounts endpoint.** A PnL-ranked candidate set is *derived*, not fetched. (This is why Task 0 exists.)
- Python SDK reference: `github.com/elliottech/lighter-python` (endpoint + model names).
- Active set is small (~13k active addresses/24h, <1k new/day) — this is a paced job over megabytes, not a big-data pipeline.

---

## SCORER CONTRACT

The brief's placeholder (`NormalizedTraderStats` with `winRate`/`maxDrawdown`/`tradeCount30d`) does **not** match the real scorer. Resolved from code (`packages/scoring/src/score.ts`, used by `apps/worker/src/jobs/score.ts`):

```typescript
// packages/scoring/src/score.ts — the ACTUAL scorer entry point.
interface ScoreInputs {
  roi30d: number | null;               // 30d realized ROI, decimal (0.30 = +30%)
  weeksProfitableRatio: number | null; // profitable weeks / active weeks over 90d, 0..1
  maxDrawdownPct: number | null;       // max drawdown magnitude over 90d, decimal 0..1
}
function computeScore(input: ScoreInputs): { score: number; breakdown } | null;
// Any input null/NaN ⇒ score null (renders "—"); we never zero-fill missing inputs.
```

**Key consequence:** only one of the three inputs is a 30-day figure. The other two need a **~90-day** history. And these inputs are not raw venue fields — in the HL pipeline they're *derived* by other `@copytrade/scoring` functions:
- `roi30d` ← HL's own reported 30d ROI (`wallets.hl_roi_30d`). For Lighter we need an equivalent reported 30d ROI, or to reconstruct it.
- `weeksProfitableRatio` ← `weeklyProfitableRatio({ fills: [{ blockTimeMs, closedPnl }] })` over 90d.
- `maxDrawdownPct` ← `maxDrawdownPct(toDailyReturns(buildDailySeries({ fills, fundings, ledger }), initialDeposit))`.

There is also a **gate** (`passesGate`) that drops a wallet before scoring; it needs `accountValueUsd`, `lastFillMs`, and a market-maker flag derived from `computeBehavioral(fills)` (maker share, hold time, long/short balance, fill count).

So "reuse the scorer unchanged" most faithfully means: **normalize Lighter trades into the existing fill / funding / ledger shapes and feed the same `@copytrade/scoring` derivation functions** — not invent a flat stats object. The fill shape the derivations read: `{ blockTimeMs, closedPnl, fee, sz, px, coin, side, startPosition, crossed }`.

**Acceptance for the contract:** the adapter produces objects the scoring functions accept with zero changes on the scoring side. Any required field with **no** Lighter source must be FLAGGED in Task 0 — never silently defaulted.

---

## Tasks

### 🚦 Task 0 — Discovery spike (BLOCKING — no production code)

Determine **how** to obtain a 30d-PnL-ranked candidate set, since no leaderboard endpoint exists.

Probe `account`, `pnl`, `accountStats`, `exchangeStats` against 3–5 known-active account indices and answer:
- **(a)** Does any endpoint return a sortable/pageable list of accounts? Or must we enumerate by index and sort client-side?
- **(b)** Time-series depth of `pnl`: can we compute a true **30-day** PnL window — and a **90-day** weekly/drawdown history (which the scorer actually needs)? Or only lifetime/snapshot?
- **(c)** Field mapping: which raw Lighter fields feed each required scorer input (`roi30d`, `weeksProfitableRatio`, `maxDrawdownPct`) and the gate inputs? List any with **no** Lighter source.
- **(d)** Observed rate limits / pagination caps.

**Deliverable:** `src/lib/server/lighter/DISCOVERY.md` with the four answers + committed sample JSON payloads.
**Gate:** owner reviews `DISCOVERY.md` and picks the Task 1 path before any further code.

---

### Task 1 — Candidate acquisition (path decided by Task 0)

Implement whichever Task 0 proved:
- **Path A (ranked endpoint exists):** paginate it, take top-N by 30d PnL.
- **Path B (enumerate + sort):** crawl active account indices with an **activity floor** (e.g. min account value or min 30d trade count — set threshold in config), compute 30d PnL, sort, take top-N.

Output: array of candidate `{ accountIndex, rawStats }`. **Fetch only — no scoring here.**
- Paced requests (respect Task 0 rate limits); configurable concurrency + delay.
- `N` (candidate pool size) configurable; default to a value that yields ≥100 survivors after scoring (start ~300–500).

**Acceptance:** running the module prints/returns a deduped candidate list with 30d PnL per account.

---

### Task 2 — Normalization adapter

Map raw Lighter payloads → the existing fill / funding / ledger shapes (the SCORER CONTRACT).
- Exact field names/types/units. No invented fields.
- Any non-derivable field: handle per the Task 0 decision (do **not** silently zero-fill).

**Acceptance:** given a raw Lighter account payload, emits objects the scoring functions accept unmodified. Unit test with ≥2 real payloads from Task 0.

---

### Task 3 — Scoring + Neon persistence

- Feed each normalized object into the **existing scorer** (unchanged).
- Write to Neon:
  - `lighter_candidates` — all scored candidates (audit/debug).
  - `leaderboard_top100` — ranked top 100, with `venue` discriminator column.
- Idempotent upsert keyed on `(venue, account_index)`; store `scored_at` timestamp.
- **Optional QA cross-check (read-only):** compare our top-20 against a public Lighter dashboard's top traders to sanity-check scoring. Log discrepancies; do NOT use their data as source of truth.

**Suggested schema (adjust to repo conventions — go through Drizzle):**
```sql
CREATE TABLE leaderboard_top100 (
  venue          text NOT NULL,            -- 'lighter' (HL slots in later)
  account_index  text NOT NULL,
  rank           int  NOT NULL,
  score          numeric NOT NULL,
  pnl_30d        numeric,
  win_rate       numeric,
  max_drawdown   numeric,
  trade_count_30d int,
  scored_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue, account_index)
);
CREATE INDEX ON leaderboard_top100 (venue, rank);
```

**Acceptance:** after a run, `SELECT … WHERE venue='lighter' ORDER BY rank LIMIT 100` returns a stable ranked list.

---

### Task 4 — Read endpoint

One SvelteKit server route (e.g. `apps/api/src/routes/api/leaderboard/+server.ts`) returning cached `leaderboard_top100` for `venue=lighter`.
- Static read from Neon. **No** live fetch/score on the request path.
- Support `?venue=` param (defaults to lighter) so HL plugs in later with no route change.

**Acceptance:** endpoint returns the cached top 100 in <100ms typical.

---

### Task 5 — Scheduled refresh

Wrap Tasks 1→3 as a job (the worker's cron/pm2 stack — `ecosystem.config.cjs`).
- Slow cadence (every few hours — 30d PnL moves slowly).
- Backfill-then-refresh: don't re-fetch everything if unchanged where avoidable.
- Structured logs: candidates fetched, scored, written, duration, errors.

**Acceptance:** job runs end-to-end on schedule and refreshes the cached table without manual steps.

---

## Definition of done (MVP)

- [ ] `DISCOVERY.md` reviewed and signed off (🚦 Task 0).
- [ ] Candidate fetch paced and configurable.
- [ ] Normalization produces scorer-accepted objects (tested on real payloads).
- [ ] Existing scorer used unchanged; top 100 persisted to Neon with `venue` discriminator.
- [ ] Read endpoint serves cached list, venue-parameterized.
- [ ] Scheduled refresh runs unattended.
- [ ] Zero changes to scorer, HL code, execution code, or UI.

## Out of scope (explicitly deferred to v2)

- Copy-trade execution / HL→Lighter signal translation.
- Canonical asset registry & mirrorability filter.
- Unified HL + Lighter merged ranking (schema is ready for it; logic is not in this handoff).
- Deep per-trader historical profile pages.

---

## Resolved decisions (owner, 2026-06-23)

1. **Wallet set** → **active Lighter accounts** (the live set), not our existing HL roster. The brief's assumption holds; Tasks 0–1 stand.
2. **90-day history** → **reconstruct from trades.** Rebuild a ~90d equity/PnL series from raw Lighter trade history to feed `weeklyProfitableRatio` + `maxDrawdownPct`. Task 0(b) must confirm trade history goes back far enough; Task 2 owns the reconstruction.
3. **Persistence** → **extend existing tables with a `venue` column** (not a new `leaderboard_top100` table). Reuse the current `scores`/`wallets`/`leaders` shape + read paths; HL becomes `venue='hl'`, Lighter `venue='lighter'`. Mind the 512 MB cap. (Supersedes the suggested-schema block in Task 3.)
4. **Module home** → **worker job + BFF route.** The paced fetch/score job lives in `apps/worker` (alongside HL scoring); the cached read route is served from the `apps/api` BFF.

### Still open (lower priority — can resolve during Task 0)

- **`roi30d` source** — accept a Lighter-reported 30d ROI if one exists, else reconstruct from deposits + PnL (the reconstruction in #2 likely yields this for free).
- **`venue` column rollout** — exact columns/migration to add `venue` across `scores`/`wallets`/`leaders` without disturbing HL reads (default existing rows to `'hl'`). Decide concretely once Task 0 fixes the Lighter account key shape (account index, not address).
