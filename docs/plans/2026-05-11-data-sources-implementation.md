# Data Sources & Scoring-Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the "last active 17 hrs vs latest fill 1 month ago" class of bug by giving every displayed value one canonical source (two-tier model: live = WS per-user for curated wallets / REST on-demand for the tail; analyzed = locally stored history), and fold in the scoring cleanup (drop DSR + Calmar, fix the confidence-cap field, re-fit the curves).

**Architecture:** See `docs/plans/2026-05-11-data-sources-design.md`. This plan details **Phase 1 (scoring cleanup)**, **Phase 2 (schema migration)**, and **Phase 3 (web-query consistency fix — the visible bug)** bite-sized; **Phases 4–7 (leaderboard-poll cron, ws-live-subscriber worker, on-demand queue, retire the accumulators)** are outlined and get their own detailed plan once 1–3 land.

**Tech stack:** TypeScript ESM (`.js` import specifiers), pnpm workspaces, vitest, Drizzle ORM + drizzle-kit migrations (`pnpm db:generate` / `pnpm db:migrate`), `@nktkas/hyperliquid` for HL REST/WS, SvelteKit (`apps/web`), Neon Postgres. Worktree: `/Users/ege/swash/.worktrees/data-sources`, branch `data-sources`.

**Conventions:**
- ESM: every relative import ends in `.js`.
- TDD where it's testable (scoring, pure query/logic helpers): failing test → run → see fail → minimal impl → run → see pass → commit. Small commits.
- Commits attribute to `hexcantcode`: `git -c user.name="hexcantcode" -c user.email="178187349+hexcantcode@users.noreply.github.com" commit ...` with a `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- The user owns the `apps/web/**/*.svelte` rendering — **do not touch `.svelte` files, `app.css`, `app.html`**. You MAY touch `apps/web/src/lib/server/**` (queries, db, hl wrappers) and `apps/web/src/routes/**/+server.ts` / `+page.server.ts` (the data-loading side) — these are the contract the UI consumes.
- Calibration CSV from the prior run is at `/tmp/curves-calib.csv` (235 wallets) with the summary in `/tmp/calib-run.log`; if missing, re-run `pnpm --filter @copytrade/worker exec tsx src/scripts/calibrate-curves.ts --source=db --limit=400 --out=/tmp/curves-calib.csv` (`.env` is at the repo root).
- Don't touch `packages/scoring/src/curves.ts` while the prior calibration agent's commit might still be in flight — check `git log --oneline -3` first; it's not, but verify.

---

## Phase 1 — Scoring cleanup (drop DSR + Calmar, fix confidence cap, re-fit curves)

### Task 1: Remove `calmar` from `metrics.ts`

**Files:** `packages/scoring/src/metrics.ts`, `packages/scoring/src/metrics.test.ts`, and any importer (grep first: `grep -rn "calmar" packages apps`).

**Steps:**
1. Run `grep -rn "\bcalmar\b\|Calmar" packages apps --include=*.ts | grep -v test` to enumerate all importers. Expected: `composite.ts` (`MetricKey`, `METRIC_CURVES`, `BASKET`), `index.ts` (via `export *`), `apps/worker/src/jobs/score.ts`, `apps/worker/src/scripts/calibrate-curves.ts`, `apps/web/src/lib/server/queries/leader-detail.ts`. You'll fix those in their own tasks; here just remove the `calmar` *function* and its `metrics.test.ts` tests.
2. Delete `export function calmar(...)` from `metrics.ts`. Remove `calmar` from the `RatioMetrics` interface if present.
3. Delete the `calmar` test block(s) from `metrics.test.ts`.
4. Run `pnpm --filter @copytrade/scoring test` — will FAIL to compile because `composite.ts` / `index.ts` still reference it. That's expected; the next tasks fix it. (If you'd rather keep the tree green at every step, do Tasks 1+2+3+4 as one commit — acceptable given they're a tight unit. Otherwise commit at the end of Task 4.)
5. (Defer commit to Task 4 if going the tight-unit route.)

### Task 2: Remove `dsr.ts` and its exports

**Files:** delete `packages/scoring/src/dsr.ts` and `packages/scoring/src/dsr.test.ts`; edit `packages/scoring/src/index.ts` (remove `export * from './dsr.js';`); edit `packages/scoring/src/psr.ts` (remove `adjustedBenchmarkSharpe` and `standardNormalInverseCdf` if now unused — `grep -rn "adjustedBenchmarkSharpe\|standardNormalInverseCdf" packages apps` to confirm; keep `probabilisticSharpe` and `standardNormalCdf`).

**Steps:**
1. `git rm packages/scoring/src/dsr.ts packages/scoring/src/dsr.test.ts`.
2. Remove the `./dsr.js` re-export from `index.ts`.
3. In `psr.ts`: if `adjustedBenchmarkSharpe`/`standardNormalInverseCdf` are unused elsewhere, delete them + their `psr.test.ts` tests; keep `probabilisticSharpe`/`standardNormalCdf` and their tests.
4. (Defer commit.)

### Task 3: Drop `dsr` and `calmar` from `composite.ts` (the basket → 8 metrics) and fix the confidence cap

**Files:** `packages/scoring/src/composite.ts`, `packages/scoring/src/composite.test.ts`, `packages/scoring/src/curves.ts`, `packages/scoring/src/curves.test.ts`.

**Steps — TDD-ish (the contract changes, so update tests alongside):**
1. In `curves.ts`: remove `'calmar'` and `'dsr'` from the `MetricKey` union and from `METRIC_CURVES`. In `curves.test.ts`: remove `calmar`/`dsr` from the "every basket metric has a curve" list and any curve-specific assertions on them.
2. In `composite.ts`:
   - `BASKET` becomes `['sharpe','sortino','psr','profitFactor','expectancy','maxDrawdownPct','recoveryTimeDays','monthlyConsistency']` (8 entries).
   - Change `MedianCompositeInput` so the confidence cap is driven by **calendar span**, not `activeDays`: rename the field to `daysOfData: number` (the first→last-event span in days), and `confidence = min(max(daysOfData, 0) / 90, 1)`, `provisional = daysOfData < 90`. (If a caller still wants to pass both, that's their concern — the composite takes `daysOfData`.) Update the doc comment.
3. In `composite.test.ts`: update the `medianComposite` tests — `fullBasket` drops `calmar`/`dsr` (8 keys now), `breakdown` length 8, the confidence-cap test uses `daysOfData` (e.g. `daysOfData: 30` → confidence 1/3). Keep the "outlier doesn't blow up the median", "nulls dropped", "empty → 0", "odd count → middle value" tests (adapt counts). The old `computeComposite`/`computeDecayFlag` and their tests still exist and stay green (they don't reference dsr/calmar — verify; `computeDecayFlag` uses rolling Sharpe, fine).
4. Update the e2e smoke test in `composite.test.ts` (the "returns → metrics → medianComposite" one) — remove `calmar`/`dsr` from the `metrics` object, pass `daysOfData` (= span; you can compute `(series.lastEventMs - series.firstEventMs)/86400000`) instead of `activeDays`. Re-check the assertion threshold is still meaningful.
5. Run `pnpm --filter @copytrade/scoring test` — green. Run `cd packages/scoring && pnpm exec tsc --noEmit` — clean.

### Task 4: Commit Phase-1a (the removals + cap fix)

`git add -A && git -c user.name=... commit -m "feat(scoring): drop DSR + Calmar from the basket; confidence cap on calendar span"` (Co-Authored-By trailer). Body: note basket is now 8 metrics, DSR removed (degenerate over real population), Calmar removed (annualization blows up), confidence cap moved from activeDays → daysOfData.

### Task 5: Update `apps/worker/src/jobs/score.ts` for the 8-metric basket

**Files:** `apps/worker/src/jobs/score.ts`.

**Steps:**
1. Remove the `calmar` / `deflatedSharpe` / `adjustedBenchmarkSharpe` imports and computations. Remove the two-pass DSR machinery (the population-Sharpe pass exists *only* to compute the DSR benchmark; with DSR gone it's dead — but check: is `psr` still computed per-wallet without needing population stats? Yes — `probabilisticSharpe(returns, sharpe, 0)` needs no population. So the whole pass-1/pass-2 split collapses to a single pass). Simplify `runScoreRecompute` to one pass.
2. **Critical**: the current code feeds `probabilisticSharpe` the *annualized* Sharpe — switch it to `dailySharpe(returns)` (the units fix from the scoring-redesign branch; `dailySharpe` is now exported). PSR/Sharpe-for-PSR must be in daily units.
3. Switch the composite call from the old `computeComposite(...)` to `medianComposite({ metrics: { sharpe: dailySharpe(returns) * trackRecordMultiplier(daysOfData), sortino: (annualizedSortino(returns)/Math.sqrt(365)) * trackRecordMultiplier(daysOfData), psr, profitFactor: ..., expectancy: ..., maxDrawdownPct, recoveryTimeDays, monthlyConsistency }, daysOfData })` where `daysOfData = (series.lastEventMs - series.firstEventMs)/86400000` (guard nulls → 0). Decide the `profitFactor` input (see §5 of the design — `profitFactor(returns)` vs `profitFactor(perTradePnl)`; pick one, use it here AND in `calibrate-curves.ts`, and make the `curves.ts` knot for it match — recommend `profitFactor(perTradePnl)` since that's the existing production definition, but confirm against the calibration distribution).
4. Write the new `scores` columns appropriately; stop writing `dsr` / `calmar` (those columns get dropped in Phase 2 — until then, write `null`).
5. Remove `computeDecayFlag` usage only if you're also removing it; otherwise keep. (Decay flag is still wanted — keep it.)
6. `cd apps/worker && pnpm exec tsc --noEmit` — clean. (No unit tests on `score.ts` currently; a smoke run is Phase 2+ once the migration's applied.) Commit: `feat(worker): score.ts uses medianComposite (8 metrics, daily-Sharpe PSR)`.

### Task 6: Update `apps/worker/src/scripts/calibrate-curves.ts`

**Files:** `apps/worker/src/scripts/calibrate-curves.ts`.

**Steps:** remove `calmar` and the DSR two-pass from the metric set it computes/reports; align `profitFactor` input with the choice made in Task 5; drop `calmar`/`dsr` columns from the CSV header and rows; report `daysOfData`-based confidence in the composite section. `cd apps/worker && pnpm exec tsc --noEmit` clean. Commit: `chore(worker): calibrate-curves drops DSR/Calmar, aligns with 8-metric basket`.

### Task 7: Re-fit `curves.ts` from real data

**Files:** `packages/scoring/src/curves.ts`, `packages/scoring/src/curves.test.ts`, new `docs/plans/2026-05-11-curve-calibration-notes.md`.

**Steps (runbook — not TDD; deliverable is calibrated knots + notes):**
1. Re-run the calibration: `cd /Users/ege/swash/.worktrees/data-sources && cp /Users/ege/swash/.env .env` (gitignored — verify it doesn't show in `git status`), then `pnpm --filter @copytrade/worker exec tsx src/scripts/calibrate-curves.ts --source=db --limit=400 --out=/tmp/curves-calib2.csv`. Delete `.env` after.
2. From the quantile table, fit each of the 8 curves: median wallet ≈ 50–60 on each metric; score ~95–100 ≈ p95–p99 of that metric (or a sane absolute ceiling — clamp heavy-tailed Sortino (daily; p99 ≈ 753 in the prior run) at ~p90 ≈ 27, profit factor (p99 ≈ 1678) at ~p90 ≈ 86; everything above clamps to 100). `maxDrawdownPct` / `recoveryTimeDays` stay inverted (monotone decreasing). Knot inputs strictly increasing. Replace the `// PROVISIONAL` block comment with `// CALIBRATED <YYYY-MM-DD> from N=<count> HL wallets — see docs/plans/2026-05-11-curve-calibration-notes.md`.
3. Re-run the calibrate command (uses the new curves) and confirm the `medianComposite().score` distribution is sane: median ~40–65, not pinned at 0/100, `>= 70` count a small minority (~single-digit to ~15%). Iterate once or twice.
4. **Resolve the expectancy question**: if raw-USD expectancy still can't be curved sanely (it couldn't in the prior run — median ≈ 0, range −1719…+1418), either (a) change the metric to per-trade *return* expectancy (`mean(perTradeReturn)` where `perTradeReturn = perTradePnl / tradeNotional` or similar) — a small change in `metrics.ts` + `score.ts` + the calibrate script — or (b) drop `expectancy` from the basket too (→ 7 metrics, odd → true median; update `BASKET`, `MetricKey`, `METRIC_CURVES`, tests, `score.ts`, `leader-detail.ts`, methodology copy). Pick one; document the choice in the notes.
5. `pnpm --filter @copytrade/scoring test` — green (curve tests check structure/monotonicity, not exact values; the e2e/strong-basket test may need its threshold adjusted — note which and why). `cd packages/scoring && pnpm exec tsc --noEmit` — clean.
6. Write `docs/plans/2026-05-11-curve-calibration-notes.md`: dataset (source, N, date), the quantile table, chosen knots + one-line rationale per curve, before/after composite distribution, the expectancy decision, the round-trip-trade floor recommendation for eligibility.
7. Commit: `feat(scoring): calibrate the 8-metric curves from real HL wallet data`.

### Task 8: Phase-1 review

Run `pnpm --filter @copytrade/scoring test` (green), `pnpm -r exec tsc --noEmit` (scoring + worker clean; `apps/web` fails for pre-existing svelte-kit reasons — ignore). Use `superpowers:requesting-code-review` on the Phase-1 diff. Update `docs/plans/2026-05-11-data-sources-design.md` §5 if the expectancy decision changed the basket size.

---

## Phase 2 — Schema migration

### Task 9: `leader_cache` live-tier columns + drop `scores.dsr`/`scores.calmar`

**Files:** `packages/db/src/schema.ts`, generated migration under `packages/db/migrations/`, `packages/db/src/index.ts` (if it re-exports types).

**Steps:**
1. In `schema.ts`, on `leaderCache`: add `equity numeric(30,8)` (or rename existing `accountValue` → `equity` — pick; renaming is cleaner but more churn, decide), `leverage numeric(20,4)`, `marginUsed numeric(30,8)`, `lastTradeMs bigint`, `source text` (values `'ws'|'rest'`), keep `positionsJson jsonb` and `lastRefreshedAt timestamptz`. On `scores`: remove the `dsr` and `calmar` columns. Document `wallets.lastSeenAt` as internal-discovery-only in a comment; leave `totalFills`/`totalVolumeUsd` for now (Phase 7 decides their fate) but add a `-- TODO(phase7): retire as display fields` comment.
2. `pnpm db:generate` → review the generated SQL (it should be an `ALTER TABLE leader_cache ADD COLUMN ...` + `ALTER TABLE scores DROP COLUMN dsr, DROP COLUMN calmar`). Check it doesn't do anything destructive beyond the intended drops.
3. Apply to the dev DB: `pnpm db:migrate` (uses `.env` DATABASE_URL — copy `.env` into the worktree root if needed; verify it's gitignored). Confirm via a quick query that `leader_cache` has the new columns and `scores` lost the two.
4. `pnpm -r exec tsc --noEmit` for the packages that import these types — fix any breakage (e.g. `leader-detail.ts` referencing `scores.dsr`/`scores.calmar` — handled in Phase 3, but the type error surfaces here; you can stub-fix or do it now).
5. Commit: `feat(db): leader_cache live-tier columns; drop scores.dsr/calmar`.

---

## Phase 3 — Web-query consistency fix (the visible bug)

### Task 10: `leader-detail.ts` — one canonical source per field

**Files:** `apps/web/src/lib/server/queries/leader-detail.ts`. (Do NOT touch the `.svelte` consumer — the user does that; but you MAY change the returned shape, just document it in the function's JSDoc / the `LeaderDetail` interface so the user knows what changed.)

**Steps:**
1. Remove `scoring.dsr` and `scoring.calmar` from `ScoringDetail` (they no longer exist on `scores`).
2. **Last-traded**: add `last_trade_at: string | null` derived from `max(fills.blockTimeMs)` over `linked` addresses (a `select max(block_time_ms)` query — you already fetch `recentFillRows`; just take `recentFillRows[0]?.blockTimeMs` since they're `orderBy desc`). This is the canonical "last traded". Keep `last_seen_at` for now but mark it `@deprecated — internal discovery signal, do not display` in the interface (or remove it outright if the user agrees — leave it, with the deprecation note).
3. **Account value / positions**: keep reading from `leaderCache`, but read the *new* `equity` column (or `accountValue` if you didn't rename), plus `leverage`, `marginUsed`, `lastTradeMs` (prefer `leaderCache.lastTradeMs` for "last traded" when present and fresher than the fills-derived one — actually no: keep it simple, "last traded" = `max(fills.blockTimeMs)`; `leaderCache.lastTradeMs` is a redundant convenience the WS subscriber writes — use whichever is *more recent*). Add `live_refreshed_at` (= `leaderCache.lastRefreshedAt`) and `live_source` (= `leaderCache.source`) to the returned shape so the UI can render "live · 2m ago" vs "live · stale".
4. **Total volume / total trades**: the returned `total_volume_usd` (top-level) currently = `wallets.totalVolumeUsd` (the WS accumulator) — change it to `scores.totalVolumeUsd` (analyzed tier), same source as `scoring.total_volume_usd`. Either drop the duplicate top-level field or make it an alias — recommend dropping it and having the UI read `scoring.total_volume_usd`. Same for any `total_trades` exposure → `scores.totalTrades`.
5. Add `analyzed_as_of: string | null` = `scores.computedAt` (the "as of" stamp for the analyzed tier).
6. Run the web build/check: `pnpm --filter @copytrade/web exec svelte-kit sync && pnpm --filter @copytrade/web exec tsc --noEmit` (or `pnpm --filter @copytrade/web check`) — fix type errors in `+page.server.ts` if it destructures removed fields (it probably just passes the whole object through). Commit: `fix(web): leader-detail reads one canonical source per field (live vs analyzed)`.

### Task 11: `leaders.ts` (main table) — same canonical sources, drop `wallets.lastSeenAt` for display

**Files:** `apps/web/src/lib/server/queries/leaders.ts`.

**Steps:**
1. `last_active_at` currently = `wallets.lastSeenAt` → change to a `max(fills.blockTimeMs)` per wallet. Since this is a list query over many wallets, doing a correlated `max(fills...)` per row is expensive — instead: (a) add a `lastTradeMs` to `leaderCache` (Phase 2 did) and `leftJoin leaderCache`, reading `leaderCache.lastTradeMs` — but tail wallets without a cache row have null; (b) OR maintain a `wallets.lastTradeMs` column updated by `score.ts` (= `scores.lastTradeAt`) — actually `scores.lastTradeAt` already exists! Just `leftJoin scores` (already joined) and read `scores.lastTradeAt`. **Use `scores.lastTradeAt`** for the table (analyzed-tier freshness — consistent with the other table columns which are all `scores.*`), and on the *detail* page show the fresher `max(fills.blockTimeMs)` / `leaderCache.lastTradeMs`. Document this: the table shows "last traded (as of last sync)", the profile shows live. That's still *consistent* (each is one source, clearly labeled) — the bug was them silently being *different concepts*; now they're the same concept at two stated freshnesses.
2. Remove the `last_active` sort option that orders by `wallets.lastSeenAt` → order by `scores.lastTradeAt` instead.
3. The `sort === 'roi'` option orders by `scores.netPnlPct` — fine, keep. (The design's "Sharpe/Sortino" and "7d-ROI" lenses are a later web task; not here.)
4. `numOrNull` etc. unchanged. `pnpm --filter @copytrade/web check` — clean. Commit: `fix(web): leaders table last-active comes from scores.lastTradeAt (consistent with other analyzed columns)`.

### Task 12: kill the WS accumulators as display fields

**Files:** `apps/web/src/lib/server/queries/*.ts` (grep `totalFills\|totalVolumeUsd` referencing `wallets.`), the `refresh` API route if it surfaces them.

**Steps:** ensure no web query returns `wallets.totalFills` or `wallets.totalVolumeUsd` as a displayed value (they're now only `scores.*`-sourced). `grep -rn "wallets.totalFills\|wallets.totalVolumeUsd" apps/web` → fix any. Commit: `fix(web): stop surfacing the WS accumulator columns`.

### Task 13: Phase-3 review

`pnpm --filter @copytrade/web check` clean. `superpowers:requesting-code-review` on the Phase-3 diff. Manually note (for the user) the changed shapes of `LeaderDetail` / `LeaderCard` so they can update the `.svelte` consumers.

---

## Phases 4–7 — outline (own detailed plan after 1–3 land)

- **Phase 4 — leaderboard-poll cron + `curated` flag.** `apps/worker/src/jobs/leaderboard-poll.ts` (every ~15 min: `fetchLeaderboard` all windows → upsert `wallets.hl*` + `hlMetricsAt`; feed eligible new wallets into the curation-candidate flow). Add the `wallets.curated` / `curated_since` columns + the curation logic: a wallet is `curated` iff it passes the eligibility gate (≥$10k acct, ≥$100k vol, ≥90d span, ≥30 active days, ≥N round-trips, capital-base-known, not-MM) AND `compositeScore >= 70` (with ~65 hysteresis). Wire into `index.ts` cron + `cli.ts`.
- **Phase 5 — `ws-live-subscriber` worker.** Long-running. On start + on curated-set change: reconcile per-user WS subscriptions (`webData2` + `userFills` + `userFundings` + `userNonFundingLedgerUpdates`) across one or more `SubscriptionClient` connections for every `curated` wallet. On `webData2` push → upsert `leader_cache` live columns (`equity`, `leverage`, `marginUsed`, `positionsJson`, `lastTradeMs`, `source='ws'`, `lastRefreshedAt`). On `userFills`/`userFundings`/`userNonFundingLedgerUpdates` push → idempotent insert into `fills`/`fundings`/`ledgerUpdates` (on conflict `tid`/`hash` do nothing). When a wallet *enters* the curated set: do a one-time REST 90d backfill first, then add the subscriptions. Run via `index.ts` (as a separate process / cron-managed). `trades-subscriber` stays as the discovery firehose but **stops writing `wallets.totalFills`/`totalVolumeUsd` as accumulators** (Phase 7).
- **Phase 6 — on-demand path.** `score_requests` table (from the scoring-redesign plan) + `apps/worker/src/jobs/score-requests.ts` (drain queue, own rate budget): for a requested address → `clearinghouseState` (→ `leader_cache` live cols, `source='rest'`), 90d `userFillsByTime`/`userFunding`/`userNonFundingLedgerUpdates` backfill (→ history tables), score (→ `scores`); 24h score cache / 15min live cache; if it clears the eligibility gate + `compositeScore >= 70` → set `curated=true` (which the ws-live-subscriber then picks up). Web: "Score this wallet" CTA on `+page.server.ts` / a `+server.ts` endpoint enqueues + the page polls. Also: viewing a non-curated wallet whose `leader_cache` is stale (>15min) enqueues a live refresh.
- **Phase 7 — retire the accumulators + cleanup.** `trades-subscriber.ts`: stop the `+= excluded.…` upserts on `totalFills`/`totalVolumeUsd`; it only does `lastSeenAt = greatest(...)` + `ingestState='observed'` (discovery). Decide `wallets.totalFills`/`totalVolumeUsd`: drop the columns (migration) or repurpose to honest per-sweep snapshots — recommend **drop** (display comes from `scores.*`). Remove `computeComposite`/`computeDecayFlag` from `composite.ts` if nothing imports them anymore. Update the methodology copy (the user owns the `.svelte`, but provide the text). `superpowers:finishing-a-development-branch`.

---

## Notes for the implementer

- The repo was renamed `swish` → `swash`; the main worktree `/Users/ege/swash` has uncommitted `.svelte`/`app.css`/`hl-client/src/leaderboard.ts` edits owned by the user — don't pull those in, work only on `data-sources`. If `packages/hl-client/src/leaderboard.ts` needs changes in Phase 4, coordinate (the user has local edits there).
- `apps/web`'s `check` script is `svelte-kit sync && svelte-check` — `pnpm -r exec tsc --noEmit` will fail in `apps/web` for that reason; that's pre-existing, not your regression.
- `packages/hl-client` has a `test` script but no test files — `pnpm -r test` reports it as a failure; scope to `--filter @copytrade/scoring` while in Phase 1.
- The prior scoring-redesign branch is already merged to `main`; this branch builds on it (it's why `dailySharpe`, `medianComposite`, `curves.ts`, `monthlyConsistency`, `trackRecordMultiplier` exist).
- `@nktkas/hyperliquid` v0.32.2 `SubscriptionClient` (for Phase 5) exposes `webData2({user}, cb)`, `userFills({user}, cb)`, `userFundings({user}, cb)`, `userNonFundingLedgerUpdates({user}, cb)`, plus `trades({coin}, cb)` (already used). Confirm exact signatures against `node_modules/.pnpm/@nktkas+hyperliquid@0.32.2_typescript@5.9.3/node_modules/@nktkas/hyperliquid/esm/clients/subscription.d.ts` before building Phase 5.
