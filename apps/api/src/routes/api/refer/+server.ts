import { error, json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { discoveryQueue, wallets } from '@copytrade/db';
import { tryNormalizeAddress } from '@copytrade/shared';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Social-referral hook. Any address can be promoted into the deep-ingest
 * pipeline without needing to be on HL's leaderboard or to have traded in
 * our WS sweep window. This is the path for the "trader asks a friend to
 * copy me" flow: the friend pastes their address, we queue it, J-5 picks
 * it up on the next refresh tick.
 *
 *   POST /api/refer
 *   Body: { address: "0x..." }
 *
 * Always returns 202; the actual ingest happens async on the worker.
 */
const BodySchema = z.object({
  address: z.string(),
});

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid json body');
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, parsed.error.message);
  }
  const address = tryNormalizeAddress(parsed.data.address);
  if (!address) {
    throw error(400, 'invalid Ethereum address');
  }

  const now = new Date();

  // Tier-1 row if missing. We don't have HL metrics here — those'll fill in
  // on the next leaderboard ingest if the address is eligible, or stay null.
  await db()
    .insert(wallets)
    .values({
      address,
      firstSeenAt: now,
      lastSeenAt: now,
      ingestState: 'queued',
    })
    .onConflictDoNothing({ target: wallets.address });

  // Push into the discovery queue. ON CONFLICT DO NOTHING keeps the row
  // unique; already-queued addresses are no-op.
  const queued = await db()
    .insert(discoveryQueue)
    .values({ address, source: 'referral' })
    .onConflictDoNothing({ target: discoveryQueue.address })
    .returning({ address: discoveryQueue.address });

  // Bump state from 'observed' to 'queued' if it was lower.
  await db().execute(sql`
    update wallets set ingest_state = 'queued'
    where address = ${address} and ingest_state = 'observed'
  `);

  return json(
    {
      ok: true,
      data: {
        address,
        queued: queued.length > 0,
      },
    },
    { status: 202 },
  );
};
