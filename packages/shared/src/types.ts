export type Side = 'B' | 'A';

export const SIDE_BUY = 'B' as const satisfies Side;
export const SIDE_SELL = 'A' as const satisfies Side;

export function isBuy(side: Side): boolean {
  return side === SIDE_BUY;
}

export function flipSide(side: Side): Side {
  return side === SIDE_BUY ? SIDE_SELL : SIDE_BUY;
}

export type MainTag = 'alpha_hunter' | 'veteran' | 'insider' | 'specialist' | 'dark_horse';
export type AssetTag = 'bluechip' | 'altcoin' | 'meme' | 'stocks' | 'mixed';
export type CadenceTag = 'scalp' | 'intraday' | 'swing' | 'position';
export type RiskTag = 'conservative' | 'balanced' | 'aggressive';
export type HeatTag = 'hot' | 'steady' | 'cooling';
export type SizeTag = 'whale' | 'mid' | 'small' | 'micro';

export const MAIN_TAGS: ReadonlyArray<MainTag> = [
  'alpha_hunter',
  'veteran',
  'insider',
  'specialist',
  'dark_horse',
] as const;

export const MAIN_TAG_LABELS: Record<MainTag, string> = {
  alpha_hunter: 'Alpha Hunter',
  veteran: 'Veteran',
  insider: 'Insider',
  specialist: 'Specialist',
  dark_horse: 'Dark Horse',
};

export const MAIN_TAG_DESCRIPTIONS: Record<MainTag, string> = {
  alpha_hunter:
    'Proven directional skill at significant sample. PSR > 0.95, ≥100 trades, ≥90 active days, max DD < 30%.',
  veteran: 'High sample, long history, sustained performance. ≥500 trades, ≥365 active days, PSR ≥ 0.8.',
  insider:
    'Fresh wallet (<60 days) with concentrated, event-driven activity. Often surfaces around news.',
  specialist: 'Dominant in one asset or category. Asset concentration > 60% with ≥50 trades.',
  dark_horse: 'Small sample (<50 trades) with strong signal (PSR > 0.9) and recent activity.',
};

export type DecayFlag = 'green' | 'yellow' | 'red';

export type TagType = 'main' | 'asset' | 'cadence' | 'risk' | 'heat' | 'size';

export interface SecondaryTags {
  asset?: AssetTag;
  cadence?: CadenceTag;
  risk?: RiskTag;
  heat?: HeatTag;
  size?: SizeTag;
}
