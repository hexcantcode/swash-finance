import { describe, expect, it } from 'vitest';
import { TRAIT_EXPLAINERS, traderBio } from './trader-bio.js';
import { PROFILE_TAGS } from './types.js';

const DAY = 86_400;

describe('traderBio', () => {
  it('returns null without an archetype', () => {
    expect(traderBio({})).toBeNull();
    expect(traderBio({ size: 'whale', heat: 'hot', avgHoldSeconds: DAY })).toBeNull();
  });

  it('composes the full sentence', () => {
    expect(
      traderBio({
        profile: 'allrounder',
        size: 'mid',
        market: 'stocks',
        avgHoldSeconds: 11 * DAY,
      }),
    ).toBe(
      'Steady, diversified trader with a mid-sized account, mostly stocks — holds positions for a week or two.',
    );
  });

  it('keeps Rising Star by name', () => {
    expect(traderBio({ profile: 'rising_star' })).toBe('Rising star with strong recent form.');
  });

  it('degrades clause by clause', () => {
    expect(traderBio({ profile: 'veteran' })).toBe('Battle-tested.');
    expect(traderBio({ profile: 'veteran', size: 'whale' })).toBe(
      'Battle-tested with a whale-sized account.',
    );
    expect(traderBio({ profile: 'veteran', market: 'BTC & majors' })).toBe(
      'Battle-tested mostly trading BTC & majors.',
    );
  });

  it('buckets hold rhythm', () => {
    const bio = (s: number) => traderBio({ profile: 'alpha', avgHoldSeconds: s });
    expect(bio(3600)).toContain('in and out within hours');
    expect(bio(12 * 3600)).toContain('usually trades within the day');
    expect(bio(3 * DAY)).toContain('holds positions for days');
    expect(bio(10 * DAY)).toContain('holds positions for a week or two');
    expect(bio(40 * DAY)).toContain('holds positions for weeks at a time');
    expect(traderBio({ profile: 'alpha', avgHoldSeconds: 0 })).toBe('Makes rare, precise bets.');
  });

  it('appends a hot streak after the rhythm with "and"', () => {
    expect(traderBio({ profile: 'veteran', heat: 'hot', avgHoldSeconds: 3 * DAY })).toBe(
      'Battle-tested — holds positions for days, and on a hot streak.',
    );
    expect(traderBio({ profile: 'veteran', heat: 'hot' })).toBe(
      'Battle-tested — on a hot streak.',
    );
  });

  it('lets cooling/decay win over hot (honesty rule)', () => {
    expect(traderBio({ profile: 'veteran', heat: 'hot', decay: 'red' })).toBe(
      'Battle-tested — though results have cooled lately.',
    );
    expect(traderBio({ profile: 'veteran', heat: 'cooling' })).toBe(
      'Battle-tested — though results have cooled lately.',
    );
    expect(traderBio({ profile: 'veteran', decay: 'green', heat: 'hot' })).toBe(
      'Battle-tested — on a hot streak.',
    );
  });
});

describe('TRAIT_EXPLAINERS', () => {
  it('covers every archetype, size, heat extreme, and market', () => {
    for (const tag of PROFILE_TAGS) expect(TRAIT_EXPLAINERS[tag]).toBeDefined();
    for (const key of ['whale', 'mid', 'small', 'micro', 'hot', 'cooling', 'market'] as const) {
      expect(TRAIT_EXPLAINERS[key].body.length).toBeGreaterThan(20);
      expect(TRAIT_EXPLAINERS[key].takeaway.length).toBeGreaterThan(10);
    }
  });

  it('stays de-jargoned', () => {
    const all = Object.values(TRAIT_EXPLAINERS)
      .map((e) => `${e.body} ${e.takeaway}`)
      .join(' ');
    for (const jargon of ['PSR', 'Sharpe', 'Sortino', 'drawdown', 'notional', 'PnL']) {
      expect(all).not.toContain(jargon);
    }
  });
});
