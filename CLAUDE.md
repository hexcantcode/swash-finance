# Swash — working notes for agents

Repo: `github.com/hexcantcode/swash.finance` · monorepo (`apps/web` SvelteKit, `apps/worker`, `packages/{db,scoring,shared,hl-client}`) · pnpm workspace · DB = Neon Postgres + Drizzle.

---

## ⚠️ BLOCKER — DB migration drift (live DB is ahead of `main`)

The shared Neon DB has **5 migrations applied** (`drizzle.__drizzle_migrations`), but `main`'s `packages/db/migrations/` only contains **3** (`0000`–`0002`). Migrations `0003` and `0004` live **only on the `data-sources` branch / worktree** and were applied to the DB out-of-band:

- `0003_abandoned_tempest` — `ALTER TABLE scores DROP COLUMN calmar; DROP COLUMN dsr;` + adds `leader_cache.{leverage,margin_used,last_trade_ms,source}`
- `0004_premium_marten_broadcloak` — adds `wallets.{curated,curated_since}`

### Rules while working on `main`

1. **Do NOT run `pnpm db:migrate` / `db:generate` / `db:push` from `main`.** Drizzle compares the schema against the stale local snapshots in `packages/db/migrations/meta/` and a journal that doesn't match the live DB — it will emit wrong and/or destructive diffs.
2. `main`'s code still references `scores.calmar` and `scores.dsr` (in `packages/db/src/schema.ts`, `apps/web/src/lib/server/queries/leader-detail.ts`, `apps/worker/src/jobs/score.ts`, `packages/scoring`). The `data-sources` branch removed them. **Stopgap already applied:** those two columns were manually re-added to the live DB —
   ```sql
   ALTER TABLE scores ADD COLUMN IF NOT EXISTS calmar numeric(10,4);
   ALTER TABLE scores ADD COLUMN IF NOT EXISTS dsr    numeric(10,4);
   ```
   so `main`'s trader page (`/trader/<address>`) and worker scoring keep working. Don't be surprised those columns exist even though migration `0003` drops them.
3. Don't introduce new schema/DB skew. If you genuinely need a schema change, do it on a branch and coordinate — the migration story has to be untangled first.

### Resolution

Merge `data-sources` → `main`. It brings `0003`/`0004` and removes `calmar`/`dsr` from the code. Migrations `0003`/`0004` are already recorded as applied in `__drizzle_migrations`, so they won't re-run; the manually re-added columns become harmless leftovers (or can be dropped deliberately afterward).

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
