import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Liveness probe for Railway's healthcheck. Dependency-free on purpose — it must
 * not touch the DB or any upstream (Hyperdash/HL), so an upstream blip never
 * marks the service unhealthy and triggers a restart loop. Replaced the old
 * `/api/stats` healthcheck, which was removed with the DB pipeline.
 */
export const GET: RequestHandler = () => json({ ok: true });
