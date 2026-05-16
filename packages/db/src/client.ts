import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import pg from 'pg';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as schema from './schema.js';

// WS-on-443 fallback for local dev when outbound TCP/5432 is filtered.
// Enable with DB_OVER_WS=1. Railway keeps the default pg/TCP path.
// Read lazily inside createDb so dotenv (loaded by worker/web before first DB
// call but after this module is imported) can populate it in time.
function shouldUseWs(): boolean {
  const v = process.env['DB_OVER_WS'];
  return v === '1' || v === 'true';
}

let _pool: pg.Pool | NeonPool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

export type Db = NodePgDatabase<typeof schema>;

export interface DbConfig {
  url: string;
  max?: number;
  idleTimeoutMillis?: number;
}

export function createDb(config: DbConfig): { db: Db; pool: pg.Pool | NeonPool } {
  if (shouldUseWs()) {
    neonConfig.webSocketConstructor = ws;
    const pool = new NeonPool({
      connectionString: config.url,
      max: config.max ?? 10,
      idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    });
    pool.on('error', (err: Error) => {
      console.error('[db] idle pool client error (recovering):', err.message);
    });
    const db = drizzleNeon(pool, { schema, casing: 'snake_case' }) as unknown as Db;
    return { db, pool };
  }
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    ssl: config.url.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  // Without an 'error' listener, an idle client that drops (network blip,
  // laptop sleep/wake, DB restart) emits an unhandled 'error' that crashes the
  // whole process. Swallow it — the pool discards the bad client and reconnects
  // on the next query.
  pool.on('error', (err) => {
    console.error('[db] idle pool client error (recovering):', err.message);
  });
  const db = drizzlePg(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}

export function getDefaultDb(): Db {
  if (_db && _pool) return _db;
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL must be set');
  }
  const { db, pool } = createDb({ url });
  _db = db;
  _pool = pool;
  return db;
}

export async function closeDefaultDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}
