import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

let _pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

export type Db = NodePgDatabase<typeof schema>;

export interface DbConfig {
  url: string;
  max?: number;
  idleTimeoutMillis?: number;
}

export function createDb(config: DbConfig): { db: Db; pool: pg.Pool } {
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
  const db = drizzle(pool, { schema, casing: 'snake_case' });
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
