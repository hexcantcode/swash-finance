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
