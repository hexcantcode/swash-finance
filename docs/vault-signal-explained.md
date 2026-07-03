# How a Conviction Vault decides — the signal, explained plainly

*The non-technical companion to `docs/plans/2026-07-01-conviction-vault-master-plan.md`.
The implementation lives in `backtest/forward_test.py`; the vault detail page's
"Who's driving it" ranking mirrors the same weighting.*

## The vault is a voting room

Every 30 minutes, we look at one market — say BTC — and ask every trader in our
Extremely Profitable cohort who has a position there: **"long or short?"** Each
trader casts a vote, and the vault holds whatever the room decides, sized by how
lopsided the vote was. Unanimous room → full position. Split room → small
position or cash.

The entire design question is: **how loud is each trader's voice?**

## What makes a voice louder

**1. Track record — the main thing.**
Every trader has a skill score. A trader with a great score doesn't just get a
slightly louder voice — we make skill count *disproportionately*: someone twice
as skilled speaks four times as loud. Mediocre traders fade to background noise;
the vault mostly listens to its best people.

**2. How much of their own money is behind it — the tiebreaker.**
A trader who bets their whole account on a view believes it more than one
dabbling with 5% — so we let that raise their voice, but only a little. Going
from a normal bet to an absolutely-maxed-out bet makes you less than twice as
loud. (An earlier version made it *five times* louder — which meant one reckless
whale could out-shout ten skilled traders. We flipped it: **skill first, bet
size second.**)

## The two honesty rules

**Rule 1: a new trader's score can't be trusted yet — but zero isn't fair either.**
Our strict skill score refuses to call anyone "skilled" until it has months of
evidence — statistically correct, but early on it scores almost everyone zero,
and then the "listen to skill" idea backfires: whoever is a hair above zero owns
the room. (Observed in practice: a BTC "99% short" that was, underneath, **one
wallet holding 92% of the vote**.) The fix is common sense: while a trader's
history with us is thin, lean on their reputation coming in; as we watch them
longer, shift smoothly to what *we've* measured. No cliff, no code change
later — trust just migrates with evidence.

**Rule 2: count voices, not heads.**
Seventeen traders in the room sounds like consensus. But if one of them has 92%
of the speaking time, it's really a one-man show with sixteen spectators. So
before the vault acts, we measure the *effective* number of voices — how spread
the speaking time actually is — and if it's fewer than three real voices, **the
vault sits in cash**. No trade gets to masquerade as "the smart money agrees"
when it's one guy's opinion.

## What it looked like on BTC, concretely (2026-07-03 calibration)

- **Before:** "17 traders, 99% short" — really one whale shouting (1.4 effective
  voices, top wallet 83–92% of the vote).
- **After both fixes:** 28 traders voting, about **7–8 genuinely distinct
  voices**, best-scored traders loudest, and the verdict softened to a
  *moderate* short — because our single best long (a high-scored trader with
  real money behind it) was actually heard pulling the other way.

**The whole formula in one sentence:** let the most proven traders speak
loudest, let bet size add emphasis but never dominance, and refuse to act unless
several real voices agree.

---

## Appendix — story → math

For each trader *i* with a position in the market:

| In the story | In the formula |
|---|---|
| Vote | direction `dᵢ = +1` (long) / `−1` (short) |
| Skill counts disproportionately | `q_effᵢ²` |
| Bet size adds emphasis, not dominance | `√convᵢ`, where `convᵢ = min(notional/equity, 3)` |
| Voice loudness | `wᵢ = q_effᵢ² · √convᵢ` |
| The room's verdict | `s = Σ wᵢdᵢ / Σ wᵢ` ∈ [−1, +1] |
| Trust migrates with evidence | `q_effᵢ = λᵢ·DSRᵢ + (1−λᵢ)·priorᵢ`, `λᵢ = n_obsᵢ / (n_obsᵢ + 180)` — prior = roster copyScore/100; DSR = the vault-grade deflated-Sharpe score (`backtest/quality_score.py`) |
| Count voices, not heads | `n_eff = (Σwᵢ)² / Σwᵢ²`; actionable only if `n_eff ≥ 3` |
| Split room → cash | deadzone: FLAT while `|s| < 0.08` (hysteresis 0.08/0.12) |

The vault then holds `s × NAV` of the asset at 1× leverage (long or short), so a
`s = −0.40` verdict means 40% of the vault short, the rest in cash.
