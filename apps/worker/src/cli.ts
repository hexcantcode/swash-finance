import { runBootstrap } from './jobs/bootstrap.js';
import { runHyperdashIngest } from './jobs/hyperdash-ingest.js';
import { runLeaderCachePoll } from './jobs/leader-cache-poll.js';
import { runLeaderboardIngest } from './jobs/leaderboard-ingest.js';
import { runLeaderboardPoll } from './jobs/leaderboard-poll.js';
import { runRefreshQueue } from './jobs/refresh-queue.js';
import { runScoreRecompute } from './jobs/score.js';
import { runFillsRetention } from './jobs/fills-retention.js';
import { runHip3PollSubscriber } from './jobs/hip3-poll-subscriber.js';
import { runTradesCoinSubscriber } from './jobs/trades-coin-subscriber.js';
import { runTradesSubscriber } from './jobs/trades-subscriber.js';
import { runWsLiveSubscriber } from './jobs/ws-live-subscriber.js';
import { ingestWallet } from './services/ingest-wallet.js';
import { closeDb } from './db.js';
import { log } from './log.js';

const COMMANDS = {
  bootstrap: 'Run a one-shot WS discovery sweep and queue every observed wallet.',
  leaderboard:
    'Fetch HL official leaderboard, persist tier-1 wallets, queue top-N for deep ingest.',
  'leaderboard-poll':
    'Poll HL leaderboard for top-7d-ROI + top trader-rankers, queue them as curation candidates.',
  hyperdash:
    "Fetch Hyperdash's curated copytraders group, mark them source='hyperdash', and queue for deep ingest (primary roster).",
  'trades-watch': 'Long-running WS subscriber: upserts tier-1 wallet rows for every fill.',
  'trades-coin-live':
    'Long-running per-coin WS firehose: filters every fill against the wallets table and writes matched fills + advances leader_cache.last_trade_ms.',
  'hip3-poll-live':
    'Long-running REST poller for HIP-3 builder dex positions (every 5 min). Companion to trades-coin-live which only covers main-dex perps.',
  'fills-retention':
    'One-shot: trim fills > FILLS_RETENTION_DAYS (default 90) for wallets where history_deepened_at IS NULL. The cron worker runs this nightly at 02:30 UTC; use this CLI for manual / ad-hoc trims.',
  'ws-live':
    'Long-running per-user WS subscriber for curated wallets (live cache + history). --reconcile=<seconds>. NOTE: blocked by HL 10-user/IP cap — use trades-coin-live instead.',
  'leader-cache-poll':
    'Long-running REST poller: refreshes leader_cache positions for top-250 tracked wallets every --poll=<seconds> (default 60).',
  'refresh-queue': 'Process the next batch of wallets in discovery_queue.',
  score: 'Recompute scores for every active master wallet (or one with --address).',
  'refresh-leader': 'Fetch fresh fills/agents for a single address (--address required).',
  help: 'Show this help.',
} as const;

type Command = keyof typeof COMMANDS;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help') {
    printHelp();
    return;
  }
  if (!isCommand(command)) {
    log.error({ command }, 'unknown command');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const flags = parseFlags(rest);

  switch (command) {
    case 'bootstrap':
      await runBootstrap();
      break;
    case 'leaderboard': {
      const topPersist = flags['top-persist'] ? Number.parseInt(flags['top-persist'], 10) : undefined;
      const topQueue = flags['top-queue']
        ? Number.parseInt(flags['top-queue'], 10)
        : flags['top']
          ? Number.parseInt(flags['top'], 10)
          : undefined;
      const minVol = flags['min-vol'] ? Number.parseInt(flags['min-vol'], 10) : undefined;
      const minAcct = flags['min-acct'] ? Number.parseInt(flags['min-acct'], 10) : undefined;
      const winRaw = flags['window'];
      const win =
        winRaw === 'day' || winRaw === 'week' || winRaw === 'month' || winRaw === 'allTime'
          ? winRaw
          : undefined;
      await runLeaderboardIngest({
        ...(topPersist !== undefined ? { topPersist } : {}),
        ...(topQueue !== undefined ? { topQueue } : {}),
        ...(minVol !== undefined ? { minMonthlyVolumeUsd: minVol } : {}),
        ...(minAcct !== undefined ? { minAccountValueUsd: minAcct } : {}),
        ...(win !== undefined ? { window: win } : {}),
      });
      break;
    }
    case 'hyperdash': {
      const groupId = flags['group'];
      await runHyperdashIngest({
        ...(groupId !== undefined ? { groupId } : {}),
        ...(flags['include-all'] ? { includeNonCopyEnabled: true } : {}),
      });
      break;
    }
    case 'leaderboard-poll': {
      const topRoi = flags['top-roi'] ? Number.parseInt(flags['top-roi'], 10) : undefined;
      const topRankers = flags['top-rankers']
        ? Number.parseInt(flags['top-rankers'], 10)
        : undefined;
      await runLeaderboardPoll({
        ...(topRoi !== undefined ? { topRoi } : {}),
        ...(topRankers !== undefined ? { topRankers } : {}),
      });
      break;
    }
    case 'trades-watch': {
      const topCoins = flags['coins'] ? Number.parseInt(flags['coins'], 10) : undefined;
      await runTradesSubscriber(topCoins !== undefined ? { topCoins } : {});
      break;
    }
    case 'trades-coin-live': {
      await runTradesCoinSubscriber();
      break;
    }
    case 'hip3-poll-live': {
      await runHip3PollSubscriber();
      break;
    }
    case 'fills-retention': {
      await runFillsRetention();
      break;
    }
    case 'ws-live': {
      const reconcileSeconds = flags['reconcile']
        ? Number.parseInt(flags['reconcile'], 10)
        : undefined;
      await runWsLiveSubscriber(reconcileSeconds !== undefined ? { reconcileSeconds } : {});
      break;
    }
    case 'leader-cache-poll': {
      const pollSeconds = flags['poll']
        ? Number.parseInt(flags['poll'], 10)
        : undefined;
      await runLeaderCachePoll(pollSeconds !== undefined ? { pollSeconds } : {});
      break;
    }
    case 'refresh-queue':
      await runRefreshQueue();
      break;
    case 'score': {
      const onlyAddress = flags['address'];
      await runScoreRecompute(onlyAddress !== undefined ? { onlyAddress } : {});
      break;
    }
    case 'refresh-leader': {
      const address = flags['address'];
      if (!address) {
        log.error('refresh-leader requires --address=0x…');
        process.exitCode = 1;
        return;
      }
      await ingestWallet(address);
      break;
    }
    case 'help':
      printHelp();
      break;
  }
}

function isCommand(value: string): value is Command {
  return Object.prototype.hasOwnProperty.call(COMMANDS, value);
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) {
        out[arg.slice(2)] = 'true';
      } else {
        out[arg.slice(2, eq)] = arg.slice(eq + 1);
      }
    }
  }
  return out;
}

function printHelp(): void {
  console.log('usage: pnpm worker:run <command> [--flags]');
  for (const [k, v] of Object.entries(COMMANDS)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
}

main()
  .catch((err: unknown) => {
    log.error({ err: err instanceof Error ? err.stack : err }, 'cli.fatal');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
