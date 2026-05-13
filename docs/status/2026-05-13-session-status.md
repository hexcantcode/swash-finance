# Session status — 2026-05-13

Snapshot of where `main` stands today vs. the state described in
[`CLAUDE.md`](../../CLAUDE.md). Everything below is on `origin/main` at
`291ce35` unless noted otherwise.

---

## TL;DR

- **DB migration drift blocker (from CLAUDE.md): RESOLVED.** Migrations
  `0003`–`0005` are on `main`; `data-sources` was merged.
- **Score v2** replaced the old composite. `wallets.compositeScore` →
  `wallets.score`; copyability + composite + PSR + curves modules
  fully removed in the HEAD commit.
- **Assets page** grew from "Phase 1 list" → list + detail + filters +
  HIP-3 universes + volume dedup + per-symbol icon overrides.
- **Responsive shell**: sidebar + topbar on desktop, mobile header +
  bottom nav under 1024 px. Single breakpoint, cream-hl pattern.
- **Web app is no longer single-page** — CLAUDE.md's "Other notes" line
  is stale (see below).

---

## What shipped this session

Commits ordered newest → oldest, scoped to the session window
(`eafe4ca..HEAD`).

### `291ce35` — chore(scoring): remove dead code — composite/copyability/psr/curves (HEAD)
The full purge of score-v1 leftovers. **13 files changed, +26 / −1133.**

Deleted modules:
- `packages/scoring/src/composite.ts` + `.test.ts`
- `packages/scoring/src/copyability.ts` + `.test.ts`
- `packages/scoring/src/psr.ts` + `.test.ts`
- `packages/scoring/src/curves.ts` + `.test.ts`
- `apps/worker/src/scripts/calibrate-curves.ts` (374 lines — no longer needed once curves were dropped)

Migration details:
- `computeDecayFlag` (used to live in `composite.ts`) moved to
  `classifier.ts` since it's a display-only badge — alongside
  `classifyHeat` / `classifyProfile` / `classifySize`.
- `packages/scoring` barrel exports + `package.json` `exports` field
  updated to match the new file set.
- Worker `score.ts` dropped the `probabilisticSharpe` import and now
  writes `scores.psr` as `null` (the DB column is kept for backwards
  compatibility; trader page renders `—` when null).
- Trader page legacy "Copyability" stat cell removed; `score` takes
  its place.
- `leader-detail.ts` API contract no longer exposes `copyability`,
  `copyability_breakdown`, or `copyability_notes`.

Test footprint: **178 → 135 scoring tests** (~43 removed for the
deleted modules). `pnpm check` clean across scoring + worker + web.

### `06d3d09` — chore(web): strip legacy copyability, align assets section rhythm
Removed deprecated `copyability` fields from `leader-detail.ts` and the
trader page; dropped the inline `margin-top: var(--space-4)` on
`/assets`'s winners/losers section so it lines up with the equivalent
section on `/`.

### `16c0b2c` — feat: score v2 — gate + 3-input weighted score, rename composite_score → score
The schema + query rename. `wallets.compositeScore` → `wallets.score`.
Drizzle index name preserved (`idx_wallets_score`). Sort enum
across `+page.server.ts`, `api/leaders/+server.ts`, `LeaderTable.svelte`
switched from `'composite_score'` to `'score'`.

### `e24553b` — feat(web,scoring): Index filter, sidebar polish, score v2 wiring
Third filter chip on `/assets` (Index, 30 symbols). Sidebar items
turned white-default, active state uses `accent-dark` text +
`accent-muted` background. Order swapped to Assets-above-Traders on
both sidebar and mobile bottom-nav. SMSN logo override added.

### `d7605a6` — feat(scoring): score v2 — gate + 3-input weighted score (TDD)
The actual `score.ts` + `gate.ts` modules — gate check (eligibility
filter) + 3-input weighted average (returns, consistency, track-record)
that produces the new `score` integer.

### `6200180` — docs: Score v2 design — gate + 3-input weighted average
Design doc at `docs/plans/2026-05-13-score-v2-design.md`.

### `5cce464` — feat(web): swap header brand to logotext.png at natural aspect
Sidebar brand + mobile-header brand now source `/logotext.png` at
`height: 36px; width: auto`.

### `d4e792e` — chore(web): bump nav-brand img to 32px, add avatar-preview dev route
Brand img sized to 32 × 32; `/avatar-preview` dev route added for
comparing identicon/boring-avatars/dicebear styles side-by-side.

### `ef706ce` — fix(worker): paginate userFillsByTime / userFunding / userNonFundingLedger
Pre-existing bug: long-history wallets were truncated at the first
HL API page. Now paginates through all pages.

### `dabe73c` — feat(web): responsive shell, header polish, identicon avatars
The big layout commit. Four nav surfaces, cream-hl pattern,
`1024 px` breakpoint. Top-nav search behaviour cleaned up
(toggle button submits on second click, ESC clears). Identicon style
chosen for trader avatars.

### `b6e9ed6` — feat(web): Winners/Losers mini-tables on home, top-nav search polish
Home page Winners cards (`RoiCards.svelte`) replaced with side-by-side
Winners · 7d / Losers · 7d mini-tables. Losers stubbed with
"biggest drawdowns — coming soon" empty state pending the loser data
set.

### `dc37a25` — feat(web,worker): top-earners ranking, top-nav redesign, ticker labels
Winners ranked by 7d realized PnL (`winnerRank`) instead of composite.
Top-nav redesigned with collapsible search + Connect Wallet placeholder.
Trade ticker labels strip the HIP-3 `dex:` prefix.

### `32afd0c` — feat(web): assets — coin-icon overrides, exclude/white-bg lists, Stocks/Crypto filter
Per-symbol overrides served from `apps/web/static/icons/` (15 files
at this point; SMSN added later → 16 total). White-disc modifier
for dark-silhouette logos. Exclude list (initially 7 symbols, later
expanded to 9). First two filter chips: Stocks & Commodities / Crypto.

### `da2ac11` — feat(web,hl-client): assets — detail page, HIP-3 universes, volume dedup, coin-icon proxy
Foundational session commit:
- New `/assets/[coin]` detail page (chart + best-traders list).
- `hl-client` exposes `candleSnapshot`.
- `listAssets` fans out to every HIP-3 builder dex via
  `perpDexs` + `metaAndAssetCtxs({dex})`. Cross-dex duplicates collapse
  to the highest-24h-volume listing per bare symbol.
- Same-origin coin-icon proxy at `/coins/[coin].svg` with a
  process-local memory cache + `stale-while-revalidate` headers. `kCOIN`
  tickers fall back to the underlying asset's logo.
- Lifted background tokens (`#1f1f1f` → `#2a2a2a` base, etc.) so
  tables read as grey rather than near-black.

---

## Cleanup performed at end of session

| Removed | Reason |
|---|---|
| `.k-dex-tag` CSS block | Markup using it was deleted (per user request to hide HIP-3 tags) |
| `.k-sidenav-brand-text` CSS block | Sidebar text removed; logo-only brand |
| `.stripe-text-success`, `.stripe-text-danger` rules | No template uses them; `pnlSignClass` returns `k-pnl-positive/negative` instead |
| `apps/web/src/lib/components/RoiCards.svelte` | Orphaned after Winners/Losers swap |
| Comment ref to `RoiCards.svelte` in `assets/[coin]/+page.svelte:82` | Updated to remove the dead link |

After cleanup: **0 errors, 6 warnings** from `pnpm --filter web check`.

---

## Known / open items

### Intentional warnings (not actioned)
All 6 svelte-check warnings are `state_referenced_locally`:
- `LeaderTable.svelte:30` (`sort` prop → `localSort` state)
- `assets/+page.svelte:11` (`data` → `assets` state)
- `assets/[coin]/+page.svelte:19-22` (`data.{candles,asset,topTraders,traderOpens}`)

Each site has a `$effect` that resyncs the local state when the prop
changes, so the pattern is semantically correct. Silencing would require
wrapping the initial value in `untrack()`, which is uglier than the
warning. Leaving as-is.

### Dev-only surfaces still on `main`
- `/avatar-preview` — explicitly dev-only per its own header comment:
  > "Not linked from anywhere — safe to delete once a style is picked."
  The chosen style (identicon via effigy.im) is now in use, so this
  route is overdue for deletion. Kept around in case another comparison
  is needed.

### Logo coverage
`COIN_KNOWN_NO_LOGO` is currently empty — every previously-listed
missing symbol is either overridden (16 PNGs in `static/icons/`: BIRD,
BMNR, CAR, COPPER, EBAY, GAS, KWEB, MSFT, NATGAS, SEMI, SMSN, TENCENT,
URNM, USENERGY, WHEAT, XIAOMI) or excluded. Any new HIP-3 listing that
lacks an HL CDN logo will silently 404 via the proxy and hide via
`onerror`; if/when this happens, add an override or exclude entry.

### Stale `compositeScore` references
`grep` still finds the old name in `apps/web/build/` — that directory
is gitignored and just stale build output. Source tree is clean.

### Duplicate `logotext.png`
Two copies exist: the repo-root version (design source) and the
`apps/web/static/logotext.png` (served version). Same pattern as the
existing `logoicon.PNG` at the root. Intentional but worth a
`.gitignore` entry on the root copies if we want a single source of
truth.

### Losers data set
The home page Losers · 7d mini-table is a UI stub. The data plumbing
to back it (mirror of `wallets.winner` but for drawdowns) is the
obvious next thing to wire.

---

## Items from CLAUDE.md still relevant

- **STRICT RULE — one source of truth per data point**: still in force.
  The `compositeScore` → `score` rename was a good test of this — it
  had to propagate through schema, queries, loaders, components, and
  formatters in the same change. The follow-up cleanup commit
  `06d3d09` and the HEAD `291ce35` purge caught a few stragglers
  (`copyability_*` fields, dead modules); the audit at the top of this
  report verified the source tree is now consistent.
- **Dev**: `pnpm dev` (web on `:5173`) — unchanged.
- **Theme toggle**: still no toggle; dark mode default. Backgrounds
  lifted from near-black to medium grey this session.

## Items from CLAUDE.md that are now stale

- **"The web app is a single page (`/` = the leaderboard + Winners +
  ticker). `/browse` 308-redirects to `/`."** — out of date. We now
  have `/`, `/assets`, `/assets/[coin]`, `/trader/[address]`,
  `/methodology`, `/about`, plus the dev-only `/avatar-preview`. The
  `/browse` redirect is presumably still in place but no longer the
  central nav story.
- **DB migration drift blocker** — resolved by the `data-sources`
  merge; `main`'s `migrations/` folder now contains `0000`–`0005`.

Worth a CLAUDE.md refresh in a follow-up.
