import { runCohortSnapshot } from './jobs/cohort-snapshot.js';
import { closeDb } from './db.js';
import { log } from './log.js';

const COMMANDS = {
  'cohort-snapshot':
    'One-shot: snapshot Hyperdash cohort sentiment (per-cohort long/short aggregate) into cohort_sentiment_history. The cron worker runs this every 5 min; use this CLI for manual/ad-hoc captures.',
  help: 'Show this help.',
} as const;

type Command = keyof typeof COMMANDS;

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
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

  switch (command) {
    case 'cohort-snapshot': {
      await runCohortSnapshot();
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

function printHelp(): void {
  console.log('usage: pnpm worker:run <command>');
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
