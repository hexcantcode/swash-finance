/*
 * Thin client wrapper around apps/web's `/api/*` endpoints. Mobile is a pure
 * view layer — it never talks to the database directly. Every data shape
 * here mirrors what those endpoints return; if the API contract changes,
 * the mismatch surfaces as a runtime parse failure here, not as silently
 * wrong UI deeper in the app.
 *
 * In dev the Vite proxy forwards /api → http://localhost:5173. In Capacitor
 * the build sets PUBLIC_API_BASE to the deployed apps/web URL so the same
 * paths resolve cross-origin.
 */

import { env } from '$env/dynamic/public';

const API_BASE = (env['PUBLIC_API_BASE'] ?? '').replace(/\/$/, '');

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Resolve an API path to a full URL — same-origin in dev/PWA, PUBLIC_API_BASE
 *  cross-origin in the Capacitor build. Used for both `fetch` and `EventSource`. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed: ${res.status}`, res.status);
  }
  const body = (await res.json()) as unknown;
  return body as T;
}
