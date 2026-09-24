import type { Locale } from '@minhaj/contracts';
import { formatDuration, isoDuration } from '@minhaj/contracts/media';

import { TextLink } from '@/components/ui';
import { absoluteUrl } from '@/config/origin';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';

/**
 * The small presentation parts Watch, Listen and the photograph pages share —
 * one implementation, so a duration, a date, a page link and a breadcrumb
 * claim read the same on every Media surface.
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

/**
 * JSON-LD, ONLY WHAT IS TRUE and only when the page may be indexed at all: a
 * `BreadcrumbList`. No `AudioObject` or `ImageObject` is claimed — ROUTE_MAP.md
 * §9.6 lists neither, and either one's content address would be a byte route
 * behind an authorisation decision, which is not a public, stable media URL to
 * advertise.
 */
export function BreadcrumbData({
  contentLocales,
  trail,
}: {
  readonly contentLocales: readonly Locale[];
  readonly trail: readonly { readonly name: string; readonly path: string }[];
}) {
  if (!isContentIndexable({ contentLocales })) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeStructuredData({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: trail.map((entry, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: entry.name,
            item: absoluteUrl(entry.path),
          })),
        }),
      }}
    />
  );
}
