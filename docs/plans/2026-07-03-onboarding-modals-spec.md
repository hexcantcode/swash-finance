# Onboarding modals — Welcome + Vault intro (spec)

**Status:** Copy locked 2026-07-03. Ready to implement (either branch — the vault
modal targets the `/vaults` page, which is further along on `conviction-vaults`).

Two show-once modals: a **Welcome** modal on first app open, and a **Vault intro**
on first `/vaults` visit. Grounded in the onboarding research (2026-07-01 session):
progressive disclosure, plain language, worst-case-honest risk framing, no walls of
text. **Style rule locked: no invented safety, ever** — sell the edge (smart-money
signal) and the clarity (you see and set your risk); never promise a floor that
doesn't exist (e.g. "you can't lose more than you put in" is FALSE under
leverage/liquidation and was explicitly rejected).

## Shared behavior

- **Show-once, persisted, versioned** (localStorage; bump version to re-show after a
  major change):
  - `swash.onboarding.welcome.v1` = `"seen"`
  - `swash.onboarding.vaults.v1` = `"seen"`
- **Skippable always**; set `"seen"` on complete *or* skip.
- **Replayable** from a persistent "?" (header or profile → "How Swash works" /
  "How vaults work") — reopens the modal without touching the flag.
- **Pattern:** reuse the sheet system (`MobileSheet` / `lib/ui/sheets.svelte.ts` —
  add `'welcome'` and `'vaultIntro'` to the `AppSheet` union), or a dedicated
  full-screen component if the first-run canvas needs it. Mobile-first, dismiss on
  backdrop + explicit CTA, safe-area aware.
- **Vocabulary:** "perpetual futures", not "perps".
- Optional analytics hooks: `shown`, `step_view`, `skipped`, `completed`.

## Modal 1 — Welcome (first app open)

**Trigger:** first mount in `apps/mobile/src/routes/+layout.svelte` when
`welcome.v1 !== "seen"`. Two steps.

### Step 1 — hook

> ### Follow the smart money. Get convicted trades.
> Swash tracks the traders who keep winning on Hyperliquid — where they're long,
> where they're short, and where their conviction is strongest right now.
>
> `[Show me]` · `Skip`

### Step 2 — perpetual futures, straight

> ### Perpetual futures in ten seconds.
> A perpetual future is a position on where a price goes — up or down. You never
> hold the coin, just the outcome.
>
> The outcome cuts both ways. Swash puts your risk in plain numbers **before** you
> commit — what you're in for, what you'd lose, where you'd get out.
>
> `[Got it]` · `Tell me more ▾`

**Expansion ("Tell me more", progressive disclosure):**

> Leverage multiplies a position beyond your balance — gains and losses alike, and
> losses end fast. Swash always shows what a move costs you before you make it.

## Modal 2 — Vault intro (first `/vaults` visit)

**Trigger:** mount of `apps/mobile/src/routes/vaults/+page.svelte` when
`vaults.v1 !== "seen"`. Single screen. No fee copy (intentionally omitted).

> ### Their conviction. Your position.
> Put USDC in a Conviction Vault and it holds what the top traders are betting on
> for this asset — sized to how sure they are, adjusting when they move.
>
> **1×, no leverage** — none of the liquidation roulette of leveraged perpetual
> futures. But it's a live position, not a savings account: when the smart money is
> right you gain, when they're wrong you lose. Real edge, real risk.
>
> In and out whenever you want.
>
> `[Got it]` · `How it works →`

`How it works →` links to the detailed vault explainer (methodology page or a
dedicated sheet) — out of scope here.

## Explicitly out of scope

- **Beginner ⇄ Pro** is NOT part of these modals and NOT app-wide. It exists only
  as a toggle **inside the asset-page trading frame** (`assets/[coin]`), persisted
  separately (e.g. `swash.trade.mode`, default Beginner: long/short + amount +
  plain "Max loss: $X"; Pro: full controls). Own spec when the trading frame lands.
- Fee display in the vault modal (decided against).
- Tap-to-explain tooltips / empty-state education (follow-on layer; same style rule).
