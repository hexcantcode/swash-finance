export type Side = 'B' | 'A';

export const SIDE_BUY = 'B' as const satisfies Side;
export const SIDE_SELL = 'A' as const satisfies Side;

export function isBuy(side: Side): boolean {
  return side === SIDE_BUY;
}

export function flipSide(side: Side): Side {
  return side === SIDE_BUY ? SIDE_SELL : SIDE_BUY;
}

/**
 * The trader "Profile" — the one archetype tag shown next to the composite
 * score. Replaces the old `MainTag`. Exactly one per scored wallet; priority
 * order (rarest / highest-signal first): alpha → veteran → rising_star →
 * specialist → allrounder.
 */
export type ProfileTag = 'alpha' | 'veteran' | 'rising_star' | 'specialist' | 'allrounder';
/** Asset class of a wallet's primary market — derived from `primaryAsset`,
 *  shown as a plain stat (no longer a filterable tag group). */
export type AssetTag = 'bluechip' | 'altcoin' | 'meme' | 'stocks' | 'mixed';
export type HeatTag = 'hot' | 'steady' | 'cooling';
export type SizeTag = 'whale' | 'mid' | 'small' | 'micro';

export const PROFILE_TAGS: ReadonlyArray<ProfileTag> = [
  'alpha',
  'veteran',
  'rising_star',
  'specialist',
  'allrounder',
] as const;

export const PROFILE_TAG_LABELS: Record<ProfileTag, string> = {
  alpha: 'Alpha',
  veteran: 'Veteran',
  rising_star: 'Rising Star',
  specialist: 'Specialist',
  allrounder: 'All-Rounder',
};

export const PROFILE_TAG_DESCRIPTIONS: Record<ProfileTag, string> = {
  alpha:
    'Moves with information — concentrated, event-driven entries with a lethal hit-rate. High PSR on a small, focused sample; controlled drawdown.',
  veteran:
    'Battle-tested — a long observable history and a large sample, with performance that has held up. ≥500 round-trips, consistent month to month.',
  rising_star:
    'A small book near the listing floor with strong recent form — one to watch. $25K–$250K equity, short record or modest sample, recent Sharpe near its peak.',
  specialist:
    'A one-asset operator — most of their volume in a single market, without a proven information edge.',
  allrounder: 'A solid, active, diversified trader without a sharper archetype — the catch-all.',
};

export type DecayFlag = 'green' | 'yellow' | 'red';

/** Tag groups stored in `wallet_tags`. The composite score is the headline;
 *  these are informational. `profile` is also mirrored to `wallets.primary_tag`. */
export type TagType = 'profile' | 'heat' | 'size';

export interface SecondaryTags {
  heat?: HeatTag;
  size?: SizeTag;
}
