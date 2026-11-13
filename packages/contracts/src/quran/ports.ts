import type { PrivilegedActor } from '../identity/authorization.ts';
import type {
  AyahRecordPage,
  RecitationPage,
  TafsirEntryPage,
  TafsirPage,
  TopicAyahPage,
  TranslationPage,
  TransliterationPage,
  WordByWordPage,
  AyahDetail,
  AyahGlosses,
  AyahSearchRecord,
  CandidateAyah,
  CorrectionPreview,
  LayerText,
  LayerTextChange,
  PublicAyah,
  PublicAyahPlace,
  PublicAyahTiming,
  PublicJuz,
  PublicLayerCoverage,
  PublicLayerWork,
  PublicRecitation,
  PublicRecitationAlignment,
  PublicRecitationSegment,
  PublicSurah,
  PublicAyahTajweed,
  PublicTajweedOverlay,
  PublicTajweedRule,
  PublicTajweedUses,
  PublicTransliteration,
  QuranAvailability,
  QuranCorpusStatus,
  QuranLayerState,
  QuranRef,
  QuranSitemapRow,
  QuranSourceRecord,
  RecitationAlignmentValue,
  RecitationDetail,
  RecitationSegmentAsset,
  RecitationSegmentValue,
  RecitationStream,
  RecitationValue,
  SurahNamesValue,
  SurahRecord,
  TafsirEntryRecord,
  TafsirEntryValue,
  TafsirRecord,
  TafsirValue,
  TajweedAyahRecord,
  TajweedAyahValue,
  TajweedOverlayRecord,
  TajweedOverlayValue,
  TajweedRule,
  TajweedRuleRecord,
  TajweedRuleValue,
  TajweedSaveResult,
  PublicTafsirCoverage,
  PublicTranslationCoverage,
  TranslationLayerText,
  TranslationRecord,
  PublicTranslationSpan,
  TranslationTextChange,
  TranslationValue,
  TransliterationRecord,
  TransliterationValue,
  VerificationMismatch,
  WordByWordRecord,
  WordByWordValue,
  WordGlossChange,
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
  /**
   * Every Juz with what the reader derives for it — its range, count, pages,
   * hizb and the stored text of its first Ayah — in number order. ONE grouped
   * read and one read of the thirty first ayat.
   */
  juzList(): Promise<readonly PublicJuz[]>;
  juz(number: number): Promise<PublicJuz | null>;
  /**
   * Where each Ayah of one Juz falls — citation, hizb and page, no text — in
   * canonical order: ONE bounded read the Juz page lays its windows out from.
   */
  juzOutline(number: number): Promise<readonly PublicAyahPlace[]>;
  /**
   * The ayat of one Juz from one citation to another inclusive, in canonical
   * order — ONE read of at most `QURAN_JUZ_WINDOW` ayat.
   */
  juzAyat(number: number, from: QuranRef, to: QuranRef): Promise<readonly PublicAyah[]>;
  /**
   * The ayat the source placed on one mushaf page, in canonical order — ONE
   * bounded read. Empty for a page no public Ayah carries (Quran Part 1).
   */
  pageAyat(page: number): Promise<readonly PublicAyah[]>;
  /** The highest mushaf page any public Ayah carries; 0 when none records one. */
  lastPage(): Promise<number>;

  translations(): Promise<readonly PublicLayerWork[]>;
  translation(slug: string): Promise<PublicLayerWork | null>;
  transliterations(): Promise<readonly PublicTransliteration[]>;
  transliteration(slug: string): Promise<PublicTransliteration | null>;
  tafsirs(): Promise<readonly PublicLayerWork[]>;
  tafsir(slug: string): Promise<PublicLayerWork | null>;
  /** The public word-by-word works (Quran Part 7), in slug order. */
  wordByWords(): Promise<readonly PublicLayerWork[]>;
  wordByWord(slug: string): Promise<PublicLayerWork | null>;

  /**
   * One public Translation's texts for a range of one Surah, each with its
   * translator's notes in order — ONE read per page, never per Ayah.
   */
  translationTexts(
    workId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly TranslationLayerText[]>;
  /**
   * How much of the Quran each of these public Translations carries, per
   * Surah: ayat with text and translator's notes (Quran Part 6). ONE grouped
   * read for every work named; a work that is not public now is absent.
   */
  translationCoverage(
    workIds: readonly string[],
  ): Promise<readonly PublicTranslationCoverage[]>;
  transliterationTexts(
    workId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly LayerText[]>;
  /**
   * How much of the Quran each of these public Transliterations carries, per
   * Surah (Quran Part 7). ONE grouped read; a work not public now is absent.
   */
  transliterationCoverage(
    workIds: readonly string[],
  ): Promise<readonly PublicLayerCoverage[]>;
  /**
   * One public word-by-word work's glosses for a range of one Surah, each
   * Ayah's in position order — ONE read per page, never per Ayah or word.
   */
  wordByWordGlosses(
    workId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly AyahGlosses[]>;
  /** Ayat and words glossed per Surah, for each of these public works. ONE grouped read. */
  wordByWordCoverage(workIds: readonly string[]): Promise<readonly PublicLayerCoverage[]>;
  /** Public Tafsir entries overlapping a range of one Surah, in range order. */
  tafsirEntries(
    workId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly TafsirEntryRecord[]>;
  /** One bounded page of a public Tafsir's entries, in canonical order. */
  tafsirEntryPage(workId: string, offset: number): Promise<TafsirEntryPage>;
  /**
   * Entries and ayat covered per Surah, for each of these public Tafsirs
   * (Quran Part 8, the Tafsir hub's Surah grid). ONE bounded read; a work not
   * public now is absent.
   */
  tafsirCoverage(workIds: readonly string[]): Promise<readonly PublicTafsirCoverage[]>;

  recitations(): Promise<readonly PublicRecitation[]>;
  recitation(slug: string): Promise<PublicRecitation | null>;
  recitationsByReciter(personId: string): Promise<readonly PublicRecitation[]>;
  /** A public Recitation's segments with audio, in canonical order. Bounded. */
  recitationSegments(
    recitationId: string,
    surah: number | null,
  ): Promise<readonly PublicRecitationSegment[]>;
  /**
   * The per-Ayah timing of a public Recitation's segments in ONE Surah, in
   * canonical order — ONE read, bounded by the Surah's ayat (Quran Part 5).
   */
  recitationTimings(
    recitationId: string,
    surah: number,
  ): Promise<readonly PublicAyahTiming[]>;
  /**
   * Where each passage's translation is heard in a public narration's segments
   * in ONE Surah, in canonical order (Quran translation audio) — ONE read,
   * bounded by the Surah's ayat.
   */
  recitationTranslationSpans(
    recitationId: string,
    surah: number,
  ): Promise<readonly PublicTranslationSpan[]>;
  /**
   * What a public narration's aligned segments were matched against: each
   * PUBLIC reference recitation and how many Surahs. A reference that is not
   * public now is absent.
   */
  recitationAlignments(
    recitationId: string,
  ): Promise<readonly PublicRecitationAlignment[]>;

  tajweedRules(): Promise<readonly PublicTajweedRule[]>;
  tajweedRule(slug: string): Promise<PublicTajweedRule | null>;
  /**
   * The public tajweed colour overlays (Quran Part 9), in slug order — none
   * while the corpus is inactive, and none that is not public now.
   */
  tajweedOverlays(): Promise<readonly PublicTajweedOverlay[]>;
  /**
   * One public overlay's spans for a range of one Surah, each Ayah's in its
   * recorded order — ONE read per page. An Ayah whose canonical text no longer
   * hashes to the text it was aligned to is ABSENT: its spans described
   * another text, so the reader shows it uncoloured.
   */
  tajweedSpans(
    overlayId: string,
    surah: number,
    from: number,
    to: number,
  ): Promise<readonly PublicAyahTajweed[]>;
  /**
   * How many ayat a public overlay colours now and, for each rule it marks,
   * how many current ayat and spans and up to `perRule` of the shortest such
   * ayat (one per distinct text) with that rule's spans — ONE bounded read for
   * the Tajweed hub and a rule's page (`rule` narrows it).
   */
  tajweedRuleUses(
    overlayId: string,
    perRule: number,
    rule: TajweedRule | null,
  ): Promise<PublicTajweedUses>;

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
  /** A Translation's texts of one Surah, each with its translator's notes in order. */
  translationTexts(id: string, surah: number): Promise<readonly TranslationLayerText[]>;
  /**
   * Saves texts of one Surah and — where a change names them — replaces that
   * Ayah's translator's notes, in one transaction under the expected version
   * (Quran Part 6). The service has already tied every note to its text.
   */
  saveTranslationTexts(
    input: Versioned & {
      readonly surah: number;
      readonly changes: readonly TranslationTextChange[];
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

  /* ---- Word by word (Quran Part 7) -------------------------------------- */

  wordByWords(offset: number): Promise<WordByWordPage>;
  wordByWord(id: string): Promise<WordByWordRecord | null>;
  createWordByWord(
    input: Attributed & { readonly value: WordByWordValue },
  ): Promise<WordByWordRecord>;
  updateWordByWord(
    input: Versioned & { readonly value: WordByWordValue },
  ): Promise<WordByWordRecord>;
  setWordByWordState(
    input: Versioned & { readonly state: QuranLayerState },
  ): Promise<WordByWordRecord>;
  /** A word-by-word work's glosses of one Surah, each Ayah's in position order. */
  wordByWordGlosses(id: string, surah: number): Promise<readonly AyahGlosses[]>;
  /**
   * Replaces the glosses of each named Ayah of one Surah WHOLE, in one
   * transaction under the expected version. The service has already checked
   * every position against the Ayah's stored text (`ayahWords`).
   */
  saveWordByWordGlosses(
    input: Versioned & {
      readonly surah: number;
      readonly changes: readonly WordGlossChange[];
    },
  ): Promise<WordByWordRecord>;

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
  /**
   * Creates a draft Recitation. `stream` is a STREAMED recitation's allowlisted
   * location (Quran Part 5) — fixed at creation, never changed — or `null` for
   * first-party audio uploaded segment by segment.
   */
  createRecitation(
    input: Attributed & {
      readonly value: RecitationValue;
      readonly stream: RecitationStream | null;
    },
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
   * Records an untimed first-party narration segment's ALIGNMENT — its per-Ayah
   * timing, its alignment provenance and its translation spans — in ONE
   * transaction under the Recitation's expected version; the database refuses
   * anything partial, overlapping or out of order, and never edits one (51405).
   */
  alignRecitationSegment(
    input: Versioned & { readonly value: RecitationAlignmentValue },
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

  /* ---- Tajweed colours (Quran Part 9) ------------------------------------- */

  tajweedOverlays(): Promise<readonly TajweedOverlayRecord[]>;
  tajweedOverlay(id: string): Promise<TajweedOverlayRecord | null>;
  tajweedOverlayBySlug(slug: string): Promise<TajweedOverlayRecord | null>;
  createTajweedOverlay(
    input: Attributed & { readonly value: TajweedOverlayValue },
  ): Promise<TajweedOverlayRecord>;
  setTajweedOverlayState(
    input: Versioned & { readonly state: QuranLayerState },
  ): Promise<TajweedOverlayRecord>;
  /** The ayat of one Surah an overlay records, in canonical order, without spans. */
  tajweedAyat(id: string, surah: number): Promise<readonly TajweedAyahRecord[]>;
  /**
   * Records each named Ayah of one Surah WITH its spans, in ONE transaction
   * under the expected version — an Ayah already recorded is KEPT, never
   * edited. The service has already checked every span against the Ayah's
   * stored text; the database checks each Ayah's digest against it again.
   */
  saveTajweedAyat(
    input: Versioned & {
      readonly surah: number;
      readonly ayat: readonly TajweedAyahValue[];
    },
  ): Promise<TajweedSaveResult>;
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
