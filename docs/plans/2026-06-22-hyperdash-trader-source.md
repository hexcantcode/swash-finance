# Hyperdash as the primary trader source

**Date:** 2026-06-22
**Decisions (locked with product):**
1. Hyperdash is a **discovery seed** — Swash's own fills+scoring pipeline owns every displayed number. Hyperdash `copyScore` is an internal selection signal only.
2. Hyperdash wallets are the **primary roster** on the trader page.
3. Sentiment: these traders **join the existing tracked cohort**; no new sentiment UI. Their positions flow into `/api/feed/sentiment` automatically once tracked.

Roster sourcing method + field reference: skill `.claude/skills/hyperdash-top-traders/` (memory: [[hyperdash-trader-sourcing]]).

## Architecture (adds a *source*, reuses the whole pipeline)

```
hyperdash-ingest (NEW worker job)
  → fetchHyperdashCopytraders()        # TS port of the skill's GraphQL call
  → persist into wallets (source='hyperdash') + enqueue discovery_queue
       → [existing] ingest-wallet fills/fundings/ledger
       → [existing] score.ts  → scores + wallet_tags
       → [existing] tracked_wallets view
  → leaders.ts: order source='hyperdash' first   ("primary roster")
  → [existing] leader-cache-poll → positions → /api/feed/sentiment  (sentiment, automatic)
```

## Steps

1. **Schema: `wallets.source`** (Drizzle migration `0008`)
   - `source text not null default 'hl_leaderboard'`; index on `source`.
   - `verify:` `pnpm db:generate` produces one migration; `pnpm check` passes.

2. **Fetch fn** `packages/hl-client/src/hyperdash.ts` (or worker-local)
   - POST `api.hyperdash.com/graphql` `GetSystemGroupTraders(groupId:"copytraders")` with browser UA (UA-gated). Return `{address, label, displayName, perpsEquity, copyScore, ...}`.
   - `verify:` unit-ish smoke — logs 100 rows, 99 copy-enabled.

3. **Worker job** `apps/worker/src/jobs/hyperdash-ingest.ts`
   - Map rows → upsert `wallets` (`source='hyperdash'`, `accountValue=perpsEquity`, `displayName=label??displayName`); enqueue all into `discovery_queue` (`source='hyperdash'`) so fills get pulled. Reuse the upsert/queue mechanics from `persistAndQueueLeaderboardRows` (generalize it, or a parallel helper). Do **not** write `hl_*30d` fields from Hyperdash's cumulative `pnl` (wrong window — scoring supersedes anyway).
   - Register: add a `hyperdash-ingest` cron entry (worker cron + `ecosystem.config.cjs`), e.g. hourly.
   - `verify:` run once against live API; rows land with `ingest_state` queued, `source='hyperdash'`.

4. **Primary-roster ordering** `apps/api/src/lib/server/queries/leaders.ts`
   - Add source to `LeaderCard`; default sort puts `source='hyperdash'` first, then existing score order.
   - `verify:` `/api/leaders` returns Hyperdash wallets at the top; `pnpm check`.

5. **Gate handling (OPEN SUB-DECISION — see below)** — decides whether step 1 also needs a `tracked_wallets` view migration.

6. **Sentiment** — no code. Confirm Hyperdash wallets, once `winner`/tracked, get into `leader_cache` via leader-cache-poll so they count in `getCategoryPositionBreakdown()`.

## Open sub-decision: the scoring gate vs. "show all 100"

`tracked_wallets` filters to scored, ≥50 trades, profit_factor≥1, drawdown≤50%, equity floor. Options:
- **(A) Keep the gate (recommended).** Hyperdash wallets appear only once they pass Swash quality. Honest, no view change, but the "primary roster" may show <100 until/unless they qualify.
- **(B) Curated bypass.** Source='hyperdash' wallets skip the trade-count/profit-factor gate (keep equity floor + MM exclusion). Shows the full set fast, but needs a `tracked_wallets` view migration and means some displayed wallets have thin scored history.

## Notes / risks
- Can't fully verify ingest→score end-to-end without the live worker stack + HL API (fills pull is async). Steps 1–4 are verifiable locally; step 3's scoring tail needs the stack.
- DB is at 512MB cap (memory: neon-db-capacity) — 100 new wallets' fills are modest but watch the `fills` table.
```
