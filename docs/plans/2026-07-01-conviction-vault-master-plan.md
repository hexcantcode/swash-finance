# Conviction Vault — master plan (quant-grade, finalized)

**Status:** Finalized design (2026-07-01). Authoritative spec consolidating
`2026-06-27-sentiment-vault-design.md` (mechanics/custody) and
`2026-06-28-conviction-vault-primitive.md` (the primitive). Everything here is **decided**;
numeric parameters marked *(calibrate)* are set by the backtest (Part VII), not by hand.

Product: **12 per-asset Conviction Vaults on Hyperliquid** — each holds a **1× directional
perp position that tracks a skill- and conviction-weighted consensus** of a curated trader
population, sized to how confident that population is. Tokenized (ERC-4626/7540) on HyperEVM,
permissionless fair redemption.

---

## Part I — The signal: Skill-Weighted Net Positioning (SWNP)

Per asset `a`, time `t`, over curated population `P`. Each trader `i` with a position on `a`:

| term | definition | source |
|---|---|---|
| `d_{i,a} ∈ {−1,0,+1}` | sign of net position | fills → reconstructed position |
| `n_{i,a}` | position notional (USD) | position × mark |
| `E_i` | account equity (USD) | clearinghouseState / ledger |
| `q_i ∈ [0,1]` | **quality** (Part II) — vault-grade skill | scoring engine |
| `c_{i,a} = min(n_{i,a}/E_i, λ)` | **conviction** — fraction of book, leverage-capped | `λ` *(calibrate ~3)* |

```
raw signal   s_a = Σ_i q_i·c_{i,a}·d_{i,a}  /  Σ_i q_i·c_{i,a}          ∈ [−1,+1]
breadth gate if #{contributing traders} < N_min  →  flat               N_min *(calibrate ~5)*
deadzone     enter |s|>S_on ; exit to flat |s|<S_off                    *(calibrate ~0.12/0.08)*
actionable   š_a = deadzoned, hysteresis-filtered s_a
```

Quality decides *who counts*, conviction decides *how committed* (leverage enters here once,
capped). No raw notional (gameable). No dust floor (population is vetted).

## Part II — Vault-grade quality score `q`

`q` measures **predictive, risk-adjusted, luck-corrected, leverage-neutral** skill — not past
return. Pipeline (upgrades today's 3-ingredient discovery score):

1. **Honest returns.** Time-weighted return series per wallet from fills+ledger, **flows
   stripped** (deposits/withdrawals are not P&L). Foundation; most leaderboards get this wrong.
2. **Risk-adjusted.** Sharpe, Sortino, Calmar; drawdown depth + recovery (Ulcer).
3. **Luck / selection correction.** **PSR** (track length, skew, kurtosis) + **DSR** (deflate
   for best-of-N selection across the population) + **Bayesian shrinkage** for short samples.
4. **Alpha, not beta.** Regress returns on market (+ momentum/carry) → keep **alpha**; strip
   **leverage** (leverage already lives in conviction — never double-count it).
5. **Persistence-validated.** `q` is legitimate only if it **predicts forward returns**
   (walk-forward IC > 0, stable) — proven in Part VII, not assumed.
6. **Compose.** Winsorize → rank/z-score components → blend (equal-weight baseline, learned
   weights only with regularization) → normalize to `q ∈ [0,1]`.

**Honest limits (state them):** we see only HL activity (partial book → partial alpha &
conviction), short crypto track records (high uncertainty), no clean perp factor model. `q` is
noisier than an equities-manager score and its weights are **empirically validated, not
assumed**.

## Part III — Signal → position

Vault NAV `V`. Position on `a`:
```
X_a = š_a · V        at 1× (unit leverage)        + long / − short
free collateral = (1 − |š_a|) · V
min order: |X| or a rebalance delta < $10 → treat as flat / defer
```
- **Exposure = confidence** — endogenous uncertainty scaling; weak/ambiguous signal ⇒ auto
  de-risk to cash (capped Kelly-lite).
- **1× ⇒ liquidation-remote** — position always < collateral; downside bounded, gradual.

## Part IV — Custody, execution, redemption (finalized; detail in the 06-27 doc)

- **Chain: HyperEVM.** Per-asset **ERC-4626/7540** vault contract; NAV read **trustlessly via
  HyperCore precompiles** (`withdrawable` + position×markPx uPnL), **no oracle**.
- **No USDC buffer** — all capital in the HL account (position + free collateral). **Bounded
  operator** ("predetermined rights"): can only move USDC vault↔HL and settle redeems; cannot
  redirect funds or bypass share-gated redeem.
- **Redemption — no buffer, both-sides, fair, async.** Each redeem trims **both** position
  (`f·|š|·V`) and free USDC (`f·(1−|š|)·V`) pro-rata; ERC-7540 `requestRedeem → keeper settles
  → claim`, seconds. No one exits by skimming cash.
- **Execution split:** money-moves + NAV on-chain (CoreWriter/precompiles); **trading via the
  keeper agent key** (off-chain L1 API, KMS-HSM, can't withdraw). Reference: **hvUSDC**.
- **Rebalance:** on every signal update, trade only the **delta**; delta-only keeps turnover
  small. Kill-switch + staleness circuit-breaker (stale reads → freeze / flatten).

## Part V — Risk, fees, set

- **Risk:** liquidation-remote (≤1×); directional drawdown is the real risk (bounded);
  **funding drag** — accept + monitor + **extreme-funding circuit-breaker** *(calibrate
  threshold)*; redemption-run mild at 1×; charge trim slippage to the withdrawer.
- **Fees:** **performance fee** (high-water mark, rate *calibrate*) + **Swash builder code** on
  every rebalance trade (`approveBuilderFee` internal — we own both accounts). Disclose both;
  note builder-fee-on-turnover is a mild churn-alignment tension (deadband as safeguard).
- **Set:** **fixed 12** (top by EP-cohort volume) at launch; vaults **persistent** (never
  force-close depositors); add/retire manually.

## Part VI — Model risk (the honest core)

The vault **amplifies our data**. Good `q`/conviction → real edge dollar-signals miss. Bad/stale
→ confident *wrong-direction* real-money bets (recall A/B/C: only quality×conviction survives
the whale, *if* the data is right). So the edge is a **bet on `q`** and must be *earned* by
Part VII before real money — not asserted by the formula.

---

## Part VII — Backtest & calibration (how we get "best performance")

We do **not** hand-tune. Every *(calibrate)* parameter is set by a walk-forward backtest, and
the edge itself is validated or rejected here.

**Simulation (point-in-time, no look-ahead):**
1. For each `t`, reconstruct every roster wallet's **position** on each asset (cumulative signed
   fills) and **equity** (ledger + realized/unrealized).
2. Compute each wallet's **`q` using only data ≤ t** (walk-forward — never future returns).
3. Assemble `š_a(t)` via Part I. Simulate `X = š·NAV`; step forward one period applying **price
   return + funding + taker fee on the rebalance delta + builder fee**; roll NAV.

**Performance metrics:** annualized return, vol, **Sharpe / Sortino / Calmar**, max drawdown +
recovery, hit-rate, turnover, and explicit **funding-drag** and **fee-drag** decomposition.

**Signal validation (edge vs noise):**
- **Information Coefficient**: corr(`š_a(t)`, forward `r_a`) across assets/time; **alpha
  half-life** (IC decay by horizon → sets rebalance cadence).
- **Deflated significance** — is the Sharpe significant *after* deflating for the parameter
  search? (Don't fool ourselves with DSR the same way we correct traders.)
- **`q` persistence** — does high-`q` predict forward trader returns (rank autocorrelation)?

**Parameter optimization (anti-overfit):** grid/Bayesian over `λ`, deadzone (`S_on/S_off`),
`N_min`, quality-blend weights, rebalance cadence/deadband, leverage — via **walk-forward /
nested CV with an out-of-sample holdout**. Prefer **robust plateaus over sharp optima**; report
out-of-sample, deflated.

**Baselines to beat:** Method A (raw notional signal), buy-and-hold, and a naïve equal-weight
follow. If quality×conviction doesn't beat raw notional out-of-sample, the whole quality thesis
is unproven — that's the key experiment.

**Go / no-go for real money:** positive, persistent out-of-sample IC; net-of-funding-and-fees
Sharpe above threshold across regimes (incl. drawdowns); funding-survivable; adequate capacity.

## Part VIII — Historical data collection (the immediate next step)

To run Part VII we need a clean, point-in-time dataset. **Do not** dump into the prod Neon DB
(512MB cap, `fills` is already the bloat — see `neon-db-capacity`); land raw history in a
**separate backtest store** (Neon branch / dedicated Postgres / Parquet in object storage).

Collect:
1. **Roster** — the EP-cohort wallets, **as membership existed over time** (avoid survivorship;
   include wallets that later blew up or left). Freeze a roster-as-of series.
2. **Per wallet, full history** (as deep as HL serves): `userFillsByTime`, `userFunding`,
   `userNonFundingLedgerUpdates`. Raw, immutable.
3. **Per asset:** `candleSnapshot` price history at the sim resolution (e.g. hourly) + **historical
   funding rates** — for the 12 launch assets *and* their history when in/out of the top-12.
4. **Derived, offline:** reconstruct position(t) + equity(t) + walk-forward `q(t)` per wallet.

**Known data caveats:** HL `userFillsByTime` history depth is finite (may bound the backtest
window); the **hidden-book** problem (off-HL positions unseen → conviction/`q` partial); ensure
**point-in-time** roster + scores (no look-ahead).

**First build:** a `apps/worker` collection job that, for the roster, pulls fills/funding/ledger
+ per-asset candles/funding into the backtest store, plus an offline reconstructor
(position/equity/return series). Then the sim harness (Part VII).

## Part IX — Build phases

1. **Data collection + reconstruction** (Part VIII) — *start here*.
2. **Backtest harness + signal/`q` validation** (Part VII) — prove or kill the edge; calibrate.
3. **Vault-grade `q` productionization** (Part II) — the validated scorer, live.
4. **Contracts on HyperEVM testnet** (mirror hvUSDC) + keeper + native signal pipeline.
5. **Testnet end-to-end**, then **audited mainnet limited beta** (TVL caps), then full 12.

## Appendix — parameters

| param | role | status |
|---|---|---|
| `λ` (conviction/leverage cap) | cap conviction | *calibrate* (~3) |
| `S_on` / `S_off` (deadzone) | enter/exit hysteresis | *calibrate* (~0.12/0.08) |
| `N_min` (breadth) | min contributors | *calibrate* (~5) |
| quality-blend weights | Part II composite | *calibrate* (equal-wt baseline) |
| rebalance cadence / deadband | turnover vs freshness | *calibrate* (from IC half-life) |
| leverage | 1× | **fixed** |
| performance fee / builder fee | revenue | *set* (business) |
| funding circuit-breaker | extreme-funding guard | *calibrate* |
