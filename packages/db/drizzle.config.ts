import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit transpiles this file to CJS, so import.meta is unavailable.
// `pnpm generate` runs from packages/db; .env lives two levels up.
loadEnv({ path: resolve(process.cwd(), '../../.env') });

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL must be set to generate migrations.');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
