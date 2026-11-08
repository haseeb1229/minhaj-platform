import type { Locale } from '@minhaj/contracts';
import type { ScholarlyListing, WorkRecord } from '@minhaj/contracts/library';
import type { getTranslations } from 'next-intl/server';

import { contentLanguageBadge } from '@/components/content-language';
import { MediaCard } from '@/components/ui';
import { directionOf } from '@/config/locale';

import { editionCoverPath, issueCoverPath } from './cover';
import { labelFor, workPath } from './presentation';
import { listingHref, scholarlyLabel } from './scholarly-presentation';

type LibraryTranslator = Awaited<ReturnType<typeof getTranslations<'library'>>>;

/**
 * THE LIBRARY'S CARDS (R2) — one cover-led card for a Work and one for a
 * periodical or an issue, shared by the home page, the Library landing, the
 * listings and a Work's related shelf, so a book looks like the same book
 * everywhere.
 *
 * The cover is shown whole on a calm surface and never cropped; a record with
 * no cover is a titled card of the same width, never a grey box. The title
 * carries its own language and direction, and a title in another language
 * than the interface's is named in words (audit F10).
 */
export function WorkCard({
  locale,
  work,
  headingLevel = 'h3',
  sizes = '11rem',
}: {
  readonly locale: Locale;
  readonly work: WorkRecord;
  readonly headingLevel?: 'h2' | 'h3';
  readonly sizes?: string;
}) {
  const label = labelFor(work, locale);
  const language = contentLanguageBadge(label.locale, locale);
  return (
    <MediaCard
      href={workPath(locale, work.slug)}
      title={label.title}
      aspect="book"
      sizes={sizes}
      headingLevel={headingLevel}
      lang={label.locale}
      dir={directionOf(label.locale)}
      {...(language === undefined ? {} : { language })}
      image={
        work.cover === null
          ? null
          : {
              path: editionCoverPath(work.cover.editionId, work.cover.assetId),
              width: work.cover.width,
              height: work.cover.height,
            }
      }
    />
  );
}

/** "Volume 3, issue 2" — only the numbers the issue genuinely has. */
export function issueNumbering(
  t: LibraryTranslator,
  volume: number | null,
  issueNumber: number | null,
): string | null {
  if (volume !== null && issueNumber !== null)
    return t('scholarly.numbering.both', { volume, number: issueNumber });
  if (volume !== null) return t('scholarly.numbering.volume', { volume });
  if (issueNumber !== null)
    return t('scholarly.numbering.number', { number: issueNumber });
  return null;
}

/**
 * A Magazine (shown by its newest issue's cover) or one issue (by its own),
 * with the facts that tell one issue from the next: its numbering and year.
 */
export function PeriodicalCard({
  locale,
  row,
  t,
  headingLevel = 'h3',
  sizes = '11rem',
}: {
  readonly locale: Locale;
  readonly row: ScholarlyListing;
  readonly t: LibraryTranslator;
  readonly headingLevel?: 'h2' | 'h3' | 'h4';
  readonly sizes?: string;
}) {
  const label = scholarlyLabel(row, locale);
  const cover =
    row.issue !== null && row.issue.cover !== null
      ? { issueId: row.id, cover: row.issue.cover }
      : row.latestCover;
  const language =
    row.languageCode === null
      ? undefined
      : contentLanguageBadge(row.languageCode, locale);
  return (
    <MediaCard
      href={listingHref(locale, row)}
      title={label.title}
      aspect="magazine"
      sizes={sizes}
      headingLevel={headingLevel}
      lang={label.locale}
      dir={directionOf(label.locale)}
      meta={[
        row.issue === null
          ? null
          : issueNumbering(t, row.issue.volume, row.issue.issueNumber),
        row.publicationYear === null
          ? null
          : new Intl.NumberFormat(locale, { useGrouping: false }).format(
              row.publicationYear,
            ),
      ]}
      {...(language === undefined ? {} : { language })}
      image={
        cover === null
          ? null
          : {
              path: issueCoverPath(cover.issueId, cover.cover.assetId),
              width: cover.cover.width,
              height: cover.cover.height,
            }
      }
    />
  );
}
