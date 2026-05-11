import { createDb, type Db } from '@copytrade/db';
import pg from 'pg';
import { env } from './env.js';

let _db: Db | null = null;
let _pool: pg.Pool | null = null;

export function db(): Db {
  if (_db) return _db;
  const created = createDb({ url: env().DATABASE_URL, max: 5 });
  _db = created.db;
  _pool = created.pool;
  return _db;
}

export function pool(): pg.Pool {
  if (!_pool) db();
  if (!_pool) throw new Error('pool unavailable');
  return _pool;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

/**
 * Fold a string into a 32-bit integer via FNV-1a; pg advisory locks accept
 * a `bigint` keyspace, so we sign-extend safely.
 */
function lockKey(name: string): bigint {
  let hash = 2166136261n;
  for (let i = 0; i < name.length; i++) {
    hash ^= BigInt(name.charCodeAt(i));
    hash = (hash * 16777619n) & 0xffffffffn;
  }
  return BigInt.asIntN(64, hash);
}

/**
 * Acquire a postgres advisory lock for the duration of `fn`. If the lock is
 * already held, returns null (work should be skipped).
 */
export async function withAdvisoryLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const client = await pool().connect();
  const key = lockKey(name);
  try {
    const res = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock($1) as acquired',
      [key.toString()],
    );
    if (res.rows[0]?.acquired !== true) {
      return null;
    }
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [key.toString()]);
    }
  } finally {
    client.release();
  }
}
