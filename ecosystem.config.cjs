/**
 * PM2 process definitions for running the full Swash stack locally.
 *
 *   pnpm stack:start    # boot the api + worker-cron processes
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
      // Scheduled cron: cohort-snapshot (every 5 min) — snapshots Hyperdash
      // cohort sentiment into cohort_sentiment_history. Holds an advisory lock
      // so duplicates can't run.
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
  ],
};
