import { localizedPath } from '@minhaj/contracts';
import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  ScholarlyKind,
  ScholarlyLabel,
  ScholarlyListing,
  StandaloneScholarlyKind,
} from '@minhaj/contracts/library';

/**
 * Presentation decisions for the Phase-9 Library surfaces — Research,
 * ResearchPaper, Publication, Magazine, MagazineIssue and Encyclopedia.
 *
 * PURE AND FREE OF REACT, like `./presentation.ts`: which address a record has,
 * which label a page renders, which query a URL means. Each is a function a test
 * can call, and each has exactly one implementation — the pages, the sitemap,
 * the old-slug redirect and the search result addresses all call these, so no
 * two of them can spell one record's address differently.
 */

/**
 * The route segment of each aggregate with an address of its own
 * (ROUTE_MAP.md §3.6). An issue lives beneath its Magazine.
 */
const SCHOLARLY_SEGMENTS: Readonly<Record<StandaloneScholarlyKind, string>> =
  Object.freeze({
    research: 'research',
    'research-paper': 'research-papers',
    publication: 'publications',
    magazine: 'magazines',
    encyclopedia: 'encyclopedias',
  });

/** The segment → kind lookup the redirect proxy needs. */
export function standaloneKindOfSegment(segment: string): StandaloneScholarlyKind | null {
  const found = (
    Object.entries(SCHOLARLY_SEGMENTS) as [StandaloneScholarlyKind, string][]
  ).find(([, value]) => value === segment);
  return found === undefined ? null : found[0];
}

const part = (value: string) => encodeURIComponent(value);

/**
 * The LOCALE-FREE canonical path of one record. Search results and the sitemap
 * prefix a locale; nothing else assembles these.
 */
export function scholarlyPathOf(
  kind: ScholarlyKind,
  slug: string,
  magazineSlug: string | null,
): string {
  if (kind === 'magazine-issue') {
    if (magazineSlug === null)
      throw new Error('An issue has no address without its Magazine.');
    return `/library/magazines/${part(magazineSlug)}/issues/${part(slug)}`;
  }
  return `/library/${SCHOLARLY_SEGMENTS[kind]}/${part(slug)}`;
}

/** The canonical public address of one standalone record in one locale. */
export function scholarlyPath(
  locale: string,
  kind: StandaloneScholarlyKind,
  slug: string,
): string {
  return localizedPath(locale, `${scholarlyPathOf(kind, slug, null)}`);
}

/** The canonical public address of one issue in one locale. */
export function issuePath(
  locale: string,
  magazineSlug: string,
  issueSlug: string,
): string {
  return localizedPath(
    locale,
    `${scholarlyPathOf('magazine-issue', issueSlug, magazineSlug)}`,
  );
}

/** The address of one listing row: an issue beneath its Magazine, else its own. */
export function listingHref(
  locale: Locale,
  row: Pick<ScholarlyListing, 'kind' | 'slug' | 'issue'>,
): string {
  return row.kind === 'magazine-issue' && row.issue !== null
    ? issuePath(locale, row.issue.magazineSlug, row.slug)
    : scholarlyPath(locale, row.kind as StandaloneScholarlyKind, row.slug);
}

/**
 * A Magazine's issues grouped by year (R2, audit F14), from a list already in
 * the periodical's order — newest year first, an undated issue last. Groups
 * keep that order and so do the issues within them; nothing is re-sorted.
 */
export function issuesByYear<T extends { readonly publicationYear: number | null }>(
  issues: readonly T[],
): { readonly year: number | null; readonly issues: readonly T[] }[] {
  const groups: { year: number | null; issues: T[] }[] = [];
  for (const issue of issues) {
    const last = groups.at(-1);
    if (last !== undefined && last.year === issue.publicationYear)
      last.issues.push(issue);
    else groups.push({ year: issue.publicationYear, issues: [issue] });
  }
  return groups;
}

/** The listing address of one standalone kind. */
export function scholarlyListPath(locale: string, kind: StandaloneScholarlyKind): string {
  return localizedPath(locale, `/library/${SCHOLARLY_SEGMENTS[kind]}`);
}

/**
 * The descriptive label a page renders, and the language it is in.
 *
 * THE SAME RESOLUTION AS A WORK'S (`./presentation.ts` `labelFor`): the reader's
 * interface locale, then the record's primary locale, then the first label.
 * Presentation, never translation — and the resolved locale is returned so the
 * caller marks the element with it (WCAG 3.1.2).
 */
export function scholarlyLabel(
  record: { readonly labels: readonly ScholarlyLabel[]; readonly primaryLocale: Locale },
  locale: Locale,
): ScholarlyLabel {
  return (
    record.labels.find((label) => label.locale === locale) ??
    record.labels.find((label) => label.locale === record.primaryLocale) ??
    record.labels[0] ?? { locale: record.primaryLocale, title: '', summary: '' }
  );
}

/** The interface locales a record genuinely has descriptive metadata in. */
export function scholarlyLocales(record: {
  readonly labels: readonly ScholarlyLabel[];
}): Locale[] {
  return record.labels.map((label) => label.locale);
}

/**
 * The paragraphs of a plain-text field — an abstract, a summary — split on blank
 * lines. Each becomes a TEXT NODE; there is no markup path.
 */
export function paragraphsOf(value: string): string[] {
  return value
    .replaceAll('\r\n', '\n')
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

/** The address a DOI resolves at. The DOI's grammar admits nothing unsafe. */
export function doiHref(doi: string): string {
  return `https://doi.org/${doi.split('/').map(part).join('/')}`;
}

/** The Library's interface words. */
type LibraryTranslator = Awaited<ReturnType<typeof getTranslations<'library'>>>;

/** The section registry key of each standalone kind's listing. */
const SECTION_KEY = {
  research: 'research',
  'research-paper': 'research-papers',
  publication: 'publications',
  magazine: 'magazines',
  encyclopedia: 'encyclopedias',
} as const satisfies Record<StandaloneScholarlyKind, string>;

/** A kind's listing name ("Research papers"), as the Library menu names it. */
export function sectionTitle(
  t: LibraryTranslator,
  kind: StandaloneScholarlyKind,
): string {
  return t(`section.${SECTION_KEY[kind]}`);
}

/** What a kind's listing holds, in one sentence. */
export function sectionBody(t: LibraryTranslator, kind: StandaloneScholarlyKind): string {
  return t(`sectionBody.${SECTION_KEY[kind]}`);
}
