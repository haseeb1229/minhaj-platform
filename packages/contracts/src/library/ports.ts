import type { Locale } from '../env/shared.ts';
import type {
  WorkInput,
  EditionInput,
  TranslationInput,
  SalePointInput,
  LibraryQuery,
  AssetPurpose,
  LibraryCover,
  TopicWorksQuery,
} from './values.ts';
import type { PassageQuery, PassageSurahCount, QuranPassage } from '../passage/index.ts';
import type {
  MagazineIssueRecord,
  TopicResearchFacets,
  TopicResearchPage,
  TopicResearchQuery,
  ScholarlyAdminQuery,
  ScholarlyKind,
  ScholarlyListing,
  ScholarlyListingPage,
  ScholarlyQuery,
  ScholarlyRecord,
  ScholarlySearchRecord,
  ScholarlySitemapRow,
  ScholarlyTarget,
  ScholarlyValue,
  StandaloneScholarlyKind,
} from './scholarly.ts';

export interface LibraryActor {
  readonly accountId: string;
}
export interface LibraryAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
}
/**
 * Phase 30-R. Storage's narrow answer about which assets are servable still
 * images, asked before a cover is recorded. Infrastructure, not a context.
 */
export interface LibraryImagesPort {
  servableImages(assetIds: readonly string[]): Promise<ReadonlySet<string>>;
}
export interface LibraryReferencesPort {
  validPeople(ids: readonly string[]): Promise<boolean>;
  validTopics(ids: readonly string[]): Promise<boolean>;
  validLanguage(code: string): Promise<boolean>;
}
export interface WorkRecord extends WorkInput {
  id: string;
  version: number;
  updatedAt: Date;
  /**
   * Phase 30-R: the cover a card shows for this Work — that of its first
   * PUBLISHED Edition (by identifier) which has one — or null.
   */
  cover: (LibraryCover & { readonly editionId: string }) | null;
}
export interface EditionRecord extends EditionInput {
  id: string;
  version: number;
  /** Phase 30-R: the Edition's cover, or null — always stated on a record. */
  cover: LibraryCover | null;
  contentVersion: string | null;
  updatedAt: Date;
  translation: { sourceEditionId: string | null; translatorIds: string[] } | null;
}
export interface SalePointRecord extends SalePointInput {
  id: string;
  version: number;
}
export interface WorkDetail extends WorkRecord {
  editions: EditionRecord[];
  salePoints: SalePointRecord[];
  /**
   * Quran Part 8: the Quran passages this Work explains, in the order its
   * editor gave them — citation VALUES (`@minhaj/contracts/passage`), owned by
   * Library, with no reference into Quran (DOMAIN_MODEL.md §10.1).
   */
  quranPassages: readonly QuranPassage[];
}

/**
 * Quran Part 8: one PUBLIC Work that explains a Quran passage, as the Tafsir
 * hub composes it at Layer 4 — identity, address, titles, card cover, credits
 * and every passage it carries. No Edition, file or availability detail.
 */
export interface QuranPassageWork {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly { readonly locale: Locale; readonly title: string }[];
  readonly cover: (LibraryCover & { readonly editionId: string }) | null;
  readonly contributors: readonly { readonly personId: string; readonly role: string }[];
  /** The latest publication year among its published Editions, or null. */
  readonly year: number | null;
  readonly passages: readonly QuranPassage[];
}
/**
 * Quran Part 10 (Hadith Part 1): one PUBLIC Work on a subject's Books hub — a
 * card's worth: identity, address, titles and descriptions, card cover,
 * credits, the content languages of its published Editions, its latest year,
 * whether a published Edition may be read online, and the passages it
 * explains (always none without `quranPassages`). No file, asset or
 * availability internals.
 */
export interface TopicWork {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly isFeatured: boolean;
  readonly labels: readonly {
    readonly locale: Locale;
    readonly title: string;
    readonly description: string;
  }[];
  readonly cover: (LibraryCover & { readonly editionId: string }) | null;
  readonly contributors: readonly { readonly personId: string; readonly role: string }[];
  /** The distinct content languages of its published Editions, A–Z by code. */
  readonly languages: readonly string[];
  /** The latest publication year among its published Editions, or null. */
  readonly year: number | null;
  /** A published Edition offers reading online (its availability allows it). */
  readonly readable: boolean;
  /** Its Quran passages, in the order its editor gave them. */
  readonly passages: readonly QuranPassage[];
}

/** One page of the Topic Works read, with how many Works the query admits in all. */
export interface TopicWorkPage {
  readonly items: readonly TopicWork[];
  readonly total: number;
  readonly hasMore: boolean;
}

/**
 * Quran Part 10 (Hadith Part 1): the aggregates a Books hub is navigated by —
 * each ONE grouped read, each bounded, each counting public Works:
 *
 *   `hub`          the whole set, unfiltered: Works, those explaining a
 *                  passage, the featured, and the distinct content languages;
 *   `shelves`      the set under the query's language and contributor: all,
 *                  and those explaining a passage;
 *   `languages`    content language → Works, under the query's shelf, Surah
 *                  and contributor (its own filter left out, so every option
 *                  says what choosing it would show);
 *   `contributors` Person → Works, under the shelf, Surah and language;
 *   `surahs`       Surah → Works explaining a passage in it, under the
 *                  language and contributor.
 *
 * Without `quranPassages` nothing explains a passage: `explaining` is zero
 * and `surahs` empty.
 */
export interface TopicWorkFacets {
  readonly hub: {
    readonly works: number;
    readonly explaining: number;
    readonly featured: number;
    readonly languages: number;
  };
  readonly shelves: { readonly all: number; readonly explaining: number };
  readonly languages: LibraryFacetPage;
  readonly contributors: LibraryFacetPage;
  readonly surahs: readonly PassageSurahCount[];
}

export interface WorkPage {
  items: WorkRecord[];
  hasMore: boolean;
}
export interface LibrarySitemapRow {
  slug: string;
  locales: string[];
  updatedAt: Date;
}
export interface LibraryAssetRelation {
  workState: string;
  editionState: string;
  reading: string;
  download: string;
  readableAssetId: string | null;
  downloadAssetId: string | null;
  /** Phase 30-R: the Edition's cover asset, or null. */
  coverAssetId: string | null;
}

/** Phase 30-R: what the issue-cover route decides by — the issue, its Magazine, its cover. */
export interface IssueCoverRelation {
  issueState: string;
  magazineState: string;
  coverAssetId: string | null;
}
/**
 * One navigational facet of the published Library: an identifier and how many
 * public Works carry it.
 *
 * `id` is deliberately untyped as to WHAT it identifies — a Person, a Topic or a
 * Language code — because the three facet reads differ only in what they group
 * by, and three identical interfaces would be three places for one shape to
 * drift. The method that returns it says which.
 *
 * THE COUNT IS OF PUBLIC WORKS, so a facet whose only Works are drafts does not
 * appear at all. A browse entry leading to an empty result is dead navigation
 * (ROUTE_MAP.md §5.2), and filtering it out here is what stops the page having to
 * guess.
 */
export interface LibraryFacet {
  readonly id: string;
  readonly works: number;
}

export interface LibraryFacetPage {
  readonly items: LibraryFacet[];
  readonly hasMore: boolean;
}

/** One public Work as another context may name it: identity, address, titles. */
export interface WorkReference {
  readonly id: string;
  readonly slug: string;
  readonly labels: readonly { readonly locale: string; readonly title: string }[];
}

export interface LibraryPublicReaderPort {
  works(query: LibraryQuery): Promise<WorkPage>;
  work(slug: string): Promise<WorkDetail | null>;
  canonicalSlug(slug: string): Promise<string | null>;
  salePoints(offset: number): Promise<{ items: SalePointRecord[]; hasMore: boolean }>;
  sitemap(offset: number, limit: number): Promise<LibrarySitemapRow[]>;
  assetRelation(editionId: string): Promise<LibraryAssetRelation | null>;
  /** Phase 30-R: the relation the issue-cover route decides by, or null. */
  issueCoverRelation(issueId: string): Promise<IssueCoverRelation | null>;
  /**
   * The navigational facets `/library/authors`, `/library/topics` and
   * `/library/languages` browse by.
   *
   * THREE AGGREGATE READS, not one read per row. The pages that consume them
   * resolve the display names for a whole page of identifiers in ONE call to the
   * owning context, so a listing of 25 contributors costs two queries rather
   * than twenty-six (§32, §49).
   *
   * Library does not own a Person, a Topic or a Language. These return
   * IDENTIFIERS and counts of its own Works; the names come from the owners.
   */
  contributorFacets(offset: number): Promise<LibraryFacetPage>;
  topicFacets(offset: number): Promise<LibraryFacetPage>;
  languageFacets(offset: number): Promise<LibraryFacetPage>;

  /**
   * Search projection reads (DELIVERY_PLAN.md Phase 17 — "Work, Edition and
   * BookTranslation records").
   *
   * THE SAME PUBLIC PREDICATE as every other public Library read: a Work is
   * public when it is published and has a published Edition, and only its
   * published Editions are carried. Metadata only — no reader text, no file,
   * no asset identifier, no availability internals.
   */
  searchWork(id: string): Promise<LibrarySearchRecord | null>;
  searchWorks(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;

  /** Current public addresses of whichever Works are public now. Bounded. */
  publicWorkTargets(
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly slug: string }[]>;

  /**
   * Current public addresses of whichever Editions are public now — published,
   * within a public Work. Bounded.
   */
  publicEditionTargets(
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly workSlug: string }[]>;

  /**
   * PHASE 15 — THE WORK REFERENCE SURFACE an Editorial Collection is composed
   * from (Editorial → Library). PUBLIC WORKS ONLY, under the same predicate as
   * every public Library read: a Work that is not public now is simply absent,
   * so no caller learns a draft's title. Identity, current slug and titles —
   * no Edition, file, asset or availability detail. Bounded; one call per
   * batch, never one per Work.
   */
  workReferences(ids: readonly string[]): Promise<readonly WorkReference[]>;
  /** Public Works an editor may choose, narrowed by title text. Bounded. */
  workChoices(text: string | null, limit: number): Promise<readonly WorkReference[]>;

  /**
   * QURAN PART 8 — WHICH PUBLIC WORKS EXPLAIN A PASSAGE. Every public Work
   * (the ordinary public predicate) one of whose Quran passages overlaps the
   * query's range of its Surah — or, with no Surah, every public Work carrying
   * a passage — ordered by its earliest passage, then slug. Bounded by the
   * query's limit; one read, never one per Work. Library answers by citation
   * value: it reads nothing of Quran.
   */
  quranPassageWorks(query: PassageQuery): Promise<readonly QuranPassageWork[]>;
  /** How many public Works carry a passage in each Surah. ONE grouped read. */
  quranPassageCounts(): Promise<readonly PassageSurahCount[]>;

  /**
   * THE TOPIC WORKS READ (Quran Part 10; Hadith Part 1) — a subject's Books
   * hub. One bounded, ordered page of the public Works on the query's Topic
   * or, with `quranPassages`, carrying a Quran passage
   * (`topicWorksQuerySchema`), with the total the query admits; and the hub's
   * aggregates (`TopicWorkFacets`). The ordinary public predicate
   * throughout; the Topic is an identifier Library holds, never a Taxonomy
   * read, and the passages are Library's own citation values.
   */
  topicWorks(query: TopicWorksQuery): Promise<TopicWorkPage>;
  topicWorkFacets(query: TopicWorksQuery): Promise<TopicWorkFacets>;

  /**
   * THE TOPIC RESEARCH READ (Quran Part 12; Hadith Part 1) — a subject's
   * Research hub. One bounded, ordered page of the public Research and
   * ResearchPaper records on the query's Topic (`topicResearchQuerySchema`),
   * with the total the query admits; and the hub's aggregates
   * (`TopicResearchFacets`). Each aggregate's ONE public
   * predicate throughout; the Topic is an identifier Library holds, never a
   * Taxonomy read, and no record carries a Quran passage.
   */
  topicResearch(query: TopicResearchQuery): Promise<TopicResearchPage>;
  topicResearchFacets(query: TopicResearchQuery): Promise<TopicResearchFacets>;

  /* -------------------------------------------------------------------------
   * Phase 9 — Research, ResearchPaper, Publication, Magazine, MagazineIssue and
   * Encyclopedia (DOMAIN_MODEL.md §10.2).
   *
   * ONE PUBLIC PREDICATE PER AGGREGATE, applied in the query: a record is public
   * when it is `published`, and an issue additionally only while its Magazine is.
   * Every read below — listing, detail, redirect, sitemap, search — composes the
   * same predicate, so no two of them can disagree about what exists.
   * ---------------------------------------------------------------------- */

  /** One bounded page of public records of one kind, in a deterministic order. */
  scholarlyList(
    kind: ScholarlyKind,
    query: ScholarlyQuery,
  ): Promise<ScholarlyListingPage>;

  /** One public record of `kind` by its CURRENT slug. */
  scholarlyRecord(
    kind: StandaloneScholarlyKind,
    slug: string,
  ): Promise<ScholarlyRecord | null>;

  /** The current slug a current or FORMER slug of a public record resolves to. */
  scholarlyCanonicalSlug(
    kind: StandaloneScholarlyKind,
    slug: string,
  ): Promise<string | null>;

  /** One bounded page of a public Magazine's public issues, newest first. */
  magazineIssues(magazineId: string, offset: number): Promise<ScholarlyListingPage>;

  /** One public issue by its Magazine's CURRENT slug and its own CURRENT slug. */
  magazineIssue(
    magazineSlug: string,
    issueSlug: string,
  ): Promise<MagazineIssueRecord | null>;

  /**
   * The current address a current or former Magazine slug and a current or
   * former issue slug resolve to — both halves at once, so an old periodical
   * address redirects in ONE hop.
   */
  magazineIssueCanonical(
    magazineSlug: string,
    issueSlug: string,
  ): Promise<{ readonly magazineSlug: string; readonly issueSlug: string } | null>;

  /**
   * The adjacent public issues by volume and number, where that order is
   * unambiguous — both numbers known. Two indexed reads, never a scan.
   */
  magazineIssueNeighbours(issueId: string): Promise<{
    readonly previous: ScholarlyListing | null;
    readonly next: ScholarlyListing | null;
  }>;

  scholarlySitemap(
    kind: ScholarlyKind,
    offset: number,
    limit: number,
  ): Promise<readonly ScholarlySitemapRow[]>;

  /** Search projection reads, under the same public predicate. */
  scholarlySearchRecord(
    kind: ScholarlyKind,
    id: string,
  ): Promise<ScholarlySearchRecord | null>;
  scholarlySearchList(
    kind: ScholarlyKind,
    input: { readonly after: string | null; readonly limit: number },
  ): Promise<readonly { readonly id: string; readonly stamp: string }[]>;

  /** Current public addresses of whichever of `ids` are public now. Bounded. */
  scholarlyTargets(
    kind: ScholarlyKind,
    ids: readonly string[],
  ): Promise<readonly ScholarlyTarget[]>;
}

/** What Search may know about one public Work and its published Editions. */
export interface LibrarySearchRecord {
  readonly id: string;
  readonly slug: string;
  /** `Work.version`, which every Library mutation touching the Work moves. */
  readonly stamp: string;
  readonly primaryLocale: string;
  readonly topicIds: readonly string[];
  readonly labels: readonly {
    readonly locale: string;
    readonly title: string;
    readonly description: string;
  }[];
  readonly editions: readonly {
    readonly id: string;
    readonly label: string;
    readonly languageCode: string;
    readonly publisher: string | null;
    readonly publicationYear: number | null;
    readonly isbn: string | null;
    /** A genuine BookTranslation of another Edition of this Work. */
    readonly isTranslation: boolean;
  }[];
}
export interface LibraryPersistencePort {
  works(offset: number): Promise<WorkPage>;
  work(id: string): Promise<WorkDetail | null>;
  /**
   * The Work whose CURRENT slug is exactly this one, in any state — the
   * administrative lookup an operator (or the migration publisher resuming an
   * interrupted publication) needs to find a record by its address. A FORMER
   * slug resolves to nothing here: it is reserved history, not this Work's name.
   */
  workBySlug(slug: string): Promise<WorkDetail | null>;
  editions(offset: number): Promise<{ items: EditionRecord[]; hasMore: boolean }>;
  edition(id: string): Promise<EditionRecord | null>;
  salePoints(offset: number): Promise<{ items: SalePointRecord[]; hasMore: boolean }>;
  saveWork(input: {
    actorId: string;
    id: string | null;
    expectedVersion: number | null;
    value: WorkInput;
  }): Promise<WorkRecord>;
  saveEdition(input: {
    actorId: string;
    id: string | null;
    expectedVersion: number | null;
    value: EditionInput;
    contentVersion: string | null;
  }): Promise<EditionRecord>;
  saveTranslation(input: TranslationInput & { actorId: string }): Promise<void>;
  removeTranslation(input: {
    actorId: string;
    editionId: string;
    expectedVersion: number;
  }): Promise<void>;
  saveSalePoint(input: {
    actorId: string;
    id: string | null;
    expectedVersion: number | null;
    value: SalePointInput;
  }): Promise<SalePointRecord>;
  /**
   * Quran Part 8. Replaces a Work's ordered Quran passages with `passages` —
   * ONLY while the Work is still at `expectedVersion`, which it advances — and
   * audits the named change: an editor's `add`, `remove` or `move`, or
   * `title`, a set the operator command proposed from the Work's title.
   */
  setWorkQuranPassages(input: {
    actorId: string;
    workId: string;
    expectedVersion: number;
    passages: readonly QuranPassage[];
    change: 'add' | 'remove' | 'move' | 'title';
  }): Promise<WorkDetail>;

  /** Phase 9: the administrative directory of one aggregate, any state. */
  scholarlyRecords(
    kind: ScholarlyKind,
    query: ScholarlyAdminQuery,
  ): Promise<ScholarlyListingPage>;
  scholarlyRecordById(kind: ScholarlyKind, id: string): Promise<ScholarlyRecord | null>;
  /**
   * Creates (`id === null`) or updates one record under its expected version,
   * replacing its label, contributor, topic and citation sets, reserving its
   * slug, recording its audit entry and its search intent — in ONE transaction.
   */
  saveScholarly(input: {
    actorId: string;
    id: string | null;
    expectedVersion: number | null;
    save: ScholarlyValue;
  }): Promise<ScholarlyRecord>;
}
export interface LibraryAssetRequest {
  editionId: string;
  assetId: string;
  purpose: AssetPurpose;
}
