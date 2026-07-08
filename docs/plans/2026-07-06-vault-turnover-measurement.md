# Vault turnover — first measurement from live signal data (2026-07-06)

## MEMO — decision state (2026-07-08)

1. **§5.2 turnover cap stays [OPEN].** Best current estimate: tens-of-× per year (first
   read 40–70×), NOT committable — the paper track rewrites its own history (see caveat).
2. **Fee economics de-risked anyway:** even the un-tuned upper bound ⇒ ~2%/yr depositor
   drag @ 3 bps taker. The 3/1 bps builder-fee decision needs no revisiting.
3. **Blocker to a real number:** `forward_test.py` recomputes all history with the current
   roster/quality each run (85% of rows changed 07-06→07-08). **Decision needed (owner):**
   make `signal_track` append-only, then accrue ~2 weeks and re-measure.
4. **Confirmed either way:** vault direction is sticky (zero long↔short reversals); churn
   enters via gates, not opinion changes; designed S_ON/S_OFF hysteresis is implemented
   statelessly in the paper track — implementing it as designed is keeper-spec work, not
   a new idea.
5. **New calibration entry needed:** roster-refresh smoothing (a refresh retroactively
   flipped XRP −0.97→+0.04; live, that flip = a real trade).

> **DATA-INTEGRITY CAVEAT (added 2026-07-08, supersedes the confidence below):** `signal_track`
> is NOT append-only — `forward_test.py` recomputes ALL history with the CURRENT quality table
> + CURRENT roster on every run and upserts over old rows. Between 07-06 and 07-08, **85% of
> historical s values changed** (median |Δs| 0.185; XRP 07-02 rows flipped −0.968 → +0.044).
> A live keeper trades the s computed at the time — which is exactly what gets overwritten.
> Treat every number in this doc as order-of-magnitude ("tens of ×, not hundreds"), not a
> committed figure. The qualitative findings (zero long↔short reversals; churn enters via the
> gates; designed S_ON/S_OFF hysteresis is implemented statelessly in the paper track) held in
> BOTH data vintages. **Prerequisite before filling §5.2's [OPEN] with a number:** make
> `signal_track` append-only (compute each snapshot's signal once, at capture time; never
> overwrite), accrue ~2 weeks, re-measure. Roster-refresh instability is itself a turnover
> risk: a refresh that retroactively flips a signal would, in production, command a real
> position flip — roster-change smoothing needs a calibration entry alongside S_ON/S_OFF.

Answers the open item in the 07-03 handoff (§ next-steps #3) and the decision catalog §5.2
(`Turnover cap per vault — [OPEN] number, measure from backtest/`). Replaces the guessed
25×–500× range in the handoff's B5 economics table with measured numbers.

**Headline: a 12-vault platform set runs ≈ 40–70× annualized turnover per vault at a 0.05
deadband — the low-middle of the guessed range. At 3 bps taker that is ≈ 1.3–2.1 %/yr
depositor drag and ≈ $13–21k/yr platform revenue per $1M AUM.**

## Method

- Data: `signal_track` in the Railway forward-test Postgres (project `adventurous-alignment`) —
  the real SWNP signal `s ∈ [−1,1]` computed every ~30 min by `backtest/forward_test.py`.
  Sample: **2026-07-01 → 07-06 (5.0 days), 243 snapshots, 28 coins, 5,971 rows.**
- Position rule per master plan Part III: target `x = š·V` at 1×, where `š = s` when
  `actionable ≠ FLAT` (hysteresis/breadth-gated) else 0.
- Rebalance rule per catalog §3.3/§5.2: trade the full delta when `|x_target − x_held| >
  deadband`. Turnover = annualized Σ|Δx_held| (traded notional ÷ AUM).
- 12-vault set assumed = BTC, ETH, SOL, HYPE, XRP, PUMP, LIT, ZEC, xyz:SP500, xyz:GOLD,
  xyz:NVDA, xyz:MSFT (top of EP-cohort volume in the sample).

## Results

Per-vault annualized turnover across the 12-vault set, by deadband (5-day sample):

| deadband | median | mean | notes |
|---|---|---|---|
| 0 (every tick) | 74× | 88× | upper bound at 30-min sampling |
| 0.02 | 67× | 76× | |
| **0.05** | **67×** | **71×** | recommended v1 |
| 0.10 | 60× | 66× | diminishing returns, adds tracking error |

Day-to-day variance is large: full-day pace ranged **17×–93×** (median ≈ 32×). Jul 1 ran at
148× pace — signal warm-up (quality table filling in), excluded from the central estimate.
**Central estimate: ≈ 40–70×/yr per vault**, with hot coins (SOL ≈ 210×) far above and
gated/quiet coins (ZEC, XRP, PUMP ≈ 0–25×) far below.

### Drag / revenue at the measured range (per vault)

| turnover | drag @ 3 bps taker (v1) | drag @ 1 bps maker (v2) | revenue / $1M AUM |
|---|---|---|---|
| 40× | 1.2 %/yr | 0.40 %/yr | $12,000 |
| 70× | 2.1 %/yr | 0.70 %/yr | $21,000 |
| 100× (hot vault) | 3.0 %/yr | 1.0 %/yr | $30,000 |

## Findings that should shape the keeper spec

1. **Gate flips are ≈ half of all turnover** — decomposing at db=0.05, trades where the
   position crosses FLAT (or flips sign) account for ~50 % of traded notional overall and
   ~75 % on SOL (158× of 210×). The `actionable` gate in `forward_test.py` thresholds at
   S_OFF only (no true S_ON/S_OFF hysteresis) and the breadth gate `n_eff ≥ 3` has **no
   hysteresis at all** — one voice entering/leaving flaps a full ±1.0 position (xyz:MRVL:
   97 % FLAT yet 344× turnover). **Top drag lever: hysteresis + persistence on the gates,
   worth more than any deadband tuning.**
2. **Cadence is not the driver.** Downsampling 30 min → 4 h only cuts median turnover
   67×→63×. The signal moves in regimes, not sampling noise — so the decided 5-min keeper
   tick (catalog §3.3) should not materially inflate these numbers, provided the deadband
   gates trading. (Caveat: 30-min data cannot fully prove 5-min behavior.)
3. **Deadband 0.05 is a reasonable v1 default** — cuts ~20 % of turnover vs trading every
   tick; 0.10 buys little more.
4. **Suggested §5.2 turnover cap: 150×/yr per vault** (≈ 2× the central estimate; only SOL
   and warm-up days exceeded that pace) — a circuit-breaker against signal-flapping bugs,
   not a routine constraint. At the cap, worst-case drag = 4.5 %/yr @ 3 bps.

## Worked examples ($1M NAV, db=0.05, from the actual 5-day signal)

- **BTC (typical vault):** 8 trades / $1.09M traded in 5 days — held short throughout, only
  size drifted (entry $399.7k, then deltas of $59–172k as `s` moved −0.19…−0.43). = 80×/yr
  → $23,900/yr fees = 2.39 % of NAV @ 3 bps.
- **SOL (hot vault, 211×):** two FLAT-crossings alone moved ~$1.5M — closed a $685k short
  07-03 15:17, re-opened $800k short 07-04 05:42. One conviction round-trip ≈ 150 % of NAV.
- **xyz:MRVL (gate pathology, 344× pace):** `s` pinned at −1.000 the whole sample, but the
  breadth gate (n_eff ≥ 3) flapped on one trader entering/leaving: FLAT→SHORT 07-02 07:37,
  SHORT→FLAT 07-02 08:07 (30 min later), again 17:10/19:41 — four $1M round-trips in 4 days,
  zero information change. Motivates finding #1 (gate hysteresis).
- **Full 12-vault set @ $1M each:** trades/traded/turnover/fees = SOL 10/$2.89M/211×/$63.2k;
  LIT 22/$1.95M/142×/$42.6k; HYPE 7/$1.68M/123×/$36.8k; ETH 6/$1.28M/93×/$28.0k; BTC
  8/$1.09M/80×/$23.9k; xyz:NVDA 3/$0.98M/72×/$21.5k; xyz:GOLD 3/$0.86M/62×/$18.7k; xyz:SP500
  2/$0.36M/26×/$7.9k; PUMP 1/$0.30M/22×/$6.5k; XRP 2/$0.16M/12×/$3.5k; xyz:MSFT
  1/$0.15M/11×/$3.2k; ZEC 0/—/0×/$0. **Portfolio: $12M AUM → ≈ $256k/yr fees ≈ 2.1 % avg
  drag**, with a 0–6.3 %/yr per-vault spread.

## Why turnover is higher than the signal's stickiness implies (2026-07-06 follow-up)

Owner intuition ("direction shouldn't swing; moves should be flat") is **confirmed**: zero
long↔short reversals across all 12 vaults in the sample; mean 30-min |Δs| is only
0.002–0.008 (below the 0.05 deadband — most ticks trade nothing); BTC's skew stayed in
−0.19…−0.43 the whole time. Decomposing traded notional: **0% direction flips,
37–100% FLAT-gate crossings, remainder size drift** — and the drift itself is spike-driven
(BTC's two largest trades came from a −0.29→−0.43→−0.26 spike that reverted in 8 min;
$326k = 30% of its 5-day volume from one flickering snapshot).

**Implication: measured 40–70× is the *naive execution rule's* turnover, not the strategy's.**
Two keeper-side fixes — (1) sticky gate (state must persist ≥2 ticks), (2) spike
confirmation or EMA-smoothed skew — should bring a typical vault to **≈30–40×/yr
(~1%/yr drag @ 3 bps)**. Treat 30–40× as the design target and 40–70× as the un-tuned
upper bound; neither fix delays a real regime change by more than ~1 h.

## Launch wave — first platform vaults (2026-07-08; answers part of catalog §7.6)

This is the **launch sequencing within the §7.7 universe** (threshold rule, DECIDED
2026-07-06: >$10M EP-cohort notional on Lighter×HL matched assets — 27 at snapshot). It
does NOT redefine eligibility. Signal-health criteria applied on top of §7.7: (1) breadth
(median contributors, % snapshots ≥5); (2) coverage/activity in the 7-day track; (3)
Lighter depth (judgment, pending the slippage check).

**Launch 13 (owner approved the shape 2026-07-08; two [PENDING-owner] swaps below):**
- Crypto (7): **BTC, ETH, SOL, HYPE** (24–39 median contributors, 100% coverage) +
  **NEAR, LIT, ZEC** (13 each, 100% active).
- Stocks (2): **NVDA** (11 voices) + **MU** (10 voices, 100% active) — [PENDING-owner]
  MU added per "more stocks when eligible"; SPCX (8 voices) is the next candidate but
  waits for time-averaged qualification.
- Indices/commodities (4): **US500, XAU (GOLD), WTI (CL), BRENTOIL** (6–10 voices,
  BRENTOIL 99% active).
- **[PENDING-owner] XRP dropped:** owner approved it in the wave, but it fails the
  decided §7.7 bar (>$10M EP notional — not in the 27). Recommended resolution applied:
  out of the wave, BRENTOIL in. Reverse if the owner overrides the threshold.

**In the 27 but NOT in the wave, with reasons:** MSFT & INTC (breadth gate closed ~100% —
vault would never trade), GOOGL (12% coverage), MRVL (gate-flapping pathology),
SNDK / DRAM (thin, patchy), AAVE (5–6 voices, gated ~⅔), SPCX / SKHYNIX / US100 / XAG /
CRCL / NBIS / ZRO (hover names or unassessed — join via re-qualification).

**Stock watchlist (owner wants more equities, no forcing):** SPCX now; MSFT, INTC, GOOGL
fail only on breadth/coverage — re-check monthly against the (now append-only) track once
the worker persists per-asset EP participation (catalog §7.7 [OPEN]).

## Caveats

- **5 days, one market regime**, annualized ×73 — treat as an order-of-magnitude estimate;
  re-run monthly as `signal_track` accrues (script re-runnable in ~1 min, see below).
- `q` is still mostly the copyScore prior (vault-grade DSR thin) — the production signal may
  differ.
- Flow-driven trading (deposits/redeems) is on top of this; signal turnover dominates at
  steady AUM.
- Neon `cohort_sentiment_history` was checked as a 5-min cross-source: it is aggregate
  per-cohort (all assets summed), not per-coin — unusable for per-vault turnover.

## Re-run

```bash
export PGURL="$(railway variables -s Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)"
# pull signal_track, apply the position rule, Σ|Δx| annualized per coin & deadband
# (analysis was ad-hoc; ~40 lines — pull (ts, coin, s, actionable), x = s if actionable≠FLAT
#  else 0, trade when |Δx| > deadband, annualize by 365/days-observed)
```
