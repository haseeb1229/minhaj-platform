import { z } from 'zod';

/**
 * Search — Layer-0 infrastructure vocabulary (ARCHITECTURE.md §4.3, §6.1).
 *
 * SEARCH IS NOT A BOUNDED CONTEXT. It owns no publication, no visibility and no
 * slug. Every resource below is OWNED ELSEWHERE — Taxonomy, People &
 * Contributors, Editorial, Library — and Search holds only a DERIVED, rebuildable
 * projection of what those owners already publish, plus the operational state of
 * keeping that projection current (ARCHITECTURE.md §8.5).
 *
 * NOTHING HERE NAMES THE ENGINE. No `CONTAINS`, no catalog, no LCID, no column.
 * Those belong to the SQL Server adapter behind `SearchIndexPort`, so a future
 * engine replaces the adapter and nothing that calls Search notices
 * (DELIVERY_PLAN.md Phase 17 exit — "the abstraction permits reconsideration
 * without rework").
 */

/* ===========================================================================
 * The closed inventory
 * ========================================================================= */

/**
 * The Phase-17 initial inventory (DELIVERY_PLAN.md Phase 17), extended by each
 * searchable domain in its OWN phase and nothing more. Video, News, Quran,
 * Hadith, Fatwa, Learning, Events and Collections each add their own kind WITH
 * their own projection, filters and tests, when they ship (DELIVERY_PLAN.md §3).
 *
 * `book-translation` is an Edition that IS a genuine translation of another
 * Edition of the same Work (DOMAIN_MODEL.md §10.1). It is indexed as that kind
 * INSTEAD of `edition`, never beside it, so one manifestation is one result.
 *
 * PHASE 9 adds the six scholarly and periodical Library aggregates, each its own
 * kind — a research paper is not a research work, and a magazine issue is not
 * its magazine.
 *
 * PHASE 10 adds `video`, and only `video`. A Series or a Playlist is a grouping
 * of Videos rather than a searchable resource of its own (DELIVERY_PLAN.md
 * Phase 10), so neither is a kind.
 *
 * PHASE 11 adds `audio` — a non-Quran AudioTrack — and only `audio`. An
 * AudioSeries is a grouping, as a Video Series is, and a Quran recitation is
 * Quran's to project when Quran ships, never Media's.
 *
 * PHASE 13 adds Editorial's four News families, each its own kind — a press
 * release is not a news article, a statement is not a press release, and a
 * record of media coverage is none of them — so the type filter can tell them
 * apart and each result links to its own canonical family.
 *
 * PHASE 18 adds `quran-ayah`, and only that. The canonical citation is the
 * result unit: an Ayah's canonical Arabic and each public translation or
 * transliteration of it are documents of ONE result — one per text language —
 * so several layered works matching never multiply the canonical result, and a
 * translation's words are never presented as the Arabic. A Surah, a Juz and a
 * layered work are navigated, not searched. Its scope is one Ayah, because a
 * Surah can hold more ayat than a scope may hold documents.
 */
export const SEARCH_KINDS = Object.freeze([
  'topic',
  'person',
  'article',
  'page',
  'work',
  'edition',
  'book-translation',
  'research',
  'research-paper',
  'publication',
  'magazine',
  'magazine-issue',
  'encyclopedia',
  'video',
  'audio',
  'news-article',
  'press-release',
  'statement',
  'media-coverage',
  'quran-ayah',
] as const);

export type SearchKind = (typeof SEARCH_KINDS)[number];

export const searchKindSchema = z.enum(SEARCH_KINDS);

/**
 * The unit of DERIVED WORK: what an owner asks to have re-projected.
 *
 * Coarser than a kind on purpose. A Work's Editions and translations are
 * visible only while the Work is public, share its title and its topics, and are
 * changed through the same aggregate — so the Library re-projects "this Work
 * and everything that hangs off it" as one scope, and a withdrawn Work removes
 * its Editions in the same step rather than leaving them to a second request
 * that might fail independently.
 *
 * A MAGAZINE ISSUE IS ITS OWN SCOPE, deliberately unlike an Edition. A periodical
 * accumulates issues without bound, and one scope per Magazine would carry more
 * documents than a scope may; instead a Magazine's own change requests each of
 * its issues in the same transaction (DELIVERY_PLAN.md Phase 9).
 */
export const SEARCH_SCOPE_KINDS = Object.freeze([
  'topic',
  'person',
  'article',
  'page',
  'work',
  'research',
  'research-paper',
  'publication',
  'magazine',
  'magazine-issue',
  'encyclopedia',
  'video',
  'audio',
  'news-article',
  'press-release',
  'statement',
  'media-coverage',
  'quran-ayah',
] as const);

export type SearchScopeKind = (typeof SEARCH_SCOPE_KINDS)[number];

/** Which scope a resource kind is projected within. */
export const SCOPE_OF_KIND: Readonly<Record<SearchKind, SearchScopeKind>> = Object.freeze(
  {
    topic: 'topic',
    person: 'person',
    article: 'article',
    page: 'page',
    work: 'work',
    edition: 'work',
    'book-translation': 'work',
    research: 'research',
    'research-paper': 'research-paper',
    publication: 'publication',
    magazine: 'magazine',
    'magazine-issue': 'magazine-issue',
    encyclopedia: 'encyclopedia',
    video: 'video',
    audio: 'audio',
    'news-article': 'news-article',
    'press-release': 'press-release',
    statement: 'statement',
    'media-coverage': 'media-coverage',
    'quran-ayah': 'quran-ayah',
  },
);

/**
 * Owner identifiers: GUID strings, except a Quran Ayah, whose identity is its
 * canonical citation `"{surah}:{ayah}"` (Phase 18) — the owner's own key.
 */
export const searchResourceIdSchema = z.string().min(1).max(36);

/** One owner resource whose projection should be recomputed. */
export interface SearchScopeRef {
  readonly kind: SearchScopeKind;
  readonly id: string;
}

/* ===========================================================================
 * Bounds — every one of them load-bearing
 * ========================================================================= */

/**
 * The public query and its paging.
 *
 * A search box is an input anybody on the internet can fill, and the cost of a
 * full-text query grows with its terms and with how deep a visitor pages
 * (SECURITY_BASELINE.md §1, "denial of service through search parameters").
 * Every dimension is therefore capped, and the caps are what the SQL adapter
 * relies on rather than something it re-checks.
 */
export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_MAX_TERMS = 8;
export const SEARCH_TERM_MAX_LENGTH = 64;

/**
 * The shortest term that may be matched AS A PREFIX. A one- or two-letter
 * prefix fans out to a large share of the vocabulary; such a term still matches
 * as a whole word.
 */
export const SEARCH_PREFIX_MIN_LENGTH = 3;

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE = 50;

/**
 * The deepest result anybody can reach, and therefore the most the engine is
 * ever asked to rank. Beyond it a visitor is asked to refine the query rather
 * than to page — an honest limit, stated in the interface.
 */
export const SEARCH_RESULT_CEILING = SEARCH_PAGE_SIZE * SEARCH_MAX_PAGE;

export const SEARCH_YEAR_MIN = 1;
export const SEARCH_YEAR_MAX = 9999;

/** The projection's display and matching bounds (DELIVERY_PLAN.md Phase 17). */
export const SEARCH_TITLE_MAX_LENGTH = 300;
export const SEARCH_SUMMARY_MAX_LENGTH = 600;

/**
 * How much of a long-form body is matched against.
 *
 * BOUNDED, because the projection is derived and duplicating an entire corpus
 * into it has a real cost and no demonstrated need. An Article's opening twenty
 * thousand characters carry what a visitor searches for; the whole of a book's
 * reader text is not indexed at all (Edition projections are metadata).
 */
export const SEARCH_BODY_MAX_LENGTH = 20_000;

export const SEARCH_TOPICS_PER_DOCUMENT = 50;

/** One projection scope may carry at most this many documents. */
export const SEARCH_DOCUMENTS_PER_SCOPE = 200;

/** An owner's opaque staleness stamp for one scope. */
export const SEARCH_STAMP_MAX_LENGTH = 64;

/* ===========================================================================
 * What an owner hands to Search
 * ========================================================================= */

/**
 * The language a document's TEXT is written in — what decides how it is
 * tokenised and how it is announced (`lang`, `dir`).
 *
 * DISTINCT FROM `contentLanguage`, deliberately. A Topic's Urdu name is Urdu
 * text, but a Topic is not content written in Urdu; a Work's Arabic label is
 * Arabic text, but a Work has no language — its Editions do
 * (DOMAIN_MODEL.md §6.3, §10.1). Conflating the two would make the content
 * language filter return every Urdu-labelled thing instead of Urdu content.
 */
export const searchLanguageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i);

/**
 * One searchable document, as its OWNER defines it.
 *
 * Only public-safe fields a result can display or be matched on. No account,
 * no role, no private note, no storage key, no draft — the owner builds this
 * from its own PUBLIC read, and Search stores what it is given and nothing more.
 */
export const searchDocumentSourceSchema = z.strictObject({
  kind: searchKindSchema,
  resourceId: searchResourceIdSchema,
  textLanguage: searchLanguageCodeSchema,
  /** The genuine content Language, where the owner models one; else `null`. */
  contentLanguage: searchLanguageCodeSchema.nullable(),
  title: z.string().trim().min(1),
  summary: z.string(),
  /** Matched against, never displayed. Plain text, never markup. */
  body: z.string(),
  /** A genuine owner-provided publication year, never an invented one. */
  year: z.number().int().min(SEARCH_YEAR_MIN).max(SEARCH_YEAR_MAX).nullable(),
  topicIds: z.array(searchResourceIdSchema).max(SEARCH_TOPICS_PER_DOCUMENT),
});

export type SearchDocumentSource = z.infer<typeof searchDocumentSourceSchema>;

/**
 * An owner's CURRENT public projection of one scope.
 *
 * `null` means the scope is not public now — withdrawn, archived, drafted,
 * absent — and everything previously indexed for it is removed. There is no
 * third state: an owner that cannot answer throws, and the work is retried.
 */
export interface SearchScopeProjection {
  /** Opaque to Search; compared, never interpreted. */
  readonly stamp: string;
  readonly documents: readonly SearchDocumentSource[];
}

/** One currently-public scope, for rebuild and reconciliation enumeration. */
export interface SearchScopeListing {
  readonly id: string;
  readonly stamp: string;
}

/* ===========================================================================
 * Operational state
 * ========================================================================= */

/**
 * Why a unit of indexing work failed, as a CATEGORY.
 *
 * Never a message: an owner's or a driver's error text can carry content,
 * identifiers or SQL, and an operator screen is not where any of that belongs
 * (SECURITY_BASELINE.md §19.2).
 */
export const SEARCH_FAILURE_CATEGORIES = Object.freeze([
  /** The owner could not produce its projection. */
  'source-unavailable',
  /** The owner produced something outside the document contract. */
  'invalid-projection',
  /** The projection could not be written. */
  'index-write-failed',
] as const);

export type SearchFailureCategory = (typeof SEARCH_FAILURE_CATEGORIES)[number];

/** One failed scope, as an operator sees it. */
export interface SearchFailureView {
  readonly kind: SearchScopeKind;
  readonly id: string;
  readonly category: SearchFailureCategory;
  readonly attempts: number;
  readonly failedAt: Date;
  /** `true` once automatic retry has stopped and an operator must act. */
  readonly exhausted: boolean;
}

/** The operator's view of indexing health (DELIVERY_PLAN.md Phase 17). */
export interface SearchIndexStatus {
  /** Scopes waiting to be (re)projected, including requests not yet relayed. */
  readonly pending: number;
  /** Scopes whose automatic retry is exhausted. */
  readonly failed: number;
  /** Scopes failing but still being retried automatically. */
  readonly retrying: number;
  /** When the oldest unprocessed request was made — the indexing lag. */
  readonly oldestPendingAt: Date | null;
  readonly lastIndexedAt: Date | null;
  readonly documents: number;
  /**
   * Rows the engine has accepted but not yet made searchable. Full-text
   * population is asynchronous, so this is the second half of the lag.
   */
  readonly enginePending: number;
  readonly failures: readonly SearchFailureView[];
}

/* ===========================================================================
 * What a visitor receives
 * ========================================================================= */

/**
 * One result. PUBLIC-SAFE FIELDS ONLY (DELIVERY_PLAN.md Phase 17 §8).
 *
 * `href` is a LOCALE-FREE path the owner's CURRENT state produced at the moment
 * of this request — never the one recorded at indexing time — so a renamed slug
 * resolves to its current address and a withdrawn record has no result at all.
 */
export interface SearchHit {
  readonly kind: SearchKind;
  readonly resourceId: string;
  readonly href: string;
  readonly title: string;
  readonly summary: string;
  readonly textLanguage: string;
  readonly contentLanguage: string | null;
  readonly year: number | null;
}

export interface SearchResultPage {
  readonly hits: readonly SearchHit[];
  /** Matches in the index, capped at `SEARCH_RESULT_CEILING`. */
  readonly total: number;
  /** `true` when more matched than any visitor may page to. */
  readonly capped: boolean;
  readonly page: number;
  readonly pageCount: number;
  /**
   * Results the index still held but their owner no longer publishes. They are
   * never shown; the count exists so the omission is honest in tests and logs.
   */
  readonly withheld: number;
}
