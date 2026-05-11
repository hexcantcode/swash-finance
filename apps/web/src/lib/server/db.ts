import { createDb, type Db } from '@copytrade/db';
import { env } from '$env/dynamic/private';

let _db: Db | null = null;

export function db(): Db {
  if (_db) return _db;
  const url = env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL must be set');
  }
  _db = createDb({ url, max: 5 }).db;
  return _db;
}
