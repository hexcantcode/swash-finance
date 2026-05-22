# Swash — working notes for agents

Repo: `github.com/hexcantcode/swash.finance` · monorepo (`apps/web` SvelteKit, `apps/worker`, `packages/{db,scoring,shared,hl-client}`) · pnpm workspace · DB = Neon Postgres + Drizzle.

---

## DB migration state (drift resolved 2026-05-17)

Main and the live Neon DB are in sync: 6 migrations applied (`0000`–`0005`), all SQL files committed under `packages/db/migrations/`, all meta snapshots present in `packages/db/migrations/meta/`. `pnpm db:generate` / `db:migrate` / `db:push` are safe to run from main.

**Loose ends from the old drift, still in the DB:**
- `scores.calmar` and `scores.dsr` columns still exist in the live DB but are not referenced by any code on main. Migration `0003_abandoned_tempest` dropped them; they were manually re-added at the time as a stopgap when main code still read them, then main was cleaned up but the columns weren't dropped again. Safe to drop in a future migration; harmless if left.

**`data-sources` branch is stale** (~140 commits behind main) — do **not** merge it. Its only unique contribution was migrations `0003`/`0004`, which have since landed on main directly. If anything on `data-sources` is still wanted, cherry-pick the specific commits rather than merging.

### Out-of-band SQL applies

One SQL file in `packages/db/sql/` was applied via Neon MCP outside Drizzle:
- `packages/db/sql/2026-05-16-leaders-view-and-history.sql` — creates the `leaders` view and adds `wallets.history_deepened_at` / `history_oldest_ms`.

New SQL should go through Drizzle (`pnpm db:generate` then `db:migrate`). For DDL Drizzle can't autogenerate (views, complex triggers), hand-edit the generated migration file to append the SQL.

---

## STRICT RULE — one source of truth per data point, and propagate changes

This is an analytics product; a number on screen is only as trustworthy as the discipline behind it.

1. **One canonical definition per data point.** Every metric/figure (ROI, PnL, win rate, composite score, 7d window numbers, …) is computed/owned in exactly one place — the relevant `packages/scoring` function or `packages/db` column / server query. Components and loaders **read** that canonical value; they never recompute, re-derive, or "fix up" the same quantity locally. If you find the same number being calculated in two places, that's a bug — collapse it to one.

2. **A data-point change isn't done until every consumer is updated.** When you change how something is computed, named, scaled, or shaped, trace the full chain — `packages/scoring` / DB column → server query (`apps/web/src/lib/server/queries/*`) → `+page.server.ts` loader → component props → display formatting (`$lib/utils/format.ts`) — and update them together in the same change. Before claiming done, grep for the field name across `apps/web/src` and `packages/` and confirm nothing stale remains.

3. **Renames & removals are not "just" backend changes.** Dropping or renaming a column/metric breaks every component and type that referenced it. List those consumers up front and decide what each should show instead (a different metric? hidden? "—"?) — don't leave a component pointing at a field that no longer exists.

---

## Other notes

- The web app is a single page (`/` = the leaderboard + Winners + ticker). `/browse` 308-redirects to `/`. There is no theme toggle.
- Dev: `pnpm dev` (web on :5173). `pnpm check` / `pnpm build` at the repo root.
- Product model & scoring redesign details: `docs/plans/2026-05-11-*.md`.

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
- For any renamed/removed/reshaped data point: `grep` the field name across `apps/web/src` and `packages/` returns no stale references (per the STRICT RULE).
- DB changes go through Drizzle (`pnpm db:generate` → `db:migrate`), not ad-hoc SQL, unless the migration state notes above say otherwise.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
