import { z } from 'zod';

import type { Locale } from '@minhaj/contracts';
import type {
  ScholarlyKind,
  ScholarlyLabel,
  ScholarlyQuery,
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
  return `/${locale}${scholarlyPathOf(kind, slug, null)}`;
}

/** The canonical public address of one issue in one locale. */
export function issuePath(
  locale: string,
  magazineSlug: string,
  issueSlug: string,
): string {
  return `/${locale}${scholarlyPathOf('magazine-issue', issueSlug, magazineSlug)}`;
}

/** The listing address of one standalone kind. */
export function scholarlyListPath(locale: string, kind: StandaloneScholarlyKind): string {
  return `/${locale}/library/${SCHOLARLY_SEGMENTS[kind]}`;
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
 * A URL's query, tolerated and then re-validated by the read service — the same
 * two layers as the Work listing. A mistyped year or a repeated parameter is the
 * unfiltered listing, never an error page, and nothing here can widen what is
 * public.
 */
export function readScholarlyQuery(
  query: Record<string, string | string[] | undefined>,
): ScholarlyQuery {
  const text = (key: string, max: number): string | null => {
    const raw = query[key];
    return typeof raw === 'string' && raw !== '' && raw.length <= max ? raw : null;
  };
  const year = (key: string): number | null =>
    z.coerce.number().int().min(1).max(9999).nullable().catch(null).parse(text(key, 8));

  const from = year('from');
  const to = year('to');
  const topic = text('topic', 64);

  return {
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(25_000)
      .catch(0)
      .parse(text('offset', 8) ?? 0),
    language: text('language', 16),
    topic: topic !== null && z.uuid().safeParse(topic).success ? topic : null,
    ...(from !== null && to !== null && from > to
      ? { from: null, to: null }
      : { from, to }),
  };
}

/** The listing address for a set of filters, neutral values omitted. */
export function scholarlyQueryPath(
  base: string,
  filters: ScholarlyQuery,
  overrides: Partial<ScholarlyQuery> = {},
): string {
  const merged = { ...filters, ...overrides };
  const search = new URLSearchParams();
  if (merged.offset > 0) search.set('offset', String(merged.offset));
  if (merged.language !== null) search.set('language', merged.language);
  if (merged.topic !== null) search.set('topic', merged.topic);
  if (merged.from !== null) search.set('from', String(merged.from));
  if (merged.to !== null) search.set('to', String(merged.to));
  const text = search.toString();
  return text === '' ? base : `${base}?${text}`;
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
