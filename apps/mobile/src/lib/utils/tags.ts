import { PROFILE_TAG_LABELS } from '@copytrade/shared';

/** CSS class for a profile chip — `tag-<value>` (styles in app.css), or
 *  `tag-neutral` when the wallet has no profile yet. */
export function profileTagClass(tag: string | null | undefined): string {
  if (!tag) return 'tag-neutral';
  return `tag-${tag}`;
}

/** Human label for a profile value. Falls back to a de-snaked version for any
 *  legacy/unknown value, and "Unclassified" when missing. */
export function profileTagLabel(tag: string | null | undefined): string {
  if (!tag) return 'Unclassified';
  return (PROFILE_TAG_LABELS as Record<string, string>)[tag] ?? tag.replace(/_/g, ' ');
}
