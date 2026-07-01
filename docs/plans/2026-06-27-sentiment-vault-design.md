# Sentiment Vaults — design

**Status:** Design draft (2026-06-27), brainstormed with the user. A set of **12 per-asset
perp vaults** that auto-follow the Extremely-Profitable cohort's positioning. Real money.
Custom-built on Hyperliquid perps (NOT HL native vaults). Custodial, server-driven.

This is the `/vaults` feature (placeholder page already shipped).

---

## 1. Concept

Pick the **top 12 assets by volume** within the EP cohort. For each, run a **dedicated
vault** that holds pooled depositor USDC and takes a **1x directional perp position** sized
to the cohort's net skew on that asset — **following** the smart money. As sentiment shifts,
each vault rebalances. Deposits/withdrawals are permissionless, in USDC (withdrawals settle in
seconds, async — see §3).

Decided in brainstorming:
- **Follow** the cohort (not fade).
- **Per-asset vaults** (12 separate), single-asset, **1x leverage**.
- **Pooled, on-chain custody** via an ERC-4626/7540 vault contract on **HyperEVM** with a
  bounded operator (see §3/§4) — not raw-key custody, not HL native vaults.
- **Rebalance on every sentiment update** (trading only the delta).
- **Set selection — fixed 12 at launch, manual revisit (decided).** Pick the top-12 by
  EP-cohort volume at launch; vaults are **persistent** (never force-closed — depositors are
  never pushed out); add/retire vaults manually as the market evolves. No automated re-rank
  churn for v1.

## 2. The formula (per vault)

Let `C` = vault NAV. The directional signal `s` is a **quality- and conviction-weighted skew**
computed **per-trader over our scored roster** (not the anonymous aggregate feed — see §5). For
the vault's asset, over every roster trader `i` who holds a position on it:

```
quality_i     = composite Swash score, normalized 0–1            (who is sharp)
conviction_i  = clamp( position_notional_i / account_equity_i, 0, LEV_CAP )   (how committed; LEV_CAP ~3×)
direction_i   = +1 long  /  −1 short
weight_i      = quality_i × conviction_i

skew:        s = Σ( direction_i · weight_i ) / Σ( weight_i )           ∈ [−1, +1]
breadth gate:  if fewer than BREADTH_MIN sharp traders hold a position → flat (all free USDC)
deadzone:      enter when |s| > S_ON (~0.12); flat when |s| < S_OFF (~0.08)   (hysteresis)
target:        targetNotional = s × C   at 1x   (+ long / − short)
min order:     if |target| or a rebalance delta < $10 (HL min) → treat as flat / defer
free usdc:     (1 − |s|) × C   free collateral IN the HL account (NOT a contract buffer)
```

- **Why quality × conviction, not raw notional:** raw dollar size is a weak, gameable signal —
  a big *mediocre* trader dominates it. Weighting each vote by **quality** (our composite score)
  means only sharp traders count; weighting by **conviction** (a trader's position as a fraction
  of *their own book*) means a small elite trader betting big **outweighs a whale dabbling 1% of
  their book**. **Leverage is captured for free** — a 5× full-book bet = conviction 5.0 — and
  capped at `LEV_CAP` so no single hyper-leveraged wallet swamps the roster.
- **Direction** = sign(s). **Size** = |s| × C — exposure equals the weighted conviction of the
  roster. Worked example: a BTC vault, C=$1,000, roster nets s=+0.6 → **+$600 long, $400 USDC**.
- **1x** → effective account leverage = |s| ≤ 1, so the position is always smaller than
  collateral → **liquidation practically impossible** under normal moves; downside is bounded
  directional loss.
- **Rebalance:** on each update recompute `s` + `targetNotional`; trade only the **delta**.
- **Sizing curve = linear + deadzone (decided):** exposure equals the weighted skew (`s × C`);
  modest skew deploys modestly, rest stays free USDC. The hysteresis deadzone filters
  near-neutral noise and prevents long↔short flip-flopping; the `$10`-min rule prevents
  dust-order rejections.

## 3. Share accounting — async tokenized vault (ERC-4626 + ERC-7540)

A tokenized vault per asset handles shares + NAV-per-share math, on-chain and permissionless.
**No idle USDC buffer in the contract** — *all* capital lives in the HL account (position
margin `|s|·C` + free USDC collateral `(1−|s|)·C` = `C`). The contract is the share/accounting
+ custody layer; it doesn't sit on cash.
- **`totalAssets()` = value of the HL account** (free USDC `withdrawable` + unrealized PnL from
  the position), read **trustlessly on-chain via HyperEVM precompiles** (no oracle — see §4).
- **Deposit `D`:** `deposit(USDC)` → mint `D / navPerShare` shares; USDC moves contract→HL; the
  next rebalance resizes the position to `s·(C+D)` (free collateral absorbs the rest).
- **Withdraw — the "both sides, fair distribution" rule (no buffer):** a redemption of fraction
  `f` of shares trims **both** the position (`f·|s|·C`) **and** the free USDC (`f·(1−|s|)·C`)
  pro-rata, returns `f·C` to the contract, and pays the user. Both sides shrink by `f`, so the
  skew ratio `s` and every remaining depositor's position/cash mix are preserved — no one can
  exit by skimming only the cash. Trim slippage is charged to the withdrawer.
- **Why async (ERC-7540):** trimming the live position runs through the keeper + a CoreWriter
  action (~few-second delay), so redemption is a **2-phase flow** — `requestRedeem` → keeper
  trims both sides + moves USDC contract-ward → user `claim`s. Settles in seconds, not a
  synchronous call. (This is the `hvUSDC` pattern.)
- **Bounded operator ("predetermined rights"):** the contract grants our backend a restricted
  role that can ONLY (a) move USDC between the vault and the **designated** HL trading wallet
  and resize the position, and (b) settle redeem requests. It **cannot** send funds to
  arbitrary addresses or bypass the share-gated redeem path. The operator runs the strategy; it
  can't rug.

## 4. Custody & execution — contract-custodied (EVM) + key-custodied (HL)

Funds flow exactly as specified: **user ↔ vault contract ↔ HL trading wallet.**
- **EVM side (vault contract):** owns share/NAV accounting and settles redemptions —
  contract-enforced, bounded operator, permissionless entry/exit. **No idle USDC sits here;**
  capital is deployed to HL. Removes raw-key custody of share logic.
- **HL side (trading wallet):** the deployed `|s|·C` lives in a HyperCore perps account, traded
  by an **agent key** (`ECC_SECG_P256K1` in **AWS KMS HSM**, CloudTrail-audited; can't
  withdraw → limited blast radius). Pulling USDC HL→contract (for a trim) uses the wallet's
  withdraw-capable key, which **only ever sends to the vault contract address** (KMS, monitored).
  So the *deployed* capital is the only key-custodied part. (This is the "server-driven
  execution tier" of `2026-06-26-hl-trading-interface-plan.md` §A.)
- **Chain = HyperEVM + CoreWriter (decided).** It's the only option satisfying *both*
  near-instant withdrawals and trustless on-chain NAV (Arbitrum forces a ~3–7 min bridge + a
  trusted keeper/oracle for NAV, since HL account value isn't visible on Arbitrum). Concrete
  mechanism:
  - **Fund moves, on-chain & ~sub-second:** EVM→Core = ERC-20 `transfer` of USDC to the token
    **system address**; Core→EVM = `sendAsset` (~200k gas); spot↔perp = CoreWriter **Action 7**
    (USD class transfer). No external bridge, no 1-USDC fee.
  - **Trustless `totalAssets()` via read precompiles:** `withdrawable` (0x…803) + unrealized
    PnL from `position` (0x…800) × `markPx` (0x…806) + EVM-side USDC. **No oracle.** Bound
    mark↔oracle divergence on deposit/withdraw (manipulation guard).
  - **Hybrid trading (recommended):** money-movement + NAV on-chain (CoreWriter/precompiles);
    **active order placement/rebalancing via the keeper agent key over the off-chain L1 API**
    (faster, richer, and dodges CoreWriter's intentional ~few-second action delay).
  - **Reference design: `hvUSDC`** (ERC-4626 + ERC-7540, NAV via precompiles, keeper-EOA
    trading, delegatecall libs for EIP-170, timelock'd UUPS). Mirror its structure; **get an
    independent audit** — CoreWriter itself has no public audit and the reference vaults are
    young.
- **Rebalance engine** (`apps/worker`): on each sentiment update, computes `targetNotional`
  per vault, submits the delta order via the **keeper agent key** (off-chain L1 API); rate-limit
  aware; kill-switch.
- **Withdrawals (no buffer, both-sides, async):** every redemption trims **both** the position
  (`f·|s|·C`) and the free USDC (`f·(1−|s|)·C`) pro-rata — fair distribution, ratio preserved.
  Since the position trim runs through the keeper + a CoreWriter action (~few-second delay),
  redemption is the 2-phase **ERC-7540** flow (`requestRedeem` → keeper trims both sides + moves
  USDC contract-ward → user `claim`s). Settles in seconds. No depositor can exit by skimming
  only cash.
- **Still custom, not HL native vaults** — required because native (legacy) vaults trade
  **validator-operated perps only (no HIP-3 `xyz:` markets** like SP500/GOLD that dominate the
  cohort's volume) and impose a 1-day lockup. A normal HyperCore account can trade HIP-3 via
  the API. (Re-confirm HIP-3 tradability on a funded account before mainnet.)

## 5. The signal — computed per-trader over our scored roster

The vault's `s` is **not** the anonymous aggregate sentiment feed. We compute it ourselves,
per-trader, over **our own scored roster** (§2). Per asset, for each roster trader we need:
- **position** on the asset (direction + notional) — native `clearinghouseState` reads,
- **account equity** — `clearinghouseState` / the `wallets` table,
- **composite Swash score** — our scoring engine.

This is a strength, not a cost: the signal now runs on **our own data and our scoring moat**,
not a third-party aggregate — so it **sidesteps the Hyperdash corrupt-data risk for the signal
itself.** We read ~80 roster wallets × 12 assets natively; the expensive anonymous aggregate
feeds are out of the loop.

- **Pluggable interface:** vault logic reads `getRosterSkew(coin) → { s, contributingTraders,
  asOfMs }`; the implementation aggregates per-trader quality×conviction. Roster + scores come
  from the EP-cohort pipeline (parallel session, `2026-06-25-hyperdash-independence-migration.md`);
  position/equity reads are native HL.
- **Guards (before any mainnet money):** breadth gate (≥ `BREADTH_MIN` contributing traders),
  per-trader sanity bounds (equity / notional / leverage), `LEV_CAP` on conviction, and a
  **staleness circuit-breaker** (stale position reads → freeze rebalancing or flatten to USDC).
- **Dependency:** needs the scored roster live + reliable native position reads. The roster/score
  pipeline lands in the parallel session; gate real-money *scale* on it.

## 6. Risk management

- **Liquidation:** ≤1x ⇒ effectively none under normal moves (still handle extreme gaps).
- **Directional drawdown:** the real risk — if the cohort is wrong, the vault loses (capped at
  position size). No leverage means losses are bounded and slow.
- **Funding cost (decided: accept + monitor + extreme-funding guard):** following the crowd
  usually means sitting on the *crowded* side, which typically **pays funding** — a persistent
  drag. v1 holds the position and eats normal funding (measure the real drag first), with a
  **circuit-breaker that dampens/flattens only when funding is extremely adverse**. Revisit
  continuous funding-aware sizing once the live drag is known.
- **Min order ($10 notional):** tiny vaults / tiny deltas below min are skipped until they
  clear the threshold.
- **Kill-switch / circuit breakers:** flatten-all on data anomaly, depeg, or ops incident.
- **Slippage:** charged to the actor (withdrawer pays their own trim slippage).
- **Redemption-run risk:** instant withdrawals force position trims; a withdrawal wave closes
  positions at worse prices. Much milder at ≤1x than leveraged, but cap instant-withdraw
  liquidity per block/epoch and socialize nothing onto remaining depositors.

## 7. Mobile UI (`/vaults`)

- **Vault list:** the 12 asset-vaults; each card shows asset, current **direction + skew%**,
  position size, vault TVL, performance (PnL / est. APR), and "your position."
- **Vault detail:** deposit/withdraw (USDC), live positioning, the sentiment driving it, and
  history. Connect-wallet via the trading plan's Privy/WC layer.
- Replaces the current "coming soon" placeholder.

## 8. Phasing

1. **Testnet** — vault accounting + rebalance engine on HL testnet, test USDC, the formula
   end-to-end (sentiment → target → delta order → share NAV).
2. **Sentiment hardening** — guards + circuit-breaker; ideally native sentiment.
3. **Custody/security** — KMS master/agent keys, withdrawal controls, audit.
4. **Mainnet limited beta** — small per-vault TVL caps, a few assets.
5. **Full 12-vault launch.**

## 9. Fees & revenue (decided)

Two streams:
- **Performance fee** — a % of vault profits above a high-water mark (rate TBD, e.g. 10–20%).
  Aligns us with depositors — we earn only when they gain.
- **Builder code on every rebalancing trade** — the vault's HL orders carry a Swash builder
  code (≤0.1% perps), so we also earn on the vault's trade flow. Because we control **both**
  the builder account and the vault accounts, the one-time `approveBuilderFee` is internal
  (we approve our own code on our own accounts) — no per-depositor signature.

**Transparency / alignment note (important for the product's trust ethos):** the builder fee
is charged on **turnover**, and "rebalance on every update" maximizes turnover — so this
stream *rewards churn*, which is in mild tension with depositor returns (every delta trade
costs them taker ~0.035% + builder ≤0.1%). The performance fee aligns us with gains; the
builder fee does not. Disclose both clearly in the vault UI, and treat a future **deadband**
not just as fee control but as an alignment safeguard. Total depositor cost per rebalance ≈
HL taker + builder; model cumulative drag against the signal's edge (cf. the funding drag in
§6) before mainnet.

## 10. Open decisions

- **Performance-fee rate** + high-water-mark mechanics; **builder-fee rate** (≤0.1%).
- **Deposit caps** for beta (per-vault TVL ceiling, min deposit).
- **Funding-aware sizing.** Accept funding drag as-is for v1, or dampen size when funding is
  adverse? (Recommend: accept for v1, monitor.)
- **Legal/custodial posture.** Holding pooled user funds has regulatory weight — out of scope
  for this doc, but must be addressed before mainnet.
