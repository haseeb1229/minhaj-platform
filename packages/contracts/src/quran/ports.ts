import type { PrivilegedActor } from '../identity/authorization.ts';
import type {
  AyahRecordPage,
  PublicAyahPage,
  RecitationPage,
  TafsirEntryPage,
  TafsirPage,
  TopicAyahPage,
  TranslationPage,
  TransliterationPage,
  AyahDetail,
  AyahSearchRecord,
  CandidateAyah,
  CorrectionPreview,
  LayerText,
  LayerTextChange,
  PublicAyah,
  PublicJuz,
  PublicLayerWork,
  PublicRecitation,
  PublicRecitationSegment,
  PublicSurah,
  PublicTajweedRule,
  PublicTransliteration,
  QuranAvailability,
  QuranCorpusStatus,
  QuranLayerState,
  QuranRef,
  QuranSitemapRow,
  QuranSourceRecord,
  RecitationDetail,
  RecitationSegmentAsset,
  RecitationSegmentValue,
  RecitationValue,
  SurahNamesValue,
  SurahRecord,
  TafsirEntryRecord,
  TafsirEntryValue,
  TafsirRecord,
  TafsirValue,
  TajweedRuleRecord,
  TajweedRuleValue,
  TranslationRecord,
  TranslationValue,
  TransliterationRecord,
  TransliterationValue,
  VerificationMismatch,
} from './values.ts';

/**
 * The ports between the Quran context and what it depends on
 * (ARCHITECTURE.md §3.1.1, §4.1).
 *
 * The context lives in `apps/web/src/contexts/quran/` and its adapter in
 * `packages/database/src/adapters/quran/`; neither imports the other, and both
 * import this. Every operation is ONE named act with its own bounds — no
 * repository, no `where`, no transaction handle.
 *
 * THREE SURFACES, AND THE SPLIT IS THE SECURITY BOUNDARY.
 *
 *   - `QuranPublicReaderPort` takes no actor and returns only what is public
 *     NOW: nothing at all while the corpus is inactive, and no layered work that
 *     is unpublished or lacks a registered source. The public reader and Search
 *     are built on it and cannot render withheld state by forgetting a check.
 *   - `QuranPersistencePort` is reached only through the Quran service, which
 *     re-checks `quran.read` or `quran.administer` live on every call. It has NO
 *     method that writes canonical text or structure.
 *   - `QuranCanonicalPort` is the ONLY write path to canonical Arabic and
 *     structure, and every method on it is a database procedure that re-verifies
 *     the actor's live permission and purpose-bound step-up grant, the source,
 *     the expected version and the exact text before it writes anything.
 *
 * QURAN NEVER READS ANOTHER CONTENT CONTEXT. Contributor names come from People
 * and Topic names from Taxonomy, composed at Layer 4; Media, Library and
 * Editorial are never consulted, and none of them can author a Recitation.
 */

export interface QuranActor {
  readonly accountId: string;
}

/**
 * What Quran asks Identity. Live on every call.
 *
 * `verifyCanonical` is Identity's `verifyPrivilegedActor` for exactly
 * `quran.editCanonical` with the `quran-canonical-edit` step-up purpose — a
 * grant earned for privilege administration or for a second factor answers no.
 */
export interface QuranAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
  verifyCanonical(actor: PrivilegedActor): Promise<boolean>;
}

/* ===========================================================================
 * Public reads
 * ========================================================================= */

export interface QuranPublicReaderPort {
  availability(): Promise<QuranAvailability>;

  /** Every Surah, in number order. Empty while the corpus is inactive. */
  surahs(): Promise<readonly PublicSurah[]>;
  surah(number: number): Promise<PublicSurah | null>;
  /**
   * The ayat of one Surah in a bounded inclusive range, in order. A whole
   * Surah fits the bound, so a Surah page is ONE read rather than one per Ayah.
   */
  ayat(surah: number, from: number, to: number): Promise<readonly PublicAyah[]>;
  ayah(ref: QuranRef): Promise<PublicAyah | null>;
  /** Every Juz with its derived range, in number order. */
  juzList(): Promise<readonly PublicJuz[]>;
  juz(number: number): Promise<PublicJuz | null>;
  /** One bounded page of a Juz's ayat in canonical order. */
  juzAyat(number: number, offset: number): Promise<PublicAyahPage>;

  translations(): Promise<readonly PublicLayerWork[]>;
  translation(slug: string): Promise<PublicLayerWork | null>;
  transliterations(): Promise<readonly PublicTransliteration[]>;
  transliteration(slug: string): Promise<PublicTransliteration | null>;
  tafsirs(): Promise<readonly PublicLayerWork[]>;
  tafsir(slug: string): Promise<PublicLayerWork | null>;

  /** One public work's texts for a range of one Surah — ONE read per page, never per Ayah. */
  translationTexts(
    workId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly LayerText[]>;
  transliterationTexts(
    workId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly LayerText[]>;
  /** Public Tafsir entries overlapping a range of one Surah, in range order. */
  tafsirEntries(
    workId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly TafsirEntryRecord[]>;
  /** One bounded page of a public Tafsir's entries, in canonical order. */
  tafsirEntryPage(workId: string, offset: number): Promise<TafsirEntryPage>;

  recitations(): Promise<readonly PublicRecitation[]>;
  recitation(slug: string): Promise<PublicRecitation | null>;
  recitationsByReciter(personId: string): Promise<readonly PublicRecitation[]>;
  /** A public Recitation's segments with audio, in canonical order. Bounded. */
  recitationSegments(
    recitationId: string,
    surah: number | null,
  ): Promise<readonly PublicRecitationSegment[]>;

  tajweedRules(): Promise<readonly PublicTajweedRule[]>;
  tajweedRule(slug: string): Promise<PublicTajweedRule | null>;

  /** One bounded page of the public ayat assigned to a Topic, in canonical order. */
  topicAyat(topicId: string, offset: number): Promise<TopicAyahPage>;

  /** Canonical Ayah URLs for the sitemap — APPROVED corpus only, bounded. */
  ayahSitemap(offset: number, limit: number): Promise<readonly QuranSitemapRow[]>;
  ayahSitemapCount(): Promise<number>;

  /* ---- Search ----------------------------------------------------------- */

  /** One Ayah's public projection, or null when it is not public now. */
  searchAyah(ref: QuranRef): Promise<AyahSearchRecord | null>;
  /** Public Ayah scopes after a citation, for rebuild and reconciliation. Bounded. */
  searchAyahScopes(
    after: QuranRef | null,
    limit: number,
  ): Promise<readonly { readonly ref: QuranRef; readonly stamp: string }[]>;
  /** Of these citations, those public now. */
  publicAyahTargets(refs: readonly QuranRef[]): Promise<readonly QuranRef[]>;
  /**
   * The CURRENT public projection of each of these citations that is public
   * now — `searchAyah`'s record, for many at once, in canonical order. A
   * results page displays these rather than an index summary, which may lag a
   * withdrawn layer or a corrected text until the indexer catches up. At most
   * `QURAN_SEARCH_RECORDS_MAX` citations; one bounded batch, never one read per
   * citation.
   */
  searchAyahRecords(refs: readonly QuranRef[]): Promise<readonly AyahSearchRecord[]>;

  /* ---- Serving ---------------------------------------------------------- */

  /** The recorded asset of a segment and whether it is public now. */
  segmentAsset(
    recitationId: string,
    segmentId: string,
  ): Promise<RecitationSegmentAsset | null>;
}

/* ===========================================================================
 * Administration — non-canonical
 * ========================================================================= */

/** Audit attribution every administrative write carries. */
interface Attributed {
  readonly actorId: string;
}

interface Versioned extends Attributed {
  readonly id: string;
  readonly expectedVersion: number;
}

export interface QuranPersistencePort {
  corpusStatus(): Promise<QuranCorpusStatus>;
  source(id: string): Promise<QuranSourceRecord | null>;
  /** The source's text for one Ayah, exactly as registered. */
  sourceText(sourceId: string, ref: QuranRef): Promise<string | null>;

  surahs(): Promise<readonly SurahRecord[]>;
  surahAyat(surah: number, offset: number): Promise<AyahRecordPage>;
  ayah(ref: QuranRef): Promise<AyahDetail | null>;
  correctionPreview(ref: QuranRef, sourceId: string): Promise<CorrectionPreview | null>;
  /** Replaces the localised display names of a Surah. Presentation only. */
  saveSurahNames(
    input: Attributed & {
      readonly expectedVersion: number;
      readonly value: SurahNamesValue;
    },
  ): Promise<SurahRecord>;

  addAyahTopic(
    input: Attributed & { readonly ref: QuranRef; readonly topicId: string },
  ): Promise<void>;
  removeAyahTopic(
    input: Attributed & { readonly ref: QuranRef; readonly topicId: string },
  ): Promise<void>;

  /* ---- Translation, Transliteration, Tafsir ------------------------------ */

  translations(offset: number): Promise<TranslationPage>;
  translation(id: string): Promise<TranslationRecord | null>;
  createTranslation(
    input: Attributed & { readonly value: TranslationValue },
  ): Promise<TranslationRecord>;
  updateTranslation(
    input: Versioned & { readonly value: TranslationValue },
  ): Promise<TranslationRecord>;
  setTranslationState(
    input: Versioned & { readonly state: QuranLayerState },
  ): Promise<TranslationRecord>;
  translationTexts(id: string, surah: number): Promise<readonly LayerText[]>;
  saveTranslationTexts(
    input: Versioned & {
      readonly surah: number;
      readonly changes: readonly LayerTextChange[];
    },
  ): Promise<TranslationRecord>;

  transliterations(offset: number): Promise<TransliterationPage>;
  transliteration(id: string): Promise<TransliterationRecord | null>;
  createTransliteration(
    input: Attributed & { readonly value: TransliterationValue },
  ): Promise<TransliterationRecord>;
  updateTransliteration(
    input: Versioned & { readonly value: TransliterationValue },
  ): Promise<TransliterationRecord>;
  setTransliterationState(
    input: Versioned & { readonly state: QuranLayerState },
  ): Promise<TransliterationRecord>;
  transliterationTexts(id: string, surah: number): Promise<readonly LayerText[]>;
  saveTransliterationTexts(
    input: Versioned & {
      readonly surah: number;
      readonly changes: readonly LayerTextChange[];
    },
  ): Promise<TransliterationRecord>;

  tafsirs(offset: number): Promise<TafsirPage>;
  tafsir(id: string): Promise<TafsirRecord | null>;
  createTafsir(
    input: Attributed & { readonly value: TafsirValue },
  ): Promise<TafsirRecord>;
  updateTafsir(input: Versioned & { readonly value: TafsirValue }): Promise<TafsirRecord>;
  setTafsirState(
    input: Versioned & { readonly state: QuranLayerState },
  ): Promise<TafsirRecord>;
  tafsirEntries(id: string, surah: number): Promise<readonly TafsirEntryRecord[]>;
  /** Adds an entry, or replaces `entryId`'s, under the Tafsir's expected version. */
  saveTafsirEntry(
    input: Versioned & {
      readonly entryId: string | null;
      readonly value: TafsirEntryValue;
    },
  ): Promise<TafsirRecord>;
  removeTafsirEntry(
    input: Versioned & { readonly entryId: string },
  ): Promise<TafsirRecord>;

  /* ---- Recitation -------------------------------------------------------- */

  recitations(offset: number): Promise<RecitationPage>;
  recitation(id: string): Promise<RecitationDetail | null>;
  createRecitation(
    input: Attributed & { readonly value: RecitationValue },
  ): Promise<RecitationDetail>;
  updateRecitation(
    input: Versioned & { readonly value: RecitationValue },
  ): Promise<RecitationDetail>;
  setRecitationState(
    input: Versioned & { readonly state: QuranLayerState },
  ): Promise<RecitationDetail>;
  addRecitationSegment(
    input: Versioned & { readonly value: RecitationSegmentValue },
  ): Promise<RecitationDetail>;
  removeRecitationSegment(
    input: Versioned & { readonly segmentId: string },
  ): Promise<RecitationDetail>;
  /**
   * Records `assetId` as a segment's audio — ONLY if the Recitation is still at
   * `expectedVersion`. The previous asset is left untouched in Storage.
   */
  attachSegmentAsset(
    input: Versioned & { readonly segmentId: string; readonly assetId: string },
  ): Promise<RecitationDetail>;
  /** The asset recorded against a segment, whatever its state — the admin preview's question. */
  segmentAssetForPreview(recitationId: string, segmentId: string): Promise<string | null>;

  /* ---- Tajweed ------------------------------------------------------------ */

  tajweedRules(): Promise<readonly TajweedRuleRecord[]>;
  tajweedRule(id: string): Promise<TajweedRuleRecord | null>;
  createTajweedRule(
    input: Attributed & { readonly value: TajweedRuleValue },
  ): Promise<TajweedRuleRecord>;
  updateTajweedRule(
    input: Versioned & { readonly value: TajweedRuleValue },
  ): Promise<TajweedRuleRecord>;
  setTajweedRuleState(
    input: Versioned & { readonly state: QuranLayerState },
  ): Promise<TajweedRuleRecord>;
}

/* ===========================================================================
 * Canonical — the only write path to Arabic and structure
 * ========================================================================= */

/** The verified authority every canonical write carries into the database. */
export interface CanonicalAuthority {
  readonly actorId: string;
  readonly sessionId: string;
  readonly stepUpGrantId: string;
}

export interface QuranCanonicalPort {
  /** Every Ayah a source registered, in canonical order — the verifier's reference. */
  sourceCorpus(sourceId: string): Promise<readonly CandidateAyah[]>;
  /**
   * Materialises the canonical corpus FROM the source's own rows, after the
   * database itself re-compares the candidate byte for byte. Refused when a
   * corpus already exists, when the source is unknown, or on any mismatch.
   */
  acceptCorpus(input: {
    readonly authority: CanonicalAuthority;
    readonly sourceId: string;
    readonly candidate: readonly CandidateAyah[];
  }): Promise<{ readonly runId: string; readonly ayat: number }>;
  /**
   * Replaces one Ayah's text with the source's text for it, under the expected
   * version, appending an immutable revision and a verification record.
   */
  correctAyah(input: {
    readonly authority: CanonicalAuthority;
    readonly ref: QuranRef;
    readonly expectedVersion: number;
    readonly sourceId: string;
    readonly reviewedText: string;
    readonly reason: string;
  }): Promise<{ readonly runId: string; readonly version: number }>;
  /** Records a failed verification as immutable, content-free evidence. */
  recordFailure(input: {
    readonly actorId: string;
    readonly kind: 'corpus-acceptance' | 'ayah-correction';
    readonly sourceId: string;
    readonly checked: number;
    readonly mismatches: number;
    readonly first: VerificationMismatch | null;
  }): Promise<{ readonly runId: string }>;
}
