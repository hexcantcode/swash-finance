import { json } from '@sveltejs/kit';
import { getCohortSentiment } from '$lib/server/queries/cohort-sentiment';
import type { RequestHandler } from './$types';

/**
 * Sentiment data for the feed's Sentiment tab. `cohorts` is each realized-PnL
 * tier's overall bias (the cohort table); `sentiment` is the Extremely Profitable
 * cohort's long/short positioning by market (the notional bars). Backed by
 * Hyperdash's perpsMarketParticipation (cached 60 s server-side), so client
 * polling just reflects that cadence. `sentiment` is null when upstream is
 * unavailable; `cohorts` is then empty.
 */
export const GET: RequestHandler = async () => {
  const { cohorts, sentiment } = await getCohortSentiment();
  return json({ ok: true, cohorts, sentiment });
};
