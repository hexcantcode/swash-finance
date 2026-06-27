# Railway deployment — Swash

Single source of truth for how Swash deploys. Config-as-code lives in each app's
`railway.json`; this doc covers the project shape + the one-time dashboard setup
the CLI can't do (GitHub connect, per-service Root Directory, secrets).

## Shape: 1 project, 3 services, 1 external DB

Railway project **`swash`** (env `production`), all three services built from the
**one GitHub repo `hexcantcode/swash.finance`, branch `main`**. The DB is **Neon**
(external — not a Railway service); services just point `DATABASE_URL` at it.

| Service | Root Directory | Role | Public domain | Env vars |
|---|---|---|---|---|
| **api** | `apps/api` | the single backend (BFF) — owns all `/api/*` | yes | `DATABASE_URL` |
| **mobile** | `apps/mobile` | PWA frontend (pure `/api` client) | yes (user-facing) | `PUBLIC_API_BASE` = api's public URL |
| **worker** | `apps/worker` | `cohort-snapshot` cron (every 5 min) | none | `DATABASE_URL` |

Flow: `mobile → api (/api) → Neon`; `worker → Neon`. `api` is the only backend
the client talks to.

Each service's build/start/healthcheck is defined in its `railway.json`:
- **api** — NIXPACKS build → `pnpm --filter @copytrade/api build`; start `node apps/api/build/index.js`; healthcheck `/api/health`.
- **mobile** — build `pnpm --filter @copytrade/mobile build`; serves the static build; healthcheck `/`.
- **worker** — no build (tsx runtime); **cron** `1-59/5 * * * *` → `pnpm --filter @copytrade/worker run cohort-snapshot`; `restartPolicyType: NEVER` (the schedule re-runs it; a failed snapshot just retries next cycle). The cron fires ~1 min after Hyperdash's 5-min recompute so it captures the fresh snapshot.

## One-time dashboard setup (per service)
The CLI can't set Root Directory or connect the GitHub app, so do this in the dashboard:
1. New project **`swash`** → connect GitHub repo `hexcantcode/swash.finance`.
2. Add service **api**: Source = repo `main`; **Settings → Root Directory = `apps/api`**; Networking → Generate Domain.
3. Add service **mobile**: Root Directory `apps/mobile`; Generate Domain.
4. Add service **worker**: Root Directory `apps/worker`. (No domain. The cron schedule comes from `railway.json`; confirm it shows under the service's cron settings.)
5. Variables: `DATABASE_URL` on **api** + **worker** (the Neon string); `PUBLIC_API_BASE` on **mobile** = api's public URL.

Railway reads each app's `railway.json` once Root Directory points at that app.

## CLI ops (after services exist + are linked)
```bash
railway link            # select project swash / env production / a service
railway variables --set "DATABASE_URL=..."   # or PUBLIC_API_BASE on mobile
railway up --service api          # deploy (or rely on GitHub auto-deploy on main)
railway logs --service api        # stream build/run logs
```
Verify: `GET <api-domain>/api/health` → `{ok:true}`, `/api/leaders` returns EP wallets; mobile root loads and its `/api/*` calls reach api.

## Notes
- `ecosystem.config.cjs` (PM2) is the **local** dev stack only; Railway uses the
  `railway.json` configs above. The worker's long-running `index.ts` cron is for
  local; Railway runs the one-shot CLI on a schedule.
- DB = Neon `delicate-bird-68439522`; after the EP pivot it holds only
  `cohort_sentiment_history` (see `CLAUDE.md`).
