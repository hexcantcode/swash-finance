/**
 * PM2 process definitions for running the full Swash stack locally.
 *
 *   pnpm stack:start    # boot all six processes
 *   pnpm stack:logs     # tail logs from every process
 *   pnpm stack:status   # see what's running
 *   pnpm stack:stop     # bring everything down
 *
 * Each process auto-restarts on crash. Logs land in `./logs/<name>.log`.
 *
 * Hosted later (Railway / Fly / VPS) — reuse this same file; PM2 runs in
 * the same shape there. For Railway specifically you'd typically split into
 * one service per process (each picks the right `args` from this file).
 */
module.exports = {
  apps: [
    {
      name: 'api',
      script: 'pnpm',
      args: '--filter @copytrade/api dev',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      out_file: './logs/api.log',
      error_file: './logs/api.log',
      merge_logs: true,
    },
    {
      // Scheduled crons: score (02:00 UTC daily), leaderboard-poll (every
      // 15m), refresh-queue (every 30s), fills-retention (02:30 UTC daily).
      // Holds an advisory lock per job so duplicates can't run.
      name: 'worker-cron',
      script: 'pnpm',
      args: '--filter @copytrade/worker start',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      out_file: './logs/worker-cron.log',
      error_file: './logs/worker-cron.log',
      merge_logs: true,
    },
    {
      // Live equity / positions refresh for the tracked cohort. 60s cycle,
      // weight ~138/min HL = ~11% of budget. Also writes
      // wallets.last_below_floor_at via gate-reconcile when equity drops.
      name: 'leader-cache-poll',
      script: 'pnpm',
      args: '--filter @copytrade/worker leader-cache-poll',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      out_file: './logs/leader-cache-poll.log',
      error_file: './logs/leader-cache-poll.log',
      merge_logs: true,
    },
    {
      // Per-user WS subscriptions for the cohort — userFills, userFundings,
      // userLedger, webData2. Primary feed for the `fills` table that the
      // scoring job reads. Without this, score job can't recompute (see
      // 2026-05-18 freshness diagnosis).
      name: 'ws-live',
      script: 'pnpm',
      args: '--filter @copytrade/worker ws-live',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      out_file: './logs/ws-live.log',
      error_file: './logs/ws-live.log',
      merge_logs: true,
    },
    {
      // Per-coin firehose — listens to a coin's `trades` stream and writes
      // any tracked-wallet fills it sees. Backup ingest path; matters for
      // wallets whose ws-live subscription drops or for the trade ticker.
      name: 'trades-coin-live',
      script: 'pnpm',
      args: '--filter @copytrade/worker trades-coin-live',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      out_file: './logs/trades-coin-live.log',
      error_file: './logs/trades-coin-live.log',
      merge_logs: true,
    },
    {
      // HIP-3 position poller. clearinghouseState doesn't return HIP-3 entries
      // on the main dex; this fills in those open positions so trader pages
      // and Holdings columns show the right notional for HIP-3 holders.
      name: 'hip3-poll-live',
      script: 'pnpm',
      args: '--filter @copytrade/worker hip3-poll-live',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      out_file: './logs/hip3-poll-live.log',
      error_file: './logs/hip3-poll-live.log',
      merge_logs: true,
    },
  ],
};
