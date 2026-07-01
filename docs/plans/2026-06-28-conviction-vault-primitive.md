# Conviction Vaults — a new financial primitive (draft)

**Status:** Conceptual draft (2026-06-28), written in quant terms. Formalizes the sentiment-
vault work (`2026-06-27-sentiment-vault-design.md`) into a general, defensible primitive.
"Not copy-trading, not an index — something new."

---

## 0. One line

> A **Conviction Vault** is a tokenized, bounded-leverage perpetual position whose **signed
> exposure continuously tracks a skill- and conviction-weighted consensus** of a curated
> trader population — so a depositor holds *managed directional exposure to informed
> positioning*, sized to how confident that informed cohort is.

The underlying signal — **Skill-Weighted Net Positioning (SWNP)** — is the actual primitive;
the vault is its tradable wrapper.

---

## 1. The signal — Skill-Weighted Net Positioning (SWNP)

For a curated population `P` and asset `a` at time `t`, each trader `i ∈ P` contributes:

| term | meaning |
|---|---|
| `d_{i,a} ∈ {−1,0,+1}` | sign of their net position on `a` (0 = flat) |
| `n_{i,a}` | their position notional on `a` |
| `E_i` | their account equity |
| `c_{i,a} = min(n_{i,a}/E_i, λ)` | **conviction** — fraction of their book on the bet, leverage-capped at `λ` |
| `q_i ∈ [0,1]` | **quality** — normalized skill (see §4) |

**SWNP:**
```
s_a(t)  =  Σ_i  q_i · c_{i,a} · d_{i,a}   /   Σ_i  q_i · c_{i,a}        ∈ [−1, +1]
```

Read it as a **cross-sectional, skill-weighted estimate of informed flow imbalance.**
Properties that make it well-posed:
- **Bounded** in [−1, +1]; `sign(s)` = consensus direction, `|s|` = consensus *strength*
  (agreement × conviction × quality).
- **Whale-robust** — conviction normalizes raw size, so a big position that's a small fraction
  of a huge book barely counts.
- **Skill-gated** — `q_i` means only demonstrably-skilled traders move the signal.
- **Leverage-aware, not leverage-fooled** — leverage enters once, through conviction, capped at
  `λ` so no single hyper-levered wallet dominates. Crucially, `q` is **leverage-stripped**
  (§4) so leverage isn't double-counted as skill.
- **Breadth-gated + de-noised** — require ≥ `N` contributors; apply a hysteresis deadzone so the
  *actionable* signal `š` ignores near-neutral noise and doesn't flip-flop.

## 2. The instrument — the Conviction Vault

Holds a perp position on `a` of
```
X_a(t) = š_a(t) · V(t)        at fixed unit (1×) leverage,   V = vault NAV
```
- **Exposure = confidence.** `|X| = |š|·V`, with `(1−|š|)·V` left as free collateral. When the
  informed cohort is uncertain (`š→0`) the vault automatically de-risks to cash. This is an
  **endogenous, uncertainty-scaled position size** — a capped, signal-driven cousin of Kelly:
  you are only as exposed as the smart money is sure.
- **Liquidation-remote.** `|X| ≤ V` ⇒ effective account leverage ≤ 1, so ordinary moves can't
  liquidate it; downside is bounded, gradual directional loss.
- **Tokenized & fairly redeemable.** ERC-4626/7540 shares; every redemption trims **both** the
  position and the free collateral pro-rata (no one exits by skimming cash), settling in seconds.
- **Deterministic & transparent.** No discretion — the position is a published function of a
  published signal.

## 3. Where the return comes from (and where it dies)

Decompose the vault's return:
```
r_vault  ≈  š · r_asset  −  funding(š)  −  fees  −  rebalance_cost  −  tracking_error
```
**Alpha thesis:** skill-weighted informed positioning carries predictive information about
near-term returns — i.e. `E[ š · r_asset ] > E[ funding + costs ]`. This rests on a real,
studied effect (informed order flow → price), refined here by *only counting demonstrably
skilled, genuinely committed* traders.

**Why it can fail (state them up front):**
- **Model risk.** The edge is a *bet on `q`*. Bad/lagged skill scores → confident wrong
  *direction* (not just wrong size — see the A/B/C comparison). The primitive amplifies our
  data quality, good or bad.
- **Crowding / funding.** Following consensus usually means paying funding; if the directional
  edge < funding drag, a "correct" call is still net-negative.
- **Latency / decay.** Positioning data is stale by construction; alpha decays with signal age.
- **Capacity & reflexivity.** At size, our own flow and copied flow degrade the edge.
- **Hidden book.** Conviction uses *visible* equity; off-venue positions distort it.

## 4. Quality `q` — vault-grade skill, the quant way

`q` must measure **predictive, risk-adjusted, luck-corrected, leverage-neutral** skill — not
past return:
1. **Risk-adjusted** base — Sharpe/Sortino/Calmar + drawdown/Ulcer (blow-up risk dominates).
2. **Luck/selection correction** — **Probabilistic & Deflated Sharpe (PSR/DSR)** for track-record
   length, skew/kurtosis, and *multiple-testing* (we pick the top of thousands); **Bayesian
   shrinkage** for short samples.
3. **Alpha, not beta** — strip market/momentum/carry exposure and **leverage**; reward
   alpha-per-unit-risk. (Leverage already lives in conviction.)
4. **Persistence-validated** — `q` is only legitimate if it predicts *forward* returns
   (walk-forward IC), not just describes the past.
Normalize to `q ∈ [0,1]`. Swash's existing PSR/DSR/profit-factor/drawdown scorer is the
starting point; the additions are leverage-stripping, alpha attribution, and persistence proof.

## 5. Why it's a *primitive*, not a product

SWNP/Conviction Vault is fully parameterized by **(population `P`, quality model `q`, conviction
map `c`, asset `a`, leverage cap `λ`, deadzone)**. The sentiment vault is one instantiation:
`P` = Extremely-Profitable cohort, `q` = Swash composite, `c` = pos/equity @ `λ=3`, single
asset, 1×. Vary the parameters and you get a **family**:
- different populations (sector specialists, options desks, on-chain whales),
- baskets instead of single assets,
- **market-neutral** builds (long high-`s` assets vs short low-`s`),
- leverage tranches (conservative 1× vs aggressive),
- the raw `s_a(t)` series as a **publishable factor/oracle** others can build on.

That composability — a clean signal + a clean wrapper, each swappable — is what makes it a
primitive rather than a single strategy.

## 6. Open quant questions (must be answered with data, not assertion)

1. **Predictiveness:** information coefficient of `š` vs forward `r_asset`; alpha half-life.
2. **`q` persistence:** rank autocorrelation of skill across non-overlapping windows.
3. **Net-of-cost edge:** does `E[š·r] − funding − fees` stay positive across regimes?
4. **Optimal `λ`, deadzone, leverage:** Sharpe-maximizing calibration (not hand-set).
5. **Capacity:** edge decay vs deployed size; reflexivity from copied flow.
6. **Robustness:** survivorship/look-ahead-clean backtest; performance in drawdown regimes.

The construction (§1–§2) is exact and shippable on testnet today; the **edge claim (§3) is a
hypothesis** these questions must confirm before real money scales.
