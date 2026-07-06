# Vault stack (ERC-4626/7540 + Lighter) — exhaustive decision catalog

**Date:** 2026-07-05 · **Status:** architecture DECIDED, details cataloged here for spec-out.
**Decided (see `docs/handoff-2026-07-03-lighter-execution-and-mobile.md` §B6 + memory `vault-architecture-4626-lighter`):** 12 platform vaults = Swash's own ERC-4626/7540 contracts trading on Lighter via dedicated keeper-driven accounts (NAV keeper-reported); user vaults = **indexes** (weighted baskets of platform-vault shares, fully on-chain, no Lighter account). No success/management fees in-contract; revenue = builder fee (3 bps taker / 1 bps maker) on keeper orders, shared with index creators via external periodic payouts. No graduation/raise phase (that concept died with the abandoned Lighter-pool custody).

Legend: **[DECIDED]** settled · **[REC]** recommendation, needs a nod · **[OPEN]** genuinely undecided · **[TEST]** empirically checkable on testnet before specing · **[FACT]** verified this week.

---

## 0. Verified facts the design rests on

- **[FACT]** Lighter L1 bridge (Ethereum): `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7`, `deposit(_to, _amount, _assetIndex, _routeType)` — **`_to` beneficiary param exists** → a contract can deposit crediting any Lighter account. Min 1 USDC. RouteType 0 = perps. Deposits also possible from Arbitrum/Base/Avalanche via CCTP (min 5 USDC).
- **[FACT]** **Withdrawals have NO destination field** (`L2WithdrawTxInfo`: assetIndex, routeType, amount only) → funds always return to the Lighter account's **own L1 owner address**.
- **[FACT]** API-key registration (`ChangePubKey`) verifies an EIP-191 `personal_sign` via ecrecover → **the account owner must be an EOA**. Contract-owned Lighter accounts are unusable (can't register keys, can't even withdraw).
- ⇒ **Structural consequence:** inbound money path can be trustless (contract → bridge directly); the **outbound path necessarily transits the keeper EOA** (Lighter → EOA → forward to contract). This is the one irreducible trust hop; harden it (§1.4).
- **[FACT]** Withdrawal delay: **mainnet 1865 s (~31 min)**, testnet 506 s. "Fast withdrawals" exist (USDC, min $4; fee/mechanics unverified).
- **[FACT]** Execution proven from TS/Node (WASM signer): key registration, IOC fills, round-trip close; zero fees on Standard accounts; integrator (builder) fee fields sign into orders.
- **[FACT]** Rate limits: Standard account = 60 req/min flat (per account); Premium 24k weighted/min; a named **"Builder" tier = 240k weighted/min** exists. `sendTx` weight 6, `account` weight 300. Order caps: 500 pending/account, 16 pending/market, 1500 active/account. 429/405 + 60 s firewall cooldown on breach.
- **[FACT]** Lighter native public pools are NOT used (custody = our 4626), but remain proven as reference.

---

## 1. Money path & chain

**1.1 Host chain [DECIDED 2026-07-05: Arbitrum One]**
- Vault contracts + factory on **Arbitrum One**: ~free gas for depositors AND for NAV posts → enables **short epochs (~1h)**, which is what actually shortens user-perceived redemption latency (see below). Lighter officially supports CCTP deposits from Arbitrum; CCTP v2 fast transfers run seconds–minutes.
- **Inbound stays trustless via an Ethereum router:** Arbitrum vault → CCTP burn (`mintRecipient` = small **immutable router contract on Ethereum**) → permissionless relay → router calls `bridge.deposit(_to = vault's Lighter account)`. One extra audited contract (~50 lines); no EOA transit inbound.
- **Outbound unchanged** (chain-independent): Lighter → keeper EOA (~31 min bridge delay) → CCTP back to the Arbitrum contract. EOA hop hardened per §1.4.
- **Latency reframe:** Lighter's 31-min exit is fixed by no chain choice; user-facing redemption = buffer (instant) or settlement-tick + 31 min + CCTP (≈ **~40 min worst case** at the 5-min tick — see §3.3; typical case is instant/≤5 min, the bridge leg only hits oversized redemptions). Lighter "fast withdrawals" may cut the 31 min — §6.4 [TEST].
- **Robinhood Chain (mainnet 2026-07-02, Arbitrum Orbit, Chainlink CCIP, USDG-first): ruled out for v1** — 3 days old, no CCTP (Lighter's L2 deposit rail), Orbit canonical exit = 7 days. Revisit ~Q1 2027 as an expansion deployment (factory is portable; strong brand fit with the stock-perps angle).
- Consequence for §3.3: gas no longer binds the settlement cadence — see §3.3 for the two-clock design (5-min rebalance / 15-min settlement, proposed).

**1.2 Inbound path [DECIDED, enabled by `_to`]** — contract → `bridge.deposit(_to=vaultAccountOwner,…)`, callable by anyone (keeper pokes it); contract never approves any other spender; bridge address immutable in the contract.

**1.3 Outbound path [FACT-constrained]** — keeper signs L2 withdraw → funds land at keeper EOA → EOA forwards USDC to the vault contract.

**1.4 Hardening the EOA hop [REC]**
- One dedicated EOA **per vault** (blast radius = one vault), keys in KMS with policy (no export, templated txs only).
- **EIP-7702 delegation** on each keeper EOA to an audited "forwarder" implementation: any USDC received auto-forwards to its bound vault contract; delegation revocation monitored on-chain and alerts. (Reduces accident + most-malice risk; not absolute — the key holder can re-delegate. Document honestly.)
- Contract accounting: `expectedInTransit` bookkeeping — keeper must reconcile withdrawals within N hours or the vault flags degraded state in the UI.
- **[OPEN]** whether to also require a 2-of-2 (KMS + HSM co-sign) on L2 withdraw txs specifically.

**1.5 Per-vault account model [TEST → then decide]**
- Option A: **one EOA per vault** (N wallets, full isolation, N× 60 req/min Standard budgets).
- Option B: one EOA + **Lighter sub-accounts** per vault (`SignCreateSubAccount` exists; fewer keys, but shared L1 owner → shared withdrawal destination and possibly shared rate limits).
- **[TEST]** sub-account margin isolation, per-sub-account withdrawal semantics, whether rate limits are per account-index or per L1 owner. **[REC]** lean Option A (isolation + per-account rate budgets) unless tests show sub-accounts are strictly better.
- **Scope note (2026-07-05):** with user vaults = indexes (§2.9), the Lighter account count is **fixed at 12 forever** — this decision only concerns the platform vaults, and Option A's "N wallets" burden is a constant 12, further favoring it.

**1.6 Fast withdrawals [TEST]** — mechanics/fee of Lighter's fast-withdraw (USDC min $4); if cheap, use it to refill the redemption buffer quicker than 31 min.

---

## 2. Contract layer

**2.1 Deposit model [REC]** — synchronous 4626 `deposit` (mint at next-tick NAV) while funds sit idle pre-sweep; **redemptions async** (ERC-7540 `requestRedeem`). Both priced at the next settlement tick (§3.3) to kill NAV-frontrunning both ways.

**2.1b Redemption payout [DECIDED 2026-07-06, owner: direct push transfer, claim fallback]** — when redemption USDC is available (buffer at settle tick, or bridged funds landing later), the keeper's settlement tx **auto-transfers USDC to the user's wallet**; if the transfer fails (USDC blacklist etc.) it parks as claimable. Buffer-covered exits pay out instantly at the tick; only oversized redemptions ride the Lighter bridge leg.

**2.2 Factory & instances [REC]** — EIP-1167 minimal-proxy clones from a `VaultFactory`; one implementation per type (platform vault / index), per-vault immutable config (asset=USDC; platform: Lighter account L1 addr + caps; index: weight vector + creator addr). No fee config — contracts carry no fee logic (§4.2). User "create vault" = factory call + metadata.

**2.3 Upgradeability [OPEN — trust-story call]**
- Immutable implementation (strongest story, bugs unfixable) vs UUPS behind a 48–72 h timelock (fixable, weaker story).
- **[REC]** v1: immutable logic + an explicit, timelocked **migration** path (deploy v2, users opt-in migrate). Middle ground that keeps the "we can't rug you silently" claim.

**2.4 Share token [REC]** — standard transferable ERC-20 per vault (enables 4626-of-4626 smart indexes later + secondary composability). Named per vault (`swashETHskew` etc.).

**2.5 Roles [REC]**
- `KEEPER` (per-vault or global bot key): post NAV, trigger sweeps, process queue. Cannot change params.
- `GUARDIAN` (multisig): pause deposits, force wind-down. Cannot move funds.
- `ADMIN` (timelocked multisig): fee-recipient, keeper rotation, caps.
- `CREATOR` (user vaults): cosmetic metadata + strategy declaration only; NO fund/param powers.

**2.6 Wind-down / escape hatches [DECIDED in principle, spec details]**
- Stale NAV > N days (**[OPEN]** N: 3? 7?) ⇒ auto wind-down: deposits blocked, keeper's only allowed action = return funds, returned USDC becomes pro-rata claimable vs shares.
- Guardian-triggered wind-down for compromised keeper.
- Cannot force a Lighter withdrawal from L1 — document as residual risk.

**2.7 Caps & buffer [REC]** — per-vault TVL cap (launch: platform $250k, user vaults $50k, raisable by timelocked admin); idle buffer target 5–10% of TVL for instant small redemptions; keeper rebalances buffer on epoch.

**2.8 Graduation / crowdfund phase [DELETED 2026-07-05]** — the concept existed solely to cover Lighter's $1k native-pool seed; with our own 4626 contracts there is **no minimum** (Lighter's only floor is $10/order). Platform vaults launch directly; indexes are live at deploy. No raise state machine in the contract.

**2.9 User vaults = indexes of platform vaults [DECIDED 2026-07-05, owner]** — user-created vaults are **weighted baskets of the 12 platform vaults only** (no custom strategies). Consequences:
- Index = 4626 holding platform-vault ERC-20 shares; deposit splits per weights into underlying vaults; redeem unwinds pro-rata (rides the platform redemption flow).
- **No Lighter account, no NAV oracle, no graduation phase per index** — index NAV is computed on-chain from platform-vault NAVs; indexes are live at deploy. Lighter/KMS surface stays fixed at 12 accounts forever.
- No churn-farming vector: creators choose weights only; all trading is keeper-executed.
- **Weights IMMUTABLE [DECIDED 2026-07-05, owner]** — set once at factory deploy, no update logic at all (no timelock, no weight-change events). New weights = deploy a new index.
- **[DECIDED 2026-07-06, owner]** indexes **rebalance to their target weights** — tracking the declared composition IS the product (an index fund tracks its index; weight drift is not a feature). The keeper restores targets by redeeming overweight / depositing into underweight platform vaults. Spec details, not product questions: cadence vs drift-band trigger, and internal netting — the keeper controls both legs, so redeem/deposit pairs across indexes can net against opposite flows before any underlying Lighter trade, keeping rebalance fee drag near zero. (The earlier "buy-and-hold basket" alternative is rejected.)

---

## 3. NAV oracle & pricing

**3.1 Source of truth [DECIDED]** — Lighter `account.total_asset_value` for the vault's account (their own equity calc), plus contract-side idle USDC, minus in-transit adjustments.

**3.2 Posting mechanism [REC]** — keeper posts `(nav, timestamp, lighterEquity, idleReconciliation)` signed EIP-712; contract checks: signer is KEEPER, timestamp fresh, monotone timestamps, and **drift bounds [REC 2026-07-05, grounded in fund-admin tolerance practice (~2%/day equity funds, breach⇒review-not-reject) + Chainlink deviation model, scaled for 1x crypto]:** max |ΔNAV| vs last accepted post, per-vault volatility tier set at deploy — Tier A (majors): 2% ≤5min / 5% ≤1h / 15% ≤24h; Tier B (volatile alts): 4% / 8% / 25%. **Breach ⇒ escalate, never brick:** post rejected → vault pauses pricing (requests queue unsettled) → guardian co-signs the same NAV (2-of-2) → accepted + unpause. Hourly heartbeat keeps elapsed windows (and thus bounds) tight.

**3.3 Pricing cadence [DECIDED 2026-07-05, owner]** — reframed after owner pushback (the earlier "1 h epoch" was an unconfirmed rec anchored on gas):
- **Two clocks, decoupled.** (a) *Rebalance tick*: keeper-side only, no contract involvement — can be **5 min** (matches the cohort-sentiment snapshot cadence already in prod), trading only when skew delta crosses a **deadband** (turnover/drag control, §5.2). (b) *Settlement tick*: when NAV is posted and queued deposits/redeems are priced.
- **Accounting fact:** rebalancing is **NAV-neutral** (a trade converts USDC↔exposure at market; equity unchanged at trade instant, minus fees/slippage). Share math therefore does NOT require deposits to sync with position changes — it requires a fresh NAV at pricing time. Anti-frontrun = **next-tick pricing** (requests always priced at the NEXT NAV post), airtight at any cadence.
- **Unified keeper cycle — settle-BEFORE-rebalance ordering [DECIDED 2026-07-05]:** read Lighter equity (AUM known exactly) → post NAV → settle queue at that NAV (mint/burn shares) → compute target off new AUM + latest signal → **one combined trade** (signal delta + flow delta; deadband-gated) → pay redemptions (buffer instantly, else Lighter withdrawal). Settling first means one trade per tick; rebalance-first would need a second flow-correction trade next tick (double fee drag). The NAV "oracle" = Swash's Railway keeper worker posting the equity reading — nothing third-party.
- **[DECIDED 2026-07-05, per owner]** one **5-min keeper tick, event-driven**: each tick runs the full cycle above ONLY if there's something to do (pending deposit/redeem, or signal delta beyond deadband). Quiet tick = no on-chain tx, no gas. Plus a 1/hr heartbeat NAV post per vault (feeds the staleness-pause guard §3.2 + the public NAV attestation). Gas cost scales with activity, ≈ $1–5/day total across 12 vaults at moderate use. Deposit confirm ≤5 min; worst-case redemption ≈ 5 min + 31 min bridge + CCTP ≈ **~40 min**; instant when the buffer covers it.

**3.4 Verifiability [REC]** — publish the vault→Lighter-account mapping; anyone can compare posted NAV to Lighter's public API in real time. Add a public "NAV attestation" page; consider a second independent attestor key later (2-of-2 median) — **[OPEN]** v1 or v2.

**3.5 In-transit accounting [REC]** — deposits swept but not yet credited (bridge latency) and withdrawals initiated but not yet forwarded tracked as explicit contract state so NAV never double-counts; keeper reconciles per epoch.

---

## 4. Fees

**4.1 Builder (integrator) fee [DECIDED]** — 3 bps taker / 1 bps maker set on every keeper order (`integratorTakerFee/MakerFee`), accruing to Swash's integrator account. **[TEST]** `SignApproveIntegrator` flow + where fees accrue + `partnerStats` params; **[OPEN]** whether Lighter requires manual integrator onboarding on mainnet (docs suggested partner registration).

**4.2 Success fee [DECIDED 2026-07-05: NONE]** — no success fee on any vault. **Consequence: the vault contract carries ZERO fee logic** (no HWM, no crystallization, no fee-share minting) — materially smaller audit surface; "the contract takes nothing" becomes part of the trust story.

**4.3 Creator revenue [DECIDED shape: external builder-fee share, pro-rata attribution]** — creators are paid a share of the builder fees their index's capital generates. Since fees accrue on the **platform** vaults' Lighter accounts (indexes never trade — §2.9), attribution is pro-rata: `creator earns = share% × Σ_v (index AUM in v ÷ v total AUM) × builderFees(v)` per period; all inputs available (index holdings on-chain, per-account fee totals from Lighter). Payout **periodic, push-transfer with claim fallback** [DECIDED 2026-07-05, owner] — same pattern as redemptions. External system (no contract fee logic). No churn vector: keeper controls all trading. **Split [DECIDED 2026-07-05, owner]: 50/50** — half of the index-attributed builder fees to the creator, half retained by Swash. **[REC defaults]** cadence weekly, minimum ≥$10, USDC on Arbitrum.

**4.4 Management fee [DECIDED: NONE]** — no AUM/mgmt fee anywhere (follows from "zero in-contract fee logic", §4.2). Platform revenue = builder fee on all vault volume: 100% of platform-vault-direct flow + 50% of index-attributed flow (§4.3).

**4.5 Depositor-facing disclosure [DECIDED principle]** — every vault page shows: builder bps × observed turnover = est. annual drag (the ONLY cost a depositor bears), buffer %, redemption SLA (instant-from-buffer vs settle tick + ~31 min bridge), and for indexes: the creator's 50% fee share. Transparency as a feature.

---

## 5. Keeper & operations

**5.1 Stack [DECIDED]** — Node/TS service; vendored `lighter-signer.wasm` (build pinned from `lighter-go`); per-vault KMS keys; nonce manager per (account, apiKeyIndex); lives alongside existing worker (Railway).

**5.2 Strategy engine [carry-over from design doc]** — EP-cohort skew signal → per-vault target position (1x, LEV_CAP clamp) → delta order per epoch/trigger. **Turnover cap** per vault (**[OPEN]** number — measure from `backtest/`; ties to the 3 bps drag table in the handoff doc).

**5.3 Execution style [DECIDED for v1]** — taker IOC on rebalance (proven); maker/patient execution = v2 optimization (drops depositor drag 3→1 bps).

**5.4 Rate-limit budget [FACT-shaped]** — Standard 60 req/min **per account** is fine per vault at epoch cadence (NAV read w300 is the hog — poll equity via WS instead of REST where possible). If consolidated or scaled: apply for **Builder tier** (240k weighted/min) — likely the intended integrator path anyway.
 
**5.5 Monitoring [REC]** — NAV-post liveness, withdrawal-forwarding reconciliation, 7702-delegation watchdog, Lighter API health, drift between posted NAV and independently computed NAV; alerts → wind-down runbook.

**5.6 Key lifecycle [REC]** — per-vault API keys at distinct indexes; rotation procedure (ChangePubKey re-sign); KMS audit logging; break-glass = guardian wind-down.

---

## 6. Lighter integration specifics

- **6.1 [TEST]** Integrator/builder fee end-to-end on testnet: approve → trade with 3/1 bps → confirm accrual location + claim path.
- **6.2 [TEST]** Sub-accounts (§1.5): create, isolate margin, withdraw semantics, rate-limit scoping.
- **6.3 [TEST]** L2 `Transfer` tx: earlier probe got `21505 unsupported tx type` with type 4 and needs `assetIndex≥1` (python says USDC=3) — resolve correct type/params (useful for internal treasury ops; not on the user money path).
- **6.4 [TEST]** Fast withdrawal mechanics + fee (§1.6).
- **6.5 [TEST]** Bridge `deposit()` from a **contract** on a testnet L1 (which L1 does Lighter testnet bridge from? Sepolia?) with `_to` = separate EOA — confirms the trustless inbound path end-to-end.
- **6.6 [OPEN]** Mainnet integrator onboarding (self-serve vs partner contact) — affects launch timeline.
- **6.7 [FACT]** Standard-account taker latency 300 ms, maker 200 ms — fine for epoch rebalancing; Premium unnecessary v1.
- **6.8 [OPEN]** LIT staking: sendTx limits scale with staked LIT — irrelevant at epoch cadence, revisit if strategy frequency rises.

---

## 7. Product & UX

- **7.1 [DECIDED 2026-07-06, owner]** Creator requirements: **no minimum self-deposit** to create an index. Global **minimum deposit = $10** per deposit, any vault, any depositor (conveniently matches Lighter's $10 min order notional). **[REC, kept]** transparency surface: display "creator holds X%" live (on-chain readable), auto-flag if the creator fully exits.
- **7.2 [OPEN]** Creation flow (indexes): weight picker over the 12 platform vaults, metadata (free-text vs structured tags), vault naming/moderation policy. (No fee options — split is a fixed 50/50 platform-wide, §4.3.)
- ~~7.3 Graduation defaults~~ — deleted with §2.8 (no graduation phase exists).
- **7.4 [DECIDED 2026-07-06, owner]** Redemption UX framing: lead with the typical case — instant from buffer, otherwise ≤5 min (next tick). Only oversized redemptions that exceed the buffer add Lighter's ~31-min bridge leg; present that tail as a Lighter dependency ("large exits wait on Lighter's withdrawal bridge"), not as Swash's SLA. Payout is a direct transfer to the user's wallet (§2.1b); claimable only as fallback.
- **7.5 [REC]** Per-vault risk label: keeper-reported NAV + custody model explained in one paragraph; link to the NAV attestation page. Trust-through-honesty is the brand.
- **7.6 [OPEN]** Do the 12 platform vaults launch before the user-vault factory opens (staged), or together?
- **7.7 [DECIDED 2026-07-06, owner — selection rule]** Platform-vault asset universe = assets listed on **both Lighter and HL** (`packages/shared/src/asset-map.ts`, 156 verified pairs), ranked by **EP-cohort activity** (Hyperdash `perpsMarketParticipation`, `extremely_profitable` per-market total notional — the same source that drives the Sentiment tab). Snapshot 2026-07-06 top 12: HYPE, BTC, ETH, US500, SOL, MU, US100, WTI, ZEC, NVDA, LIT, SPCX. **[OPEN — snapshot bias]** several of those are trades-of-the-week (MU, SPCX, ZEC, WTI); per-asset cohort history isn't persisted anywhere (`cohort_sentiment_history` is cohort-level only), so recommend the worker snapshot per-asset EP participation for 2–4 weeks and the final 12 be picked from a time-averaged ranking. Also [OPEN]: fixed set at launch vs periodic review.

## 8. Risk / compliance flags (not legal advice — needs counsel)

- Pooled third-party funds + discretionary(ish) trading = **fund-like product** in most jurisdictions, even without performance fees (the no-fee model helps the optics but doesn't obviously change the classification); index creators add an "unlicensed manager" dimension (mitigated: creators only set weights over Swash products, never trade). Geo-gating? Terms? Entity structure? **[OPEN — external counsel before mainnet]**
- Audit: implementation + factory + forwarder (7702) + the epoch/NAV math. **[OPEN]** vendor + budget; schedule after interface spec freezes.
- Insurance/backstop fund from platform fees? **[OPEN]** v2 candidate.

## 9. Critical path (updated 2026-07-05 — items 1/3/4 now DECIDED)

~~1. Host chain~~ **DECIDED: Arbitrum One** (§1.1). ~~3. Cadence~~ **DECIDED: 5-min event-driven tick** (§3.3). ~~4. Fees~~ **DECIDED: builder-only, 50/50 index split** (§4.2–4.4).

Remaining, in order:
1. **Testnet batch** (§10) — account model (§1.5), integrator fee accrual (§6.1), fast-withdraw (§6.4), contract→bridge deposit (§6.5).
2. **Integrator onboarding on mainnet** (§6.6) — external dependency, start early.
3. **NAV drift bounds** (§3.2) — last interface input (~~weight mutability~~ DECIDED: immutable, §2.9).
4. Contract spec freeze → audit → testnet dress rehearsal (full lifecycle incl. wind-down drill) → capped mainnet beta (platform vaults first, §7.6).

## 10. Empirical test batch (one testnet session, in order)

1. Sub-account create/isolate/withdraw (§1.5) → decides account model.
2. Integrator approve + fee accrual (§6.1) → confirms revenue path.
3. Fast-withdraw mechanics (§6.4).
4. Transfer tx correct params (§6.3).
5. Contract → bridge `deposit(_to)` on Lighter's testnet L1 (§6.5) → proves trustless inbound.
