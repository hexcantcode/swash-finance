import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadEnv({ path: resolve(__dirname, '../../../.env') });


import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL must be set');

  const pool = new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  const db = drizzle(pool);

  const start = Date.now();
  console.log('[migrate] applying migrations from ./migrations');
  await migrate(db, { migrationsFolder: './migrations' });
  console.log(`[migrate] done in ${Date.now() - start}ms`);

  await pool.end();
}

main().catch((err: unknown) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
