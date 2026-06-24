# Copytrade Platform — Build Specification

> ⚠️ **STATUS (2026-06-23): HISTORICAL CONTEXT, NOT THE CURRENT BUILD TARGET.**
> This document describes the original Hyperliquid copy-execution product (v0.5/v1).
> The product has since pivoted to **analytics-only** (a curated leaderboard +
> trader/asset detail + feed), is now **mobile-led** (`apps/mobile` client +
> `apps/api` BFF), and is moving to a **multi-venue** model (Lighter alongside
> Hyperliquid). No copy execution exists today.
> For current truth read **`CLAUDE.md`** and the **`docs/plans/*`** design docs.
> Use the sections below for durable domain facts (HL gotchas, schema rationale,
> scoring derivations), not as a feature checklist.

> **Original intent:** single source of truth for building this product. Every coding agent should read this fully before writing HL/execution code.

---

## 0. Document Purpose & Conventions

### Why this document exists

To build the platform without bugs or code mistakes by encoding every architectural decision, schema, API contract, correctness rule, and Hyperliquid-specific gotcha in one place. If you are a coding agent, this is your authoritative reference. If something is ambiguous in this document, ask before assuming.

### Versioning philosophy

The product is built in two versions to keep agent context clean:

- **v0.5 — Discovery + Watchlist.** Browse, filter, and bookmark leaders. No automated copy execution. No real money flows. Validates that curated trader discovery is the product.
- **v1 — Automated Copy.** Adds agent wallet flows, copy execution, builder fee revenue, and leader payouts on top of v0.5.

**Critical: when working on v0.5, do not introduce v1 concepts.** When working on v1, do not modify v0.5 invariants. Each section below is explicitly tagged.

### Conventions used in this document

- `[v0.5]` — applies to v0.5 only
- `[v1]` — applies to v1 only
- `[both]` — applies to both versions
- `[CRITICAL]` — failure to follow this rule causes bugs, data corruption, financial loss, or regulatory issues
- All wallet addresses are stored lowercase (canonical form `0x...`, 42 chars)
- All timestamps in the database are `timestamptz` UTC unless explicitly noted
- All monetary values use `numeric(30,8)` to preserve precision
- All comparisons against Hyperliquid data normalize the address to lowercase first

---

## 1. Product Summary

### What we are building

A non-custodial copytrade platform on Hyperliquid where:
- Users browse a curated list of profitable leaders, filtered by trader type, asset focus, and risk profile
- Users delegate trade execution to a platform-controlled agent wallet (cannot withdraw funds)
- Selected leaders' trades are mirrored to the user's account in real time
- Builder code captures fee revenue on every fill, optionally shared with verified leaders

### What makes this defensible

The trader list itself. Specifically: behavioral classification (alpha hunter / veteran / insider / specialist / dark horse) layered on quantitative filters (PSR, DSR, profit factor, drawdown profile) plus decay tracking. None of this is available on Hyperdash, ASXN, or HypurrScan today.

### Revenue model

- Builder fee on every copy fill: 30 bps (3 USDC per 1000 USDC notional)
- Tiered split with leader sign-in:
  - Anonymous leader: 30 bps platform / 0 bps leader
  - Wallet-verified leader: 22 bps platform / 8 bps leader
  - X-verified leader: 15 bps platform / 15 bps leader
- Optional future: subscription for premium tags / advanced filters / fast mode

---

## 2. Technology Stack

### Locked-in choices

| Layer | Choice | Reason |
|---|---|---|
| Frontend framework | SvelteKit | Consistency with cream.run, founder familiarity, smaller bundles |
| Styling | Tailwind CSS + shadcn-svelte | Same DX as shadcn/ui, ports cleanly |
| Backend | SvelteKit `+server.ts` endpoints + separate Node.js workers | Single repo, file-based API routes |
| Database | Neon Postgres | Serverless, branching, generous free tier |
| ORM | Drizzle ORM | Type-safe, migration-friendly, framework-agnostic |
| Auth | `@auth/sveltekit` (Auth.js) + SIWE custom provider + Privy embedded wallets | Supports both crypto and email users; SIWE via the `siwe` npm package wired as a credentials provider |
| Background jobs | Node.js scripts on VPS, run via `node-cron` or systemd timers | No additional infra needed |
| WebSocket ingestion | Node.js worker with `ws` library | Standard, well-supported |
| Hyperliquid SDK | `@nktkas/hyperliquid` (TypeScript, well-maintained) | Native TS, agent-friendly; alternative: write thin wrapper around REST/WS |
| Email | Resend | Cheap, simple API |
| Hosting (web) | Vercel (free tier for v0.5) | Auto-deploys from git, zero config |
| Hosting (workers) | Hetzner CAX21 VPS, Tokyo region | $20/mo, near HL validators |
| Secrets management | Vercel env vars (web) + Doppler or .env.encrypted (workers) | Simple for MVP |
| KMS [v1] | AWS KMS for agent wallet encryption | Standard, audited |
| Monitoring | Grafana Cloud free tier + UptimeRobot | Free, sufficient for MVP |
| Domain/SSL | Cloudflare | Free SSL, DDoS protection |

### Repo structure

```
copytrade/
├── apps/
│   ├── web/                          # SvelteKit app (frontend + user-facing API)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── +layout.svelte    # Root layout
│   │   │   │   ├── +layout.server.ts # Root server load (session, etc.)
│   │   │   │   ├── +page.svelte      # Landing
│   │   │   │   ├── (marketing)/      # About, methodology, legal
│   │   │   │   ├── (auth)/           # Sign-in, onboarding
│   │   │   │   ├── browse/           # Browse table, filters
│   │   │   │   ├── trader/[address]/ # Leader detail
│   │   │   │   ├── (account)/        # Watchlist, settings, portfolio
│   │   │   │   ├── leader/           # Leader dashboard, claim
│   │   │   │   └── api/              # API routes (+server.ts files, see §6)
│   │   │   ├── lib/
│   │   │   │   ├── components/       # Svelte UI components
│   │   │   │   ├── server/           # Server-only utilities (auto-fenced by SvelteKit)
│   │   │   │   ├── stores/           # Svelte stores
│   │   │   │   └── utils/            # Shared client+server utilities
│   │   │   ├── app.html
│   │   │   ├── app.d.ts              # App.Locals type (session, user, etc.)
│   │   │   └── hooks.server.ts       # Auth middleware, error handling
│   │   ├── static/
│   │   ├── svelte.config.js          # Adapter config (Vercel or Node)
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── worker/                       # Background services
│       ├── src/
│       │   ├── jobs/                 # Cron jobs (scoring, discovery, etc.)
│       │   ├── ingestor/             # WS ingestion service
│       │   ├── executor/             # [v1] Copy execution engine
│       │   └── index.ts
│       └── package.json
├── packages/
│   ├── db/                           # Drizzle schema + migrations
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── client.ts
│   ├── hl-client/                    # Hyperliquid API/WS client wrapper
│   │   ├── info.ts                   # REST info endpoint helpers
│   │   ├── exchange.ts               # [v1] REST exchange endpoint helpers
│   │   ├── ws.ts                     # WebSocket client
│   │   ├── signing.ts                # [v1] EIP-712 signing helpers
│   │   ├── types.ts                  # Generated/canonical types
│   │   └── constants.ts
│   ├── scoring/                      # Score computation library
│   │   ├── metrics.ts                # PSR, DSR, Sharpe, Sortino, etc.
│   │   ├── classifier.ts             # Tag rules
│   │   ├── decay.ts                  # Rolling metrics
│   │   └── index.ts
│   └── shared/                       # Shared types, constants, utils
├── docs/
│   └── BUILD_SPEC.md                 # This document
├── docker-compose.yml                # Local dev stack
├── package.json                      # pnpm workspace root
└── pnpm-workspace.yaml
```

Use **pnpm** as the package manager. **Do not** use npm or yarn — they don't handle workspace deps as cleanly.

---

## 3. Environment Variables

### Required for `web` app

```bash
# Database
DATABASE_URL=postgresql://...

# Hyperliquid endpoints
HL_API_URL=https://api.hyperliquid.xyz
HL_INFO_URL=https://api.hyperliquid.xyz/info
HL_EXCHANGE_URL=https://api.hyperliquid.xyz/exchange
HL_WS_URL=wss://api.hyperliquid.xyz/ws

# Auth (Auth.js for SvelteKit)
AUTH_SECRET=                           # 32+ random bytes; used by @auth/sveltekit
AUTH_URL=https://copytrade.example.com # Canonical URL for OAuth callbacks
AUTH_TRUST_HOST=true                   # Required when behind a reverse proxy (Vercel, etc.)

# Privy (optional, for embedded wallets)
PUBLIC_PRIVY_APP_ID=                   # PUBLIC_ prefix exposes to client per SvelteKit convention
PRIVY_APP_SECRET=

# Email
RESEND_API_KEY=

# Builder code [v1]
PUBLIC_BUILDER_ADDRESS=                # Platform's builder address (public, used by client)
BUILDER_FEE_BPS=30                     # Total builder fee in bps

# X OAuth (for leader verification)
X_OAUTH_CLIENT_ID=
X_OAUTH_CLIENT_SECRET=

# Admin
ADMIN_API_TOKEN=                       # For admin endpoints

# Feature flags
ENABLE_LEADER_CLAIMS=true
ENABLE_COPY_EXECUTION=false            # false in v0.5, true in v1
```

### Required for `worker`

```bash
# Database (same as web)
DATABASE_URL=

# Hyperliquid
HL_API_URL=
HL_WS_URL=
HL_FOUNDATION_NODE_URL=                # Optional: foundation non-validator if available

# Builder [v1]
BUILDER_PRIVATE_KEY=                   # Encrypted; decrypted via KMS at runtime
BUILDER_ADDRESS=

# KMS [v1]
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
KMS_KEY_ID=                            # For wrapping agent wallet keys

# Worker config
WORKER_REGION=tokyo
WORKER_ID=worker-1                     # If running multiple workers
LOG_LEVEL=info

# Rate limit budgets
HL_REST_WEIGHT_BUDGET_PER_MIN=800     # Reserve 400/1200 for unforeseen spikes
HL_REFRESH_PER_LEADER_COOLDOWN_SEC=60
HL_REFRESH_PER_USER_PER_MIN=10
```

[CRITICAL] Never commit any of these to git. Use `.env.local` in dev, Vercel/Doppler in prod. Add `.env*` to `.gitignore`.

---

## 4. Database Schema

### Conventions

- All addresses are TEXT, lowercase, format `0x[a-f0-9]{40}`
- Indexes are explicit (don't rely on foreign-key autocreation)
- All tables have `created_at`, mutable tables have `updated_at`
- Use `numeric(30,8)` for all monetary/quantity values
- Use `bigint` for HL trade IDs (`tid`) — they're large enough to overflow int4

### v0.5 Schema

```sql
-- ============================================================
-- USERS & AUTH
-- ============================================================

create table users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  main_wallet     text unique check (main_wallet ~ '^0x[a-f0-9]{40}$'),
  privy_user_id   text unique,
  display_name    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_active_at  timestamptz
);

create index idx_users_main_wallet on users(main_wallet);

-- ============================================================
-- WALLET UNIVERSE
-- ============================================================

-- Every wallet ever observed on HL. Includes leaders, agents, normal users.
create table wallets (
  address           text primary key check (address ~ '^0x[a-f0-9]{40}$'),
  master_address    text references wallets(address),  -- if this is an agent
  is_agent          boolean not null default false,
  is_vault          boolean not null default false,
  agent_name        text,                              -- e.g. "MyApp Trading"
  agent_valid_until bigint,                            -- ms timestamp, null = no expiry
  
  first_seen_at     timestamptz not null,
  last_seen_at      timestamptz not null,
  
  total_fills       bigint not null default 0,
  total_volume_usd  numeric(30,8) not null default 0,
  
  -- Latest snapshot from refresh
  account_value     numeric(30,8),
  
  -- Cached values, refreshed by score job
  composite_score   int,                               -- 0-100
  primary_tag       text,                              -- main tag enum
  
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_wallets_master on wallets(master_address) where master_address is not null;
create index idx_wallets_score on wallets(composite_score desc) where composite_score is not null;
create index idx_wallets_last_seen on wallets(last_seen_at desc);
create index idx_wallets_primary_tag on wallets(primary_tag) where primary_tag is not null;

-- ============================================================
-- FILLS (event log of every observed fill)
-- ============================================================

create table fills (
  -- (tid, user_address) is the unique key. tid alone isn't unique because
  -- the same trade has two fill records (buyer + seller).
  tid               bigint not null,
  user_address      text not null,
  
  block_time_ms     bigint not null,                   -- HL block time in ms
  
  coin              text not null,                     -- includes HIP-3 prefix when applicable
  side              char(1) not null check (side in ('B', 'A')),  -- B=buy, A=sell
  px                numeric(30,8) not null,
  sz                numeric(30,8) not null,
  
  fee               numeric(30,8) not null,
  fee_token         text not null,
  builder_fee       numeric(30,8) not null default 0,  -- subset of fee
  
  oid               bigint,
  hash              text not null,
  crossed           boolean not null,                  -- was taker?
  
  closed_pnl        numeric(30,8) not null default 0,
  start_position    numeric(30,8),
  
  liquidation_user  text,                              -- if this fill was a liquidation
  
  created_at        timestamptz not null default now(),
  
  primary key (tid, user_address)
);

create index idx_fills_user_time on fills(user_address, block_time_ms desc);
create index idx_fills_coin_time on fills(coin, block_time_ms desc);
create index idx_fills_block_time on fills(block_time_ms desc);

-- Partition by month if growth requires it. Initial: single table.

-- ============================================================
-- FUNDING PAYMENTS
-- ============================================================

create table fundings (
  id              bigserial primary key,
  user_address    text not null,
  block_time_ms   bigint not null,
  coin            text not null,
  usdc            numeric(30,8) not null,
  szi             numeric(30,8) not null,
  funding_rate    numeric(30,8) not null,
  created_at      timestamptz not null default now(),
  
  unique (user_address, block_time_ms, coin)
);

create index idx_fundings_user_time on fundings(user_address, block_time_ms desc);

-- ============================================================
-- LEDGER UPDATES (deposits, withdrawals, transfers)
-- [CRITICAL] Required for accurate PnL calculation.
-- ============================================================

create table ledger_updates (
  id              bigserial primary key,
  user_address    text not null,
  block_time_ms   bigint not null,
  hash            text not null,
  type            text not null,                       -- 'deposit', 'withdraw', etc.
  usdc            numeric(30,8),                       -- nullable for non-USDC events
  details_json    jsonb,                               -- full delta object
  created_at      timestamptz not null default now(),
  
  unique (hash, user_address, type)
);

create index idx_ledger_user_time on ledger_updates(user_address, block_time_ms desc);

-- ============================================================
-- COMPUTED SCORES
-- ============================================================

create table scores (
  address                text primary key references wallets(address),
  computed_at            timestamptz not null,
  
  -- Sample / coverage
  total_trades           int not null,
  total_round_trips      int not null,
  total_volume_usd       numeric(30,8) not null,
  first_trade_at         timestamptz,
  last_trade_at          timestamptz,
  active_days            int not null,
  
  -- PnL (deposits/withdrawals subtracted)
  net_pnl_usd            numeric(30,8) not null,
  net_pnl_pct            numeric(20,8),                -- net_pnl / time-weighted account value
  
  -- Risk-adjusted
  sharpe                 numeric(10,4),
  sortino                numeric(10,4),
  calmar                 numeric(10,4),
  psr                    numeric(10,4),                -- probabilistic sharpe ratio
  dsr                    numeric(10,4),                -- deflated sharpe ratio
  profit_factor          numeric(10,4),
  win_rate               numeric(10,4),
  expectancy             numeric(20,8),
  max_drawdown_pct       numeric(10,4),
  recovery_time_days     int,
  
  -- Behavioral
  avg_hold_seconds       bigint,
  trades_per_day_avg     numeric(10,4),
  maker_taker_ratio      numeric(10,4),                -- maker_volume / total_volume
  asset_concentration    numeric(10,4),                -- Herfindahl on volume
  primary_asset          text,                         -- the dominant coin if any
  primary_dex            text,                         -- 'main' or HIP-3 dex name
  long_short_ratio       numeric(10,4),
  funding_pnl_pct        numeric(10,4),                -- sensitivity signal
  
  -- Decay
  rolling_30d_sharpe     numeric(10,4),
  rolling_7d_sharpe      numeric(10,4),
  decay_flag             text,                         -- 'green', 'yellow', 'red', null
  
  -- Composite
  composite_score        int not null,                 -- 0-100
  
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ============================================================
-- TAGS
-- ============================================================

-- One primary tag, multiple secondary tags.
create table wallet_tags (
  address     text not null references wallets(address),
  tag_type    text not null,                           -- 'main', 'asset', 'cadence', 'risk', 'heat', 'size'
  tag_value   text not null,
  set_by      text not null default 'auto',            -- 'auto' or 'admin:<id>'
  set_at      timestamptz not null default now(),
  
  primary key (address, tag_type, tag_value)
);

create index idx_wallet_tags_lookup on wallet_tags(tag_type, tag_value);

-- Allowed values (enforce in app layer):
-- main: 'alpha_hunter', 'veteran', 'insider', 'specialist', 'dark_horse'
-- asset: 'bluechip', 'altcoin', 'meme', 'stocks', 'mixed'
-- cadence: 'scalp', 'intraday', 'swing', 'position'
-- risk: 'conservative', 'balanced', 'aggressive'
-- heat: 'hot', 'steady', 'cooling'
-- size: 'whale', 'mid', 'small', 'micro'

-- ============================================================
-- WATCHLIST
-- ============================================================

create table watchlist (
  user_id        uuid not null references users(id) on delete cascade,
  leader_addr    text not null references wallets(address),
  added_at       timestamptz not null default now(),
  
  primary key (user_id, leader_addr)
);

-- ============================================================
-- REFRESH CACHE
-- ============================================================

create table leader_cache (
  address               text primary key references wallets(address),
  last_refreshed_at     timestamptz,
  next_refresh_after    timestamptz,                   -- now() + 60s after refresh
  
  account_value         numeric(30,8),
  positions_json        jsonb,
  recent_fills_json     jsonb,                         -- last 50
  funding_30d_json      jsonb,
  ledger_30d_json       jsonb,
  
  refresh_count         int not null default 0,
  last_refresh_source   text                           -- 'user_click', 'opportunistic', 'background_top'
);

-- ============================================================
-- DISCOVERY QUEUE
-- ============================================================

create table discovery_queue (
  address       text primary key,
  queued_at     timestamptz not null default now(),
  source        text not null,                         -- 'refresh_side_effect', 'daily_sweep', 'weekly_full'
  processed     boolean not null default false,
  processed_at  timestamptz
);

create index idx_discovery_queue_pending on discovery_queue(queued_at) where not processed;

-- ============================================================
-- LEADER PROFILES (claimed via SIWE)
-- ============================================================

create table leader_profiles (
  address              text primary key references wallets(address),
  user_id              uuid references users(id),     -- null if claimed but not linked to platform user
  
  display_name         text not null,
  bio                  text,
  avatar_url           text,
  
  twitter_handle       text,
  twitter_id           text,
  twitter_verified_at  timestamptz,
  
  verification_tier    text not null check (verification_tier in ('wallet', 'x')),
  
  do_not_list          boolean not null default false,
  
  claimed_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  
  -- Onboarding agreement
  tos_accepted_at      timestamptz not null,
  tos_version          text not null
);

-- ============================================================
-- ONBOARDING / USER PREFERENCES
-- ============================================================

create table user_preferences (
  user_id        uuid primary key references users(id) on delete cascade,
  intent         text,                                 -- 'steady', 'high-upside', 'narrative', 'explore'
  risk_tolerance text,                                 -- 'conservative', 'balanced', 'aggressive'
  asset_focus    text,                                 -- 'bluechip', 'altcoin', 'meme', 'stocks', 'any'
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

create table audit_log (
  id          bigserial primary key,
  actor       text,                                    -- 'system', 'user:<id>', 'admin:<id>'
  action      text not null,
  target      text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index idx_audit_actor on audit_log(actor, created_at desc);
create index idx_audit_action on audit_log(action, created_at desc);
```

### v1 Additional Schema

```sql
-- ============================================================
-- AGENT WALLETS [v1]
-- ============================================================

create table agent_wallets (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references users(id) on delete restrict,
  address                  text not null unique check (address ~ '^0x[a-f0-9]{40}$'),
  
  -- Encrypted private key (KMS-wrapped)
  encrypted_privkey        bytea not null,
  kms_key_id               text not null,
  
  -- Lifecycle
  created_at               timestamptz not null default now(),
  approved_at              timestamptz,                -- when ApproveAgent confirmed onchain
  approval_tx_hash         text,
  activated_at             timestamptz,                -- when funded with activation gas
  
  -- ApproveBuilderFee state
  builder_fee_approved     boolean not null default false,
  builder_fee_max_bps      int,                        -- e.g., 30 = 30 bps
  builder_fee_approved_at  timestamptz,
  builder_fee_tx_hash      text,
  
  status                   text not null default 'pending'
                           check (status in ('pending', 'active', 'revoked', 'compromised')),
  revoked_at               timestamptz,
  
  agent_name               text                       -- displayed to user in HL UI
);

create unique index idx_agent_wallets_user_active on agent_wallets(user_id) 
  where status = 'active';
  -- One active agent per user. Multiple historical OK.

-- ============================================================
-- FOLLOWS (user copies leader)
-- ============================================================

create table follows (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references users(id),
  agent_wallet_id               uuid not null references agent_wallets(id),
  leader_address                text not null references wallets(address),
  
  -- Sizing
  allocation_pct                numeric(5,4) not null,  -- 0.05 = 5%
  sizing_method                 text not null default 'pct_of_account'
                                check (sizing_method in ('pct_of_account', 'fixed_dollar', 'mirror_leverage')),
  fixed_dollar_per_trade        numeric(30,8),
  
  -- Risk caps
  per_trade_max_usd             numeric(30,8),
  daily_loss_limit_pct          numeric(5,4) default 0.10,
  asset_blacklist               text[] default '{}',
  slippage_tolerance_bps        int not null default 5,
  
  -- Auto-stop
  auto_stop_consecutive_losers  int default 3,
  auto_stop_drawdown_pct        numeric(5,4) default 0.25,
  consecutive_loss_count        int not null default 0,
  
  -- Speed
  fast_mode                     boolean not null default false,  -- enables priority fee
  
  -- State
  status                        text not null default 'active'
                                check (status in ('active', 'paused', 'stopped', 'auto_stopped')),
  paused_reason                 text,
  
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  
  unique (user_id, leader_address)
);

create index idx_follows_active on follows(leader_address) where status = 'active';
create index idx_follows_user on follows(user_id, status);

-- ============================================================
-- COPY FILLS (every fill we executed for users)
-- [CRITICAL] Idempotency by (leader_fill_tid, user_id)
-- ============================================================

create table copy_fills (
  id                  uuid primary key default gen_random_uuid(),
  follow_id           uuid not null references follows(id),
  user_id             uuid not null references users(id),
  agent_wallet_id     uuid not null references agent_wallets(id),
  
  -- Source: the leader's fill that triggered this
  leader_address      text not null,
  leader_fill_tid     bigint not null,
  leader_fill_time_ms bigint not null,
  
  -- Order intent
  coin                text not null,
  side                char(1) not null check (side in ('B', 'A')),
  intended_px         numeric(30,8),
  intended_sz         numeric(30,8) not null,
  
  -- Execution result
  our_oid             bigint,
  our_tid             bigint,                          -- HL trade id of OUR fill
  filled_px           numeric(30,8),
  filled_sz           numeric(30,8),
  
  -- Costs
  fee                 numeric(30,8),
  builder_fee         numeric(30,8),
  
  -- Status
  status              text not null
                      check (status in ('pending', 'submitted', 'filled', 'partial', 'rejected', 'skipped')),
  rejected_reason     text,                            -- e.g. 'slippage_exceeded', 'asset_blacklisted'
  
  -- Timestamps
  detected_at         timestamptz not null,            -- when we saw the leader's fill
  submitted_at        timestamptz,
  filled_at           timestamptz,
  
  unique (leader_fill_tid, user_id)                   -- IDEMPOTENCY KEY
);

create index idx_copy_fills_user on copy_fills(user_id, detected_at desc);
create index idx_copy_fills_follow on copy_fills(follow_id, detected_at desc);
create index idx_copy_fills_status on copy_fills(status) where status in ('pending', 'submitted');

-- ============================================================
-- FEE LEDGER
-- ============================================================

create table fee_ledger (
  id                  uuid primary key default gen_random_uuid(),
  copy_fill_id        uuid not null references copy_fills(id),
  
  notional_usd        numeric(30,8) not null,
  total_builder_fee   numeric(30,8) not null,         -- in USDC
  
  platform_share      numeric(30,8) not null,
  leader_share        numeric(30,8) not null default 0,
  leader_address      text references wallets(address),
  leader_tier         text check (leader_tier in ('anonymous', 'wallet', 'x')),
  
  recorded_at         timestamptz not null default now()
);

create index idx_fee_ledger_leader on fee_ledger(leader_address, recorded_at) 
  where leader_address is not null;

-- ============================================================
-- LEADER CLAIMS (claimable balance)
-- ============================================================

create table leader_claims (
  leader_address          text primary key references wallets(address),
  
  claimable_usdc          numeric(30,8) not null default 0,
  total_earned_usdc       numeric(30,8) not null default 0,
  total_withdrawn_usdc    numeric(30,8) not null default 0,
  
  oldest_unclaimed_at     timestamptz,                -- for 12-month expiration
  
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ============================================================
-- LEADER WITHDRAWALS
-- ============================================================

create table leader_withdrawals (
  id              uuid primary key default gen_random_uuid(),
  leader_address  text not null references wallets(address),
  amount_usdc     numeric(30,8) not null check (amount_usdc > 0),
  
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  failure_reason  text,
  tx_hash         text,
  
  requested_at    timestamptz not null default now(),
  processed_at    timestamptz,
  completed_at    timestamptz
);

create index idx_withdrawals_status on leader_withdrawals(status, requested_at);

-- ============================================================
-- POSITION SNAPSHOTS (per user, for portfolio view)
-- ============================================================

create table position_snapshots (
  id              bigserial primary key,
  user_id         uuid not null references users(id),
  agent_wallet    text not null,
  snapshot_time   timestamptz not null default now(),
  
  account_value   numeric(30,8) not null,
  positions_json  jsonb not null,                     -- ClearinghouseState format
  
  -- For querying historical pnl
  cumulative_realized_pnl   numeric(30,8),
  unrealized_pnl            numeric(30,8)
);

create index idx_position_snapshots_user on position_snapshots(user_id, snapshot_time desc);

-- ============================================================
-- NONCE COUNTERS (per agent wallet, prevents races)
-- ============================================================

create table nonce_counters (
  agent_address   text primary key references agent_wallets(address),
  current_nonce   bigint not null,                    -- ms timestamp last used
  last_synced_at  timestamptz not null default now()
);
```

[CRITICAL] All foreign keys must be properly declared. Don't skip them — they prevent data corruption from orphaned rows.

---

## 5. Hyperliquid Client Library (`packages/hl-client`)

Centralize all Hyperliquid interaction here. Workers and web app both import from this package.

### Required modules

#### `info.ts` — REST info endpoint helpers

Each function wraps a single info type and handles:
- Address normalization (always lowercase before sending)
- Response parsing into typed objects
- Rate limit weight tracking (return weight cost in metadata)

Functions to implement:
- `getMeta(): Promise<Meta>` — universe of perp assets (weight: 20)
- `getSpotMeta(): Promise<SpotMeta>` — universe of spot assets
- `getPerpDexs(): Promise<PerpDex[]>` — all HIP-3 dexes
- `getAllMids(dex?: string): Promise<Record<string, string>>` (weight: 2)
- `getClearinghouseState(user: string, dex?: string): Promise<ClearinghouseState>` (weight: 2)
- `getUserFills(user: string, aggregateByTime?: boolean): Promise<Fill[]>` (weight: 20 + per 20 items)
- `getUserFillsByTime(user: string, startMs: number, endMs?: number, aggregateByTime?: boolean): Promise<Fill[]>` (same)
- `getUserFundings(user: string, startMs: number, endMs?: number): Promise<UserFunding[]>` (weight: 20 + per 20)
- `getUserNonFundingLedgerUpdates(user: string, startMs: number, endMs?: number): Promise<LedgerUpdate[]>` (weight: 20 + per 20)
- `getOpenOrders(user: string, dex?: string): Promise<Order[]>` (weight: 20)
- `getHistoricalAgents(user: string): Promise<Agent[]>` — [CRITICAL for v0.5]
- `getRecentTrades(coin: string): Promise<Trade[]>` (weight: 20 + per 20)
- `getL2Book(coin: string): Promise<L2Book>` (weight: 2)
- `getOrderStatus(user: string, oid: number): Promise<OrderStatus>` (weight: 2)

#### `ws.ts` — WebSocket client

Wraps `ws` library with:
- Automatic reconnection (exponential backoff: 1s → 60s)
- Subscription registry (re-subscribe on reconnect)
- Message dedup helpers (caller is responsible for actually deduping)
- Heartbeat handling (HL pings every 30s, respond)

Functions:
- `connect(url: string): Promise<void>`
- `subscribe(sub: Subscription, handler: (msg: Message) => void): SubscriptionId`
- `unsubscribe(id: SubscriptionId): void`
- `disconnect(): void`

[CRITICAL] On reconnect, subscriptions are NOT auto-resumed by HL. The client library must store all active subscriptions and re-send them after reconnect. This is your responsibility.

#### `signing.ts` [v1] — EIP-712 signing helpers

Functions:
- `signOrder(orderRequest, agentPrivKey, builderInfo?): SignedAction`
- `signApproveAgent(mainPrivKey, agentAddress, agentName?): SignedAction`
- `signApproveBuilderFee(mainPrivKey, builderAddress, maxBps): SignedAction`
- `getNonce(): number` — returns `Date.now()` but with monotonic guarantee per process

Use the official Python SDK as reference for exact EIP-712 type definitions. Do NOT reinvent the type structures — copy them precisely.

#### `exchange.ts` [v1] — REST exchange endpoint helpers

- `placeOrder(action, signature): Promise<OrderResponse>`
- `cancelOrder(action, signature): Promise<CancelResponse>`
- `approveAgent(action, signature): Promise<Response>`
- `approveBuilderFee(action, signature): Promise<Response>`

#### `types.ts` — Canonical types

Mirror the TypeScript interfaces from HL docs exactly. Critical types:

```typescript
type Side = 'B' | 'A';  // B = buy/long, A = ask/sell/short

interface Fill {
  coin: string;          // Includes HIP-3 prefix when applicable
  px: string;
  sz: string;
  side: Side;
  time: number;          // ms timestamp
  startPosition: string;
  dir: string;           // for display only
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;      // true = was taker
  fee: string;           // includes builderFee
  tid: number;
  liquidation?: { liquidatedUser?: string; markPx: number; method: 'market' | 'backstop' };
  feeToken: string;
  builderFee?: string;   // optional, only if > 0
}

interface OrderRequest {
  a: number;             // asset id (see constants.ts)
  b: boolean;            // isBuy
  p: string;             // price as string (no trailing zeros!)
  s: string;             // size as string (no trailing zeros!)
  r: boolean;            // reduceOnly
  t: { limit: { tif: 'Gtc' | 'Ioc' | 'Alo' } } | { trigger: ... };
  c?: string;            // cloid (optional client order id)
}

interface BuilderInfo {
  b: string;             // builder address
  f: number;             // fee in TENTHS of bps. e.g. f=300 means 30bps
}
```

### `constants.ts`

```typescript
export const HL_MAINNET_API = 'https://api.hyperliquid.xyz';
export const HL_MAINNET_WS = 'wss://api.hyperliquid.xyz/ws';

export const HL_BLOCK_TIME_MS = 200;  // ~0.2s typical

// Asset ID conversion:
// Perp on first dex (BTC, ETH, etc.): index from meta.universe
// Spot: 10000 + spot index
// Perp on HIP-3 dex: complex — see HIP-3 section
export function spotAssetId(spotIndex: number): number {
  return 10000 + spotIndex;
}
```

---

## 6. API Routes

### Conventions

- API routes are `+server.ts` files under `src/routes/api/...` exporting `GET`, `POST`, `PATCH`, `DELETE` handlers
- Use the `RequestHandler` type from `'./$types'` for handlers
- All routes return JSON with shape `{ ok: boolean, data?: T, error?: string }`
- Authenticated routes verify session in `hooks.server.ts` (sets `event.locals.user`); handlers read `event.locals.user`
- Throw `error(status, message)` from `@sveltejs/kit` for non-2xx responses (auto-formatted as JSON)
- All routes log to `audit_log` for state-changing operations
- Rate limit per user via Upstash Redis or in-memory (single-instance MVP)
- For form-style mutations on pages (copy modal, settings), prefer SvelteKit `actions` in `+page.server.ts` over fetch-to-API pattern (cleaner progressive enhancement)

### v0.5 Routes

#### Auth

```
POST   /api/auth/siwe/nonce
  Body: { address: string }
  Returns: { nonce: string }

POST   /api/auth/siwe/verify
  Body: { message: string, signature: string }
  Side effect: creates user if new, sets session cookie
  Returns: { user: User }

GET    /api/auth/me
  Returns: { user: User | null }

POST   /api/auth/signout
  Side effect: clears session
  Returns: { ok: true }
```

#### Browse / Discovery

```
GET    /api/leaders
  Query: ?tag=alpha_hunter&asset=bluechip&risk=balanced&heat=hot
         &sort=composite_score:desc&page=1&limit=50
  Returns: { leaders: LeaderCard[], total: number, page: number }
  
  LeaderCard {
    address: string
    display_name?: string  // from leader_profiles if claimed
    primary_tag: string
    secondary_tags: string[]
    composite_score: number
    metrics: {
      total_pnl_usd: number
      total_pnl_pct: number
      sharpe: number
      max_drawdown_pct: number
      total_trades: number
      avg_hold_seconds: number
    }
    verification_tier?: 'wallet' | 'x'
    twitter_handle?: string
    last_active_at: string  // ISO
    score_computed_at: string  // ISO
  }

GET    /api/leaders/:address
  Returns: { leader: LeaderDetail }
  
  LeaderDetail extends LeaderCard with:
    cache_age_seconds: number
    next_refresh_in_seconds: number
    positions: Position[]
    recent_fills: Fill[]  // last 50
    equity_curve: { ts: number, value: number }[]  // computed
    rolling_sharpe_30d_history: { ts: number, value: number }[]
    funding_30d_total: number
    deposits_30d_total: number
    withdrawals_30d_total: number

POST   /api/leaders/:address/refresh
  Auth: required
  Rate limit: 1/60s per leader (server-wide), 10/min per user
  Side effect: 
    1. If cache is fresh (< 60s old), return cached
    2. Otherwise: parallel fetch from HL info API (clearinghouseState, userFills, userFundings, ledgerUpdates)
    3. Update leader_cache row
    4. Async: extract counterparty addresses from recent fills, queue for discovery
  Returns: LeaderDetail

POST   /api/leaders/discover
  Auth: admin token required
  Body: { addresses: string[] }
  Side effect: insert into discovery_queue
  Returns: { queued: number }
```

#### Watchlist

```
POST   /api/watchlist
  Auth: required
  Body: { leader_address: string }
  Returns: { ok: true }

DELETE /api/watchlist/:leader_address
  Auth: required
  Returns: { ok: true }

GET    /api/watchlist
  Auth: required
  Returns: { leaders: LeaderCard[] }
```

#### Onboarding

```
POST   /api/onboarding
  Auth: required
  Body: { intent, risk_tolerance, asset_focus }
  Returns: { ok: true, recommendations: LeaderCard[] }

GET    /api/onboarding
  Auth: required
  Returns: { preferences: UserPreferences | null }
```

#### Leader Profile / Claim

```
POST   /api/leader-profile/claim/nonce
  Body: { address: string }
  Returns: { nonce: string }

POST   /api/leader-profile/claim/verify
  Body: { message, signature, display_name, bio?, avatar_url? }
  Side effect: 
    1. Verify SIWE signature
    2. Create leader_profile with verification_tier='wallet'
    3. Create leader_claims row if doesn't exist
  Returns: { profile: LeaderProfile }

POST   /api/leader-profile/connect-twitter
  Auth: leader required
  Initiates X OAuth flow
  
GET    /api/leader-profile/twitter-callback
  X OAuth callback
  Side effect: update verification_tier to 'x', store twitter_handle
  Redirect: /leader/dashboard

GET    /api/leader-profile/:address
  Returns: { profile: LeaderProfile | null }

PATCH  /api/leader-profile
  Auth: leader required
  Body: { display_name?, bio?, avatar_url?, do_not_list? }
  Returns: { profile: LeaderProfile }
```

#### Stats

```
GET    /api/stats
  Returns: {
    total_wallets: number,
    total_leaders_scored: number,
    avg_score: number,
    last_score_run: string  // ISO
  }
```

### v1 Additional Routes

#### Agent Wallets

```
POST   /api/agents/create
  Auth: required
  Side effect: 
    1. Generate fresh secp256k1 keypair
    2. Encrypt with KMS
    3. Insert agent_wallets row with status='pending'
  Returns: { agent_address: string, agent_name: string }

POST   /api/agents/:id/approve-confirmation
  Auth: required (must own agent)
  Body: { tx_hash: string }
  Side effect: 
    1. Verify tx hash exists on HL (via info API)
    2. Update agent_wallets status to 'active', record approval_tx_hash
  Returns: { agent: AgentWallet }

POST   /api/agents/:id/builder-fee-confirmation
  Auth: required
  Body: { tx_hash: string, max_bps: number }
  Returns: { agent: AgentWallet }

POST   /api/agents/:id/revoke
  Auth: required
  Side effect: status='revoked' (user must also sign revoke onchain via separate flow)
  Returns: { ok: true }
```

#### Follows / Copy

```
POST   /api/follows
  Auth: required
  Body: {
    leader_address: string
    allocation_pct: number
    sizing_method?: 'pct_of_account' | 'fixed_dollar' | 'mirror_leverage'
    fixed_dollar_per_trade?: number
    per_trade_max_usd?: number
    daily_loss_limit_pct?: number
    asset_blacklist?: string[]
    slippage_tolerance_bps?: number
    auto_stop_consecutive_losers?: number
    auto_stop_drawdown_pct?: number
    fast_mode?: boolean
  }
  Validation:
    - User must have an active agent_wallet
    - Leader must exist in wallets table
    - allocation_pct between 0.005 and 0.50
  Side effect: insert follows row with status='active'
  Returns: { follow: Follow }

PATCH  /api/follows/:id
  Auth: required (must own)
  Body: any subset of mutable fields
  Returns: { follow: Follow }

POST   /api/follows/:id/pause
  Auth: required
  Side effect: status='paused', paused_reason='user'
  Returns: { ok: true }

POST   /api/follows/:id/resume
  Returns: { ok: true }

DELETE /api/follows/:id
  Body: { close_open_positions?: boolean }
  Side effect: 
    1. status='stopped'
    2. If close_open_positions, queue close orders for user's positions in followed leader's coins
  Returns: { ok: true }

GET    /api/follows
  Auth: required
  Returns: { follows: Follow[] }
```

#### Portfolio

```
GET    /api/portfolio
  Auth: required
  Returns: {
    total_account_value: number
    total_pnl_24h: number
    total_pnl_7d: number
    total_pnl_30d: number
    active_follow_count: number
    open_position_count: number
    today_fees_paid: number
  }

GET    /api/portfolio/follows/:id
  Auth: required (must own)
  Returns: {
    follow: Follow
    fills: CopyFill[]
    pnl_attribution: { realized: number, unrealized: number, fees: number }
    equity_curve: { ts: number, value: number }[]
  }

GET    /api/portfolio/positions
  Auth: required
  Returns: { positions: Position[] }

GET    /api/portfolio/fills
  Auth: required
  Query: ?page=1&limit=50&follow_id=...
  Returns: { fills: CopyFill[], total: number }
```

#### Leader Earnings

```
GET    /api/leader/earnings
  Auth: leader required
  Returns: {
    claimable_usdc: number
    total_earned_usdc: number
    total_withdrawn_usdc: number
    expires_at: string | null
    recent_accruals: FeeLedgerEntry[]
  }

POST   /api/leader/withdraw
  Auth: leader required
  Body: { amount_usdc: number }
  Validation: amount <= claimable_usdc, amount >= 25 (min claim threshold)
  Side effect: 
    1. Insert leader_withdrawals row with status='pending'
    2. Decrement claimable_usdc atomically
    3. Trigger async withdrawal worker
  Returns: { withdrawal: LeaderWithdrawal }
```

---

## 7. Background Jobs

### Job Runner

Use a single `worker` process that runs multiple scheduled jobs via `node-cron` or `croner`. For long-running services (ingestor, executor), use separate child processes managed by a supervisor.

Run jobs with:
- Explicit `lockJob(name)` mutex via Postgres advisory locks (prevents double-runs)
- Logged start/end with duration
- On error: log to audit_log + send alert (Slack/Resend email)

### v0.5 Jobs

#### J-1: Daily score recompute (cron: `0 2 * * *` UTC)

Pseudocode:
```
acquire_lock('score_recompute')
log_start()

# 1. Determine which wallets to score
candidates = SELECT address FROM wallets 
             WHERE total_fills >= 10 
             AND last_seen_at > now() - interval '180 days'

# 2. For each candidate, compute metrics
for address in candidates:
  fills = SELECT * FROM fills 
          WHERE user_address = address OR user_address IN (
            SELECT address FROM wallets WHERE master_address = address
          )
          ORDER BY block_time_ms ASC
  
  fundings = SELECT * FROM fundings WHERE user_address = address ...
  ledger = SELECT * FROM ledger_updates WHERE user_address = address ...
  
  # Compute net pnl (CRITICAL: subtract deposits, add withdrawals)
  net_deposits = sum of (type='deposit') - sum of (type='withdraw')
  gross_pnl = sum of fills.closed_pnl + sum of fundings.usdc - sum of fills.fee
  net_pnl = gross_pnl - net_deposits  # gross was inflated by deposits
  
  # Risk metrics
  daily_returns = compute_daily_returns(fills, fundings, ledger)
  sharpe = mean(daily_returns) / stddev(daily_returns) * sqrt(365)
  psr = compute_psr(daily_returns, benchmark=0)
  dsr = compute_dsr(psr, n_trials=count(candidates))  # selection bias correction
  ...
  
  # Behavioral metrics
  avg_hold_seconds = compute_avg_hold(fills)
  maker_taker_ratio = sum(sz where !crossed) / sum(sz)
  ...
  
  # Apply tag rules
  primary_tag = classify_main_tag(metrics, behavioral)
  secondary_tags = classify_secondary(behavioral, fills)
  
  # Compute composite score (rubric in scoring/composite.ts)
  composite = compute_composite(metrics, behavioral, decay_flag)
  
  # Upsert
  INSERT INTO scores (...) ON CONFLICT (address) DO UPDATE
  DELETE FROM wallet_tags WHERE address = ?
  INSERT INTO wallet_tags (...) for each tag
  UPDATE wallets SET composite_score = ?, primary_tag = ?, updated_at = now()

log_end()
```

[CRITICAL] This job is CPU-bound but I/O simple. Run it as a single transaction per wallet (not one giant transaction). If a wallet fails, log and continue.

[CRITICAL] Re-running this job must produce the same result given the same inputs (deterministic). Don't use random sampling without a seed.

#### J-2: Daily wallet discovery sweep (cron: `0 1 * * *` UTC)

Pseudocode:
```
acquire_lock('discovery_sweep')

# Open WS connection
ws = connect(HL_WS_URL)

# Get list of all active perp coins (from meta + perpDexs)
coins = getActivePerpCoins()  # ~200 coins

# Subscribe to trades for each coin
for coin in coins:
  ws.subscribe({ type: 'trades', coin: coin })

# Accumulate for 30 minutes
addresses = Set<string>()
volume_per_addr = Map<string, number>()

ws.on_message((msg) => {
  if msg.channel == 'trades':
    for trade in msg.data:
      for user in trade.users:
        addresses.add(user.toLowerCase())
        volume_per_addr.add(user.toLowerCase(), trade.px * trade.sz)
})

await sleep(30 * 60 * 1000)  // 30 min
ws.disconnect()

# Upsert into wallets table
for addr in addresses:
  INSERT INTO wallets (address, first_seen_at, last_seen_at, total_volume_usd)
  VALUES (?, ?, ?, ?) 
  ON CONFLICT (address) DO UPDATE SET 
    last_seen_at = EXCLUDED.last_seen_at,
    total_volume_usd = wallets.total_volume_usd + EXCLUDED.total_volume_usd

# Queue NEW addresses for next-night scoring
for addr in addresses where wallets.first_seen_at = now():
  INSERT INTO discovery_queue (address, source) VALUES (?, 'daily_sweep')
```

#### J-3: Weekly full chain sweep (cron: `0 0 * * 0` UTC, Sundays)

Same as J-2 but runs for 24 hours instead of 30 minutes. Catches wallets not adjacent to actively-watched leaders.

#### J-4: Hourly trending refresh (cron: `0 * * * *`)

```
top = SELECT address FROM wallets 
      WHERE composite_score > 60 
      ORDER BY composite_score DESC LIMIT 100

for address in top:
  parallel fetch:
    clearinghouseState = info.getClearinghouseState(address)
    fills = info.getUserFills(address)  # last 100
  
  upsert leader_cache (positions_json, recent_fills_json, account_value, last_refreshed)
```

Rate budget: 100 leaders × ~22 weight = 2200 weight. Spread over 60 minutes = ~37/min, well within 1200/min.

#### J-5: Refresh queue processor (every 30 sec)

```
items = SELECT * FROM discovery_queue 
        WHERE NOT processed 
        ORDER BY queued_at ASC LIMIT 10

for item in items:
  fills = info.getUserFillsByTime(item.address, now() - 90d, now())
  fundings = info.getUserFundings(item.address, now() - 90d)
  ledger = info.getUserNonFundingLedgerUpdates(item.address, now() - 90d)
  
  # Bulk insert (handle duplicates with ON CONFLICT)
  INSERT INTO fills (...) ON CONFLICT (tid, user_address) DO NOTHING
  INSERT INTO fundings (...) ON CONFLICT DO NOTHING
  INSERT INTO ledger_updates (...) ON CONFLICT DO NOTHING
  
  # Detect agents and link to master
  agents = info.getHistoricalAgents(item.address)
  for agent in agents:
    INSERT INTO wallets (address, master_address, is_agent, agent_valid_until, ...)
    ON CONFLICT (address) DO UPDATE SET 
      master_address = EXCLUDED.master_address,
      is_agent = true
  
  # Mark as processed
  UPDATE discovery_queue SET processed = true, processed_at = now() WHERE address = ?
```

[CRITICAL] Must handle agent attribution here. If a leader trades through multiple agent wallets, you must roll their fills up to the master for proper scoring.

#### J-6: Stale data alert (every 6 hours)

If most recent fill in `fills` table is older than 30 minutes, alert ops. Possible causes: ingestor died, HL API issue, network problem.

### v1 Additional Jobs

#### J-7: Active leader subscription manager (continuous, runs as separate process)

```
active_leaders = Set<string>()

# Initial load
follows = SELECT DISTINCT leader_address FROM follows WHERE status = 'active'
active_leaders = Set(follows)

# Subscribe to trades feed (single WS connection, all coins)
ws = connect(HL_WS_URL)
coins = getActivePerpCoins()
for coin in coins:
  ws.subscribe({ type: 'trades', coin: coin })

ws.on_message((msg) => {
  if msg.channel == 'trades':
    for trade in msg.data:
      for user_addr in trade.users:
        if user_addr in active_leaders:
          emit_to_executor({ leader: user_addr, trade: trade })
})

# Update active_leaders set when follows change
listen_to_follows_changes(via Postgres LISTEN/NOTIFY):
  active_leaders.add(or remove)(...)
```

#### J-8: Copy execution worker (continuous)

Consumes events from J-7. For each leader fill event:

```
event = { leader_address, trade }

# Find all active follows for this leader
follows = SELECT * FROM follows WHERE leader_address = ? AND status = 'active'

for follow in follows:
  # IDEMPOTENCY CHECK
  exists = SELECT id FROM copy_fills WHERE leader_fill_tid = trade.tid AND user_id = follow.user_id
  if exists: continue  # already processed
  
  # Determine the leader's side from the trade
  # trade.users[0] is buyer (Long opener), trade.users[1] is seller (Short opener / Long closer)
  if trade.users[0].toLowerCase() == leader_address:
    side = 'B'  # leader bought
  else:
    side = 'A'  # leader sold
  
  # Get user account state
  agent = SELECT * FROM agent_wallets WHERE id = follow.agent_wallet_id AND status = 'active'
  state = info.getClearinghouseState(agent.user.main_wallet)
  
  # Compute size
  if follow.sizing_method == 'pct_of_account':
    target_notional = state.account_value * follow.allocation_pct
  elif follow.sizing_method == 'fixed_dollar':
    target_notional = follow.fixed_dollar_per_trade
  
  size = target_notional / trade.px
  size = round_to_szDecimals(size, asset_meta[trade.coin].szDecimals)
  
  # Apply caps
  if target_notional > follow.per_trade_max_usd: 
    target_notional = follow.per_trade_max_usd
    size = recompute(...)
  
  # Daily loss limit check
  today_pnl = compute_today_pnl(follow.user_id, follow.id)
  if today_pnl < -follow.daily_loss_limit_pct * state.account_value:
    skip_with_reason('daily_loss_limit_hit')
    continue
  
  # Asset blacklist
  if trade.coin in follow.asset_blacklist:
    skip_with_reason('asset_blacklisted')
    continue
  
  # Slippage check
  current_book = info.getL2Book(trade.coin)
  current_px = side == 'B' ? current_book.asks[0].px : current_book.bids[0].px
  slippage_bps = abs(current_px - trade.px) / trade.px * 10000
  if slippage_bps > follow.slippage_tolerance_bps:
    skip_with_reason('slippage_exceeded')
    continue
  
  # Insert copy_fill row (status='pending') for idempotency
  copy_fill_id = INSERT INTO copy_fills (
    follow_id, user_id, agent_wallet_id, leader_address, leader_fill_tid,
    leader_fill_time_ms, coin, side, intended_px, intended_sz, 
    status, detected_at
  ) VALUES (..., 'pending', now()) RETURNING id
  
  # If the insert failed due to unique conflict, another worker handled it. Skip.
  
  # Construct order
  asset_id = computeAssetId(trade.coin)  # see HIP-3 section
  order = {
    a: asset_id,
    b: side == 'B',
    p: format_price(current_px * (side == 'B' ? 1.005 : 0.995), tickSize), # aggressive limit
    s: format_size(size, szDecimals),
    r: false,  // not reduce-only
    t: { limit: { tif: 'Ioc' } }  // IOC for taker fill
  }
  
  builder = { b: BUILDER_ADDRESS, f: 300 }  // 30 bps in tenths-of-bps
  
  # Sign with agent's private key (decrypted from KMS in memory)
  agent_privkey = decrypt_kms(agent.encrypted_privkey)
  nonce = next_nonce_for(agent.address)
  signed = signOrder(order, builder, agent_privkey, nonce)
  agent_privkey.zeroize()  // clear from memory ASAP
  
  # Submit
  UPDATE copy_fills SET status = 'submitted', submitted_at = now() WHERE id = ?
  result = exchange.placeOrder(signed)
  
  if result.status == 'ok':
    UPDATE copy_fills SET our_oid = ?, ... WHERE id = ?
    # Wait for fill confirmation via WS or via order status polling
  else:
    UPDATE copy_fills SET status = 'rejected', rejected_reason = ? WHERE id = ?
```

[CRITICAL] Idempotency by `(leader_fill_tid, user_id)` is non-negotiable. Without it, network retries will double-execute orders.

[CRITICAL] Decrypt agent private keys only in memory. Use a `Buffer` and zero it after signing. Never log them. Never serialize them outside memory.

[CRITICAL] Nonce management: each agent address has a `nonce_counters` row. Acquire row-level lock when reading + incrementing. Use `ms timestamp + counter` if collisions possible:
```
nonce = max(now_ms, last_nonce + 1)
```

#### J-9: Position state syncer (every 5 min)

For each user with active follows, fetch their `clearinghouseState`, compute pnl, store snapshot.

#### J-10: Fee accrual reconciliation (cron: `0 3 * * *` UTC)

```
# For yesterday's filled copy_fills
fills = SELECT * FROM copy_fills 
        WHERE status = 'filled' 
        AND filled_at >= yesterday AND filled_at < today

for fill in fills:
  notional = fill.filled_px * fill.filled_sz
  total_builder_fee = fill.builder_fee  # actual fee charged by HL
  
  # Determine leader tier
  profile = SELECT * FROM leader_profiles WHERE address = fill.leader_address
  tier = profile ? (profile.verification_tier == 'x' ? 'x' : 'wallet') : 'anonymous'
  
  # Compute splits
  if tier == 'anonymous':
    platform_share = total_builder_fee
    leader_share = 0
  elif tier == 'wallet':
    platform_share = total_builder_fee * 22/30
    leader_share = total_builder_fee * 8/30
  elif tier == 'x':
    platform_share = total_builder_fee * 15/30
    leader_share = total_builder_fee * 15/30
  
  INSERT INTO fee_ledger (...)
  
  if leader_share > 0:
    UPDATE leader_claims 
    SET claimable_usdc = claimable_usdc + leader_share,
        total_earned_usdc = total_earned_usdc + leader_share,
        oldest_unclaimed_at = COALESCE(oldest_unclaimed_at, now()),
        updated_at = now()
    WHERE leader_address = fill.leader_address
    
    # If row doesn't exist, INSERT
```

#### J-11: Decay/blacklist evaluator (every 6 hours)

For each leader with active follows: check rolling 7d sharpe, recent dd, fill quality. If degraded:
- Update wallet's decay_flag
- Optionally pause follows (with user notification)

#### J-12: Leader fee expiration (daily 04:00 UTC)

```
expired = SELECT leader_address, claimable_usdc 
          FROM leader_claims 
          WHERE oldest_unclaimed_at < now() - interval '12 months'
          AND claimable_usdc > 0

for row in expired:
  # Move to platform's reclaim
  UPDATE leader_claims SET claimable_usdc = 0 WHERE leader_address = ?
  log to audit_log: 'leader_fees_expired'
```

#### J-13: Leader withdrawal processor (every 5 min)

```
pending = SELECT * FROM leader_withdrawals WHERE status = 'pending' LIMIT 10

for w in pending:
  UPDATE status = 'processing' WHERE id = ?
  
  try:
    tx = send_usdc(from=PLATFORM_TREASURY, to=w.leader_address, amount=w.amount_usdc)
    UPDATE status = 'sent', tx_hash = tx.hash WHERE id = ?
    
    # Wait for confirmation in subsequent run
  except err:
    UPDATE status = 'failed', failure_reason = err.message WHERE id = ?
    # Refund claimable balance
    UPDATE leader_claims SET claimable_usdc = claimable_usdc + w.amount_usdc WHERE ...
```

---

## 8. Frontend Pages

### v0.5 Pages

| Path | Description |
|---|---|
| `/` | Landing page. Hero + value prop + sample leader cards + sign-up |
| `/sign-in` | Sign-in (email or wallet via SIWE) |
| `/onboarding` | 3-question drill, results page |
| `/browse` | Main table. Filter rail on left, table on right. Paginated. |
| `/trader/[address]` | Leader detail. Equity curve, metrics, recent fills, refresh button. |
| `/watchlist` | User's bookmarked leaders |
| `/settings` | User profile, preferences, sign-out |
| `/leader/dashboard` | For verified leaders. Earnings preview, profile editor. |
| `/leader/claim` | Leader claim flow (SIWE + optional X) |
| `/about` | Platform description |
| `/methodology` | How scores are computed (transparency) |
| `/tos`, `/privacy` | Legal |

### v1 Additional Pages

| Path | Description |
|---|---|
| `/copy/[address]` | Copy modal. Allocation slider + advanced options. ApproveAgent if first time. |
| `/portfolio` | User's active copies + total pnl |
| `/portfolio/follows/[id]` | Per-follow detail. Pnl attribution, fills, settings. |
| `/onboarding/agent` | Agent wallet setup flow (post-signup, pre-first-copy) |

### Component conventions

- Use `shadcn-svelte` for buttons, modals, inputs, tables (https://shadcn-svelte.com)
- Use `layerchart` (Svelte-native) or `chart.js` for equity curves and metric charts
- Use `lucide-svelte` for icons
- Page paths above translate to SvelteKit routes: `/browse` → `src/routes/browse/+page.svelte`
- Use `+page.svelte` for UI, `+page.server.ts` for server `load` and form `actions`, `+page.ts` for client-safe load
- Prefer `+page.server.ts` `load` for data fetching — runs on server, ships only data to client, no API round-trip from page
- Mutations: SvelteKit `actions` pattern over fetch-to-API where it makes sense (progressive enhancement, less client-side state)
- `<script lang="ts">` everywhere; strict TypeScript
- All async ops show loading state (skeleton or spinner) — use `mode-watcher` and `bits-ui` patterns from shadcn-svelte
- All errors caught and shown as toasts via `svelte-sonner`

---

## 9. Critical Correctness Rules

[CRITICAL] These rules prevent the most common categories of bugs. Violations cause data corruption, financial loss, or wrong-result bugs that are hard to detect.

### Address handling

- Always store and compare addresses **lowercase**
- Validate format on input: `^0x[a-f0-9]{40}$`
- When receiving from HL, lowercase before any operation

### Amount and price formatting

- HL requires **no trailing zeros** in price/size strings. `"100.0"` is rejected; use `"100"`.
- Use the SDK or write a `formatHlNumber(value, decimals)` helper that strips trailing zeros after rounding to the asset's `szDecimals` / `tickSize`.
- Never use floating-point arithmetic on monetary values. Use `decimal.js` or BigInt-based math.

### Asset ID conversion

- **Perp on first dex (BTC, ETH, etc.)**: `asset = meta.universe.findIndex(coin)`. e.g., BTC is usually 0, ETH is 4.
- **Spot pair**: `asset = 10000 + spotMeta.universe.findIndex(name)`
- **HIP-3 perp**: asset id is structured. The coin field has `dex:COIN` format. Get correct asset id from that dex's meta.
- The conversion is in `computeAssetId(coin: string): number` — implement once, use everywhere.

### Side encoding

- HL uses `'B'` for buy/long, `'A'` for ask/sell/short.
- For order placement, use `b: true` for buy, `b: false` for sell.
- Don't mix these: a fill with `side: 'B'` becomes order `{ b: true }`.

### Idempotency [v1]

- Every copy execution must be guarded by the unique constraint on `copy_fills(leader_fill_tid, user_id)`.
- Insert with `ON CONFLICT DO NOTHING` then check `if not inserted: skip`.
- If a network retry causes a duplicate event, idempotency prevents double-execution.

### Deduplication

- Fills come from multiple sources (WS, REST refresh, S3 backfill). 
- Use `(tid, user_address)` as the primary key — never just `tid`.
- All inserts use `ON CONFLICT DO NOTHING`.

### WebSocket snapshots

- HL streams `isSnapshot: true` for the first message of a user-specific subscription.
- Process the snapshot to seed state, but **dedupe** against existing data.
- On reconnect, snapshots replay. Without dedup, you'd double-count.

### PnL calculation

[CRITICAL] **Net PnL must subtract deposits and add withdrawals.**

```
gross_pnl = sum(fills.closed_pnl) + sum(fundings.usdc) - sum(fills.fee)
net_deposits = sum(ledger.usdc where type = 'deposit') - sum(ledger.usdc where type = 'withdraw')
net_pnl = gross_pnl - net_deposits
```

If you skip this, a leader who deposited $10K shows $10K of "profit" — completely wrong. Users will catch this within hours.

### Agent attribution [CRITICAL for v0.5]

- Many leaders trade through their own agent wallets to avoid signing every order with cold storage.
- For correct scoring, you MUST roll up all fills from agents to the master address.
- When a leader address is queried via `historicalAgents`, you get a list of `(agent_address, valid_from, valid_until)` tuples.
- Store these in `wallets.master_address` so future fills are attributable.
- During score computation, query: `WHERE user_address IN (master, [...all_agents_for_master])`.
- Edge case: agent revoked then re-approved. Use the valid_from/valid_until ranges.

### HIP-3 prefix handling

- HIP-3 perps have coin field like `xyz:BTC` or `stocks-dex:NVDA`.
- The bare form `BTC` refers to the main perp dex's BTC.
- Don't merge them. Treat as different assets.
- For score aggregation, group by `(dex_name, coin)` not just `coin`.
- Asset class tagging: HIP-3 `stocks-dex:*` → `stocks` asset tag, etc.

### Nonce management [v1]

- HL nonces are millisecond timestamps. Must be unique and monotonic per signer.
- Use a row in `nonce_counters` per agent address with row-level locking:
```sql
SELECT current_nonce FROM nonce_counters WHERE agent_address = ? FOR UPDATE;
-- Compute new_nonce = max(now_ms, current_nonce + 1)
UPDATE nonce_counters SET current_nonce = ?, last_synced_at = now() WHERE agent_address = ?;
```
- Periodic reconciliation: query HL for the agent's last action timestamp; if our local counter is way ahead, that's fine (we have headroom). If way behind, jump forward.

### Builder fee units

- The `f` field in builder code is in **tenths of basis points**, not bps directly.
- `f = 300` means 30 bps (0.3%).
- This is the most common HL bug. Triple-check this in tests.

### Cancellation behavior

- HL recommends invalidating nonce over spamming cancels for high-frequency cancellation.
- For our use case, we don't cancel often (IOC orders auto-cancel), so this isn't critical.
- If you do cancel, batch via a single cancel-by-cloid action where possible.

### Activation gas [v1]

- A new agent wallet needs ~$1 of USDC to activate (one-time fee).
- Send this from platform treasury to the new agent address before the user signs ApproveAgent, or right after.
- Without it, the first action will fail with "user does not exist" error.

### Reconnection logic

- WS connections drop without warning.
- Implement exponential backoff: 1s, 2s, 4s, 8s, ..., max 60s.
- On reconnect, **re-send all subscription messages**.
- Heartbeat: HL pings every ~30s, must respond.

### Rate limit budgeting

- 1200 weight/min per IP. Reserve 33% headroom (target 800 weight/min usage).
- Address-based limit: 1 request per 1 USDC traded cumulatively + 10K initial buffer. Most platform addresses won't hit this.
- Cancels have higher budget but don't spam.
- When approaching limit, queue requests and back off gracefully. Surface to user: "data refresh delayed due to high traffic".

---

## 10. Hyperliquid-Specific Reference

### Known constants and behaviors

- Block time: ~0.2s typical, can spike during congestion
- Activation gas fee: ~$1 USDC
- Default order rate limit: 10K initial buffer, +1 per USDC traded
- Cancellations have 2x budget vs other actions
- Builder approval is per-builder-address, max 10 active per user
- `expiresAfter` field on actions: order rejected if processed past timestamp
- IOC orders are required for order priority bidding [v1]

### HIP-3 reference

- Get list of all HIP-3 dexes: `info.getPerpDexs()`
- Each dex has its own meta (assets, tick sizes, leverage limits)
- Coin format: `<dex_name>:<coin>` e.g., `xyz:NVDA`
- HIP-3 markets often have lower liquidity → tighter slippage tolerance default
- New dexes appear as builders deploy — poll daily

### Known endpoints

- Mainnet API: `https://api.hyperliquid.xyz`
- Mainnet WS: `wss://api.hyperliquid.xyz/ws`
- Foundation non-validator (free): see HL docs for current URL
- Historical S3: `s3://hyperliquid-archive/`, `s3://hl-mainnet-node-data/node_fills_by_block`

### Side / direction reference

| Field | Value | Meaning |
|---|---|---|
| `fill.side` | `'B'` | Buy (long open or short close) |
| `fill.side` | `'A'` | Sell/Ask (short open or long close) |
| `order.b` | `true` | isBuy=true |
| `order.b` | `false` | isBuy=false |
| `fill.dir` | `"Open Long"` | display string only |
| `trade.users` | `[buyer, seller]` | always 2 elements |

### Scoring composite formula (v1.0)

```typescript
function computeComposite(metrics: Metrics): number {
  let score = 0;
  
  if (metrics.psr > 0.95 && metrics.total_trades >= 100) score += 25;
  if (metrics.dsr > 0) score += 15;
  if (metrics.max_drawdown_pct < 0.30) score += 10;
  if (metrics.profit_factor > 1.5) score += 10;
  if (metrics.maker_taker_ratio >= 0.2 && metrics.maker_taker_ratio <= 0.7) score += 10;
  if (metrics.avg_hold_seconds > 300) score += 10;  // > 5 min
  if (metrics.unique_assets >= 3) score += 10;
  if (metrics.rolling_30d_sharpe >= 0.7 * metrics.peak_sharpe) score += 10;
  
  return score;
}
```

### Tag classification rules

```typescript
function classifyMainTag(m: Metrics, b: Behavioral): string {
  // Insider: fresh wallet + concentrated + likely event-driven
  if (m.first_seen_days_ago < 60 && b.asset_concentration > 0.6 && b.trades_per_day_avg < 10) {
    return 'insider';
  }
  
  // Specialist: dominant in one asset/category
  if (b.asset_concentration > 0.6 && m.total_trades >= 50) {
    return 'specialist';
  }
  
  // Veteran: high sample, long history, sustained
  if (m.total_trades >= 500 && m.active_days >= 365 && m.psr >= 0.8) {
    return 'veteran';
  }
  
  // Alpha hunter: proven directional skill at significant sample
  if (m.psr > 0.95 && m.total_trades >= 100 && m.active_days >= 90 && m.max_drawdown_pct < 0.30) {
    return 'alpha_hunter';
  }
  
  // Dark horse: small sample but high signal
  if (m.total_trades < 50 && m.psr > 0.9 && m.last_trade_at > now - 14d) {
    return 'dark_horse';
  }
  
  return null;  // not classified, doesn't appear in browse
}
```

---

## 11. Security & Privacy

### Secrets

- Never commit secrets. `.env*` in `.gitignore` always.
- Production secrets: Vercel env vars (web) + Doppler or encrypted .env on VPS (workers).
- Builder private key [v1]: KMS-encrypted at rest. Decrypt only at signing time. Never log.
- Agent wallet private keys [v1]: KMS-encrypted, per-key encryption (each key wrapped separately, not one master key for all).

### Auth

- Sessions: HTTP-only secure cookies, signed with `AUTH_SECRET`.
- SIWE messages must include domain, chain ID, nonce, expiration.
- Nonce stored server-side (Redis or short-lived DB row), single-use.
- Rate limit auth endpoints (5 attempts per IP per minute).

### Data privacy

- Public data only: HL fills are already onchain, displaying them is fine.
- User's own data (follows, agent wallets, withdrawals): never expose to other users.
- Leader's claimed profile: public by design.

### Admin endpoints

- Protected by `ADMIN_API_TOKEN`.
- Logged exhaustively to `audit_log`.
- Limit to 1-2 trusted operators. No admin auth for v0.5/v1; revisit at scale.

### Compliance basics

- Geo-block US users (Cloudflare rule).
- Sanctions check: maintain OFAC blocklist of addresses, reject sign-ins from those addresses.
- Tax responsibility on users (terms make this clear).
- ToS clause: jurisdictional limitations, user responsible for legality in their region.

---

## 12. Deployment

### v0.5 Deploy

#### Web (SvelteKit) → Vercel

- Install `@sveltejs/adapter-vercel` and configure in `svelte.config.js`:
  ```js
  import adapter from '@sveltejs/adapter-vercel';
  export default { kit: { adapter: adapter({ runtime: 'nodejs20.x' }) } };
  ```
- Connect GitHub repo to Vercel
- Set env vars in Vercel project settings (use `PUBLIC_*` prefix for client-exposed vars)
- Auto-deploy on push to `main`
- Custom domain via Cloudflare DNS

Self-host alternative: use `@sveltejs/adapter-node` to build a Node.js server, run on the same Hetzner VPS as the worker (separate process, port 3000). Simpler ops at scale.

#### Worker → Hetzner VPS

- Provision Hetzner CAX21 (Tokyo or HEL) Ubuntu 24.04
- Install Node.js 20 LTS via fnm or nvm
- Clone repo, `pnpm install`, `pnpm build` in `apps/worker`
- Run as systemd service:

```ini
# /etc/systemd/system/copytrade-worker.service
[Unit]
Description=Copytrade Worker
After=network.target

[Service]
Type=simple
User=copytrade
WorkingDirectory=/home/copytrade/copytrade/apps/worker
ExecStart=/home/copytrade/.local/share/fnm/aliases/default/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile=/home/copytrade/copytrade/apps/worker/.env

[Install]
WantedBy=multi-user.target
```

- Enable: `systemctl enable copytrade-worker && systemctl start copytrade-worker`
- Logs: `journalctl -u copytrade-worker -f`

#### Database → Neon

- Create project in Neon
- Run migrations from `packages/db`: `pnpm db:migrate`
- Connection string in `DATABASE_URL`

### v1 Additional Deploy

#### KMS setup

- Create AWS KMS customer-managed key in `us-east-1` (or closer)
- Grant worker IAM role `kms:Encrypt`, `kms:Decrypt` on this key
- Set `KMS_KEY_ID` env var

#### Builder treasury

- Generate platform builder private key offline, KMS-encrypt, store
- Fund the address with sufficient USDC for activation gas (multiply $1 by expected user count over first month)
- Approve as builder via HL UI or API (one-time)

#### Monitoring upgrade

- Grafana Cloud dashboards: tick-to-trade latency, fill rate, slippage histogram, error rate
- Alerts: copy fill rejection rate > 5%, ingestor lag > 60s, DB connection pool exhausted

---

## 13. Testing Checklist

Before any deploy, manually verify:

### v0.5 Acceptance

- [ ] Browse page loads with at least 50 leaders, sortable, filterable
- [ ] Each main tag (alpha hunter, veteran, insider, specialist, dark horse) returns at least 5 results
- [ ] Filter combinations (e.g., specialist + meme) work
- [ ] Leader detail page shows recent fills, equity curve, current positions
- [ ] Refresh button updates `last_refreshed` timestamp, shows fresh data
- [ ] Refresh respects 60s cooldown (second click within 60s returns cached)
- [ ] Refresh respects 10/min user limit (returns rate-limit error after 10)
- [ ] Watchlist add/remove works
- [ ] Onboarding drill saves preferences and recommends matching leaders
- [ ] SIWE sign-in creates user
- [ ] Leader claim with SIWE creates `leader_profiles` row
- [ ] X OAuth upgrades verification_tier to 'x'
- [ ] Daily score recompute job runs successfully on full universe
- [ ] Discovery sweep finds new addresses, queues them, scores next night
- [ ] Net PnL correctly subtracts deposits (manually verify on a known wallet with deposits)
- [ ] Agent attribution: a master with active agents shows merged trade history
- [ ] HIP-3 fills are properly classified under stocks/fx asset tags

### v1 Acceptance

- [ ] Agent wallet generation creates encrypted private key
- [ ] User signs ApproveAgent, status moves to 'active'
- [ ] User signs ApproveBuilderFee, builder_fee_approved = true
- [ ] Activation gas funded automatically
- [ ] Copy modal accepts allocation, validates 0.005-0.50 range
- [ ] Starting a copy creates `follows` row
- [ ] Leader's trade triggers copy execution (verify via testnet first)
- [ ] Copy fill respects slippage tolerance (skip when exceeded)
- [ ] Copy fill respects asset blacklist
- [ ] Copy fill respects daily loss limit (auto-pauses)
- [ ] Idempotency: duplicate event doesn't double-execute (manually trigger via test)
- [ ] Builder fee accrues to `fee_ledger`
- [ ] Leader's claimable balance increments
- [ ] Leader withdrawal sends USDC to leader address
- [ ] Pause/resume/stop follows works
- [ ] Daily loss limit triggers auto-pause
- [ ] User dashboard shows accurate pnl

### Performance benchmarks

- [ ] Browse page first-load < 2s
- [ ] Leader detail page first-load < 1s (cached) or < 3s (fresh refresh)
- [ ] Daily score recompute completes in < 1 hour for 10K wallets
- [ ] Copy execution tick-to-trade < 200ms (p50), < 500ms (p95)

---

## 14. Common Pitfalls (Read Twice)

1. **Float arithmetic on money** — never. Use `decimal.js` or BigInt cents.
2. **Trailing zeros in price/size** — HL rejects `"100.0"`. Use `"100"`.
3. **Forgetting deposits in PnL** — net pnl is wrong, users complain.
4. **Mixing main wallet and agent wallet for fill attribution** — score is wrong.
5. **Missing HIP-3 prefix** — merging different markets, score nonsense.
6. **Non-idempotent copy execution** — double-trades on retry, real money loss.
7. **Storing private keys plaintext** — instant breach.
8. **Builder fee in bps instead of tenths-of-bps** — 10x off.
9. **Race conditions on nonce** — order rejections.
10. **Trusting WS without dedup** — duplicate fills inflate scores.
11. **Polling instead of subscribing** — wastes rate budget.
12. **Subscribing per-user without IP planning** — hits 10-user cap, misses fills.
13. **No reconnection logic** — silent ingestor death.
14. **Forgetting to lowercase addresses** — split-brain in DB.
15. **Allocating without ApproveAgent confirmation** — orders silently fail.
16. **Not handling `isSnapshot` in WS** — duplicates and weird state.
17. **Computing tags before scoring** — circular dependency.
18. **Skipping slippage check** — adverse selection eats user pnl.
19. **No daily loss limit** — runaway losses for users.
20. **No global kill switch** — one bug = many users harmed.

---

## 15. Out of Scope (Do Not Build)

For v0.5:
- Agent wallet generation
- ApproveAgent or ApproveBuilderFee flows
- Any actual trade execution
- Builder fee revenue collection
- Leader payouts (only previewed balances)
- Copy modals or follow UI
- Position dashboards
- Real-time copy execution engine

For v1 (still out of scope):
- Mobile apps (web responsive only)
- Push notifications
- Profit-sharing fee structure (regulatory risk; flat fee only)
- Subscriptions (revisit post-launch)
- HIP-4 prediction market copying (separate product line)
- Spot copy trading (focus perps for v1)
- Futures expiry handling (HL doesn't have expiry, just perps)
- Custom indicators / charting beyond equity curves
- DM / messaging between users
- Trading competitions
- Referral systems

---

## 16. Glossary

- **Agent wallet**: HL primitive. A delegated address that can place orders for a master, cannot withdraw funds.
- **Builder code**: HL revenue-share mechanism. Per-fill fee in tenths of bps to a builder address.
- **Fill**: A single matched trade execution. One trade has two fills (buyer-side and seller-side).
- **Tick size**: Minimum price increment per asset.
- **szDecimals**: Decimal places for size in a given asset.
- **PSR (Probabilistic Sharpe Ratio)**: Sharpe corrected for non-normal returns, expressed as P(true sharpe > benchmark).
- **DSR (Deflated Sharpe Ratio)**: PSR with selection bias correction (multiple-testing penalty).
- **HIP-3**: Hyperliquid permissionless perp deployment system. Users can deploy custom perp markets.
- **HIP-4**: Outcome markets / prediction markets primitive. Out of scope for this product.
- **SIWE**: Sign-In With Ethereum. Standard EIP-4361 for wallet-based auth.
- **TIF**: Time-in-force. Order behavior on book hit. GTC, IOC, ALO.
- **IOC**: Immediate-or-cancel. Required for order priority bidding.
- **ALO**: Add-liquidity-only. Post-only, won't cross.

---

## 17. Decisions Log

Append to this section as the spec evolves.

- 2026-XX-XX: Initial spec written.
- Total builder fee fixed at 30 bps (3 USDC per 1000 USDC notional).
- Leader split: anonymous 30/0, wallet 22/8, x 15/15 (balanced).
- Agent wallet keys: server-side generation, KMS-encrypted.
- Tech stack: SvelteKit + Drizzle + Neon + Hetzner VPS workers.
- Frontend stack switched from Next.js to SvelteKit for consistency with cream.run and founder familiarity. Auth.js (`@auth/sveltekit`) for sessions, `shadcn-svelte` for UI components, `lucide-svelte` for icons, `layerchart` for visualizations.
- Refresh button + cache-in-Neon architecture for dashboard layer.
- Real-time active trades via single trades-feed WS subscription, filter in process.
- Daily wallet discovery via 30-min trades subscription sweep + opportunistic via refresh.
- v0.5 / v1 split locked.

---

**End of spec. Total length: ~complete enough to build.**
