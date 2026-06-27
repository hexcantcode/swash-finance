---
name: hyperdash-top-traders
description: Fetches the top Hyperliquid copy-traders (wallets, stats, cohorts) from Hyperdash's public GraphQL API and filters them to copy-enabled wallets. Use when sourcing or refreshing the trader roster for Swash — "get the top 100 copytraders", "refresh the Hyperdash traders", "which wallets should we track", or when you need trader addresses + PnL/equity/copy-score to seed the app or sentiment data.
allowed-tools: Bash, Read, Write, Edit
metadata:
  author: hexcantcode
  version: "1.0"
  source: https://hyperdash.com/explore/copytraders
---

# Hyperdash Top Traders

How Swash sources its trader roster: the top Hyperliquid copy-traders come from
**Hyperdash's public GraphQL API**, not from scraping the rendered page. One
unauthenticated request returns the full curated list with stats and cohorts.

## When to Use

- Seeding or refreshing the wallets shown on the app's trader page.
- Getting trader addresses + stats (PnL, equity, copy score, win rate, top assets) as input for sentiment.
- Any "get / refresh the top N copytraders from Hyperdash" request.
- **Not** for per-trader live fills or positions — that's Hyperliquid's own API (`apps/worker`, `packages/hl-client`).

## The one fact that matters

The list the page calls "Top 100 / Best Wallets to Copytrade" is a single GraphQL
system group: **`GetSystemGroupTraders(groupId: "copytraders")`** → 100 traders,
already curated to high copy scores. You do **not** need a headless browser; the
page only uses one because it's a Vite/React SPA. The data call itself is a plain
public POST.

## How to fetch (preferred — run the script)

```bash
# JSON of copy-enabled traders to stdout, plus a CSV; progress to stderr
python3 .claude/skills/hyperdash-top-traders/scripts/fetch_top_traders.py --csv traders.csv
```

Flags: `--all` (skip the copy-enabled filter), `--sort pnl|copyScore` (default
`copyScore`), `--group <id>` (default `copytraders`). The script is stdlib-only
(`urllib`) — no curl, no browser, no pip installs.

## How to fetch (raw — if you need to debug the endpoint)

```bash
curl -s 'https://api.hyperdash.com/graphql' \
  -H 'content-type: application/json' \
  -H 'origin: https://hyperdash.com' \
  -H 'referer: https://hyperdash.com/' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \
  --data '{"operationName":"GetSystemGroupTraders","variables":{"groupId":"copytraders"},"query":"query GetSystemGroupTraders($groupId: ID!) { getSystemGroupTraders(groupId: $groupId) { address label displayName verified pnl perpsEquity winrate copyScore totalTrades sharpe drawdown sizeCohort pnlCohort topAssets { coin volume pnl } } }"}'
```

**Gotcha:** the endpoint returns `{"code":"BLOCKED_USER_AGENT"}` for default
curl/urllib UAs. A browser `user-agent` + the site `origin`/`referer` are required.
No API key or cookie is needed.

## Copy-enabled filter (the definition we use)

A wallet is **copy-enabled** when `copyScore > 0` AND `perpsEquity > 0` — a real,
mirrorable account. Within `groupId: "copytraders"` essentially all 100 qualify
(copy scores ~69–90); the filter matters when you pull other groups (e.g. `tagged`)
where market-maker desks (Cumberland, QCP, DV Chain, HLP vault) report `copyScore = 0`
and/or `$0` perps equity and are not meaningfully copyable.

## Field reference (`getSystemGroupTraders[]`)

| Field | Meaning / encoding |
|---|---|
| `address` | wallet (full hex) — the join key |
| `label` / `displayName` | curated label / user-set name (either may be null) |
| `verified` | known/tagged entity |
| `copyScore` | **float 0–100** (UI rounds to int); Hyperdash's copyability signal |
| `pnl` | **string**, cohort cumulative PnL in USD — parse to float |
| `perpsEquity` | **string**, live perps equity in USD — parse to float |
| `winrate` | **0–100** (already a percentage, not a 0–1 fraction) |
| `totalTrades` / `totalLong/ShortTrades` / `totalWinning/LosingTrades` | counts |
| `sharpe`, `drawdown` | risk stats |
| `sizeCohort` / `pnlCohort` | cohort ids (see below) |
| `topAssets[]` | `{coin, volume, pnl}` per market |
| `portfolioGraph[]` | `{timestamp, value}` equity-curve points (omitted by the script) |

## Cohorts (context, separate query)

Cohort definitions come from **`CohortSummary`** (`analytics.cohortSummary`):
- **Size cohorts:** Apex `$5M+`, Whale `$1M–$5M`, plus smaller bands.
- **PnL cohorts:** Extremely Profitable `+$1M+`, Very Profitable `+$100K–$1M`,
  Profitable `$0–$100K`, Unprofitable, Very Unprofitable, Rekt `−$1M+`.

Other copytrade tabs on the page (Equities Focused, Top BTC/HYPE/CL Traders) are
additional system groups — pass their id to `--group` once you confirm the key from
a fresh page capture.

## Cohort sentiment by market (`GetPerpsMarketParticipation`)

The Discover page's **Cohorts → MARKETS tab** (per-cohort, per-market long/short
positioning) is one unauthenticated query — **no variables**, returns *every*
cohort × *every* market in a single ~330 KB response. This is the source for
per-market "smart money vs. crowd" sentiment (distinct from `CohortSummary`,
which is each cohort's *overall* net bias only).

```bash
curl -s 'https://api.hyperdash.com/graphql' \
  -H 'content-type: application/json' -H 'origin: https://hyperdash.com' \
  -H 'referer: https://hyperdash.com/' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \
  --data '{"operationName":"GetPerpsMarketParticipation","query":"query GetPerpsMarketParticipation { analytics { perpsMarketParticipation { timestamp global { coin longTraderCount shortTraderCount profitableTraderCount losingTraderCount totalLongNotional totalShortNotional } pnlCohorts { cohortId cohortLabel cohortRange markets { coin longTraderCount shortTraderCount profitableTraderCount losingTraderCount totalLongNotional totalShortNotional } } sizeCohorts { cohortId cohortLabel markets { coin longTraderCount shortTraderCount profitableTraderCount losingTraderCount totalLongNotional totalShortNotional } } } } }"}'
```

Shape: `analytics.perpsMarketParticipation` → `timestamp`, `global[]` (all-trader
aggregate, per coin), `pnlCohorts[]` (the 6 PnL bands), `sizeCohorts[]` (5 size
bands). Each cohort has `markets[]`, one row per coin with the six raw fields:

| Field | Use |
|---|---|
| `longTraderCount` / `shortTraderCount` | traders long vs short → trader-count L/S split |
| `profitableTraderCount` / `losingTraderCount` | in-profit vs in-loss → the UPNL split |
| `totalLongNotional` / `totalShortNotional` | $ long vs short → notional L/S split |

The **Bearish/Bullish label is NOT a field** — Hyperdash derives it client-side
from the long/short skew. Compute it yourself (one canonical definition).
It's a **point-in-time snapshot per market**; for per-market history you poll and
store. (The historical *line* on the page is a separate aggregate query,
`HistoricalCohortPositioning` → a single `positioning` value over time, not
per-market.) Same UA/origin gotcha; no key.

## Refresh cadence

`pnl`/`perpsEquity`/`copyScore` move continuously; re-fetch when refreshing the app
roster rather than trusting a cached pull. There is no pagination — one call = the
whole curated group.

## Common Mistakes

- Rendering the page with Playwright to "scrape" rows → unnecessary; hit the GraphQL endpoint directly.
- Default curl/urllib UA → `BLOCKED_USER_AGENT`; send a browser UA + origin/referer.
- Treating `winrate` as a 0–1 fraction → it's already 0–100.
- Treating `pnl`/`perpsEquity` as numbers → they're strings; parse them.
- Merging the `tagged` group into "top 100" → inflates the list with non-copyable MM desks; the canonical top-100 is `groupId: "copytraders"`.
