import type { MainTag } from '@copytrade/shared';

const LABEL: Record<MainTag, string> = {
  alpha_hunter: 'Alpha',
  veteran: 'Veteran',
  insider: 'Insider',
  specialist: 'Specialist',
  dark_horse: 'Dark horse',
  generalist: 'Generalist',
};

export function mainTagClass(tag: string | null | undefined): string {
  if (!tag) return 'tag-neutral';
  return `tag-${tag}`;
}

export function mainTagLabel(tag: string | null | undefined): string {
  if (!tag) return 'Unclassified';
  return (LABEL as Record<string, string>)[tag] ?? tag.replace(/_/g, ' ');
}
