import { z } from 'zod';

import type { Locale } from '../env/shared.ts';
import { exactText, labelText } from '../exact-text.ts';

/**
 * Quran — the platform's strictest-integrity content context
 * (DOMAIN_MODEL.md §8; DELIVERY_PLAN.md Phase 18).
 *
 * THE STRUCTURE IS CANONICAL AND NUMERIC. A Surah is a number 1..114, a Juz a
 * number 1..30, and an Ayah is `(surah, ayah)` — a citation that never changes
 * and backs `/quran/surah/{surah}/{ayah}` for ever. Names are presentation, not
 * identity, so no slug and no slug history exists for any of them.
 *
 * NOTHING HERE KNOWS WHAT THE QURAN SAYS. No count of ayat, no Juz boundary, no
 * Surah name and no word of text is written into this repository: each arrives
 * only from a source the operator registers, and the ranges below are structural
 * ceilings that refuse an impossible reference, never a claim about the corpus.
 *
 * LAYERS ARE SEPARATE WORKS. A Translation, Transliteration, Tafsir and
 * Recitation are each their own aggregate with their own identity, source,
 * lifecycle and version, layered over the Ayah and never a field on it
 * (DOMAIN_MODEL.md §8.2). Several coexist and none is privileged.
 *
 * TEXT IS NEVER NORMALISED. No schema below trims, folds, re-composes or
 * substitutes a character of religious text. Where surrounding whitespace or an
 * unpaired surrogate would be wrong it is REFUSED, so what is stored is exactly
 * what was supplied (Phase 18 §14).
 */

/* ===========================================================================
 * Structural identity
 * ========================================================================= */

/** The Surah numbering's fixed range — 114 chapters, numbered from 1. */
export const QURAN_SURAH_MAX = 114;

/** The Juz numbering's fixed range — 30 parts, numbered from 1. */
export const QURAN_JUZ_MAX = 30;

/**
 * A structural ceiling on an Ayah number. It is NOT the length of any Surah:
 * how many ayat a Surah has is the source's fact, recorded on its Surah row.
 */
export const QURAN_AYAH_NUMBER_MAX = 999;

export const surahNumberSchema = z.number().int().min(1).max(QURAN_SURAH_MAX);
export const juzNumberSchema = z.number().int().min(1).max(QURAN_JUZ_MAX);
export const ayahNumberSchema = z.number().int().min(1).max(QURAN_AYAH_NUMBER_MAX);

/** The canonical citation of one Ayah. */
export interface QuranRef {
  readonly surah: number;
  readonly ayah: number;
}

export const quranRefSchema = z.strictObject({
  surah: surahNumberSchema,
  ayah: ayahNumberSchema,
});

/** `"2:3"` — the canonical citation as text, and the Ayah's search identity. */
export function citationOf(ref: QuranRef): string {
  return `${ref.surah}:${ref.ayah}`;
}

/** The inverse of `citationOf`, refusing anything that is not exactly one. */
export function parseCitation(value: string): QuranRef | null {
  const match = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,2})$/.exec(value);
  if (match === null) return null;
  const parsed = quranRefSchema.safeParse({
    surah: Number(match[1]),
    ayah: Number(match[2]),
  });
  return parsed.success ? parsed.data : null;
}

/** A path segment that is a canonical decimal number and nothing else. */
export function numericSegment(value: string, max: number): number | null {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) return null;
  const number = Number(value);
  return number <= max ? number : null;
}

/* ===========================================================================
 * Shared scalars
 * ========================================================================= */

export const quranIdSchema = z.uuid();

/** Immutable once chosen: the column refuses UPDATE, so no slug history is owed. */
export const quranSlugSchema = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const quranVersionSchema = z.number().int().positive().max(2_147_483_646);

/** A content-language reference, in the shape Taxonomy's `Language.code` takes. */
export const quranLanguageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

/**
 * A layered work's lifecycle. Publication is further gated by a REGISTERED
 * source (see `QuranSourceAuthority`) — the state alone never makes a work
 * public.
 */
export type QuranLayerState = 'draft' | 'published' | 'archived';
export const QURAN_LAYER_STATES = Object.freeze([
  'draft',
  'published',
  'archived',
] as const) satisfies readonly QuranLayerState[];
export const quranLayerStateSchema = z.enum(QURAN_LAYER_STATES);

/**
 * What a registered source IS.
 *
 * `fixture` — controlled, unmistakably non-authoritative engineering text that
 * proves mechanisms. `approved` — a source an external religious authority has
 * approved (OPEN_DECISIONS.md §1.1, §1.2), recorded with its evidence reference.
 *
 * NEITHER IS CHOSEN AT RUNTIME. Sources are registered by the owner/operator
 * principal only; the application principal can read them and nothing more, so
 * no permission, label or checkbox can turn a fixture into an authority.
 */
export type QuranSourceAuthority = 'fixture' | 'approved';

/** `meccan` / `medinan`, only where a source supplies it. */
export type QuranRevelation = 'meccan' | 'medinan';

/** A prostration marker, only where a source supplies it. */
export type QuranSajdah = 'recommended' | 'obligatory';

export const QURAN_LIMITS = Object.freeze({
  ayahText: 4_000,
  layerText: 12_000,
  tafsirText: 60_000,
  name: 200,
  surahName: 100,
  description: 2_000,
  attribution: 400,
  style: 100,
  reason: 500,
  contributors: 12,
  /** The texts one save may carry: at most one Surah's worth. */
  textsPerSave: QURAN_AYAH_NUMBER_MAX,
  topicsPerAyah: 20,
  segmentsPerRecitation: 1_000,
  tajweedTitle: 200,
  tajweedBody: 20_000,
  tajweedRules: 200,
  /** A candidate corpus larger than this is not a corpus. */
  corpusAyat: 10_000,
  /** How many mismatches a verification report names before it only counts. */
  reportedMismatches: 20,
});

/** Admin and public listing page size. */
export const QURAN_PAGE = 50;
/** How many ayat one Juz page shows. */
export const QURAN_JUZ_PAGE = 100;
/** How many citations one current-projection read for a results page may name. */
export const QURAN_SEARCH_RECORDS_MAX = 100;

/**
 * The playable format a recitation segment's audio is accepted in — as SNIFFED
 * by Storage, never as declared. Quran's own rule, deliberately not borrowed
 * from Media: a recitation is not an AudioTrack, and Media's formats changing
 * must never change what a recitation accepts.
 */
export const RECITATION_AUDIO_MEDIA_TYPES = Object.freeze(['audio/mpeg'] as const);

/**
 * The ceiling on one segment's audio file. A technical safety bound equal to
 * Storage's default per-object ceiling (64 MiB); Storage applies the smaller of
 * the two, and it is enforced from the declared length and again while
 * streaming.
 */
export const RECITATION_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;

/* ===========================================================================
 * Text — exact, never normalised
 * ========================================================================= */

/*
 * The exact-text schemas are shared with every religious-text context and live
 * in Layer 0 (`../exact-text.ts`); Quran re-exports the two its callers use.
 */
export { exactText, isWellFormedText } from '../exact-text.ts';

/* ===========================================================================
 * Layered works — input
 * ========================================================================= */

export const TRANSLATION_CONTRIBUTOR_ROLES = Object.freeze([
  'translator',
  'editor',
] as const);
export const TAFSIR_CONTRIBUTOR_ROLES = Object.freeze([
  'author',
  'translator',
  'editor',
  'compiler',
] as const);
export type TranslationContributorRole = (typeof TRANSLATION_CONTRIBUTOR_ROLES)[number];
export type TafsirContributorRole = (typeof TAFSIR_CONTRIBUTOR_ROLES)[number];
export type QuranContributorRole = TranslationContributorRole | TafsirContributorRole;

function contributors<const R extends readonly [string, ...string[]]>(roles: R) {
  return z
    .array(z.strictObject({ personId: quranIdSchema, role: z.enum(roles) }))
    .max(QURAN_LIMITS.contributors)
    .refine(
      (list) => new Set(list.map((c) => `${c.personId}:${c.role}`)).size === list.length,
      'A contributor is named once per role.',
    );
}

/**
 * The metadata of a Translation, Transliteration or Tafsir as an operator saves
 * it. The slug is taken on creation only and never changes afterwards.
 *
 * `sourceId` names a REGISTERED source; it may be chosen, never created, here.
 * Attribution is what the source supplies — never inferred.
 */
const layerWorkFields = {
  slug: quranSlugSchema,
  name: labelText(QURAN_LIMITS.name),
  description: labelText(QURAN_LIMITS.description).nullable(),
  attribution: labelText(QURAN_LIMITS.attribution).nullable(),
  languageCode: quranLanguageCodeSchema,
  sourceId: quranIdSchema.nullable(),
};

export const translationInputSchema = z.strictObject({
  ...layerWorkFields,
  contributors: contributors(TRANSLATION_CONTRIBUTOR_ROLES),
});
export type TranslationValue = z.output<typeof translationInputSchema>;

export const transliterationInputSchema = z.strictObject({
  ...layerWorkFields,
  /** What the scheme is, in the operator's words — e.g. its conventions. */
  scheme: labelText(QURAN_LIMITS.description).nullable(),
});
export type TransliterationValue = z.output<typeof transliterationInputSchema>;

export const tafsirInputSchema = z.strictObject({
  ...layerWorkFields,
  contributors: contributors(TAFSIR_CONTRIBUTOR_ROLES),
});
export type TafsirValue = z.output<typeof tafsirInputSchema>;

/**
 * A Recitation: a reciter's recitation work. The reciter is a People Person —
 * being one grants nothing (DOMAIN_MODEL.md §4.5).
 */
export const recitationInputSchema = z.strictObject({
  slug: quranSlugSchema,
  name: labelText(QURAN_LIMITS.name),
  reciterId: quranIdSchema,
  /** The recitation style as the source names it; never inferred. */
  style: labelText(QURAN_LIMITS.style).nullable(),
  attribution: labelText(QURAN_LIMITS.attribution).nullable(),
  sourceId: quranIdSchema.nullable(),
});
export type RecitationValue = z.output<typeof recitationInputSchema>;

export const tajweedRuleInputSchema = z
  .strictObject({
    slug: quranSlugSchema,
    position: z.number().int().min(0).max(QURAN_LIMITS.tajweedRules),
    attribution: labelText(QURAN_LIMITS.attribution).nullable(),
    sourceId: quranIdSchema.nullable(),
    texts: z
      .array(
        z.strictObject({
          languageCode: quranLanguageCodeSchema,
          title: labelText(QURAN_LIMITS.tajweedTitle),
          body: exactText(QURAN_LIMITS.tajweedBody),
        }),
      )
      .min(1)
      .max(8),
  })
  .refine(
    (value) =>
      new Set(value.texts.map((t) => t.languageCode)).size === value.texts.length,
    { path: ['texts'], message: 'One text per language.' },
  );
export type TajweedRuleValue = z.output<typeof tajweedRuleInputSchema>;

/** One Ayah's text in a Translation or Transliteration; `null` removes it. */
export const layerTextChangeSchema = z.strictObject({
  ayah: ayahNumberSchema,
  text: exactText(QURAN_LIMITS.layerText).nullable(),
});
export type LayerTextChange = z.output<typeof layerTextChangeSchema>;

export const layerTextSaveSchema = z
  .strictObject({
    surah: surahNumberSchema,
    changes: z.array(layerTextChangeSchema).min(1).max(QURAN_LIMITS.textsPerSave),
  })
  .refine(
    (value) => new Set(value.changes.map((c) => c.ayah)).size === value.changes.length,
    { path: ['changes'], message: 'An ayah is changed once per save.' },
  );
export type LayerTextSave = z.output<typeof layerTextSaveSchema>;

/** One Tafsir entry over a same-Surah range of ayat. */
export const tafsirEntryInputSchema = z
  .strictObject({
    surah: surahNumberSchema,
    startAyah: ayahNumberSchema,
    endAyah: ayahNumberSchema,
    text: exactText(QURAN_LIMITS.tafsirText),
  })
  .refine((value) => value.startAyah <= value.endAyah, {
    path: ['endAyah'],
    message: 'A range ends at or after where it starts.',
  });
export type TafsirEntryValue = z.output<typeof tafsirEntryInputSchema>;

/** A recitation segment: one audio file covering a same-Surah range. */
export const recitationSegmentInputSchema = z
  .strictObject({
    surah: surahNumberSchema,
    startAyah: ayahNumberSchema,
    endAyah: ayahNumberSchema,
  })
  .refine((value) => value.startAyah <= value.endAyah, {
    path: ['endAyah'],
    message: 'A range ends at or after where it starts.',
  });
export type RecitationSegmentValue = z.output<typeof recitationSegmentInputSchema>;

export const surahNamesInputSchema = z.strictObject({
  surah: surahNumberSchema,
  names: z
    .array(
      z.strictObject({
        locale: z.enum(['en', 'ur', 'ar']),
        name: labelText(QURAN_LIMITS.surahName),
      }),
    )
    .max(3)
    .refine(
      (list) => new Set(list.map((n) => n.locale)).size === list.length,
      'One name per locale.',
    ),
});
export type SurahNamesValue = z.output<typeof surahNamesInputSchema>;

/* ===========================================================================
 * Canonical authority operations — input
 * ========================================================================= */

/**
 * One Ayah of a CANDIDATE corpus — text decoded from its transport by
 * `decodeExact` and compared code point for code point with the source.
 */
export const candidateAyahSchema = z.strictObject({
  surah: surahNumberSchema,
  ayah: ayahNumberSchema,
  juz: juzNumberSchema,
  text: z.string().max(QURAN_LIMITS.ayahText),
});
export type CandidateAyah = z.output<typeof candidateAyahSchema>;

export const corpusAcceptanceSchema = z.strictObject({
  sourceId: quranIdSchema,
  candidate: z.array(candidateAyahSchema).min(1).max(QURAN_LIMITS.corpusAyat),
});
export type CorpusAcceptanceValue = z.output<typeof corpusAcceptanceSchema>;

/**
 * A canonical correction. The new text is the SOURCE's text for this Ayah; the
 * operator submits the exact text they reviewed, and it must match the source
 * character for character, so an approval binds to what was read
 * (DOMAIN_MODEL.md §19.8).
 */
export const ayahCorrectionSchema = z.strictObject({
  surah: surahNumberSchema,
  ayah: ayahNumberSchema,
  expectedVersion: quranVersionSchema,
  sourceId: quranIdSchema,
  reviewedText: z.string().max(QURAN_LIMITS.ayahText),
  reason: labelText(QURAN_LIMITS.reason),
});
export type AyahCorrectionValue = z.output<typeof ayahCorrectionSchema>;

/* ===========================================================================
 * Verification evidence
 * ========================================================================= */

/** Why a candidate failed verification — a category, never the text itself. */
export type VerificationMismatchReason =
  /** The candidate's bytes are not valid in the source's declared encoding. */
  | 'malformed-encoding'
  /** The source declares an encoding the verifier does not implement. */
  | 'unsupported-encoding'
  /** The candidate names an Ayah the source does not have. */
  | 'unknown-reference'
  /** The candidate names one Ayah more than once. */
  | 'duplicate-reference'
  /** The source has an Ayah the candidate does not. */
  | 'missing-reference'
  /** The candidate assigns the Ayah to a different Juz than the source. */
  | 'juz-mismatch'
  /** The texts differ; `offset` is the first differing code point. */
  | 'text-mismatch';

export interface VerificationMismatch {
  readonly reason: VerificationMismatchReason;
  readonly ref: QuranRef | null;
  /** The first differing code point index, for `text-mismatch` only. */
  readonly offset: number | null;
}

/**
 * A verification report: what was checked and, bounded, where it failed.
 * SAFE TO LOG AND SHOW — it names references and positions, never content.
 */
export interface VerificationReport {
  readonly passed: boolean;
  readonly checked: number;
  readonly mismatchCount: number;
  readonly mismatches: readonly VerificationMismatch[];
}

/* ===========================================================================
 * Records — administration
 * ========================================================================= */

export interface QuranSourceRecord {
  readonly id: string;
  readonly code: string;
  readonly authority: QuranSourceAuthority;
  readonly title: string;
  readonly version: string;
  readonly encoding: string;
  readonly script: string | null;
  /** The external evidence reference the operator registered; never inferred. */
  readonly reference: string | null;
  readonly ayahCount: number;
  readonly createdAt: Date;
}

export interface QuranActivationRecord {
  readonly sourceId: string;
  readonly authority: QuranSourceAuthority;
  readonly activatedAt: Date;
  readonly authorisedBy: string;
}

export interface VerificationRunRecord {
  readonly id: string;
  readonly kind: 'corpus-acceptance' | 'ayah-correction';
  readonly outcome: 'passed' | 'failed';
  readonly sourceId: string;
  readonly checked: number;
  readonly mismatches: number;
  readonly first: VerificationMismatch | null;
  readonly actorId: string | null;
  readonly createdAt: Date;
}

/** The whole canonical position, as an operator sees it. */
export interface QuranCorpusStatus {
  readonly surahs: number;
  readonly ayat: number;
  readonly juz: number;
  readonly activation: QuranActivationRecord | null;
  readonly sources: readonly QuranSourceRecord[];
  readonly recentRuns: readonly VerificationRunRecord[];
}

export interface SurahRecord {
  readonly number: number;
  readonly ayahCount: number;
  readonly revelation: QuranRevelation | null;
  readonly nameArabic: string | null;
  readonly names: Readonly<Partial<Record<Locale, string>>>;
  readonly sourceId: string;
  /** The display names' version — the only Surah fact the administration changes. */
  readonly namesVersion: number;
}

export interface AyahRecord {
  readonly surah: number;
  readonly ayah: number;
  readonly juz: number;
  readonly hizb: number | null;
  readonly page: number | null;
  readonly sajdah: QuranSajdah | null;
  readonly text: string;
  readonly sourceId: string;
  readonly version: number;
  readonly updatedAt: Date;
}

/** One immutable canonical version of an Ayah. */
export interface AyahRevisionRecord {
  readonly version: number;
  readonly text: string;
  readonly sourceId: string;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface AyahDetail extends AyahRecord {
  readonly history: readonly AyahRevisionRecord[];
  readonly topicIds: readonly string[];
}

/** What a correction would change — evidence for the operator, never applied by itself. */
export interface CorrectionPreview {
  readonly ayah: AyahRecord;
  readonly source: QuranSourceRecord;
  /** The source's text for this Ayah, or null when the source lacks it. */
  readonly sourceText: string | null;
  /** First differing code point between current and source text; null when equal. */
  readonly firstDifference: number | null;
}

export interface QuranContributorRef {
  readonly personId: string;
  readonly role: QuranContributorRole;
  readonly position: number;
}

interface LayerWorkRecordBase {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly attribution: string | null;
  readonly languageCode: string;
  readonly sourceId: string | null;
  readonly sourceAuthority: QuranSourceAuthority | null;
  readonly state: QuranLayerState;
  readonly version: number;
  /** How many ayat (or Tafsir entries) the work carries. */
  readonly textCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
}

export interface TranslationRecord extends LayerWorkRecordBase {
  readonly contributors: readonly QuranContributorRef[];
}
export interface TransliterationRecord extends LayerWorkRecordBase {
  readonly scheme: string | null;
}
export interface TafsirRecord extends LayerWorkRecordBase {
  readonly contributors: readonly QuranContributorRef[];
}

export interface RecitationRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly reciterId: string;
  readonly style: string | null;
  readonly attribution: string | null;
  readonly sourceId: string | null;
  readonly sourceAuthority: QuranSourceAuthority | null;
  readonly state: QuranLayerState;
  readonly version: number;
  readonly segmentCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
}

export interface RecitationSegmentRecord {
  readonly id: string;
  readonly surah: number;
  readonly startAyah: number;
  readonly endAyah: number;
  /** The Storage asset holding this segment's audio, or none yet. */
  readonly assetId: string | null;
}

export interface RecitationDetail extends RecitationRecord {
  readonly segments: readonly RecitationSegmentRecord[];
}

export interface TajweedRuleText {
  readonly languageCode: string;
  readonly title: string;
  readonly body: string;
}

export interface TajweedRuleRecord {
  readonly id: string;
  readonly slug: string;
  readonly position: number;
  readonly attribution: string | null;
  readonly sourceId: string | null;
  readonly sourceAuthority: QuranSourceAuthority | null;
  readonly state: QuranLayerState;
  readonly version: number;
  readonly texts: readonly TajweedRuleText[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
}

/** One Ayah's text in one layered work. */
export interface LayerText {
  readonly ayah: number;
  readonly text: string;
}

export interface TafsirEntryRecord {
  readonly id: string;
  readonly surah: number;
  readonly startAyah: number;
  readonly endAyah: number;
  readonly text: string;
}

/** A bounded page of records with the total it was cut from. */
export interface QuranPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
}

/*
 * Concrete pages, one per record a port returns a page of. Each is exactly
 * `QuranPage<Record>`, spelled out so a port names a concrete contract rather
 * than a type parameter (ARCHITECTURE.md §4.1).
 */
export interface AyahRecordPage {
  readonly items: readonly AyahRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface TranslationPage {
  readonly items: readonly TranslationRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface TransliterationPage {
  readonly items: readonly TransliterationRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface TafsirPage {
  readonly items: readonly TafsirRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface RecitationPage {
  readonly items: readonly RecitationRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface PublicAyahPage {
  readonly items: readonly PublicAyah[];
  readonly total: number;
  readonly offset: number;
}
export interface TafsirEntryPage {
  readonly items: readonly TafsirEntryRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface TopicAyahPage {
  readonly items: readonly PublicTopicAyah[];
  readonly total: number;
  readonly offset: number;
}

/* ===========================================================================
 * Records — public
 * ========================================================================= */

/**
 * Whether this deployment has a public corpus, and of what kind.
 *
 * `fixture` mode exists for disposable proof environments: every page then
 * says it shows non-authoritative engineering fixture text, is `noindex`, and
 * no sitemap lists it. The application principal cannot create either mode.
 */
export type QuranAvailability =
  | { readonly active: false }
  | { readonly active: true; readonly mode: QuranSourceAuthority };

export interface PublicSurah {
  readonly number: number;
  readonly ayahCount: number;
  readonly revelation: QuranRevelation | null;
  readonly nameArabic: string | null;
  readonly names: Readonly<Partial<Record<Locale, string>>>;
}

export interface PublicAyah {
  readonly surah: number;
  readonly ayah: number;
  readonly juz: number;
  readonly sajdah: QuranSajdah | null;
  readonly text: string;
}

export interface PublicJuz {
  readonly number: number;
  readonly start: QuranRef;
  readonly end: QuranRef;
  readonly ayahCount: number;
}

export interface PublicContributor {
  readonly personId: string;
  readonly role: QuranContributorRole;
}

/** A public Translation, Transliteration or Tafsir work. */
export interface PublicLayerWork {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly attribution: string | null;
  readonly languageCode: string;
  readonly contributors: readonly PublicContributor[];
  readonly publishedAt: Date;
}

export interface PublicTransliteration extends PublicLayerWork {
  readonly scheme: string | null;
}

export interface PublicRecitation {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly reciterId: string;
  readonly style: string | null;
  readonly attribution: string | null;
  readonly publishedAt: Date;
}

/** A public segment; its audio is servable only if Storage also says so. */
export interface PublicRecitationSegment {
  readonly id: string;
  readonly surah: number;
  readonly startAyah: number;
  readonly endAyah: number;
  readonly assetId: string;
}

export interface PublicTajweedRule {
  readonly slug: string;
  readonly position: number;
  readonly attribution: string | null;
  readonly texts: readonly TajweedRuleText[];
}

export interface PublicTopicAyah {
  readonly surah: number;
  readonly ayah: number;
  readonly text: string;
}

export interface QuranSitemapRow {
  readonly surah: number;
  readonly ayah: number;
  readonly lastModified: Date;
}

/** What Search projects for one Ayah — public text only. */
export interface AyahSearchRecord {
  readonly surah: number;
  readonly ayah: number;
  readonly text: string;
  readonly stamp: string;
  readonly topicIds: readonly string[];
  /** Every PUBLIC layer text of this Ayah, in deterministic work-slug order. */
  readonly layers: readonly {
    readonly kind: 'translation' | 'transliteration';
    readonly slug: string;
    readonly name: string;
    readonly languageCode: string;
    readonly text: string;
  }[];
}

/** The ONE question the recitation serving policy asks. */
export interface RecitationSegmentAsset {
  readonly recitationState: QuranLayerState;
  /** True only when the corpus and this recitation are publicly visible now. */
  readonly publiclyVisible: boolean;
  readonly assetId: string | null;
}
