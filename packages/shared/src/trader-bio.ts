/*
 * Plain-language trader insight — the one canonical composer that turns
 * classifier output (archetype / size / heat / decay) plus a couple of
 * scoring facts into a one-line bio a non-financial user can read, and the
 * explainer copy behind each trait chip.
 *
 * Deterministic templates only — no randomness, no model calls. Missing
 * inputs drop their clause; the worst case is the archetype sentence alone,
 * and with no archetype there is no bio at all (callers hide the line).
 *
 * Design: docs/plans/2026-06-10-trader-traits-insight-design.md
 */

import type { DecayFlag, HeatTag, ProfileTag, SizeTag } from './types.js';

export interface TraderBioInput {
  profile?: ProfileTag | null;
  size?: SizeTag | null;
  heat?: HeatTag | null;
  decay?: DecayFlag | null;
  avgHoldSeconds?: number | null;
  /** Display-ready dominant market, e.g. "stocks", "BTC & majors". The
   *  caller derives this from `primary_asset_breakdown`. */
  market?: string | null;
}

/** Archetype lead phrases. Rising Star keeps its name by design. */
const PROFILE_LEADS: Record<ProfileTag, string> = {
  alpha: 'Makes rare, precise bets',
  veteran: 'Battle-tested',
  rising_star: 'Rising star with strong recent form',
  specialist: 'Lives in one market',
  allrounder: 'Steady, diversified trader',
};

const SIZE_PHRASES: Record<SizeTag, string> = {
  whale: 'a whale-sized account',
  mid: 'a mid-sized account',
  small: 'a smaller account',
  micro: 'a micro account',
};

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Hold-rhythm clause from average hold time. Null when unknown. */
function holdClause(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 4 * HOUR) return 'in and out within hours';
  if (seconds < 36 * HOUR) return 'usually trades within the day';
  if (seconds < 7 * DAY) return 'holds positions for days';
  if (seconds < 21 * DAY) return 'holds positions for a week or two';
  return 'holds positions for weeks at a time';
}

/**
 * Compose the one-line bio. Returns null when there's no archetype —
 * a bio that can't open with who the trader *is* isn't worth showing.
 *
 * Honesty rule: a yellow/red decay flag (or `cooling` heat) always wins
 * over `hot` — we never lead with momentum that the longer window
 * contradicts.
 */
export function traderBio(input: TraderBioInput): string | null {
  const lead = input.profile ? PROFILE_LEADS[input.profile] : null;
  if (!lead) return null;

  // Texture: size and/or market, folded into one clause.
  const sizePhrase = input.size ? SIZE_PHRASES[input.size] : null;
  let texture: string | null = null;
  if (sizePhrase && input.market) texture = `with ${sizePhrase}, mostly ${input.market}`;
  else if (sizePhrase) texture = `with ${sizePhrase}`;
  else if (input.market) texture = `mostly trading ${input.market}`;

  const rhythm = holdClause(input.avgHoldSeconds);

  const cooled = input.decay === 'yellow' || input.decay === 'red' || input.heat === 'cooling';
  const hot = !cooled && input.heat === 'hot';

  const tail: string[] = [];
  if (rhythm) tail.push(rhythm);
  if (cooled) tail.push('though results have cooled lately');
  else if (hot) tail.push(tail.length > 0 ? 'and on a hot streak' : 'on a hot streak');

  let bio = lead;
  if (texture) bio += ` ${texture}`;
  if (tail.length > 0) bio += ` — ${tail.join(', ')}`;
  return `${bio}.`;
}

/** Everything a trait chip can open an explainer sheet for. `market` is the
 *  generic home-market explainer (the chip label itself is dynamic). */
export type TraitKey = ProfileTag | SizeTag | 'hot' | 'cooling' | 'market';

export interface TraitExplainer {
  title: string;
  /** One de-jargoned paragraph. */
  body: string;
  /** One "what to make of it" line. */
  takeaway: string;
}

export const TRAIT_EXPLAINERS: Record<TraitKey, TraitExplainer> = {
  alpha: {
    title: 'Alpha',
    body: 'Trades like they know something. Rare, concentrated bets — often around news and events — with an unusually high hit rate. The track record says these are not lucky guesses.',
    takeaway: 'High conviction, low frequency. When they move, it is deliberate.',
  },
  veteran: {
    title: 'Veteran',
    body: 'Battle-tested: hundreds of completed trades over a long stretch, with results that held up month after month. The opposite of a lucky streak.',
    takeaway: 'A long, consistent record is the hardest thing to fake.',
  },
  rising_star: {
    title: 'Rising Star',
    body: 'A smaller account with strong recent form. The track record is short, but what is there looks sharp — one to watch rather than a finished story.',
    takeaway: 'Promising, with less history to lean on. Expect more variance.',
  },
  specialist: {
    title: 'Specialist',
    body: 'Lives in one market — most of their trading happens in a single asset they clearly know well.',
    takeaway: 'Deep familiarity with one market; their results travel with it.',
  },
  allrounder: {
    title: 'All-Rounder',
    body: 'A solid, active trader spread across several markets — no single specialty, no obvious weakness.',
    takeaway: 'The dependable middle: diversified and steady.',
  },
  whale: {
    title: 'Whale',
    body: 'One of the biggest accounts on the platform by lifetime volume. At this size the results are real money and hard to fake.',
    takeaway: 'Big accounts move deliberately — fewer, larger decisions.',
  },
  mid: {
    title: 'Mid-size',
    body: 'A solid mid-sized account — large enough that the results are meaningful, small enough to stay nimble.',
    takeaway: 'Meaningful size without whale inertia.',
  },
  small: {
    title: 'Small account',
    body: 'A smaller account. The results are real, but a handful of trades can swing them noticeably.',
    takeaway: 'Read the results alongside the length of the track record.',
  },
  micro: {
    title: 'Micro account',
    body: 'A very small account — early days or small stakes. Results can move fast in either direction.',
    takeaway: 'Treat the numbers as a sketch, not a record.',
  },
  hot: {
    title: 'Hot streak',
    body: 'Recent results are running well above this trader’s own average.',
    takeaway: 'Momentum is real — but streaks are also when traders take the most risk.',
  },
  cooling: {
    title: 'Cooled lately',
    body: 'Recent results are below this trader’s usual level. It happens to every trader; it is worth knowing before you follow.',
    takeaway: 'Judge them on the longer record, not just this stretch.',
  },
  market: {
    title: 'Home market',
    body: 'Where most of this trader’s volume lives. A trader’s edge tends to travel with the market they know best.',
    takeaway: 'Their results are tied to how well they know this market.',
  },
};
