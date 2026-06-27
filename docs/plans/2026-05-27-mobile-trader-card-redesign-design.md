# Mobile `/traders` — card redesign + asset-focus filter

Date: 2026-05-27 · Status: design doc, ready for implementation
Branch: `mobile-trader-card-tweaks`

## Goal

Replace the row-based `/traders` list on the mobile app with a full-width
card per trader (avatar + address + holdings strip · 30D PnL + current
equity + a real 30D PnL curve · score-bar + inert "Mirror" button), and
add a second filter strip above the existing sort that classifies traders
as **equity-focused** or **crypto-focused**.

## What's already in place

- `apps/mobile/src/routes/traders/+page.svelte` renders a single sort
  strip (`Score / PnL / Equity / Active`) followed by a `<ul class="m-list">`
  of `MobileLeaderRow` rows.
- `LeaderRow` (mobile) carries `score, account_value, total_pnl_usd, roi,
  win_rate, sharpe, primary_asset, alfa_coin, holdings, winner,
  winner_rank` — no per-card sparkline data, no asset-class flag.
- `wallets` already has `hl_pnl_30d_usd` / `hl_roi_30d` columns — the 30D
  window is the one the existing `total_pnl_usd` already reflects (just
  not labelled as such in the type).
- `coinCategory(coin)` in `apps/web/src/lib/server/queries/analytics.ts`
  classifies each coin as `'stocks' | 'crypto'` (with `index` folded into
  `'stocks'`). Reusable here.
- No historical-equity-snapshot table exists. The 30D curve is derived
  from `fills.closed_pnl + fundings.payment_usd`, daily.
- Two `MobileTraderCard`-named components want the same name: the
  existing small horizontal-scroll card on `/` (top traders) and the new
  full-width card on `/traders`. The existing one is renamed to
  `MobileTopTraderCard` to free the name.

## Design decisions (validated)

| Question | Decision |
|---|---|
| Sparkline data | Real 30D curve, computed server-side, bundled with `/api/leaders` |
| Curve source | Cumulative realized PnL by day (fills + fundings) — honest about being a PnL trajectory, not literal equity-over-time. No deposit/withdrawal anchoring. |
| Equity-vs-crypto classifier | `abs(stocks_pnl_30d) / (abs(stocks_pnl_30d) + abs(crypto_pnl_30d)) >= 0.6` → equity-focused; else crypto-focused (fallback) |
| Top metric on card | `+$70,219` is PnL — label says **PnL 30D**, not ROI. ROI hidden on the card. |
| Equity line | Below PnL, smaller weight — `$619,189 Equity` |
| Holdings strip | Up to 5 icons (mock shows 5), then `+N` overflow |
| Score row | `89/100` + 10-bar meter, same `--stripe-accent` as desktop |
| Mirror button | Visual placeholder, inert (`aria-disabled="true"`). Label: **Mirror** |
| Filter UX | Second strip above the existing sort, same glass language. Chips: All / Equity / Crypto |
| Filter URL state | `focus=equity\|crypto`, absent = all. Same `goto(...)` + `replaceState` pattern as `sort` |
| Filter × sort | Compose: filter narrows the set, sort orders the remainder |

## Architecture

```
apps/web (canonical layer)
└─ src/lib/server/queries/leaders.ts
   └─ listLeaders({ sort, focus, ... })
      ├─ CTE: pnl_daily — 30 floats per trader, cumulative
      ├─ CTE: pnl_by_class — share-of-PnL classifier
      └─ WHERE asset_focus = focus  (when set)

  /api/leaders?focus=equity (new query param, zod-validated)
  └─ apps/mobile via listLeaders() client wrapper
     └─ /traders +page.svelte
        ├─ focus strip (new)
        ├─ sort strip (existing)
        └─ MobileTraderCard (new, full-width)
```

Single round-trip for the list. No per-card fetches, no new endpoints,
no new DB table.

## File-by-file change set

Ordered so each step compiles in isolation.

1. **`apps/web/src/lib/server/queries/leaders.ts`** — extend `LeaderCard`:
   - Add `pnl_curve_30d: number[]` (30 floats, oldest → newest, padded
     with zeros for traders < 30D of history).
   - Add `asset_focus: 'equity' | 'crypto'`.
   - Add `last_fill_ms: number | null`.
   - Two new CTEs:
     - `pnl_daily`: `fills.closed_pnl + fundings.payment_usd`,
       `GROUP BY address, date_trunc('day', ts)`, last 30 days, window
       `SUM(...) OVER (PARTITION BY address ORDER BY day)`. Densified to
       30 points in the mapper.
     - `pnl_by_class`: same fills join, `GROUP BY address, coinCategory(coin)`,
       CASE for the ≥60% threshold.
   - `BrowseFilters` gains `focus?: 'equity' | 'crypto'`. WHERE clause
     filters when present.

2. **`apps/web/src/routes/api/leaders/+server.ts`** — zod gains
   `focus: z.enum(['equity', 'crypto']).optional()`. Forwarded into
   `filters.focus`.

3. **`apps/mobile/src/lib/api/leaders.ts`** —
   - `LeaderRow`: rename `total_pnl_usd` → `pnl_30d_usd`. Add
     `pnl_curve_30d: number[]`, `asset_focus: 'equity' | 'crypto'`,
     `last_fill_ms: number | null`.
   - `RawLeaderCard`: same additions.
   - Mapper: pass new fields through.
   - `listLeaders(args)`: accept and forward `focus?: 'equity' | 'crypto'`.

4. **Rename `MobileTraderCard.svelte` → `MobileTopTraderCard.svelte`.**
   Update the one import in `apps/mobile/src/routes/+page.svelte`.

5. **New `apps/mobile/src/lib/components/MobileTraderCard.svelte`** —
   full-width card. Internal structure: three rows separated by hairlines
   (top: avatar + address + holdings + relative-time; middle: PnL +
   Equity + inline SVG sparkline; bottom: score + bars + Mirror button).
   No new design tokens; existing `--glass-bg` / `--glass-blur` /
   `--glass-highlight`. Sparkline is hand-rolled inline `<svg>`, no
   library — stroke color from sign of `last - first`.

6. **`apps/mobile/src/routes/traders/+page.svelte`** —
   - Add focus strip above sort strip (`m-focus-strip` / `m-focus-chip`,
     same glass tokens as the sort strip).
   - Replace `<MobileLeaderRow />` with `<MobileTraderCard />`.
   - Drop the `<ul class="m-list">` wrapper — cards stack with gap.
   - Add `focus` derived from URL, plumb into `load()`, touch in `$effect`.

7. **Delete `apps/mobile/src/lib/components/MobileLeaderRow.svelte`** —
   orphaned after step 6. (Per CLAUDE.md: remove orphans created by my
   changes.)

## Verification

- `pnpm --filter @copytrade/mobile check` → 0 errors.
- `pnpm --filter @copytrade/web check` → 0 errors.
- `grep -rn 'total_pnl_usd' apps/mobile/src packages/` → empty (rename
  propagated across the canonical chain).
- `grep -rn 'MobileLeaderRow' apps/mobile/src` → empty (component
  deleted, no stale imports).
- Playwright probe at iPhone-14 viewport on `http://localhost:5174/traders`:
  - `document.querySelectorAll('.m-trader-card').length === 50`
  - Click "Equity" chip → URL gains `?focus=equity`, card count drops to
    matches only, all visible cards' `asset_focus === 'equity'` in the
    Svelte state.
  - Sparkline path exists in each card (`svg path[d]`).
- Visual sanity on the phone at the LAN URL.

## Out of scope

- Mirror feature implementation. Button is inert.
- Equity-snapshot worker (daily account-value cron). Using PnL trajectory.
- Desktop `/traders` (`apps/web`). Mock is mobile-only.
- ROI ribbon on the card. PnL is the headline; ROI hidden.

## Risks

- **Query cost**: `pnl_daily` over 30 days × 50 traders is a single
  aggregation on `fills` — well within existing query budget, but worth
  measuring. If slow, the realistic fix is a daily materialized view of
  per-trader cumulative PnL — not addressed in this PR.
- **PnL ≠ equity**: the curve is realized PnL, not account-value over
  time. Deliberate trade-off (validated). Label on the card stays "PnL
  30D" — no chart axis or tooltip claims "equity".
- **Rename blast radius**: `total_pnl_usd` is used by the row component
  we're deleting; if it's referenced elsewhere on mobile, the rename
  catches it via `pnpm check`. (Quick grep at design time: only
  `MobileLeaderRow.svelte` and `leaders.ts` reference it on mobile.)
