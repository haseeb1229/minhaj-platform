import { z } from 'zod';

/**
 * News — Phase 13, inside Editorial (DOMAIN_MODEL.md §7.1).
 *
 * FOUR AGGREGATES, NOT ONE WITH A TYPE COLUMN. NewsArticle, PressRelease,
 * Statement and MediaCoverage share Editorial's language, workflow and value
 * shapes, and each keeps its own tables, its own slug namespace and its own
 * canonical route family, because their metadata genuinely differs: a
 * Statement carries an issuing authority and a MediaCoverage record describes
 * an external outlet's coverage. There is no News context, no generic content
 * table and no `targetType + targetId` anywhere below.
 *
 * NO IMAGE. News depends on Editorial and Search, not on Storage or Media, so no
 * lead image, uploaded figure or remote image address exists here. The shared
 * rich-text schema refuses images too.
 */

export const NEWS_KINDS = Object.freeze([
  'news-article',
  'press-release',
  'statement',
  'media-coverage',
] as const);

export type NewsKind = (typeof NEWS_KINDS)[number];

export const newsKindSchema = z.enum(NEWS_KINDS);

export function isNewsKind(value: string): value is NewsKind {
  return (NEWS_KINDS as readonly string[]).includes(value);
}

/**
 * Where each family lives beneath `/news` (ROUTE_MAP.md §3.9). A NewsArticle is
 * `/news/{slug}`; the other three are intentional navigational views, each with
 * its own detail family.
 */
export const NEWS_SEGMENTS: Readonly<Record<NewsKind, string | null>> = Object.freeze({
  'news-article': null,
  'press-release': 'press-releases',
  statement: 'statements',
  'media-coverage': 'media-coverage',
});

/**
 * THE STATIC SIBLINGS OF `/news/{slug}`. A NewsArticle slug can never be one of
 * these, so no article can claim the archive or another family's listing — the
 * contract refuses it, and the database refuses it again for any other writer.
 */
export const NEWS_RESERVED_SLUGS = Object.freeze([
  'archive',
  'press-releases',
  'statements',
  'media-coverage',
] as const);

export function isReservedNewsSlug(slug: string): boolean {
  return (NEWS_RESERVED_SLUGS as readonly string[]).includes(slug);
}

/** The locale-free listing address of a family. */
export function newsListPathOf(kind: NewsKind): string {
  const segment = NEWS_SEGMENTS[kind];
  return segment === null ? '/news' : `/news/${segment}`;
}

/** The locale-free canonical address of one record. */
export function newsPathOf(kind: NewsKind, slug: string): string {
  return `${newsListPathOf(kind)}/${encodeURIComponent(slug)}`;
}

/** The family a listing segment names, or `null`. */
export function newsKindOfSegment(
  segment: string,
): Exclude<NewsKind, 'news-article'> | null {
  for (const kind of NEWS_KINDS)
    if (kind !== 'news-article' && NEWS_SEGMENTS[kind] === segment) return kind;
  return null;
}

/** One page of a public listing, the archive and the topic hub's section. */
export const NEWS_PAGE = 20;
/** The deepest offset a public listing accepts. */
export const NEWS_MAX_OFFSET = 25_000;
/** The News section of a topic hub previews at most this many records. */
export const NEWS_TOPIC_PREVIEW = 6;
/** The earliest year the archive accepts in a query. */
export const NEWS_EARLIEST_YEAR = 1900;

export const NEWS_LIMITS = Object.freeze({
  issuer: 200,
  outlet: 200,
  sourceUrl: 2048,
});

/**
 * A MediaCoverage source address: HTTPS only, never with credentials in it —
 * the accepted outbound-address policy (Phase 9's citations) — and stored in its
 * normalised form. It is a described outbound link a visitor may follow; the
 * platform never fetches, embeds, proxies or redirects through it.
 *
 * PARSED, NOT PATTERN-MATCHED. Only an absolute address the platform's own URL
 * parser accepts is considered at all, so a protocol-relative `//host/path`, a
 * relative path, `javascript:`, `data:` and `file:` are refused rather than
 * reinterpreted.
 */
export function safeSourceHref(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === '' ||
    url.href.length > NEWS_LIMITS.sourceUrl
  )
    return null;
  return url.href;
}

export const newsSourceUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(NEWS_LIMITS.sourceUrl)
  .transform((value, context) => {
    const href = safeSourceHref(value);
    if (href === null) {
      context.addIssue({ code: 'custom', message: 'A safe HTTPS address is required.' });
      return z.NEVER;
    }
    return href;
  });

/**
 * What a MediaCoverage record says about the coverage it describes: the outlet
 * that published it, and — only where genuinely known — its address and the
 * date it appeared. The title, summary and body are the organisation's own
 * words about that coverage, never the third party's article copied in.
 */
export const mediaCoverageSourceSchema = z.strictObject({
  outlet: z.string().trim().min(1).max(NEWS_LIMITS.outlet),
  sourceUrl: newsSourceUrlSchema.nullable(),
  sourceDate: z.iso.date().nullable(),
});

export type MediaCoverageSource = z.infer<typeof mediaCoverageSourceSchema>;

/** The issuing authority a Statement is made in the name of, per translation. */
export const statementIssuerSchema = z.string().trim().min(1).max(NEWS_LIMITS.issuer);

/* ===========================================================================
 * Public read models
 * ========================================================================= */

/** One card: what a listing, the archive and the topic hub show of a record. */
export interface NewsSummary {
  readonly kind: NewsKind;
  readonly slug: string;
  readonly primaryLanguage: 'en' | 'ur' | 'ar';
  readonly translations: readonly {
    readonly languageCode: 'en' | 'ur' | 'ar';
    readonly title: string;
    readonly excerpt: string;
    readonly issuer?: string;
  }[];
  readonly publishedAt: Date;
  readonly topicIds: readonly string[];
  readonly contributors: readonly { readonly personId: string; readonly role: string }[];
  readonly coverage: {
    readonly outlet: string;
    readonly sourceDate: string | null;
  } | null;
}

export interface NewsPage {
  readonly items: readonly NewsSummary[];
  readonly more: boolean;
}

/**
 * The archive and the topic hub read ONE timeline across the four families,
 * ordered by genuine publication instant. Year and month are UTC calendar
 * values of that instant, never a record's creation time.
 */
export interface NewsTimelineQuery {
  readonly offset: number;
  readonly limit: number;
  readonly year: number | null;
  readonly month: number | null;
  readonly topicId: string | null;
}

export interface NewsArchivePeriod {
  readonly year: number;
  readonly month: number;
  readonly count: number;
}
