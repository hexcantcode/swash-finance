# Hyperliquid trading interface — research + plan

**Status:** Pre-design research synthesis (2026-06-26). Venue confirmed **Hyperliquid**
(Lighter postponed — see `memory/venue-stay-on-hyperliquid`). Goal: a perps **trading
interface on the asset detail pages** (`/assets/[coin]`). Build the UI first
(non-functional), then wire **wallet + agent-wallet signing** to make it live. Testnet
first, mainnet (real money) second.

This is the "understand the connections" deliverable. Visual design comes next.

---

## 1. What we already have vs. what's new

- **SDK is ready for writes.** We use `@nktkas/hyperliquid` v0.32.2 — but only its read-only
  `InfoClient`. The same package ships an **`ExchangeClient`** with `order`, `cancel`,
  `modify`, `updateLeverage`, `updateIsolatedMargin`, `approveAgent`, `approveBuilderFee`.
  It signs **in-browser** with a viem/ethers account and handles nonces. So execution is
  *not* greenfield at the SDK layer — we wire the write half.
- **No wallet/signing code exists** in `apps/mobile` yet (the `k-connect-wallet` class is
  CSS only). This is the real new surface.
- **`packages/hl-client/src/asset.ts`** already derives **HL asset ids** for orders
  (perp universe index; HIP-3 `dex:SYMBOL` → `100000 + dexIdx*10000 + idx`). Reusable.

## 2. The connections (end-to-end flow)

The non-custodial **agent-wallet** pattern is how Hyperliquid is designed to be used, and
it's the UX win — the user's real wallet is touched **once**, then trades sign locally
with no wallet round-trip per order.

```
① CONNECT / ONBOARD (cold path, once) — TWO paths, both normalize to an EIP-1193 provider
   (a) Bring your own wallet:  external wallet ──WalletConnect v2 / Reown AppKit──▶ app
       (iOS Capacitor: WC + deep links to MetaMask/Rabby/Coinbase; injected is desktop-only)
   (b) Create a wallet:        email / social / passkey ──Privy embedded wallet──▶ app
       (keys generated on-device, Shamir-split, signed in a secure iframe — Privy never sees them)
   BOTH → viem account: createWalletClient({ transport: custom(provider) }) → @nktkas/hyperliquid.
   So only the connect/onboard layer forks; the signing + trading layer is identical.

② APPROVE AGENT (cold path, once per ~30d)
   the connected master wallet (external OR Privy embedded) signs ONE `approveAgent`
   (user-signed EIP-712, real chainId), then a promptless agent key signs all orders:
   - External-wallet path: app generates a fresh agent key ON DEVICE → iOS Keychain
   - Privy path: agent key can be Privy-custodied (recipe "Pattern A"), OR use Privy
     authorization-keys + policies ("Pattern B": ALLOW orders / DENY withdrawals, transfers)
   Neither path removes the agent (HL requires one for promptless L1 signing) — Privy just
   removes the manual device key-management of it.

③ TRADE (hot path, every order — NO wallet round-trip)
   order ticket ──▶ build action ──▶ sign with AGENT key (viem, L1 phantom-agent, chainId 1337)
                ──▶ submit signed action to HL /exchange ──▶ fills/position

④ READ (already built)
   clearinghouseState / userFills / l2Book / candles ──▶ position panel, liq price, balance
```

**Two signature schemes** (both client-side via viem, no server needed to sign):
- **L1 actions** (order/cancel/leverage): msgpack(action)+nonce → keccak `connectionId` →
  EIP-712 "phantom agent", **hardcoded chainId 1337** (network-independent). Signed by the
  **agent key**.
- **User-signed actions** (approveAgent/approveBuilderFee/withdraw): direct EIP-712 on the
  **real chainId**, signed by the **user's main wallet**. Cannot be done by the agent.

Agent keys **cannot withdraw funds** — blast radius of a compromised agent key is limited
to trading. Generate a **fresh** agent key each approval; never reuse a deregistered agent
address (replay risk).

## 3. Components to build

**Client (`apps/mobile`):**
- `wallet/connect` — a connect layer with **two adapters behind one interface** that both
  yield a viem account:
  - **External:** Reown AppKit + wagmi adapter (browser-only init), WC v2 deep links.
  - **Privy embedded:** `@privy-io/js-sdk-core` (framework-agnostic — Privy's React SDK is
    not usable in Svelte). Email/social/passkey login → embedded wallet →
    `wallet.getEthereumProvider()` → viem `custom()` transport. **Cost to budget:** the
    core SDK is low-level ("contact Privy first", breaking-change-prone) — we rebuild the
    auth UI in Svelte 5 runes ourselves; wallet/signing is the stable part.
- `wallet/agent` — generate agent key, run `approveAgent`, store/load key from Keychain
  (`@aparajita/capacitor-secure-storage` or `@capacitor-community/secure-storage`,
  biometric-gated), track expiry + re-approve.
- `trade/sign` — thin layer over `@nktkas/hyperliquid` ExchangeClient built with the agent
  account; `placeOrder`, `cancel`, `setLeverage`, `closePosition`.
- **Order ticket UI** (bottom-sheet on the asset page) + **position panel** — see §5.
- State: connection status, agent status, account balance/positions (poll
  `clearinghouseState`).

**BFF (`apps/api`) — minimal:**
- Decide order-submission path (see Open Decision A). Likely a thin
  `POST /api/trade/submit` that forwards the **already-signed** action to HL (keeps the
  "mobile speaks only /api" invariant; HL is never called directly by the client), plus
  surfacing meta we already proxy (asset ids, szDecimals, tick rules, fees).
- Builder config (our builder address + default fee) if we monetize (Open Decision B).

**Reuse unchanged:** the scorer, `hl-client` reads, `asset.ts` id derivation, the existing
`clearinghouseState`/fills plumbing for the position panel.

## 4. Order params & correctness rules (from HL docs)

- Order fields (terse wire keys): `a` asset id, `b` isBuy, `p` limitPx (string), `s` size
  (string), `r` reduceOnly, `t` type, `c` optional cloid.
- **Market order** = `{limit:{tif:"Ioc"}}` with an **aggressive price** (mid × (1±slippage),
  rounded to tick). No distinct "market" type.
- **TP/SL** = `{trigger:{isMarket,triggerPx,tpsl}}` with grouping `normalTpsl`/`positionTpsl`.
- **Tick/lot:** price ≤ 5 sig figs AND ≤ (6 − szDecimals) decimals (perps); size rounded to
  `szDecimals` (from `meta`). Strip trailing zeros before signing. **Min order = $10
  notional.**
- **Liq price / margin:** prefer `liquidationPx` + `marginAvailable` straight from
  `clearinghouseState` over recomputing; label any client estimate "est."
- **Rate limits:** address-based ≈ 1 request per 1 USDC traded (10k initial buffer); cancels
  near-always allowed. Fine for a hand-driven UI; mind it for any polling.

## 5. v1 order ticket (lean, credible, safe)

From the perps-UX research — ship the lean cut, defer the rest:

**Ticket:** Long/Short toggle · Market+Limit · size (USD⇄coin toggle) · leverage
slider+presets · limit price (conditional) · margin mode shown (default cross).
**Pre-trade readouts:** order value · margin required · **est. liquidation price** (the most
important number) · fees (taker/maker + builder if used) · est. fill + max-slippage (market)
· available balance · before→after account impact.
**Position panel:** size/entry/mark/uPnL/liq/margin/leverage · **market close + %-slider
partial close** (reduce-only).
**Mobile patterns:** bottom-sheet ticket (keep chart visible) · explicit **confirm sheet**
restating side/size/lev/est-entry/est-liq/fees/slippage · named disabled states
(insufficient margin, < min size, no limit price) · liq price + leverage persistently
visible near the CTA.
**Guardrails:** 0.5% default slippage cap on market orders · high-leverage / liq-proximity
warning · **real-money disclosure** on confirm (big trust moment: app was analytics-only) ·
builder-fee shown in every readout if used.
**Defer:** Stop/TWAP/Scale, attach-TP/SL-on-open multi-level, isolated-margin toggle, TWAP
close, pro-mode layout.

## 6. Phased build (matches "UI first, wallet integration makes it live")

1. **Phase 1 — Order ticket UI, non-functional.** Bottom-sheet ticket + position panel on
   `/assets/[coin]`, wired to live read data (price, balance, position from existing reads),
   all compute (notional, margin, est. liq, fees, tick/lot validation) real, but the CTA is
   disabled / "Connect wallet to trade." No signing. *This is the design+build the user
   wants first.*
2. **Phase 2 — Wallet connect + agent approval (testnet).** Reown AppKit connect →
   `approveAgent` → Keychain storage → ExchangeClient with agent key. Wire CTA to real
   `order`/`cancel`/`close` against **HL testnet** (faucet). Return-deep-link + CSP for the
   WC relay.
3. **Phase 3 — Mainnet hardening.** Real-money disclosures, error/rate-limit handling, agent
   expiry/rotation, builder-fee approval flow (if Decision B = yes), final QA on a funded
   account.

Each phase is shippable; Phase 1 is pure UI and carries no execution risk.

## 7. Open decisions (need a call before/early in design)

**Decided:** onboarding supports **both** an external wallet (WalletConnect/Reown AppKit)
**and** a Privy-created embedded wallet — they normalize to the same viem-account → SDK path.

- **A. Where the AGENT key lives + signing path.** The master wallet (funds) is always the
  user's (external WC or Privy embedded); the open call is where the *agent* key lives, which
  decides **client vs server signing**. Deciding factor: **interactive vs server-driven**
  trading.
  - **Device Keychain agent** (client signs): non-custodial, ~0 latency, offline — best for
    interactive manual trades. (iOS **Secure Enclave can't hold secp256k1** — only P-256 — so
    it's a *software* key in the Keychain, Enclave-protected, not Enclave-signed.)
  - **Privy-custodied agent**: managed, low-latency, less plumbing — pairs with Privy onboarding.
  - **AWS KMS agent** (server signs): `ECC_SECG_P256K1` HSM key, non-exportable, **full
    CloudTrail audit**; the agent key **can't withdraw** so funds stay non-custodial in the
    regulatory sense. BUT each order is a **~100–160 ms BFF→KMS round-trip**, **$1/key/mo**
    (10k users ≈ $10k/mo storage), and a **1,000-TPS shared ECC ceiling** per region. Plugs
    into the SDK via a viem `toAccount` wrapper (or `evm-kms-signer`). Fits **server-driven
    execution** — automation/bots and especially the future **copy-trade / Mirror** feature
    where trades fire *without the user's device present* — not the interactive hot path.
  **Recommendation:** device/Privy agent for interactive trading now; **reserve KMS for a
  future server-side execution path (Mirror/copy-trade)**. In all cases relay the *signed*
  action via a thin **`/api/trade/submit`** proxy so the client never contacts HL directly
  (keeps the "/api-only" invariant). **Reject KMS-of-the-master-wallet** (= full fund custody,
  regulated).
- **B. Builder code / monetization.** Attach a Swash **builder fee** to orders? It's
  first-class (≤0.1% perps), but requires our builder account to hold **≥100 USDC** and a
  one-time `approveBuilderFee` signature from each user (must be disclosed). Yes/no, and at
  what rate.
- **C. Testnet first** — confirm we build/QA Phase 2 on HL testnet before mainnet. (Strongly
  recommend yes.)
- **D. v1 scope** — confirm the lean ticket cut in §5 (defer Stop/TWAP/isolated toggle/
  multi-level TP-SL).
- **E. Connect UX surface** — wallet connect lives where? (Profile, a global "Connect"
  affordance, and/or inline on the order ticket.)
- **F. Privy signing pattern** — for the embedded-wallet path: **Pattern A** (embedded
  wallet signs `approveAgent` once, a Privy-custodied agent key trades — simplest,
  client-side) vs **Pattern B** (authorization-keys + policies that ALLOW orders / DENY
  withdrawals — more powerful, but server-oriented via `@privy-io/node`). Recommend **A**
  for v1; revisit B if we want server-side/automated signing later.

## 8. Risks / watch-items

- **Real money.** The analytics→execution jump is the highest-stakes trust moment; confirm
  sheets, disclosures, and slippage caps are not optional.
- **iOS Capacitor wallet UX.** WC v2 is the only realistic connect path on iOS; the **iOS 17
  no-auto-return** issue needs a custom URL scheme + `appUrlOpen` listener, and the **CSP
  `connect-src`** must allowlist the WC relay `wss://` or it silently fails. Verify Verify-API
  behavior under `capacitor://` origin.
- **Invariant pressure.** Trading adds the first client-side secret (agent key) and the first
  non-`/api` connection (WC relay). Document the carve-out; keep HL order contact behind the
  BFF (Decision A) so the rest of the invariant holds.
- **SDK in the Vite/Capacitor bundle.** `@nktkas/hyperliquid` is ESM and runs in browsers/RN,
  but do a Vite build smoke-test for `@std/*` / valibot deps before committing.
- **Privy on SvelteKit is the riskiest integration.** Privy's polished SDK is React-only; the
  framework-agnostic `@privy-io/js-sdk-core` is officially "contact us first" and
  breaking-change-prone, so we own the auth-UI layer. iOS social login needs **Universal
  Links** (custom URL schemes don't work in the Capacitor webview) + `ASWebAuthenticationSession`;
  iOS secure-storage/session persistence for Privy is undocumented — verify hands-on. Free tier
  ≈ 499 MAU / ~50k signatures-mo (an active perps trader burns signatures fast). Privy is now
  Stripe-owned. Prototype this path early to de-risk before committing the design to it.
- **Agent key lifecycle.** Expiry (~30d practice, 180d max), fresh-key-per-approval,
  no-reuse-after-deregister, biometric gate, deliberate Keychain accessibility class (no
  iCloud sync).

## Sources

Hyperliquid docs (exchange endpoint, signing, nonces & API wallets, builder codes, tick/lot,
asset ids, margining, rate limits); `@nktkas/hyperliquid` SDK (GitHub/JSR); Reown AppKit +
WalletConnect v2 (SvelteKit install, mobile linking, relay/CSP); Capacitor secure-storage &
deep-links guides; perps-UX references (Hyperliquid app, dYdX, GMX, Drift, MetaMask Perps).
Full URLs captured in the 2026-06-26 research session.
