import { z } from 'zod';

import type { Locale } from '@minhaj/contracts';
import type { EditionRecord, WorkRecord } from '@minhaj/contracts/library';

/**
 * Presentation decisions the Library surfaces share.
 *
 * PURE, AND DELIBERATELY FREE OF REACT. These are the parts of Library
 * presentation that can be wrong in a way markup does not show — which language
 * version a title is rendered from, which Edition a query parameter selects,
 * what a canonical URL spells — so they are functions a test can call directly
 * rather than behaviour buried in three components.
 *
 * NOTHING HERE READS DATA. It receives resolved DTOs, which is what keeps a
 * later visual redesign a change to components rather than to the semantic
 * contract the pages consume (ARCHITECTURE.md §13, and this phase's
 * frontend/backend replaceability rule).
 */

/** The query parameter that selects an Edition on a Work page. */
export const EDITION_PARAM = 'edition';

/** How many Works one listing page shows. Matches the reader's own page size. */
export const WORK_PAGE = 25;

/**
 * Turns a URL's search parameters into the Library's own query shape.
 *
 * TWO LAYERS, AND THE OUTER ONE IS DELIBERATELY TOLERANT. A URL is not a form: a
 * visitor may arrive with `?from=banana` from a mistyped link or a crawler, and
 * answering that with a 500 would be a worse page than answering it with the
 * unfiltered listing. So every field here `catch`es to its neutral value.
 *
 * TOLERANT IS NOT TRUSTING. What this produces is re-validated by
 * `libraryQuerySchema` inside the read service, which is the authoritative
 * boundary (SECURITY_BASELINE.md §9.1) — and neither layer can widen visibility,
 * because `published` is in the query rather than in a filter a parameter could
 * unset.
 *
 * A REPEATED PARAMETER IS NOT A VALUE. `?topic=a&topic=b` arrives as an array and
 * is discarded rather than having one of the two silently chosen for the visitor.
 */
export function readLibraryQuery(query: Record<string, string | string[] | undefined>): {
  offset: number;
  language: string | null;
  topic: string | null;
  contributor: string | null;
  from: number | null;
  to: number | null;
  downloads: boolean;
} {
  const text = (key: string, max: number): string | null => {
    const raw = query[key];
    return typeof raw === 'string' && raw !== '' && raw.length <= max ? raw : null;
  };

  const year = (key: string): number | null =>
    z.coerce.number().int().min(1).max(9999).nullable().catch(null).parse(text(key, 8));

  const from = year('from');
  const to = year('to');

  return {
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(25_000)
      .catch(0)
      .parse(text('offset', 8) ?? 0),
    language: text('language', 16),
    // A malformed identifier is dropped rather than queried. The domain schema
    // would refuse it anyway; dropping it here is what turns a bad link into the
    // unfiltered listing instead of an error page.
    topic: uuidOrNull(text('topic', 64)),
    contributor: uuidOrNull(text('contributor', 64)),
    // AN INVERTED RANGE IS NOT A RANGE. `libraryQuerySchema` refuses `from > to`,
    // so it is normalised here rather than allowed to throw.
    ...(from !== null && to !== null && from > to
      ? { from: null, to: null }
      : { from, to }),
    downloads: text('downloads', 8) === '1',
  };
}

function uuidOrNull(value: string | null): string | null {
  return value !== null && z.uuid().safeParse(value).success ? value : null;
}

/**
 * The listing URL for a set of filters and an offset.
 *
 * ONE BUILDER, so the filter form, the pagination links and the clear-filter
 * links cannot produce three different spellings of the same view. Neutral values
 * are OMITTED rather than written as empty parameters, which keeps the unfiltered
 * listing at exactly one address — `?language=&topic=` is a second URL for the
 * same page, and `canonical to the base` (ROUTE_MAP.md §2.3) is easier to honour
 * when the base is the one the page actually links to.
 */
export function booksPath(
  locale: string,
  filters: ReturnType<typeof readLibraryQuery>,
  overrides: Partial<ReturnType<typeof readLibraryQuery>> = {},
): string {
  const merged = { ...filters, ...overrides };
  const search = new URLSearchParams();

  if (merged.offset > 0) search.set('offset', String(merged.offset));
  if (merged.language !== null) search.set('language', merged.language);
  if (merged.topic !== null) search.set('topic', merged.topic);
  if (merged.contributor !== null) search.set('contributor', merged.contributor);
  if (merged.from !== null) search.set('from', String(merged.from));
  if (merged.to !== null) search.set('to', String(merged.to));
  if (merged.downloads) search.set('downloads', '1');

  const query = search.toString();
  return `/${locale}/library/books${query === '' ? '' : `?${query}`}`;
}

/** The canonical public address of one Work (ROUTE_MAP.md §5, §9.1). */
export function workPath(locale: string, slug: string): string {
  return `/${locale}/library/books/${encodeURIComponent(slug)}`;
}

/**
 * The localized descriptive metadata to render, and the language it is in.
 *
 * THIS IS PRESENTATION, NOT TRANSLATION. A Work whose label exists in English
 * renders that English label inside an Urdu page — and that says nothing
 * whatever about whether an Urdu EDITION of the Work exists (DOMAIN_MODEL.md
 * §10.1). The two are different questions and this function answers only the
 * first.
 *
 * THE RESOLVED LANGUAGE IS RETURNED, not just the text, because the caller must
 * set `lang` on the element. A label rendered in English inside an Urdu page and
 * left unmarked is announced by a screen reader in the wrong language, which is
 * a WCAG 3.1.2 failure rather than a cosmetic one.
 *
 * Resolution order, and it never invents a version:
 *   1. the requested interface locale, when a label exists in it;
 *   2. the Work's own primary locale, which is the language it was described in;
 *   3. the first label there is, so a page always has a title.
 */
export function labelFor(
  work: Pick<WorkRecord, 'labels' | 'primaryLocale'>,
  locale: Locale,
): { locale: Locale; title: string; description: string } {
  const requested = work.labels.find((label) => label.locale === locale);
  const primary = work.labels.find((label) => label.locale === work.primaryLocale);
  const resolved = requested ?? primary ?? work.labels[0];

  // `labels` is non-empty by schema (at least the primary-locale label) and by
  // a CHECK constraint on the title, so this is unreachable rather than
  // defensive — but a title is what the page's heading and its `<title>` are
  // built from, and an exception thrown while rendering a public page is worse
  // than an honest empty string.
  if (resolved === undefined)
    return { locale: work.primaryLocale, title: '', description: '' };

  return {
    locale: resolved.locale,
    title: resolved.title,
    description: resolved.description,
  };
}

/** Which interface locales this Work genuinely has descriptive metadata in. */
export function labelLocales(work: Pick<WorkRecord, 'labels'>): Locale[] {
  return work.labels.map((label) => label.locale);
}

/**
 * Which Edition the page shows.
 *
 * THE QUERY PARAMETER IS A SELECTION, NEVER AN AUTHORITY. An identifier that
 * names no VISIBLE Edition of this Work is discarded rather than trusted — the
 * list this chooses from is the one the reader already produced for the public,
 * so a draft or archived Edition cannot be selected into view by URL.
 *
 * THE DEFAULT IS DETERMINISTIC, which matters for more than tidiness: a Work
 * page whose default Edition varied between two requests would make the reader's
 * position identifier unstable for the same address.
 *
 *   1. the explicitly selected Edition, when it is visible;
 *   2. an Edition in the reader's own interface language, because somebody
 *      reading Urdu chrome most likely wants the Urdu manifestation if one
 *      exists — a preference, not a filter, and it hides nothing;
 *   3. an Edition in the language the Work was originally described in;
 *   4. the first Edition, by the reader's stable ordering.
 */
export function selectEdition(
  editions: readonly EditionRecord[],
  locale: Locale,
  primaryLocale: Locale,
  requested: string | null,
): EditionRecord | null {
  if (editions.length === 0) return null;

  const explicit =
    requested === null ? undefined : editions.find((edition) => edition.id === requested);
  if (explicit !== undefined) return explicit;

  // Matched on the language SUBTAG, so `ur-PK` is an Urdu Edition for a reader
  // of the Urdu interface. A whole-string comparison would silently stop
  // matching the day a regional code is entered.
  const inLocale = editions.find(
    (edition) => primarySubtag(edition.languageCode) === locale,
  );
  if (inLocale !== undefined) return inLocale;

  const inPrimary = editions.find(
    (edition) => primarySubtag(edition.languageCode) === primaryLocale,
  );

  return inPrimary ?? editions[0] ?? null;
}

/** The language subtag of a BCP-47-shaped code: `ur-PK` is Urdu. */
function primarySubtag(languageCode: string): string {
  return (languageCode.split('-')[0] ?? languageCode).toLowerCase();
}

/**
 * What a visitor may do with one Edition, as four distinct answers.
 *
 * THE FOUR ARE NOT DERIVABLE FROM EACH OTHER, which is the whole point of
 * separating them (this phase's rights contract, §26–§27):
 *
 *   - `reflowable` — semantic text exists, so there is a genuine reading
 *     experience rather than a file to download.
 *   - `readableFile` — the readable source is a FILE. Legitimate when no
 *     reflowable text exists; never a substitute for text that does.
 *   - `downloadable` — a copy may be taken away. Reading online does not imply
 *     it, and a file existing does not imply it either: the availability
 *     decision is Library-owned data, not an inference from file presence.
 *   - `unavailable` — nothing is readable. An honest state, and the one a
 *     rights-restricted Edition renders.
 *
 * NO LEGAL CONCLUSION IS EXPRESSED OR IMPLIED. This reports what the stored
 * availability decision permits. It does not say why, because the data does not
 * carry a why and inventing one would be inventing law.
 */
interface EditionAccess {
  readonly reflowable: boolean;
  readonly readableFile: string | null;
  readonly downloadable: string | null;
  readonly unavailable: boolean;
}

export function editionAccess(edition: EditionRecord): EditionAccess {
  const reflowable = edition.reading === 'allowed' && edition.document !== null;
  const readableFile =
    edition.reading === 'allowed' && !reflowable ? edition.readableAssetId : null;
  const downloadable = edition.download === 'allowed' ? edition.downloadAssetId : null;

  return {
    reflowable,
    readableFile,
    downloadable,
    // A download alone is not "available to read": it is a copy of something
    // this platform declines to render. The reading states are what this flag
    // reports, so the page's explicit unavailable panel appears whenever there
    // is nothing to read here (§38).
    unavailable: !reflowable && readableFile === null,
  };
}

/**
 * Where an Edition's bytes are served from.
 *
 * NOT LOCALE-PREFIXED, because bytes have no interface locale and three
 * addresses for one object would be three cache entries for one file. It lives
 * under `/assets` with the rest of the platform's bytes, and the Library segment
 * is what makes the business decision Library's rather than Storage's (§24).
 *
 * THE EDITION AND THE ASSET ARE BOTH IN THE PATH, deliberately. The serving
 * route could have derived the asset from the Edition and accepted no asset
 * identifier at all — but then "a caller naming an unrelated asset is refused"
 * would be unreachable rather than proven, and it is the case most worth having
 * a test for.
 */
export function assetPath(
  editionId: string,
  purpose: 'read' | 'download',
  assetId: string,
): string {
  return `/assets/library/editions/${encodeURIComponent(editionId)}/${purpose}/${encodeURIComponent(assetId)}`;
}

/**
 * The bibliographic facts this Edition genuinely has, in a fixed order.
 *
 * ABSENT FACTS ARE ABSENT, not rendered as an empty row or a dash. "ISBN: —"
 * asserts that somebody looked and there is none; a missing row asserts nothing,
 * which is the truth (§12, §39).
 */
export function bibliography(
  edition: EditionRecord,
): readonly { readonly key: string; readonly value: string }[] {
  const rows: { key: string; value: string }[] = [];

  if (edition.publisher !== null && edition.publisher !== '')
    rows.push({ key: 'publisher', value: edition.publisher });
  if (edition.publicationYear !== null)
    rows.push({ key: 'publicationYear', value: String(edition.publicationYear) });
  if (edition.isbn !== null) rows.push({ key: 'isbn', value: edition.isbn });
  if (edition.pageCount !== null)
    rows.push({ key: 'pageCount', value: String(edition.pageCount) });

  return rows;
}

/**
 * May this Work carry `Book` structured data?
 *
 * THE DELIVERY PLAN NAMES THE CONDITION EXACTLY: "`Book` structured data only
 * where genuine ISBN and author exist". Both, on the Edition actually being
 * presented and on the Work respectively — a claim assembled from whatever
 * happened to be present would be the over-claiming ROUTE_MAP.md §9.6 warns
 * about, and a fabricated ISBN in machine-readable form is worse than none
 * because something else will believe it.
 */
export function canClaimBook(
  work: Pick<WorkRecord, 'contributors'>,
  edition: EditionRecord | null,
): boolean {
  return (
    edition !== null &&
    edition.isbn !== null &&
    work.contributors.some((contributor) => contributor.role === 'author')
  );
}
