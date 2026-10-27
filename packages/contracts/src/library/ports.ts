import type {
  WorkInput,
  EditionInput,
  TranslationInput,
  SalePointInput,
  LibraryQuery,
  AssetPurpose,
} from './values.ts';
import type {
  MagazineIssueRecord,
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
export interface LibraryReferencesPort {
  validPeople(ids: readonly string[]): Promise<boolean>;
  validTopics(ids: readonly string[]): Promise<boolean>;
  validLanguage(code: string): Promise<boolean>;
}
export interface WorkRecord extends WorkInput {
  id: string;
  version: number;
  updatedAt: Date;
}
export interface EditionRecord extends EditionInput {
  id: string;
  version: number;
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
