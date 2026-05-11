import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  HL_API_URL: z.string().url().default('https://api.hyperliquid.xyz'),
  HL_WS_URL: z.string().url().default('wss://api.hyperliquid.xyz/ws'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  WORKER_REGION: z.string().default('local'),
  HL_REST_WEIGHT_BUDGET_PER_MIN: z.coerce.number().int().positive().default(800),
  BOOTSTRAP_SWEEP_SECONDS: z.coerce.number().int().positive().default(120),
  BOOTSTRAP_SWEEP_TOP_COINS: z.coerce.number().int().positive().default(20),
  HL_CACHE_DIR: z.string().default('.cache/hl'),
  HL_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;
export function env(): Env {
  if (_env) return _env;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid worker env: ${parsed.error.toString()}`);
  }
  _env = parsed.data;
  return _env;
}

export function cacheDir(): string {
  const e = env();
  return resolve(__dirname, '../', e.HL_CACHE_DIR);
}
