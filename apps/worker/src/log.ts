import { pino } from 'pino';
import { env } from './env.js';

const dev = process.env['NODE_ENV'] !== 'production';

export const log = pino({
  level: env().LOG_LEVEL,
  base: { region: env().WORKER_REGION },
  ...(dev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,region' },
        },
      }
    : {}),
});

export type Logger = typeof log;
