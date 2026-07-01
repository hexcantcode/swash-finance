# Vaults showcase page — design (data-stage, no invest contracts)

**Status:** Design (2026-07-01), brainstormed. Turn the `/vaults` "coming soon" placeholder
into a **live data showcase** of the 12 Conviction Vaults — *before* deposit/withdraw contracts
exist. Purpose: transparent proof-of-concept via live positioning + a growing observation track.

**Key framing (data vs test):** this page lives in the **data stage** — it *shows* what each
vault is positioned in and what it would hold (observation, always honest). It does **not** make
a **quality/performance claim** — whether the signal reliably works is a separate **test stage**
(walk-forward, beat-the-baseline, vault-grade `q`). No "we outperform" headline.

## The 12 vaults
Top-12 by live EP-cohort volume (computed from snapshots): HYPE, ETH, BTC, SP500, SOL, MU,
XYZ100, ZEC, GOLD, SNDK, CL, DRAM. Half crypto, half `xyz:` synthetics. (Dynamic-ish; the
signal is computed for the top-N by volume, the page shows the top-12.)

## Architecture / data flow
- Vault data lives in the **backtest Postgres** (same Railway project as the BFF). The **BFF
  reads it over private networking** and exposes read-only **`/api/vaults`** (list) and
  **`/api/vaults/[asset]`** (detail). Mobile fetches `/api` as always — **stays a pure `/api`
  client**, no DB access, invariant intact.
- Signal for 12: `forward_test.py` computes the signal for the top-N assets by volume →
  `signal_track`. Prices/funding for those assets → the comparison + paper NAV.

## The page — `/vaults` (list)
Scrollable list of 12 vault cards, each read from `signal_track` + `positions`:
- **Asset** (icon + name) + **current call** — `LONG 34%` / `SHORT 41%` / `FLAT`, color-coded
  (% = skew magnitude `|s|`).
- **"What it would hold"** — e.g. *"$410 short per $1,000"* (tangible).
- **Breadth** — *"20 pro traders"* (FLAT badge when under the gate).
- **Skew sparkline** — signal over the last N snapshots (it's alive and moving).
- No P&L on the card. Header badge: **"Live preview · paper."**

## The page — `/vaults/[asset]` (detail)
- **Hero:** current call, "what it would hold," breadth.
- **Skew-over-time chart** — the always-on "track record" (positioning history). Hero element 1.
- **What's driving it** — long/short split + **contributing traders** (avatar + direction +
  conviction). Hero element 2 — the transparency/credibility.
- **Comparison chart (gated):** two lines indexed to 100 at inception — **underlying asset
  (buy-and-hold)** vs **paper vault** (`$1k`, each snapshot `signal × asset-return − funding −
  fees`). The gap = the vault's edge. Labeled *"paper · since [date] · observed, not validated."*
  Only rendered once there's enough history (≥ a few days) — else just the skew track. This is
  the value-demo, framed as observation (the *validated* claim stays in the test stage).
- **How it works** — short methodology strip (follow EP cohort, quality×conviction, 1×).
- **"Deposits coming soon"** affordance (no contracts; optional secondary "notify me").

## Backend to build
1. **Signal → 12 assets** — `forward_test.py` universe = top-N by volume (from snapshots).
2. **Prices/funding → the 12** — extend `fetch_prices.py`; store in Postgres.
3. **Paper NAV** — join `signal_track` × candle returns − funding − fees → `vault_nav` table.
4. **`/api/vaults` + `/api/vaults/[asset]`** on the BFF (reads backtest Postgres, private net).
5. **Mobile** — `/vaults` list + `/vaults/[asset]` detail (replaces placeholder).

## Build order (value-first)
1. Signal → 12 (unblocks the whole list page; needs only positions). ← start here
2. `/api/vaults` list endpoint + the `/vaults` list UI (the core showcase).
3. Prices + paper NAV + the comparison chart (gated; secondary).
4. Detail view polish (contributors, methodology).
