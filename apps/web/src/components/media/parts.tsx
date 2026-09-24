import type { Locale } from '@minhaj/contracts';
import { formatDuration, isoDuration } from '@minhaj/contracts/media';

import { TextLink } from '@/components/ui';

/**
 * The small presentation parts Watch and Listen share — one implementation, so
 * a duration, a date and a page link read the same on both surfaces.
 */

/** A date-only fact, formatted in the interface locale and never shifted by a zone. */
export function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

/** A duration, machine-readable and always left-to-right (`1:02:03`). */
export function Duration({ seconds }: { readonly seconds: number }) {
  return (
    <time dateTime={isoDuration(seconds)} dir="ltr">
      {formatDuration(seconds)}
    </time>
  );
}

/** Previous and next page links, or nothing when there is one page. */
export function Pagination({
  label,
  previous,
  next,
  previousLabel,
  nextLabel,
}: {
  readonly label: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly previousLabel: string;
  readonly nextLabel: string;
}) {
  if (previous === null && next === null) return null;
  return (
    <nav className="flex flex-wrap gap-6" aria-label={label}>
      {previous === null ? null : <TextLink href={previous}>{previousLabel}</TextLink>}
      {next === null ? null : <TextLink href={next}>{nextLabel}</TextLink>}
    </nav>
  );
}
