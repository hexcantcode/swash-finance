# Session Handoff — 2026-07-03

Work done in this session, for handoff to other agents. Two tracks: **(A) mobile fixes** (shippable now) and **(B) Lighter-vs-Hyperliquid execution research + vault fee/architecture decisions** (strategic, in progress).

---

## A. Mobile fixes

### A1. Profile light/dark toggle — FIXED & COMMITTED
- **Commit:** `2c6c211` — `fix(mobile): make profile light/dark toggle tappable`
- **Bug:** the toggle looked live but never fired. `.m-hero-right` (buttons) and the balance content both sat at `z-index:1`; the later-in-DOM `.m-balance-label-row` painted over the switch and swallowed taps (`elementFromPoint` returned the label row, not the switch).
- **Fix:** raised `.m-hero-right` to `z-index:2` in `apps/mobile/src/routes/profile/+page.svelte`.
- **Verified:** tap flips light↔dark, persists to `localStorage['swash-theme']`, body bg repaints; `app.html` re-applies before first paint.

### A2. Broken coin icons (xyz: HIP-3 tickers) — DONE, UNCOMMITTED
- **Problem:** many `xyz:` stock tickers (e.g. `xyz:BE`, `xyz:ARM`) 404 on HL's CDN and rendered as the browser's broken-image glyph. No component actually handled icon load failure (the `{#if icon}…{:else}` fallback in `MobileAssetRow` was dead code — `coinIconUrl` never returns empty). Note: `xyz:BB` (the originally-reported one) actually *loads* — it's just an all-black BlackBerry tile, not broken.
- **Fix (shared, per repo single-source rule):**
  - New `apps/mobile/src/lib/components/CoinIcon.svelte` — img + `onerror`→initials-tile fallback; owns iconBg/white-bg/padding. Used in the **disc** contexts.
  - New `apps/mobile/src/lib/utils/img.ts` — `hideBrokenImg(e)`; used in **inline/stacked-avatar** contexts where an initials tile doesn't fit and the coin name is adjacent.
- **Files changed (uncommitted):**
  - New: `CoinIcon.svelte`, `utils/img.ts`
  - CoinIcon swapped in: `routes/assets/+page.svelte`, `routes/assets/[coin]/+page.svelte`, `lib/components/MobileAssetRow.svelte`, `routes/trader/[address]/+page.svelte`, `routes/profile/+page.svelte`
  - `hideBrokenImg` added: `routes/feed/+page.svelte`, `lib/components/MobileMarketSentimentBar.svelte`, `MobileLeaderRow.svelte`, `MobileTraderCard.svelte`, `MobileTopTraderCard.svelte`
- **Verified:** `xyz:BE` detail hero shows a "BE" initials tile; AAPL/normal icons unchanged; `pnpm --filter @copytrade/mobile check` clean (the 7 remaining errors are pre-existing, in the unrelated `routes/avatars/+page.svelte`).

### A3. Local dev pointed at Railway API — UNCOMMITTED
- `apps/mobile/vite.config.ts`: made the `/api` + `/coins` proxy target **env-driven** — `const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:5174'`. Defaults to local; set `API_PROXY_TARGET=https://swashfinance-production.up.railway.app` to run the local UI against the deployed backend.

### A4. Infra facts observed (not a change, just context)
- **DB is stripped to one table** (`cohort_sentiment_history`) on Neon project **`rorrim` (delicate-bird-68439522)**. `fills`/`wallets`/`scores`/`leaderboard`/`discovery_queue` are gone → `/api/leaders`, `/api/stats`, `/api/feed/sentiment`, trader/asset pages **500**. Consistent with the EP-cohort pivot ("remove old DB pipeline") being mid-flight while read-side code still queries `fills`.
- **Railway deploy is healthy.** Project **`adventurous-alignment`** (created 2026-07-01): services `worker`, `swash.finance` (= the api, domain `https://swashfinance-production.up.railway.app`, healthcheck `/api/health`), `mobile`. The `worker` runs **`cohort-snapshot` as a 5-min scheduled job** (not the always-on cron) and writes `cohort_sentiment_history`. Same Neon DB as local.
- **Stale-service-worker gotcha:** a SW cached from a prior `localhost:5173` project can serve a blank page. Repo ships a self-healing tombstone at `apps/mobile/static/sw.js` (served at `/sw.js`), but it only heals if the stale SW's scriptURL is `/sw.js`. Nuclear fix: `brave://serviceworker-internals/` → Unregister the `localhost:5173` scope, or DevTools → Application → Clear site data. Not a code bug.

---

## B. Execution venue: Lighter vs Hyperliquid (strategic — IN PROGRESS)

Context: the vault/execution engine is **greenfield** — `packages/hl-client` is read-only analytics; there is no HL execution code to "migrate." So "switch execution HL→Lighter" = choosing the build target, not a migration.

### B1. Fees (verified from primary docs)
| | Base taker | Base maker | Builder-fee cap (perps) |
|---|---|---|---|
| **Lighter** (Standard acct) | **0%** | **0%** | 10 bps (integrator fee) |
| **Hyperliquid** (Tier 0) | 0.045% (4.5 bps) | 0.015% (1.5 bps) | 10 bps |
| **Binance** USDⓈ-M (VIP0) | 0.050% | 0.020% | n/a (CEX) |
- HL base is a **range**, not flat: HYPE staking gives 5–40% off (taker as low as ~2.7 bps) and volume tiers reduce it further. A rebalancing vault would likely pay < Tier 0.
- Builder/integrator fee has **separate taker & maker fields** on both venues.

### B2. Lighter TS signing — PROVEN (this reversed the earlier "Lighter is harder" verdict)
- SDKs: `github.com/elliottech/lighter-python` (thin ctypes wrapper over compiled `.so/.dylib/.dll`) and `github.com/elliottech/lighter-go` (Go + **`wasm/`** + `sharedlib/` + rust/java/cpp examples).
- **A WASM signer runs natively in Node/TS — no Python/Go sidecar.** Reproduce:
  ```
  cd lighter-go
  GOOS=js GOARCH=wasm go build -o build/lighter-signer.wasm ./wasm   # ~13MB
  cp $(go env GOROOT)/misc/wasm/wasm_exec.js build/
  node examples/wasm/test_wasm.mjs        # → "All assertions passed"
  ```
  In Node: `await import(build/wasm_exec.js)`, `new globalThis.Go()`, instantiate the wasm, `go.run(instance)`, then call globals: `GenerateAPIKey`, `CreateClient`, `CreateAuthToken`, `SignCreateOrder`, `SignCancelOrder`, `SignModifyOrder`, `SignCreateGroupedOrders`, etc. Each returns `{txType, txInfo(JSON), txHash}`. (The `.wasm` can be vendored so no Go at runtime.)
- **Builder fee is per-order & first-class:** `SignCreateOrder` takes `integratorAccountIndex/integratorTakerFee/integratorMakerFee` (args 11–13 of 19) → they land in the signed order's `L2TxAttributes` (`{"1":acct,"2":taker,"3":maker}`). There's also `SignApproveIntegrator`. Verified by signing an order with these set.
- **UPDATE 2026-07-03 — submit → fill PROVEN on testnet (full round-trip, zero human steps):**
  - **Testnet** `https://testnet.zklighter.elliot.ai`, chainId **300**. **Programmatic faucet:** `GET /api/v1/faucet?l1_address=<addr>&do_l1_transfer=false` → creates the account and credits **$10k testnet USDC** (no UI).
  - **API-key registration from Node:** wasm `SignChangePubKey` → patch `L1Sig` into txInfo (ethers `signMessage` / EIP-191 of template `"Register Lighter Account\n\npubkey: 0x<80-hex>\nnonce: <hex10>\naccount index: <hex10>\napi key index: <hex10>\nOnly sign this message for a trusted client!"`, hex10 = `0x`+16-char zero-padded hex) → `POST /api/v1/sendTx?tx_type=8&tx_info=<url-encoded JSON>`.
  - **Submit:** `POST /api/v1/sendTx?tx_type=14&tx_info=…` — **query params** (form body 404s). Nonce: `GET /api/v1/nextNonce?account_index=&api_key_index=`. Ints scaled by market decimals (`orderBooks`: ETH mkt 0 = size 4dp / price 2dp; min $10 notional).
  - **Result:** account 66 — IOC limit buy 0.01 ETH cap $1835.44 → **filled @ $1748.80** (matched at market, not cap); reduce-only IOC sell → **flat**. Cost = spread only (~$0.006), **zero fees confirmed**. Order types: 0=limit,1=market,…; TIF: 0=IOC,1=GTT,2=PostOnly.
  - Spike code (throwaway keys, scratchpad `lighter-ts-spike/`): `probe.mjs`, `faucet2.mjs`, `execute.mjs`, `close.mjs`.

### B3. Lighter native public pools = a vault primitive (verified from signer types)
- A pool **is an account**. A master account creates it via `SignCreatePublicPool(operatorFee, initialTotalShares, minOperatorShareRate, …)`. Depositors `SignMintShares` (deposit→NAV shares) / `SignBurnShares` (redeem→withdraw, **permissionless**). Operator **trades** the pool; can't withdraw depositor funds directly (only trade + mint/burn). `SignUpdatePublicPool` lets the operator change fee/status.
- Constants: `FeeTick = 1_000_000` (OperatorFee cap), `ShareTick = 10_000` (MinOperatorShareRate cap; must be `>0`), `MaxInvestedPublicPoolCount = 16`, `MinInitialTotalShares ≈ 1000 USDC` worth.
- **Coverage:** `mainnet.zklighter.elliot.ai` lists **222 markets**; confirmed present: BTC, ETH, SOL, HYPE, XRP, DOGE, SUI, AVAX, BNB, LINK, LTC, WLD, FARTCOIN, ADA, ENA, AAVE (PEPE via `1000PEPE`). All likely vault assets covered.
- **Implication:** Lighter pools could replace much of the custom vault stack (ERC-4626/HyperEVM contract + KMS custody + CoreWriter precompiles in `docs/plans/2026-06-27-sentiment-vault-design.md`), with permissionless NAV redemption. Trade: custody trust moves from your own auditable Ethereum/HyperEVM contract to Lighter's L2. **This (gate #3) is the real decision axis**, not fees or signing.

### B4. Vault fee / product model — decisions reached this session
- **Standardized fees, no per-creator configuration** ("any other option won't be provided") → locks in the **Swash-mediated** model (creators express intent; Swash operates keys + keeper; uniform fees).
- **Two revenue streams:** (1) **management fee** = the pool's `OperatorFee` (AUM/perf-based, platform-set, uncapped); (2) **builder fee** = the per-order integrator fee (per-trade, ≤10 bps).
- **Builder fee rate (proposed): 3 bps taker / 1 bps maker.** Vault will be **taker at the start** (crosses spread to rebalance) until execution logic improves toward maker.
- **Headroom insight:** because Lighter base = 0%, a 3 bps builder fee is *cheaper to the depositor than HL* (where they'd also pay HL's ~2.7–4.5 bps base) **and** 100% of it is platform revenue. You can set the builder fee anywhere ≤ HL's effective cost and still beat HL on price while keeping the margin. Put any take beyond 10 bps in the (uncapped) management fee, which also doesn't compound with turnover.
- **Creator rev-share** = an onboarding/marketing nudge ("free marketing"). Recommended structure: **referral-style** (creator earns from fees on the AUM/depositors *they bring*), NOT a flat cut of all trading on their index — avoids incentivizing churn.
- **Smart indexes (future):** users compose multiple platform vaults into their own index (a pool holding shares of the base pools — "fund-of-funds"; `MaxInvestedPublicPoolCount=16` hints this is supported, unconfirmed). Kept safe by the mediated model (index pools restricted to allocate-only among whitelisted vaults). The `MinOperatorShareRate` requirement becomes a *feature* here (enforced creator skin-in-the-game). Use a **threshold-as-activation gate** (keeper stays flat until AUM crosses a threshold) rather than an escrow crowdfund — no extra custody.

### B5. Economics model (all-taker, 3 bps)
Because base = 0%, **platform revenue = depositor drag** (minus creator share). Everything hinges on **annual turnover** (traded notional ÷ AUM):
- **Depositor drag %/yr = turnover × 3 bps (0.03%)**
- **Platform revenue = AUM × turnover × 3 bps**

| Annual turnover | Depositor drag | Revenue / $1M AUM |
|---|---|---|
| 25× | 0.75% | $7,500 |
| 50× | 1.5% | $15,000 |
| 100× | 3.0% | $30,000 |
| 250× | 7.5% | $75,000 |
| 500× | 15.0% | $150,000 |

Scales linearly with AUM. Per $100k notional trade @ 3 bps = **$30/side** (taker), $10/side @ 1 bps (maker). Key risk: a 1x cohort-skew strategy's alpha must clear the drag — at 100×+ turnover, 3%+/yr drag is material. Levers: lower turnover + move to maker (3→1 bps cuts drag 67%).

---

### B6. SETTLED vault architecture (decided 2026-07-05)

**Custom ERC-4626/7540 vault contracts for ALL vaults (platform + user-created), executing on Lighter via keeper-bridged dedicated accounts.** Supersedes both "Lighter native pools as custody" and the HyperEVM/CoreWriter custody in `2026-06-27-sentiment-vault-design.md` (HyperEVM was HL-specific; execution venue is now Lighter).

- **Why:** vault creation = factory call (no $1k/vault Lighter pool seed, no creator Lighter onboarding), uniform stack, EVM composability. **Fee model (final, 2026-07-05): NO success/management fees — contracts carry zero fee logic.** Revenue = builder fee only (3 bps taker / 1 bps maker on keeper orders). User vaults = indexes of the 12 platform vaults; index-attributed builder fees split **50/50 creator/Swash**, paid externally (periodic push or claim). See `docs/plans/2026-07-05-vault-4626-lighter-decision-catalog.md` for the full, current decision set — **that catalog supersedes this section where they differ.**
- **Flow:** deposit → 4626 shares at NAV → keeper sweeps to the vault's dedicated Lighter account (one keeper-keyed EOA per vault, KMS) → trades. Withdraw → `requestRedeem` queue → keeper frees collateral → Lighter bridge out (withdrawal delay) → claimable. Idle buffer (~5–10%) for instant small redemptions.
- **Known trust costs (accepted):** NAV is keeper-reported (verifiable against Lighter's public API but not protocol truth — no Ethereum↔Lighter equivalent of HyperEVM precompiles); withdrawal liveness depends on the keeper; audit required before real funds.
- **Required hardenings:** (1) whitelisted money path — contract funds can ONLY go to the immutable Lighter bridge w/ the vault's account as beneficiary; (2) NAV guards — max drift/update, staleness ⇒ pause; (3) epoch pricing on deposit/redeem queues (anti-NAV-frontrun); (4) liveness escape hatch — stale NAV > N days ⇒ wind-down mode; (5) launch TVL caps + buffer ratio; keeper role ≠ admin, timelocked params.
- **Crowdfund/graduation: DELETED (2026-07-05).** The concept existed solely to cover Lighter's $1k native-pool seed; own 4626 contracts have no minimum, so vaults launch directly (indexes live at deploy). Do not build a raise state machine.
- **Lighter-native public pools:** NOT used for custody, but everything proven about them (B3, open-Q2) stays valid as reference; `pool_info` perf surface irrelevant now (Swash computes NAV/perf itself).
- **Open:** which EVM chain hosts the contracts (Ethereum L1 vs Base/Arbitrum + CCTP→Lighter ~15–20 min); Lighter bridge deposit "beneficiary" mechanics (can a contract deposit crediting an EOA's Lighter account, or must the keeper EOA be the L1 sender — determines one hop in the money path); Lighter withdrawal delay duration; audit scope/vendor.

## Open questions / next steps for whoever picks this up
1. ~~**Prove Lighter submit→fill on testnet**~~ — **DONE 2026-07-03** (see B2 update: full round-trip fill, programmatic faucet, key registration, zero fees). Remaining execution unknowns: integrator-fee crediting live, pool ops live, mainnet onboarding.
2. ~~**Confirm `MinOperatorShareRate` semantics**~~ — **RESOLVED EMPIRICALLY 2026-07-03** on testnet (pool `281474976710643`, operator acct 66):
   - **It's a capacity gate: max pool AUM = operator stake ÷ rate.** Investor mints that would push the operator below the rate → rejected (`21207`); operator burns below it → rejected (enforced skin-in-the-game); investor `BurnShares` redeems at exact NAV permissionlessly ($500.00 for 500k shares).
   - **Rate is live-updatable (`UpdatePublicPool`, tx_type 11) including to 0** → zero stake / unlimited capacity possible. It's an optional alignment dial, not a tax. Units: operatorFee in ppm (10000 = 1%), rate in 1/10000 (1000 = 10%). Shares = 0.001 USDC at inception; min seed $1k. `pool_info` natively exposes APY/sharpe/daily_returns/share_prices.
   - **New caveat:** second pool from the same master account → `21130 too many public pools` (testnet cap ~1/account). 12 vaults ⇒ 1 master account per vault, or confirm the mainnet cap.
   - Still open from the original list: (b) `OperatorFee` charging semantics (perf vs mgmt vs entry/exit); (c) liquidation/NAV under stress; (d) pool-holds-pool (fund-of-funds).
3. **Measure real turnover** from the `backtest/` dir for a cohort-skew vault → replaces the 25×–500× range with the true number.
4. **Slippage/depth check** — "matches HL fee" ≠ "matches HL all-in"; Lighter books are thinner on some assets.
5. **Decide gate #3** — trustless HyperEVM/ERC-4626 custody (HL) vs Lighter native pools (0% fees, TS signing, native pools, but custody on Lighter's L2).

## Memory updated this session
- New: `lighter-ts-signing-viable` (TS-native WASM signing proven; builder fee per-order; native pools).
- Updated: `venue-stay-on-hyperliquid` (added an "under reconsideration 2026-07-01" flag; prior decision kept for context).

## Spike artifacts (throwaway, in session scratchpad — not in repo)
`scratchpad/lighter-go` (cloned + WASM built), `scratchpad/lighter-python`, and the Node signing tests. Rebuild per B2 if needed.
