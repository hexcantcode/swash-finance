# Railway deployment — Swash

How Swash deploys. **Live as of 2026-07-01.** Config-as-code lives in each app's
`railway.json`; the per-service Root Directory / Config File / cron / secrets are
service settings (dashboard or Railway API).

## Live shape: 1 project, 3 services, 1 external DB

Railway project **`adventurous-alignment`** (env `production`) — *auto-named; rename
to `swash` in Settings when convenient.* All three services deploy from the GitHub
repo **`hexcantcode/swash-finance`, branch `main`**. DB is **Neon** (external).

| Service | Role | URL | Env vars |
|---|---|---|---|
| **api** (svc name `swash.finance`) | the single backend (BFF) | `https://swashfinance-production.up.railway.app` | `DATABASE_URL`* |
| **mobile** | PWA frontend (pure `/api` client) | `https://mobile-production-9cad.up.railway.app` | `PUBLIC_API_BASE` = api URL |
| **worker** | `cohort-snapshot` cron (every 5 min) | — (no domain) | `DATABASE_URL` |

\* api reads Hyperdash, not the DB, so `DATABASE_URL` on api is optional. Worker needs it.

## THE monorepo gotcha (this is the important part)

**Do NOT set Root Directory = `apps/api`.** With a shared pnpm workspace, that hides
the root `pnpm-lock.yaml` from Nixpacks, which then falls back to `npm` and dies on
`workspace:*` deps. Instead, per service:

- **Root Directory = empty** (repo root) → Nixpacks sees the workspace, uses pnpm.
- **Config File = `apps/<app>/railway.json`** (Settings → "Railway Config File") →
  Railway uses that app's build/start while building from the repo root.

Because the build context is the repo root, the config commands are **repo-root-relative**:
- **api** — build `pnpm --filter @copytrade/api build`; start `node apps/api/build/index.js`; healthcheck `/api/health`.
- **mobile** — build `pnpm --filter @copytrade/mobile build`; start `pnpm --filter @copytrade/mobile exec serve -s build -l $PORT` (adapter-static, `serve` is a dep); healthcheck `/`.
- **worker** — no build; start `pnpm --filter @copytrade/worker run cohort-snapshot`.

## Worker cron — set it in service settings, NOT railway.json

Railway does **not** honor `deploy.cronSchedule` from `railway.json` (verified — it
stayed `null`). Set the **Cron Schedule** on the worker service directly:
`1-59/5 * * * *` (every 5 min, ~1 min after Hyperdash's recompute), with Restart
Policy = **Never** (a one-shot that exits; the schedule re-runs it).

## Reproduce / manage via CLI + API

The CLI can't set Root Directory, Config File, or Cron — use the Railway GraphQL API
(`https://backboard.railway.app/graphql/v2`, `Authorization: Bearer <token>` from
`~/.railway/config.json` → `user.token`). **Send a browser `User-Agent`** or the WAF
returns 403. Key mutations used: `serviceCreate`, `serviceConnect`,
`serviceInstanceUpdate` (`rootDirectory:""`, `railwayConfigFile`, `cronSchedule`),
`variableUpsert`, `serviceDomainCreate`, `serviceInstanceDeployV2`.

Verify: `GET <api>/api/health` → `{ok:true}`, `/api/leaders` returns EP wallets;
mobile root → 200; `cohort_sentiment_history` gets a fresh row every 5 min.

## Notes
- `ecosystem.config.cjs` (PM2) is the **local** dev stack only.
- DB = Neon `delicate-bird-68439522`; after the EP pivot it holds only
  `cohort_sentiment_history` (see `CLAUDE.md`).
- The `railway.json` files keep `cronSchedule`/NIXPACKS as documentation, but the
  *effective* settings live on the Railway services (dashboard/API) per above.
