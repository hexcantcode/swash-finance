import { runBootstrap } from './jobs/bootstrap.js';
import { runLeaderboardIngest } from './jobs/leaderboard-ingest.js';
import { runRefreshQueue } from './jobs/refresh-queue.js';
import { runScoreRecompute } from './jobs/score.js';
import { runTradesSubscriber } from './jobs/trades-subscriber.js';
import { ingestWallet } from './services/ingest-wallet.js';
import { closeDb } from './db.js';
import { log } from './log.js';

const COMMANDS = {
  bootstrap: 'Run a one-shot WS discovery sweep and queue every observed wallet.',
  leaderboard:
    'Fetch HL official leaderboard, persist tier-1 wallets, queue top-N for deep ingest.',
  'trades-watch': 'Long-running WS subscriber: upserts tier-1 wallet rows for every fill.',
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
    case 'trades-watch': {
      const topCoins = flags['coins'] ? Number.parseInt(flags['coins'], 10) : undefined;
      await runTradesSubscriber(topCoins !== undefined ? { topCoins } : {});
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
