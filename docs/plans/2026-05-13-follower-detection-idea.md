# Idea — Follower-count via execution pattern matching

**Date raised:** 2026-05-13
**Status:** Parked, not designed.

## The idea (user, paraphrased)

We can infer *how many wallets are copying a given trader* by looking at the fill history. If wallet B's trades consistently execute on the same coins, in the same direction, shortly after wallet A's trades — B is probably copying A. Aggregate that signal across the trader population and we get an *implicit follower count* per wallet, without ever needing the followers to opt in.

## Why it's interesting

- A first-class **proof point** on the trader card: "*42 copiers*" is the social-proof signal that drives the copy-trade product.
- Independent of our own product's adoption — we can show "people on HL are already mirroring this wallet" before Swash itself has users.
- Cheap signal once we have fills: it's an offline join on data we're already ingesting.

## How it could work — first sketch

For each candidate leader `L`:

1. Walk `fills` over a 30d window for `L`. For each fill `(t_L, coin_L, side_L, sz_L)`, look at all *other* wallets' fills in `[t_L, t_L + 60s]` on the same `(coin, side)`.
2. A wallet `F` is a "candidate follower" of `L` if a meaningful share of `L`'s fills are matched by an `F` fill within the window (e.g. `≥50%` of `L`'s last-30d fills have an `F` echo within 60s, same direction, smaller or proportional size).
3. Filter `F`s: must NOT be `L`'s own agent (we already track `wallets.master_address`); must not be a known MM/HFT (their fills hit everyone). Use a Bonferroni-style adjustment for how many leaders any `F` looks like a copier of — true copiers tail a few traders, MMs tail everyone.
4. Output: `wallets.follower_count_30d` (display) + `wallets.follower_addresses_30d` (jsonb, top-N) for the trader page.

## Hard parts to think through

- **What window?** Sub-second is true bots and our own follower product (later). 30-60s is the realistic latency for retail copy via a UI / bot watching `userFills`. ≥5min starts catching coincidence trades.
- **Size matching.** Copiers size down. Proportional (same `sz_F / equity_F ≈ sz_L / equity_L`) is the real signal; absolute size is too noisy.
- **Multi-leader copiers.** A wallet that copies 3 traders should count as 1 follower for each, not be filtered as noise.
- **Backfill vs streaming.** Once we have the offline computation, the WS subscriber could maintain the signal incrementally (each new fill on `L` increments a temp set; matched fills within the window increment counters).
- **Data scope.** We see fills for the wallets we ingest. To see "people copying Loracle" we need to be ingesting those copiers' fills too — they may not be in our wallet set yet. So the discovery loop matters: when we see a wallet that echoes a top-N leader's fills, we should ingest that wallet too (creates a virtuous cycle for the follower-count signal).

## Next step when we pick this up

Read [[product-model]] first. Brainstorm the precise definition of "follow" (exact window / size-ratio / per-coin overlap thresholds) before writing code. Calibration: compute the signal on a handful of well-known KOL wallets and sanity-check the count against what we'd expect from their public following.

## Related

- [[product-model]] — copy-trade product is the user-facing surface; this is the social-proof number that goes on the trader card.
- The `ws-live-subscriber` already streams `userFills` for the 10 winners; the same firehose is the input to this analysis.
- This is a discovery signal too: an "unknown wallet that echoes 3 top leaders' fills" is itself a candidate to ingest and score.
