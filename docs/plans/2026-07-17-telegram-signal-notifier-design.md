# Telegram signal notifier — design

**Date:** 2026-07-17 · **Status:** approved (channel broadcast, call-changes only, site universe, in-loop)

Broadcast vault call changes to a Telegram channel, straight from the
`vault-snapshots` Railway loop.

## Decisions (locked with product)

1. **Broadcast channel**, not per-user bot — no subscriber DB, no command surface.
2. **Call transitions only**: FLAT→LONG/SHORT, direction flips, LONG/SHORT→FLAT.
   No resize or tick-digest messages.
3. **Site universe**: Lighter-listed vaults minus the site's hidden symbols —
   every alert links to `https://www.cream.run/vaults/{TICKER}`.
4. **Runs in the loop**: `notify_telegram.py` appended after `compute_nav.py` in
   the Dockerfile CMD. No new service.

## Mechanics

- State in Postgres: `tg_notify_state(coin PK, actionable, s, ts)` — the last
  *notified* call per coin. Ephemeral container FS is never used.
- Each run: latest tick per coin from `signal_track` (+ longs/shorts from
  `positions` at the same ts) → diff `actionable` vs state → send one message
  per change → upsert state. Send failure = no state update = retry next tick.
- **First run seeds silently** (empty state table → record everything, send
  nothing) so launch doesn't blast the full book.
- Telegram via plain Bot API `sendMessage` (stdlib urllib, HTML parse mode,
  no link previews). ~0.5s pause between sends; irrelevant at our volume.
- Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (channel @handle or -100 id;
  bot must be channel admin). Missing → log + exit 0, pipeline unaffected.
  `TELEGRAM_DRY_RUN=1` prints messages instead of sending (used in testing).

## Message format (approved)

🔴 **INTC vault → SHORT** — position 69% of NAV, "was in cash" / "was 10%
long" / flip marker ⚡, pros behind it with long/short split, link to the
vault page. 🟢 long / 🔴 short / ⚪ cash. Paper caveat lives in the channel
description, not per-message.

## Sync note

The universe set inside `notify_telegram.py` is copied from cream's
`src/lib/smartmoney/coin.ts` (`LIGHTER_HL_COINS` minus `HIDDEN_SYMBOLS`) with
the ticker map for URLs — regenerate when the asset map changes (script in
the file header).
