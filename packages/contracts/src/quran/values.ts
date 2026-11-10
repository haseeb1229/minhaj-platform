import { z } from 'zod';

import type { Locale } from '../env/shared.ts';
import { exactText, hasControlCharacter, labelText } from '../exact-text.ts';

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

/**
 * A structural ceiling on a mushaf PAGE number an address may name (Quran
 * Part 1, 2026-11-09). It is NOT the length of any mushaf: which pages exist
 * is the source's fact, recorded on each Ayah row (`Ayah.page`), and a page no
 * Ayah carries is simply absent.
 */
export const QURAN_PAGE_NUMBER_MAX = 999;

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
 * `reference` — a real, licensed external text reproduced VERBATIM (Rebaseline
 * R2: the staging reference preview), recorded with its licence, version and
 * digest, and NOT reviewed by Minhaj-ul-Quran's religious authority for this
 * platform. It is never presented as approved, never indexable, and shown only
 * on a deployment that explicitly admits it (`RELIGIOUS_REFERENCE_PREVIEW`).
 *
 * NONE IS CHOSEN AT RUNTIME. Sources are registered by the owner/operator
 * principal only; the application principal can read them and nothing more, so
 * no permission, label or checkbox can turn a fixture or a reference text into
 * an authority.
 */
export type QuranSourceAuthority = 'fixture' | 'approved' | 'reference';

export const QURAN_SOURCE_AUTHORITIES = Object.freeze([
  'fixture',
  'approved',
  'reference',
] as const) satisfies readonly QuranSourceAuthority[];

/**
 * What each public mode PERMITS, in one exhaustive table — so no page, sitemap,
 * navigation probe or search projection decides it with its own comparison,
 * and a new mode cannot be added without deciding every row (a missing key is
 * a type error).
 *
 *   indexable   may a search engine be told anything (still also requires the
 *               deployment to be indexable at all)? Approved text only.
 *   sitemap     may the corpus be listed in a sitemap? Approved text only.
 *   navigation  is the Quran a destination the shell promotes? Approved, and a
 *               reference preview on the deployment that admits it.
 *   notice      what every Quran page must say first: the fixture warning,
 *               the reference-preview attribution, or nothing.
 */
export interface QuranModePosture {
  readonly indexable: boolean;
  readonly sitemap: boolean;
  readonly navigation: boolean;
  readonly notice: 'fixture' | 'reference' | null;
}

export const QURAN_MODE_POSTURE: Readonly<
  Record<QuranSourceAuthority, QuranModePosture>
> = Object.freeze({
  approved: { indexable: true, sitemap: true, navigation: true, notice: null },
  reference: { indexable: false, sitemap: false, navigation: true, notice: 'reference' },
  fixture: { indexable: false, sitemap: false, navigation: false, notice: 'fixture' },
});

/**
 * A stored authority string as the vocabulary, or `null` for anything else —
 * an unknown value is never guessed into a mode (fail closed).
 */
export function quranSourceAuthorityOf(value: string): QuranSourceAuthority | null {
  return (QURAN_SOURCE_AUTHORITIES as readonly string[]).includes(value)
    ? (value as QuranSourceAuthority)
    : null;
}

/**
 * `RELIGIOUS_REFERENCE_PREVIEW` — the deployment's explicit admission of a
 * `reference` corpus: exactly `enabled`, or absent. Anything else is invalid
 * configuration, never a quiet "off". Server configuration refuses `enabled`
 * beside public indexing (`@minhaj/contracts/env/server`).
 */
export const religiousReferencePreviewSchema = z.literal('enabled').optional();

/** `meccan` / `medinan`, only where a source supplies it. */
export type QuranRevelation = 'meccan' | 'medinan';

/** A prostration marker, only where a source supplies it. */
export type QuranSajdah = 'recommended' | 'obligatory';

export const QURAN_LIMITS = Object.freeze({
  ayahText: 4_000,
  layerText: 12_000,
  /** One translator's note (Quran Part 6) — the longest real note is a few thousand. */
  noteText: 20_000,
  /** A note's opening mark: "", "٭", "**", "٭:", "12:-", "[12]" (`TRANSLATION_NOTE_MARKER`). */
  noteMarker: 8,
  notesPerAyah: 20,
  /** One word's gloss in a word-by-word work (Quran Part 7): a word or a short phrase. */
  gloss: 200,
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

/**
 * A STRUCTURAL CEILING on a word's position in an Ayah (Quran Part 7), as
 * `ayahWords` counts them. It is NOT the length of any Ayah: how many words
 * an Ayah has is what its stored text says, and the service refuses a gloss
 * beyond that count.
 */
export const QURAN_WORD_POSITION_MAX = 999;

/** Admin and public listing page size. */
export const QURAN_PAGE = 50;
/**
 * The most ayat one window of a Juz page holds (Quran Part 3). A Juz is read
 * one hizb at a time; a hizb longer than this is read in parts that break
 * between the source's mushaf pages, never inside one.
 */
export const QURAN_JUZ_WINDOW = 100;
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
 * Recitation — streamed audio and per-Ayah timing (Quran Part 5)
 * ========================================================================= */

/**
 * WHERE A STREAMED RECITATION'S AUDIO MAY LIVE — an exhaustive allowlist of
 * providers, each ONE exact https origin and ONE path shape (owner decision
 * 2026-11-09, OPEN_DECISIONS.md §1.2: mp3quran.net's qaris, streamed from its
 * CDN, on staging only). A stored stream is never a URL: it is a provider key
 * and a path the shape admits, and the address of Surah N is DERIVED from them
 * (`recitationStreamUrl`). No form, field or request can name another host,
 * scheme, port, query or file — so an operator cannot type a URL into a
 * recitation, and a page cannot be made to load audio from anywhere else.
 *
 * The same origins are the ONLY media sources the Quran routes' policy admits
 * (`media-src`, `apps/web/next.config.ts`).
 */
export const RECITATION_STREAM_PROVIDERS = Object.freeze({
  mp3quran: Object.freeze({
    /** The CDN serving mp3quran's per-Surah files. */
    origin: 'https://cdn.mp3quran.net',
    /** `audio/{reciter-folder}/r{n}` — the folder of one moshaf on that CDN. */
    path: /^audio\/[a-z0-9]+(?:-[a-z0-9]+)*\/r[1-9][0-9]?$/,
  }),
});

export type RecitationStreamProvider = keyof typeof RECITATION_STREAM_PROVIDERS;
export const RECITATION_STREAM_PROVIDER_KEYS = Object.freeze(
  Object.keys(RECITATION_STREAM_PROVIDERS) as RecitationStreamProvider[],
);

/** Every origin a streamed recitation can be played from, for the media policy. */
export const RECITATION_STREAM_ORIGINS: readonly string[] = Object.freeze(
  RECITATION_STREAM_PROVIDER_KEYS.map((key) => RECITATION_STREAM_PROVIDERS[key].origin),
);

/** The width of the stored path; the database column and CHECK hold the same. */
export const RECITATION_STREAM_PATH_MAX = 200;

export const recitationStreamSchema = z
  .strictObject({
    provider: z.enum(['mp3quran']),
    path: z.string().min(1).max(RECITATION_STREAM_PATH_MAX),
  })
  .refine((value) => RECITATION_STREAM_PROVIDERS[value.provider].path.test(value.path), {
    path: ['path'],
    message: 'The path is not one this provider serves.',
  });
export type RecitationStream = z.output<typeof recitationStreamSchema>;

/**
 * A stored provider and path as a stream, or `null` for anything the
 * allowlist does not admit — an unknown provider or a path of another shape is
 * never guessed into an address (fail closed: the recitation has no audio).
 */
export function recitationStreamOf(
  provider: string | null,
  path: string | null,
): RecitationStream | null {
  if (provider === null || path === null) return null;
  const parsed = recitationStreamSchema.safeParse({ provider, path });
  return parsed.success ? parsed.data : null;
}

/** The ONE address of one Surah's file: `{origin}/{path}/{NNN}.mp3`. */
export function recitationStreamUrl(stream: RecitationStream, surah: number): string {
  if (!surahNumberSchema.safeParse(surah).success)
    throw new Error('A stream address needs a Surah number.');
  const checked = recitationStreamOf(stream.provider, stream.path);
  if (checked === null) throw new Error('A stream address needs an admitted stream.');
  return `${RECITATION_STREAM_PROVIDERS[checked.provider].origin}/${checked.path}/${String(surah).padStart(3, '0')}.mp3`;
}

/**
 * The structural ceiling on a timing, in milliseconds: twelve hours. It is not
 * any recording's length — the longest Surah recited slowly with a translation
 * is a few hours — only a bound that refuses an impossible number. The REAL
 * bound, the file's own duration, is known only to the player once the audio
 * has loaded: a timing that runs past it is set aside and the segment plays
 * untimed (`timingFits`, the player's pure rules; DOMAIN_MODEL.md §8.5).
 */
export const RECITATION_TIMING_MAX_MS = 12 * 60 * 60 * 1000;

/** Where one Ayah is heard in a segment's audio: `[startMs, endMs)`. */
export const ayahTimingSchema = z.strictObject({
  ayah: ayahNumberSchema,
  startMs: z.number().int().min(0).max(RECITATION_TIMING_MAX_MS),
  endMs: z.number().int().min(1).max(RECITATION_TIMING_MAX_MS),
});
export type AyahTiming = z.output<typeof ayahTimingSchema>;

/**
 * Why a segment's timing cannot be recorded — a category, never a number.
 *
 *   coverage    not exactly one timing for every Ayah of the range
 *   empty-span  an Ayah ends at or before it starts
 *   overlap     an Ayah starts before the previous Ayah ends
 */
export type TimingProblem = 'coverage' | 'empty-span' | 'overlap';

/**
 * THE TIMING RULE, ONE PURE FUNCTION (the database enforces it again): a
 * segment's timing covers EACH Ayah of its range EXACTLY ONCE, each Ayah's
 * span is non-empty, and the spans are monotonic — every Ayah starts at or
 * after the previous one ends. Gaps are allowed (the reciter's opening
 * isti'adha and basmala, a pause), overlaps are not.
 */
export function timingProblem(
  range: { readonly startAyah: number; readonly endAyah: number },
  timings: readonly AyahTiming[],
): TimingProblem | null {
  const ordered = [...timings].sort((a, b) => a.ayah - b.ayah);
  if (ordered.length !== range.endAyah - range.startAyah + 1) return 'coverage';
  for (const [index, timing] of ordered.entries()) {
    if (timing.ayah !== range.startAyah + index) return 'coverage';
  }
  let previousEnd = 0;
  for (const timing of ordered) {
    if (timing.endMs <= timing.startMs) return 'empty-span';
    if (timing.startMs < previousEnd) return 'overlap';
    previousEnd = timing.endMs;
  }
  return null;
}

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

/**
 * Addresses beneath `/quran/translations/` the platform itself serves (Quran
 * Part 6: the compare view), which no Translation may take as its slug.
 */
export const TRANSLATION_RESERVED_SLUGS: readonly string[] = Object.freeze(['compare']);

export const translationInputSchema = z.strictObject({
  ...layerWorkFields,
  slug: quranSlugSchema.refine(
    (slug) => !TRANSLATION_RESERVED_SLUGS.includes(slug),
    'This address is the platform’s own.',
  ),
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
  /**
   * The language the listener HEARS (Quran Part 5): `ar` for a recitation of
   * the Arabic, `ur` for a narration of an Urdu translation. A content
   * Language (Taxonomy), as every layered work names one.
   */
  languageCode: quranLanguageCodeSchema,
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

/* ===========================================================================
 * Translator's notes (Quran Part 6)
 * ========================================================================= */

/**
 * WHAT A NOTE OPENS WITH, as its source wrote it — the one shape a stored
 * marker may take (`QuranTranslationNote_ck` holds it again):
 *
 *   ''          no mark at all (a note the source opens with its words);
 *   ٭ * ** ٭:   a run of one to four stars, Urdu "٭" or ASCII "*" (the source
 *               mixes them), optionally followed by the ":" it sometimes sets;
 *   1:- … 99:-  a numbered entry, answering the translation's "(1)" … "(99)";
 *   [1] … [9999] a bracketed footnote number, answering the SAME mark in the
 *               translation (QuranEnc's footnotes: owner decision 2026-11-10).
 */
export const TRANSLATION_NOTE_MARKER =
  /^(?:|[٭*]{1,4}:?|[1-9][0-9]?:-|\[[1-9][0-9]{0,3}\])$/;

/** One translator's note on one Ayah, as an administrator or the import gives it. */
export const translationNoteSchema = z.strictObject({
  marker: z.string().max(QURAN_LIMITS.noteMarker).regex(TRANSLATION_NOTE_MARKER),
  text: exactText(QURAN_LIMITS.noteText),
});
export type TranslationNoteValue = z.output<typeof translationNoteSchema>;

/**
 * One Ayah's text in a Translation and — where given — its translator's notes,
 * in order (Quran Part 6). `notes` omitted keeps the notes the Ayah has (which
 * must still be tied to the new text); `[]` removes them; a removed text
 * (`null`) removes its notes with it and can carry none.
 */
export const translationTextChangeSchema = z
  .strictObject({
    ayah: ayahNumberSchema,
    text: exactText(QURAN_LIMITS.layerText).nullable(),
    notes: z.array(translationNoteSchema).max(QURAN_LIMITS.notesPerAyah).optional(),
  })
  .refine(
    (value) =>
      value.text !== null || value.notes === undefined || value.notes.length === 0,
    { path: ['notes'], message: 'A removed text carries no notes.' },
  );
export type TranslationTextChange = z.output<typeof translationTextChangeSchema>;

export const translationTextSaveSchema = z
  .strictObject({
    surah: surahNumberSchema,
    changes: z.array(translationTextChangeSchema).min(1).max(QURAN_LIMITS.textsPerSave),
  })
  .refine(
    (value) => new Set(value.changes.map((c) => c.ayah)).size === value.changes.length,
    { path: ['changes'], message: 'An ayah is changed once per save.' },
  );
export type TranslationTextSave = z.output<typeof translationTextSaveSchema>;

/** A mark in a translation's text where a note may attach (UTF-16 offsets). */
export interface TranslationNoteMark {
  readonly start: number;
  readonly end: number;
  /** A run of stars, a numbered mark "(n)", or a bracketed footnote number "[n]". */
  readonly kind: 'star' | 'numbered' | 'bracketed';
  /** The run's length in stars, or the mark's number. */
  readonly size: number;
}

/**
 * Every star run ("٭", "*", "**" …), numbered mark ("(1)" …) and bracketed
 * footnote number ("[1]" …) of a text, in order.
 */
export function translationNoteMarks(text: string): readonly TranslationNoteMark[] {
  const marks: TranslationNoteMark[] = [];
  for (const match of text.matchAll(/[٭*]+|\(([1-9][0-9]?)\)|\[([1-9][0-9]{0,3})\]/g)) {
    const start = match.index;
    const [whole, numbered, bracketed] = match;
    marks.push({
      start,
      end: start + whole.length,
      kind:
        numbered !== undefined
          ? 'numbered'
          : bracketed !== undefined
            ? 'bracketed'
            : 'star',
      size: Number(numbered ?? bracketed ?? whole.length),
    });
  }
  return marks;
}

/** A note's marker read for its shape: a star run, a numbered entry, a bracketed number, or none. */
function markerOf(marker: string): {
  readonly kind: 'star' | 'numbered' | 'bracketed' | 'none';
  readonly size: number;
} | null {
  if (!TRANSLATION_NOTE_MARKER.test(marker)) return null;
  if (marker === '') return { kind: 'none', size: 0 };
  const numbered = /^([1-9][0-9]?):-$/.exec(marker);
  if (numbered !== null) return { kind: 'numbered', size: Number(numbered[1]) };
  const bracketed = /^\[([1-9][0-9]{0,3})\]$/.exec(marker);
  if (bracketed !== null) return { kind: 'bracketed', size: Number(bracketed[1]) };
  return { kind: 'star', size: marker.replace(':', '').length };
}

/**
 * THE TIE RULE, ONE PURE FUNCTION (Quran Part 6): where each of an Ayah's
 * notes attaches in its translation — the index of its mark in
 * `translationNoteMarks(text)`, or `null` for a note on the Ayah as a whole —
 * or `null` when some note is NOT tied, which is refused (`note-untied`). A
 * note is never placed by guesswork and a mark is never moved or added:
 *
 *   numbered  the notes "1:-" … "m:-" in order answer exactly the text's
 *             marks "(1)" … "(m)", in order, each its own;
 *   star      in order, each takes the next untaken star run of the same
 *             length ("٭" and "*" are one mark in two spellings, which the
 *             source mixes); a text with NO star mark at all carries its star
 *             notes on the Ayah as a whole, as its source sets them;
 *   bracketed each "[n]" answers the text's ONE mark "[n]", the notes in the
 *             order of their marks (QuranEnc, owner decision 2026-11-10);
 *   none      a note opened with no mark is the Ayah's ONLY note, and answers
 *             the one star or numbered mark the text carries — or the Ayah,
 *             when it has none.
 *
 * A mark no note answers stays what it is: text.
 */
export function tieTranslationNotes(
  text: string,
  notes: readonly { readonly marker: string }[],
): readonly (number | null)[] | null {
  if (notes.length > QURAN_LIMITS.notesPerAyah) return null;
  const marks = translationNoteMarks(text);
  const read = notes.map((note) => markerOf(note.marker));
  if (read.some((marker) => marker === null)) return null;
  const markers = read as readonly NonNullable<(typeof read)[number]>[];

  const numberedNotes = markers.filter((marker) => marker.kind === 'numbered');
  const numberedMarks = marks
    .map((mark, index) => ({ mark, index }))
    .filter(({ mark }) => mark.kind === 'numbered');
  if (numberedNotes.length > 0) {
    if (
      numberedNotes.some((marker, index) => marker.size !== index + 1) ||
      numberedMarks.length !== numberedNotes.length ||
      numberedMarks.some(({ mark }, index) => mark.size !== index + 1)
    )
      return null;
  }
  if (markers.some((marker) => marker.kind === 'none') && markers.length !== 1)
    return null;

  const starMarks = marks
    .map((mark, index) => ({ mark, index }))
    .filter(({ mark }) => mark.kind === 'star');
  const bracketedMarks = marks
    .map((mark, index) => ({ mark, index }))
    .filter(({ mark }) => mark.kind === 'bracketed');
  const unbracketed = marks
    .map((mark, index) => ({ mark, index }))
    .filter(({ mark }) => mark.kind !== 'bracketed');
  const taken = new Set<number>();
  let after = -1;
  let afterBracketed = -1;
  const ties: (number | null)[] = [];
  for (const marker of markers) {
    if (marker.kind === 'numbered') {
      ties.push(numberedMarks[marker.size - 1]?.index ?? null);
      continue;
    }
    if (marker.kind === 'bracketed') {
      const same = bracketedMarks.filter(({ mark }) => mark.size === marker.size);
      const [only] = same;
      if (only === undefined || same.length !== 1 || only.index <= afterBracketed)
        return null;
      afterBracketed = only.index;
      ties.push(only.index);
      continue;
    }
    if (marker.kind === 'none') {
      if (unbracketed.length > 1) return null;
      ties.push(unbracketed[0]?.index ?? null);
      continue;
    }
    if (starMarks.length === 0) {
      ties.push(null);
      continue;
    }
    const found = starMarks.find(
      ({ mark, index }) =>
        index > after && !taken.has(index) && mark.size === marker.size,
    );
    if (found === undefined) return null;
    taken.add(found.index);
    after = found.index;
    ties.push(found.index);
  }
  return ties;
}

/* ===========================================================================
 * Word by word (Quran Part 7)
 * ========================================================================= */

/**
 * A WORD-BY-WORD work: a gloss for each word of the Arabic, sourced — never
 * derived — and layered over the Ayah like a Translation (DOMAIN_MODEL.md
 * §8.7). Its contributors are a Translation's: a gloss renders a word into a
 * language, as a translator does.
 */
export const wordByWordInputSchema = z.strictObject({
  ...layerWorkFields,
  contributors: contributors(TRANSLATION_CONTRIBUTOR_ROLES),
});
export type WordByWordValue = z.output<typeof wordByWordInputSchema>;

/**
 * Is this whitespace-separated run of an Ayah's stored text a WORD? It is when
 * it carries a letter. A run that carries none is a SIGN the text writes
 * between its words — a pause mark (U+06D6–U+06DC: ۖ ۗ ۘ ۙ ۚ ۛ ۜ), the rub'
 * al-hizb ۞ that opens a quarter, the sajdah ۩ — and is never counted as one.
 * The one rule the word-by-word segmentation and a Juz's opening words share.
 */
export function isAyahWordToken(token: string): boolean {
  return /\p{L}/u.test(token);
}

/** One word of an Ayah, as `ayahWords` cuts it from the stored text. */
export interface AyahWord {
  /** Its place among the Ayah's words, from 1. */
  readonly position: number;
  /** Where it lies in the stored text (UTF-16 offsets, end exclusive). */
  readonly start: number;
  readonly end: number;
  /** The stored text from `start` to `end`, unchanged. */
  readonly text: string;
}

/**
 * THE WORD SEGMENTATION, ONE PURE FUNCTION (Quran Part 7): an Ayah's words as
 * its canonical text has them, VERBATIM — the stored text split on whitespace,
 * nothing respelled, normalised or rejoined.
 *
 * A SIGN BELONGS TO A WORD. A run with no letter (`isAyahWordToken`) is not a
 * word: it is attached to the word BEFORE it, with the space between them, so
 * "رَيْبَ ۛ" is one word and a pause mark never shifts a position; a sign
 * that OPENS the text (the ۞ a quarter begins with) has no word before it and
 * is attached to the word after it. A text with no word has none.
 *
 * Every word is one contiguous slice of the stored text, so the words and the
 * whitespace between them are the text again, exactly. The count it gives is
 * the count Tanzil's Uthmani text gives when pause signs are not words — the
 * count the Quranic Arabic Corpus numbers its words by — so a gloss sourced
 * against those positions lands on its word.
 */
export function ayahWords(text: string): readonly AyahWord[] {
  const spans: { start: number; end: number }[] = [];
  let leading: number | null = null;
  for (const match of text.matchAll(/\S+/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    const last = spans.at(-1);
    if (isAyahWordToken(match[0])) {
      spans.push({ start: leading ?? start, end });
      leading = null;
    } else if (last === undefined) {
      leading ??= start;
    } else {
      last.end = end;
    }
  }
  return spans.map((span, index) => ({
    position: index + 1,
    start: span.start,
    end: span.end,
    text: text.slice(span.start, span.end),
  }));
}

/**
 * One word's gloss, as its source wrote it: one line, exactly as supplied —
 * surrounding whitespace and any control character, line breaks included,
 * are refused rather than repaired.
 */
export const wordGlossSchema = z.strictObject({
  position: z.number().int().min(1).max(QURAN_WORD_POSITION_MAX),
  text: exactText(QURAN_LIMITS.gloss).refine(
    (value) => !hasControlCharacter(value),
    'A gloss is one line.',
  ),
});
export type WordGlossValue = z.output<typeof wordGlossSchema>;

/**
 * One Ayah's glosses in a word-by-word work, WHOLE: the glosses it keeps, each
 * position once, in any order; a position not named loses its gloss, and `[]`
 * removes the Ayah's glosses. Whether a position is one of the Ayah's words is
 * the service's question (`ayahWords`), asked against the stored text.
 */
export const wordGlossChangeSchema = z.strictObject({
  ayah: ayahNumberSchema,
  glosses: z
    .array(wordGlossSchema)
    .max(QURAN_WORD_POSITION_MAX)
    .refine(
      (list) => new Set(list.map((gloss) => gloss.position)).size === list.length,
      'A word is glossed once.',
    ),
});
export type WordGlossChange = z.output<typeof wordGlossChangeSchema>;

export const wordGlossSaveSchema = z
  .strictObject({
    surah: surahNumberSchema,
    changes: z.array(wordGlossChangeSchema).min(1).max(QURAN_LIMITS.textsPerSave),
  })
  .refine(
    (value) => new Set(value.changes.map((c) => c.ayah)).size === value.changes.length,
    { path: ['changes'], message: 'An ayah is changed once per save.' },
  );
export type WordGlossSave = z.output<typeof wordGlossSaveSchema>;

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

/**
 * A recitation segment: one audio file covering a same-Surah range — with,
 * where its source supplies one, the timing of every Ayah in it (Quran Part 5).
 * A segment is timed completely or not at all (`timingProblem`).
 */
export const recitationSegmentInputSchema = z
  .strictObject({
    surah: surahNumberSchema,
    startAyah: ayahNumberSchema,
    endAyah: ayahNumberSchema,
    timings: z.array(ayahTimingSchema).min(1).max(QURAN_AYAH_NUMBER_MAX).optional(),
  })
  .refine((value) => value.startAyah <= value.endAyah, {
    path: ['endAyah'],
    message: 'A range ends at or after where it starts.',
  })
  .refine(
    (value) =>
      value.timings === undefined || timingProblem(value, value.timings) === null,
    {
      path: ['timings'],
      message: 'The timing does not cover the range exactly once, in order.',
    },
  );
export type RecitationSegmentValue = z.output<typeof recitationSegmentInputSchema>;

/**
 * A Surah's display names, one per interface locale, each with the meaning of
 * the name in that locale where one is recorded ("The Opening") — presentation,
 * never identity (DOMAIN_MODEL.md §8.3). An absent meaning is `null`.
 */
export const surahNamesInputSchema = z.strictObject({
  surah: surahNumberSchema,
  names: z
    .array(
      z.strictObject({
        locale: z.enum(['en', 'ur', 'ar']),
        name: labelText(QURAN_LIMITS.surahName),
        meaning: labelText(QURAN_LIMITS.surahName).nullable().optional(),
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
  /** The meaning recorded beside a locale's name, keyed by that locale. */
  readonly meanings: Readonly<Partial<Record<Locale, string>>>;
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
/** A word-by-word work (Quran Part 7); `textCount` counts the ayat it glosses. */
export interface WordByWordRecord extends LayerWorkRecordBase {
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
  /** The language heard; `null` only for a recitation recorded before Part 5. */
  readonly languageCode: string | null;
  /**
   * Where a STREAMED recitation's audio lives (an allowlisted provider), or
   * `null` for first-party audio in Storage. Set only when the recitation is
   * created, by the operator import — never by a form.
   */
  readonly stream: RecitationStream | null;
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
  /** The Storage asset holding this segment's audio, or none yet (always none when streamed). */
  readonly assetId: string | null;
  /** How many of its ayat are timed: none, or every one (`timingProblem`). */
  readonly timedAyat: number;
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

/** One translator's note on one Ayah of a Translation, exactly as stored. */
export interface TranslationNote {
  /** Its place among the Ayah's notes, from 1. */
  readonly ordinal: number;
  /** What it opens with, as written (`TRANSLATION_NOTE_MARKER`); '' for none. */
  readonly marker: string;
  readonly text: string;
}

/** One Ayah's text in a Translation, with its translator's notes in order. */
export interface TranslationLayerText extends LayerText {
  readonly notes: readonly TranslationNote[];
}

/** One word's gloss, exactly as stored. */
export interface WordGloss {
  readonly position: number;
  readonly text: string;
}

/** One Ayah's glosses in a word-by-word work, in position order (Quran Part 7). */
export interface AyahGlosses {
  readonly ayah: number;
  readonly glosses: readonly WordGloss[];
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
export interface WordByWordPage {
  readonly items: readonly WordByWordRecord[];
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
 * no sitemap lists it. `reference` mode is the staging reference preview: every
 * page names the source and says the text has not been reviewed for this
 * platform, is `noindex`, and no sitemap lists it — and the reader reports it
 * only where the deployment admits it, inactive everywhere else
 * (`QURAN_MODE_POSTURE`). The application principal cannot create any mode.
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
  /** The meaning recorded beside a locale's name, keyed by that locale. */
  readonly meanings: Readonly<Partial<Record<Locale, string>>>;
}

export interface PublicAyah {
  readonly surah: number;
  readonly ayah: number;
  readonly juz: number;
  /** The source's hizb (1–60), when it recorded one. */
  readonly hizb: number | null;
  /** The source's mushaf page, when it recorded one. */
  readonly page: number | null;
  readonly sajdah: QuranSajdah | null;
  readonly text: string;
}

export interface PublicJuz {
  readonly number: number;
  readonly start: QuranRef;
  readonly end: QuranRef;
  readonly ayahCount: number;
  /** The first and last mushaf page it lies on, where the source recorded pages. */
  readonly pages: { readonly start: number; readonly end: number } | null;
  /** Every hizb the source recorded in it, ascending — empty when it recorded none. */
  readonly hizbs: readonly number[];
  /**
   * The stored text, unchanged, of the Ayah a Juz is known by
   * (`juzOpeningAyah`): a Juz is known by its opening words, and these are the
   * only words it may be shown by.
   */
  readonly openingText: string;
}

/**
 * THE AYAH A JUZ IS KNOWN BY: the one it begins with — except the first Juz,
 * which begins with Al-Fatihah but is known, as printed mushafs and readers
 * name it, by the opening of Al-Baqarah (2:1, "الٓمٓ"). Al-Fatihah opens the
 * whole Quran; it is not the first Juz's name.
 */
export function juzOpeningAyah(start: QuranRef): QuranRef {
  return start.surah === 1 && start.ayah === 1 ? { surah: 2, ayah: 1 } : start;
}

/** Where an Ayah falls — its citation, hizb and mushaf page — without its text. */
export interface PublicAyahPlace {
  readonly surah: number;
  readonly ayah: number;
  readonly hizb: number | null;
  readonly page: number | null;
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

/**
 * How much of the Quran one public Translation carries (Quran Part 6): for
 * each Surah it has any text in, how many ayat carry text and how many
 * translator's notes it holds. Counted, never claimed: a Surah is complete
 * only when its count equals the Surah's own.
 */
export interface PublicTranslationCoverage {
  readonly workId: string;
  readonly surahs: readonly {
    readonly surah: number;
    readonly ayat: number;
    readonly notes: number;
  }[];
}

/**
 * How much of the Quran one public Transliteration or word-by-word work
 * carries (Quran Part 7): for each Surah it has any text in, how many ayat
 * carry it and — for a word-by-word work — how many words are glossed.
 * Counted, never claimed: a Surah is complete only when its count equals the
 * Surah's own.
 */
export interface PublicLayerCoverage {
  readonly workId: string;
  readonly surahs: readonly {
    readonly surah: number;
    readonly ayat: number;
    /** Words glossed; 0 for a Transliteration, which has no words of its own. */
    readonly words: number;
  }[];
}

export interface PublicRecitation {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly reciterId: string;
  readonly style: string | null;
  readonly attribution: string | null;
  readonly languageCode: string | null;
  /** The allowlisted provider streaming it, or `null` for first-party audio. */
  readonly stream: RecitationStream | null;
  /** How many Surahs it has audio for. */
  readonly surahCount: number;
  /** The first Surah it has audio for — where a catalogue's Play begins — or null. */
  readonly firstSurah: number | null;
  /** Whether EVERY segment with audio carries per-Ayah timing. */
  readonly timed: boolean;
  readonly publishedAt: Date;
}

/**
 * A public segment with audio. First-party audio names its Storage asset (and
 * is servable only if Storage also says so); a streamed recitation's segment
 * names none — its address is derived from the stream and the Surah.
 */
export interface PublicRecitationSegment {
  readonly id: string;
  readonly surah: number;
  readonly startAyah: number;
  readonly endAyah: number;
  readonly assetId: string | null;
  /** Whether every Ayah of the segment is timed. */
  readonly timed: boolean;
}

/** Where one Ayah is heard in one public segment's audio. */
export interface PublicAyahTiming {
  readonly segmentId: string;
  readonly ayah: number;
  readonly startMs: number;
  readonly endMs: number;
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
  /**
   * Every PUBLIC layer text of this Ayah, in deterministic work-slug order —
   * and, since Quran Part 6, each translator's note of a public Translation
   * as a `note` of that work, after every text (work-slug order, then the
   * note's own order). A note is matched and shown as a note, never as the
   * translation.
   */
  readonly layers: readonly {
    readonly kind: 'translation' | 'transliteration' | 'note';
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
