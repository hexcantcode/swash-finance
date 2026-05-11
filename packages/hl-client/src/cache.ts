import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

interface CacheEnvelope<T> {
  v: 1;
  storedAt: number;
  data: T;
}

export class FileCache {
  private readonly baseDir: string | null;

  constructor(baseDir: string | null) {
    this.baseDir = baseDir;
  }

  isEnabled(): boolean {
    return this.baseDir !== null;
  }

  private resolveKeyPath(key: string): string {
    if (!this.baseDir) throw new Error('FileCache disabled');
    const safe = createHash('sha256').update(key).digest('hex').slice(0, 24);
    const bucket = safe.slice(0, 2);
    return resolve(this.baseDir, bucket, `${safe}.json`);
  }

  async get<T>(key: string, ttlSeconds: number): Promise<T | null> {
    if (!this.baseDir) return null;
    const path = this.resolveKeyPath(key);
    try {
      const stats = await stat(path);
      const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
      if (ageSeconds > ttlSeconds) return null;
      const raw = await readFile(path, 'utf8');
      const env = JSON.parse(raw) as CacheEnvelope<T>;
      return env.data;
    } catch (err: unknown) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  async set<T>(key: string, data: T): Promise<void> {
    if (!this.baseDir) return;
    const path = this.resolveKeyPath(key);
    await mkdir(dirname(path), { recursive: true });
    const env: CacheEnvelope<T> = { v: 1, storedAt: Date.now(), data };
    await writeFile(path, JSON.stringify(env), 'utf8');
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
