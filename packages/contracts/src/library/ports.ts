import type {
  WorkInput,
  EditionInput,
  TranslationInput,
  SalePointInput,
  LibraryQuery,
  AssetPurpose,
} from './values.ts';

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
}
export interface LibraryPersistencePort {
  works(offset: number): Promise<WorkPage>;
  work(id: string): Promise<WorkDetail | null>;
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
}
export interface LibraryAssetRequest {
  editionId: string;
  assetId: string;
  purpose: AssetPurpose;
}
