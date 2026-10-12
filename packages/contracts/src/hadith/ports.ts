import type { PrivilegedActor } from '../identity/authorization.ts';
import type {
  BookCreateValue,
  ChapterCreateValue,
  CitationSetValue,
  CollectionCreateValue,
  CollectionNamesValue,
  CommentaryEntrySaveValue,
  CommentaryValue,
  HadithAvailability,
  HadithBookRecord,
  HadithChapterRecord,
  HadithCitationTarget,
  HadithCollectionRecord,
  HadithCommentaryRecord,
  HadithLayerState,
  HadithRecordDetail,
  HadithRecordFilter,
  HadithScienceRecord,
  HadithSearchRecord,
  HadithSitemapEntry,
  HadithSourceSystemRecord,
  HadithTranslationRecord,
  PublicHadith,
  PublicHadithBook,
  PublicHadithCollection,
  PublicHadithCommentary,
  PublicHadithScience,
  PublicHadithScienceSummary,
  PublicHadithStructure,
  RecordCorrectionValue,
  RecordCreateValue,
  RecordVerificationValue,
  ScienceValue,
  StructureNamesValue,
  TranslationValue,
  PublicHadithCitationPage,
  HadithCollectionPage,
  HadithBookPage,
  HadithChapterPage,
  HadithRecordSummaryPage,
  HadithCommentaryPage,
  HadithCommentaryEntryPage,
  HadithSciencePage,
} from './values.ts';

/**
 * Hadith's ports. Three of them, for three postures:
 *
 *   PUBLIC READER   — anonymous, no actor: only what is public NOW, and nothing
 *                     at all while no collection is activated.
 *   PERSISTENCE     — administration under `hadith.read` / `hadith.administer`:
 *                     every read, and every write to LAYERED records. No method
 *                     here writes a sourced fact.
 *   CANONICAL       — the only write path to structure, records, gradings,
 *                     chains, verification and citations, each call carrying a
 *                     verified `hadith-canonical-edit` authority the database
 *                     re-checks.
 *
 * Source systems, editions and activation have no write method anywhere: they
 * are the owner/operator's to register.
 */

/** Who performs a non-canonical Hadith operation. */
export interface HadithActor {
  readonly accountId: string;
}

/**
 * Identity, as Hadith needs it — wired at Layer 4. `permits` answers a live
 * permission question; `verifyCanonical` re-verifies an Identity-minted
 * `PrivilegedActor` for `hadith.editCanonical` with the `hadith-canonical-edit`
 * purpose.
 */
export interface HadithAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
  verifyCanonical(actor: PrivilegedActor): Promise<boolean>;
}

/* ===========================================================================
 * Public reader
 * ========================================================================= */

export interface HadithPublicReaderPort {
  availability(): Promise<HadithAvailability>;
  /** Activated collections that hold at least one public citation. */
  collections(): Promise<readonly PublicHadithCollection[]>;
  collection(slug: string): Promise<PublicHadithCollection | null>;
  /** The books holding at least one public citation of the collection, in source order. */
  books(collectionId: string): Promise<readonly PublicHadithBook[]>;
  book(collectionId: string, slug: string): Promise<PublicHadithBook | null>;
  /** The chapters of a book holding at least one public citation. */
  chapters(bookId: string): Promise<readonly PublicHadithStructure[]>;
  chapter(bookId: string, slug: string): Promise<PublicHadithStructure | null>;
  /** Public citations placed in the book and in no chapter. */
  bookCitations(bookId: string, offset: number): Promise<PublicHadithCitationPage>;
  chapterCitations(chapterId: string, offset: number): Promise<PublicHadithCitationPage>;
  /** The canonical citation page's facts, or null unless public now. */
  citation(collectionSlug: string, number: number): Promise<PublicHadith | null>;
  /** Every public citation, collection by collection, number by number. */
  browse(offset: number): Promise<PublicHadithCitationPage>;
  topicCitations(topicId: string, offset: number): Promise<PublicHadithCitationPage>;
  commentaries(): Promise<readonly PublicHadithCommentary[]>;
  sciences(): Promise<readonly PublicHadithScienceSummary[]>;
  science(slug: string): Promise<PublicHadithScience | null>;
  citationSitemap(offset: number, limit: number): Promise<readonly HadithSitemapEntry[]>;
  /** Search: the current projection of one citation, or null when it is not public. */
  searchCitation(citationId: string): Promise<HadithSearchRecord | null>;
  /** Search: every public citation's scope and stamp, after a cursor. */
  searchCitationScopes(
    after: string | null,
    limit: number,
  ): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
  /** Search visibility: which of these citations are public now, and where. */
  publicCitationTargets(ids: readonly string[]): Promise<readonly HadithCitationTarget[]>;
  /** Search results: the current projection of up to `HADITH_SEARCH_RECORDS_MAX` citations. */
  searchCitationRecords(ids: readonly string[]): Promise<readonly HadithSearchRecord[]>;
}

/* ===========================================================================
 * Administration — reads, and layered writes only
 * ========================================================================= */

interface Attributed {
  readonly actorId: string;
}

interface Versioned extends Attributed {
  readonly id: string;
  readonly expectedVersion: number;
}

export interface HadithPersistencePort {
  sourceSystems(): Promise<readonly HadithSourceSystemRecord[]>;

  collections(offset: number): Promise<HadithCollectionPage>;
  collection(id: string): Promise<HadithCollectionRecord | null>;
  saveCollectionNames(
    input: Attributed & { readonly value: CollectionNamesValue },
  ): Promise<void>;

  books(collectionId: string | null, offset: number): Promise<HadithBookPage>;
  book(id: string): Promise<HadithBookRecord | null>;
  saveBookNames(
    input: Attributed & { readonly value: StructureNamesValue },
  ): Promise<void>;

  chapters(bookId: string | null, offset: number): Promise<HadithChapterPage>;
  chapter(id: string): Promise<HadithChapterRecord | null>;
  saveChapterNames(
    input: Attributed & { readonly value: StructureNamesValue },
  ): Promise<void>;

  records(
    filter: { readonly collectionId: string | null; readonly view: HadithRecordFilter },
    offset: number,
  ): Promise<HadithRecordSummaryPage>;
  record(id: string): Promise<HadithRecordDetail | null>;

  translations(hadithId: string): Promise<readonly HadithTranslationRecord[]>;
  translation(id: string): Promise<HadithTranslationRecord | null>;
  createTranslation(
    input: Attributed & { readonly hadithId: string; readonly value: TranslationValue },
  ): Promise<HadithTranslationRecord>;
  updateTranslation(
    input: Versioned & { readonly value: TranslationValue },
  ): Promise<HadithTranslationRecord>;
  setTranslationState(
    input: Versioned & { readonly state: HadithLayerState },
  ): Promise<HadithTranslationRecord>;

  commentaries(offset: number): Promise<HadithCommentaryPage>;
  commentary(id: string): Promise<HadithCommentaryRecord | null>;
  createCommentary(
    input: Attributed & { readonly value: CommentaryValue },
  ): Promise<HadithCommentaryRecord>;
  updateCommentary(
    input: Versioned & { readonly value: CommentaryValue },
  ): Promise<HadithCommentaryRecord>;
  setCommentaryState(
    input: Versioned & { readonly state: HadithLayerState },
  ): Promise<HadithCommentaryRecord>;
  commentaryEntries(
    commentaryId: string,
    offset: number,
  ): Promise<HadithCommentaryEntryPage>;
  /** Saves or removes one entry under the commentary's expected version. */
  saveCommentaryEntry(
    input: Versioned & { readonly value: CommentaryEntrySaveValue },
  ): Promise<HadithCommentaryRecord>;

  sciences(offset: number): Promise<HadithSciencePage>;
  science(id: string): Promise<HadithScienceRecord | null>;
  createScience(
    input: Attributed & { readonly value: ScienceValue },
  ): Promise<HadithScienceRecord>;
  updateScience(
    input: Versioned & { readonly value: ScienceValue },
  ): Promise<HadithScienceRecord>;
  setScienceState(
    input: Versioned & { readonly state: HadithLayerState },
  ): Promise<HadithScienceRecord>;

  addRecordTopic(
    input: Attributed & { readonly hadithId: string; readonly topicId: string },
  ): Promise<void>;
  removeRecordTopic(
    input: Attributed & { readonly hadithId: string; readonly topicId: string },
  ): Promise<void>;
}

/* ===========================================================================
 * Canonical — the only write path to sourced Hadith facts
 * ========================================================================= */

/** The verified authority every canonical write carries into the database. */
export interface HadithCanonicalAuthority {
  readonly actorId: string;
  readonly sessionId: string;
  readonly stepUpGrantId: string;
}

interface Authorised {
  readonly authority: HadithCanonicalAuthority;
}

export interface HadithCanonicalPort {
  createCollection(
    input: Authorised & { readonly value: CollectionCreateValue },
  ): Promise<{ readonly id: string }>;
  createBook(
    input: Authorised & { readonly value: BookCreateValue },
  ): Promise<{ readonly id: string }>;
  createChapter(
    input: Authorised & { readonly value: ChapterCreateValue },
  ): Promise<{ readonly id: string }>;
  /**
   * Creates a source-qualified record with its gradings at version 1, records
   * conflict evidence against every disagreeing candidate for its citation
   * number, and appends the immutable revision.
   */
  createRecord(input: Authorised & { readonly value: RecordCreateValue }): Promise<{
    readonly id: string;
    readonly version: number;
    readonly conflicts: number;
  }>;
  /** Replaces every sourced fact of a record under its expected version. */
  correctRecord(
    input: Authorised & { readonly value: RecordCorrectionValue },
  ): Promise<{ readonly version: number; readonly conflicts: number }>;
  /** Human verification of the reviewed version. */
  verifyRecord(
    input: Authorised & { readonly value: RecordVerificationValue },
  ): Promise<void>;
  /** Maps a public citation to one candidate, or withdraws it. */
  setCitation(
    input: Authorised & { readonly value: CitationSetValue },
  ): Promise<{ readonly id: string; readonly version: number }>;
}
