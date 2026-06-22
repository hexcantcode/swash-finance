import { json } from '@sveltejs/kit';
import { getCohortSentiment } from '$lib/server/queries/cohort-sentiment';
import type { RequestHandler } from './$types';

/**
 * PnL-cohort sentiment for the top of the feed's Sentiment tab — each realized-
 * PnL band's net long/short bias. Backed by Hyperdash's CohortSummary (cached
 * 60 s server-side), so client polling just reflects that cadence.
 */
export const GET: RequestHandler = async () => {
  const cohorts = await getCohortSentiment();
  return json({ ok: true, cohorts });
};
