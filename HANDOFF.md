# Handoff — resume after reboot

## Why we rebooted

Local outbound **TCP port 5432 was being silently dropped** by an orphaned NordVPN NetworkExtension kernel filter. Symptoms:

- `nc -zv 1.1.1.1 5432` and `nc -zv <neon-host> 5432` both timed out (drop, not refuse)
- `nc -zv <neon-host> 443` worked fine
- NordVPN GUI was closed; helper daemon `com.nordvpn.macos.helper` was already unloaded via `sudo launchctl bootout system/com.nordvpn.macos.helper`
- macOS Application Firewall is off
- Filter persisted in the kernel because the helper was killed instead of exiting gracefully — only a reboot (or full NordVPN uninstall) clears it

Decision: **reboot to clear the filter, keep `pg` driver everywhere** (Railway has no such block, so the WebSocket-over-443 workaround is unnecessary in production).

## First steps in the new session

1. Confirm 5432 is unblocked:
   ```bash
   nc -zv 1.1.1.1 5432           # should connect or RST immediately, NOT time out
   nc -zv ep-square-cherry-aptarteu-pooler.c-7.us-east-1.aws.neon.tech 5432
   ```
   If still blocked → NordVPN wasn't the only thing; investigate `pfctl -s rules` and any other NetworkExtensions.

2. Bring everything up locally for real WS-fed data:
   ```bash
   pnpm dev                          # web on :5173
   # in separate terminals (or background), the workers from apps/worker
   ```
   Verify `/` (leaderboard), `/traders`, `/analytics` render with live data and the ticker pulses.

## State of the repo

- Branch: `main`, clean working tree (only untracked items are one-off exploratory scripts in `apps/worker/src/scripts/`)
- Recent commits land the RAMS a11y pass, directional rings on analytics tables, per-round-trip win rate, session-window ticker aggregation, Most-Held panel, Holdings column on /traders
- DB migration drift warning in `CLAUDE.md` still applies — **do not** run `db:migrate` / `db:generate` / `db:push` from `main`

## What's pending after local works

- Railway deployment (the user wants this *after* local verification, not before)
- Eventually merge `data-sources` → `main` to resolve the migration drift documented at the top of `CLAUDE.md`

## Do NOT do

- Don't re-add wallet addresses to /traders rows or the ticker — exclusion was deliberate; use `aria-label="View trader profile"` instead
- Don't switch the DB driver to `@neondatabase/serverless` — the reboot fixes the underlying issue; the swap would only have been a workaround
- Don't create a tunnel or public URL — user wants local-only
