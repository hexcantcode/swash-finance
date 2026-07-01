# Swash — working notes for agents

Repo: `github.com/hexcantcode/swash-finance` · monorepo (`apps/api` SvelteKit BFF, `apps/mobile` SvelteKit client, `apps/worker`, `packages/{db,shared,hl-client}`) · pnpm workspace · DB = Neon Postgres + Drizzle.

## Repo, branches & deploy (current — 2026-07-01)

- **Canonical repo: `hexcantcode/swash-finance`** (this is `origin`). The old
  `hexcantcode/swash.finance` is **DEPRECATED** — do not push/PR there; it's kept only
  as read-only history.
- **Deployed on Railway**, project `adventurous-alignment` (may be renamed `swash`):
  three services from `main` — **api** (`swashfinance-production.up.railway.app`),
  **mobile** (`mobile-production-9cad.up.railway.app`), **worker** (cohort-snapshot cron).
  `git push origin main` auto-deploys. Deploy runbook + the pnpm-monorepo gotcha:
  `docs/RAILWAY.md`.
- **Branches:** `main` = the deployed EP-pivot app. `conviction-vaults` = active
  Conviction Vault work built on the **pre-pivot** base (see `docs/plans/2026-07-01-conviction-vault-master-plan.md`); it must be reconciled onto the EP/main base later.
  `backup/pre-pivot-wip` + `archive/*` = safety backups.
- **Data source:** the app currently reads **Hyperdash** (MVP). The plan to replace it
  with our own HL-native backend (foundation for the vaults) is
  `docs/plans/2026-07-01-hl-native-backend-plan.md`.

---

## DB state (EP single-roster pivot — 2026-06-26)

After the EP pivot the live Neon DB holds **one table: `cohort_sentiment_history`**. The old ingest/scoring pipeline tables (`wallets`, `fills`, `fundings`, `ledger_updates`, `scores`, `wallet_tags`, `leader_cache`, `discovery_queue`, `audit_log`) and the `leaders` / `tracked_wallets` views were dropped in migration `0011_drop_pipeline_tables` (applied 2026-06-26; reclaimed the ~364 MB `fills` bloat). Earlier, `0010` dropped the dead `scores.calmar`/`scores.dsr` columns and `0009` added `cohort_sentiment_history`.

**`pnpm db:generate` is BROKEN on this repo** — meta snapshots stop at `0005` while the journal runs past it, so generate throws an interactive prompt that would corrupt unrelated tables. Hand-author migrations instead: add the `.sql` under `packages/db/migrations/` + an entry in `migrations/meta/_journal.json`, then `DB_OVER_WS=1 pnpm --filter @copytrade/db migrate` (the runner needs only the journal + SQL, not snapshots). In a fresh git worktree, copy the repo-root `.env` in first (it's gitignored).

**`data-sources` branch is stale** — do **not** merge it.

---

## STRICT RULE — one source of truth per data point, and propagate changes

This is an analytics product; a number on screen is only as trustworthy as the discipline behind it.

1. **One canonical definition per data point.** Every metric/figure (PnL, win rate, cohort net/bias, …) is computed/owned in exactly one place — the relevant `apps/api/src/lib/server/ep/` function (e.g. `biasFor` in `ep/sentiment.ts`, transport in `ep/shared.ts`) or `packages/db` column / server query. Components and loaders **read** that canonical value; they never recompute, re-derive, or "fix up" the same quantity locally. If you find the same number being calculated in two places, that's a bug — collapse it to one.

2. **A data-point change isn't done until every consumer is updated.** When you change how something is computed, named, scaled, or shaped, trace the full chain — `packages/scoring` / DB column → server query (`apps/api/src/lib/server/queries/*`) → `+page.server.ts` loader → component props → display formatting (`$lib/utils/format.ts`) — and update them together in the same change. Before claiming done, grep for the field name across `apps/api/src` and `packages/` and confirm nothing stale remains.

3. **Renames & removals are not "just" backend changes.** Dropping or renaming a column/metric breaks every component and type that referenced it. List those consumers up front and decide what each should show instead (a different metric? hidden? "—"?) — don't leave a component pointing at a field that no longer exists.

---

## Architecture (current)

Two SvelteKit apps + a worker, all on one Neon DB:
- **`apps/api`** — the Backend-for-Frontend (BFF). Owns every `/api/*` endpoint, `$lib/server` (queries, HL client, DB), and the `/coins` icon proxy. The only backend the client talks to. Since the EP pivot the trader list/detail, asset pages, and most feed endpoints are sourced from **`$lib/server/ep/`** (the Extremely Profitable Hyperdash module — `roster`, `positions`, `trades`, `sentiment`, per-trader `trader`, `feed` aggregations + `shared` transport). `cohort-sentiment` / `hyperdash-positions` / `hyperdash-trades` queries remain (feed track).
- **`apps/mobile`** — a pure `/api` client (SvelteKit, Capacitor-wrapped for iOS). PWA now, native later. **Invariant:** the client only ever speaks `/api` over HTTP — no `$lib/server` imports, no client→HL connections, no DB reads in loaders. It keeps its own presentation-layer utils (e.g. `coin.ts` category mapping) that intentionally differ from the BFF's.
- **`apps/worker`** — after the EP pivot the only job is **`cohort-snapshot`** (a 5-min cron that snapshots Hyperdash cohort sentiment into `cohort_sentiment_history`). All the old ingest/scoring/leaderboard jobs were deleted. See `ecosystem.config.cjs`.

The EP cohort (Hyperdash `exploreTraders`, +$1M all-time PnL) is the single wallet roster; copy-trade was dropped. Design + plan: `docs/plans/2026-06-25-ep-cohort-single-roster-design.md`, `docs/plans/2026-06-25-ep-single-roster-implementation.md`. Future HL-native data: `docs/plans/2026-06-25-hyperdash-independence-migration.md`.

Local dev: **mobile on :5173, api on :5174** (mobile proxies `/api` + `/coins` → 5174). Launch with `DB_OVER_WS=1` on filtered networks or Neon times out. `pnpm check` / `pnpm build` at the repo root.

## Multi-venue pivot — Lighter alongside Hyperliquid (in progress)

The trading engine is moving from Hyperliquid to **Lighter** (a zk-rollup perps DEX). **Not built yet — do not write engine/execution code.** The first step is analytics only: **fetch Lighter trader data alongside HL and present unified data in the UI.**

Principles for any Lighter work:
- **Reuse the scorer unchanged.** It's already venue-agnostic — normalize Lighter trades into the existing fill / funding / ledger shapes and feed the same `packages/scoring` functions. Do **not** re-implement ROI / weekly-consistency / drawdown.
- **Additive, behind a module boundary** (`src/lib/server/lighter/`). Don't touch HL integration, execution code, or the scorer.
- **`venue` discriminator** on everything new (DB rows, API params) so HL and Lighter share one schema and one read route.
- MVP brief & open questions: `docs/plans/2026-06-23-lighter-leaderboard-mvp.md`.

## Other notes

- The product is **analytics-only** today (curated leaderboard + trader/asset detail + feed); no copy execution. `apps/mobile` is the primary surface — multi-page, dark "deep-ocean glass" default theme.
- `docs/BUILD_SPEC.md` predates the analytics-only, mobile, and Lighter direction — treat **CLAUDE.md + the `docs/plans/*` design docs as current**; BUILD_SPEC is historical context, not a build target.
- Product model & scoring redesign details: `docs/plans/2026-05-11-*.md`; mobile design docs: `docs/plans/2026-05-19…2026-06-10-mobile-*.md`.

---

## Behavioral guidelines (from github.com/multica-ai/andrej-karpathy-skills)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with the project-specific instructions above as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

For data-point changes specifically, "surgical" does **not** mean "stop at the first file" — the STRICT RULE above requires tracing the full canonical chain (scoring/DB → query → loader → component → formatter) and updating every consumer in the same change. Surgical = no *unrelated* edits, not *incomplete* ones.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

In this repo, "verified" concretely means:
- `pnpm check` and `pnpm build` pass at the repo root.
- For any renamed/removed/reshaped data point: `grep` the field name across `apps/api/src` and `packages/` returns no stale references (per the STRICT RULE).
- DB changes go through Drizzle (`pnpm db:generate` → `db:migrate`), not ad-hoc SQL, unless the migration state notes above say otherwise.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
