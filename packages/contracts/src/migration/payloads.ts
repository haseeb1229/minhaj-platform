import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';

import {
  MIGRATION_LIMITS,
  languageCodeSchema,
  type AssetLicence,
  type MigrationContentKind,
} from './values.ts';

/**
 * Migration & Provenance — the staged payload of every content kind
 * (DOMAIN_MODEL.md §16, MIGRATION_STRATEGY.md §4.6–§4.7, Phase 30).
 *
 * LAYER 0 AND BROWSER-SAFE. Each kind has ONE strict schema, discriminated by
 * `kind`; a payload that only parses as JSON is not a payload. These are
 * Migration's OWN normalised shapes: no target type is named here, and only
 * the Layer-4 publisher of a kind translates its payload into that target's
 * input (MIGRATION_STRATEGY.md §2.2).
 *
 * TWO CLASSES OF KIND.
 *
 *   PUBLISHABLE — a Layer-4 publisher carries the payload into its owning
 *   domain through that domain's public service, which applies every one of
 *   its own rules and authority checks.
 *
 *   REVIEW-ONLY — religious material whose owning domain has no import path:
 *   a Fatwa exists only as the answer to a private question, through triage,
 *   an answerer and a different publisher; Quran layered text hangs from an
 *   accepted canonical corpus and an operator-registered source
 *   (DOMAIN_MODEL.md §8.3, §12.1). Such material is preserved, normalised,
 *   validated and reviewed as migration evidence, and is NEVER published by
 *   migration: no publisher exists, manifests refuse it, and the database
 *   refuses it a manifest entry. Its acceptance is the religious authority's
 *   (OPEN_DECISIONS.md §1).
 *
 * TEXT IS NEVER GENERATED OR CORRECTED. Every word is the source's, after the
 * conservative normalisation of §4.6 (no NFC/NFKC); rich text is the
 * sanitised allowlist re-expressed as blocks, never re-written.
 */

/* ===========================================================================
 * Kinds
 * ========================================================================= */

/* ===========================================================================
 * Shared pieces
 * ========================================================================= */

/** Lower-case ASCII words joined by single hyphens — the slug every target accepts. */
export const stagedSlugSchema = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const titleSchema = z.string().min(1).max(MIGRATION_LIMITS.title);
const dateSchema = z.iso.date();

/** Descriptive words for one locale — never a translation the pipeline made. */
export interface StagedLabel {
  readonly locale: Locale;
  readonly title: string;
  /** Plain text, derived from the sanitised description. */
  readonly description: string;
}

export const stagedLabelSchema = z
  .object({
    locale: localeSchema,
    title: titleSchema,
    description: z.string().max(MIGRATION_LIMITS.description),
  })
  .strict();

/** One inline run of rich text: its exact words, emphasis, and a safe link. */
export interface StagedInline {
  readonly text: string;
  readonly bold?: true;
  readonly italic?: true;
  /** An absolute http(s) URL or a site-relative path, already rewritten (§4.5). */
  readonly href?: string;
}

/**
 * One block of rich text. The sanitiser's allowlist (paragraphs, headings,
 * lists, quotations, emphasis, links) re-expressed as data, so each target
 * receives structure in its own format — and no markup string ever crosses
 * into a target.
 */
export type StagedBlock =
  | { readonly type: 'paragraph'; readonly content: readonly StagedInline[] }
  | {
      readonly type: 'heading';
      readonly level: 2 | 3 | 4;
      readonly content: readonly StagedInline[];
    }
  | { readonly type: 'quote'; readonly content: readonly StagedInline[] }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly StagedInline[])[];
    };

const hrefSchema = z
  .string()
  .min(1)
  .max(MIGRATION_LIMITS.url)
  .refine(
    (href) =>
      (href.startsWith('/') && !href.startsWith('//')) || /^https?:\/\//.test(href),
  );

export const stagedInlineSchema = z
  .object({
    // One run may be a whole legacy paragraph; the payload's own bound caps it.
    text: z.string().min(1).max(MIGRATION_LIMITS.payload),
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
    href: hrefSchema.optional(),
  })
  .strict();

const inlinesSchema = z.array(stagedInlineSchema).min(1).max(2000);

export const stagedBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), content: inlinesSchema }).strict(),
  z
    .object({
      type: z.literal('heading'),
      level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      content: inlinesSchema,
    })
    .strict(),
  z.object({ type: z.literal('quote'), content: inlinesSchema }).strict(),
  z
    .object({
      type: z.literal('list'),
      ordered: z.boolean(),
      items: z.array(inlinesSchema).min(1).max(500),
    })
    .strict(),
]);

/** A rich body: at most this many blocks. */
export const MAX_STAGED_BLOCKS = 2000;
export const stagedBodySchema = z.array(stagedBlockSchema).min(1).max(MAX_STAGED_BLOCKS);

/**
 * Another migrated record this one names, by the LEGACY URL of that record.
 * Resolved at publication through the ACTIVE legacy mapping only — so a
 * reference to a record not yet published refuses, and is never guessed.
 */
export interface StagedReference {
  readonly role: 'magazine';
  readonly legacyUrl: string;
}

export const stagedReferenceSchema = z
  .object({
    role: z.enum(['magazine']),
    legacyUrl: z
      .string()
      .min(1)
      .max(MIGRATION_LIMITS.url)
      .regex(/^https:\/\//),
  })
  .strict();

/**
 * An acquired source asset this record uses, by its canonical source URL.
 * Publication resolves it through Migration's own acquisition provenance,
 * and only an acquisition a PERSON decided `public-eligible` is ever used.
 */
export const stagedAssetUrlSchema = z
  .string()
  .min(1)
  .max(MIGRATION_LIMITS.url)
  .regex(/^https:\/\//);

/**
 * Phase 30-R. An image the source presents AS PART OF this record — a lead
 * image, a cover, a portrait, a poster — named by its canonical source URL.
 * Publication uses it only through a rights-cleared acquisition of exactly
 * that URL (a person decided it `public-eligible`), and then only the
 * metadata-stripped public copy Storage made of it; otherwise the record is
 * published without it. `alt` is the source's own words for it (its `alt`
 * attribute), possibly empty; `credit` only when the source states one.
 */
export interface StagedImage {
  readonly url: string;
  readonly alt: string;
  readonly credit: string | null;
}

export const stagedImageSchema = z
  .object({
    url: stagedAssetUrlSchema,
    alt: z.string().max(300),
    credit: z.string().min(1).max(200).nullable(),
  })
  .strict();

/* ===========================================================================
 * media.video (Phase 29; poster Phase 30-R)
 * ========================================================================= */

export const MIGRATION_VIDEO_PROVIDERS = Object.freeze(['youtube', 'vimeo'] as const);
export type MigrationVideoProvider = (typeof MIGRATION_VIDEO_PROVIDERS)[number];

/**
 * A staged Video. `descriptionHtml` IS ALREADY SANITISED — the allowlist ran
 * before this value was stored (SECURITY_BASELINE.md §10.2).
 */
export interface StagedVideoPayload {
  readonly kind: 'media.video';
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly languageCode: string;
  readonly provider: MigrationVideoProvider;
  readonly providerVideoId: string;
  readonly labels: readonly StagedLabel[];
  readonly descriptionHtml: string;
  readonly publishedOn: string | null;
  readonly durationSeconds: number | null;
  readonly legacyIdentifier: string | null;
  /** Phase 30-R: the source's own poster image for this video, when it shows one. */
  readonly poster: StagedImage | null;
}

export const stagedVideoPayloadSchema = z
  .object({
    kind: z.literal('media.video'),
    slug: stagedSlugSchema,
    primaryLocale: localeSchema,
    languageCode: languageCodeSchema,
    provider: z.enum(MIGRATION_VIDEO_PROVIDERS),
    providerVideoId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    labels: z.array(stagedLabelSchema).min(1).max(3),
    descriptionHtml: z.string().max(MIGRATION_LIMITS.payload / 2),
    publishedOn: dateSchema.nullable(),
    durationSeconds: z.number().int().min(1).max(360_000).nullable(),
    legacyIdentifier: z.string().max(200).nullable(),
    poster: stagedImageSchema.nullable().default(null),
  })
  .strict();

/* ===========================================================================
 * library.work — a Work with the one Edition its source page describes
 * ========================================================================= */

export interface StagedWorkPayload {
  readonly kind: 'library.work';
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly languageCode: string;
  readonly labels: readonly StagedLabel[];
  readonly legacyIdentifier: string | null;
  readonly edition: {
    readonly label: string;
    readonly publisher: string | null;
    readonly publicationYear: number | null;
    readonly isbn: string | null;
    readonly pageCount: number | null;
    /** A PDF the source offers to read, when acquired. */
    readonly readableAssetUrl: string | null;
    /** A PDF the source offers to download, when acquired. */
    readonly downloadAssetUrl: string | null;
    /** Phase 30-R: the edition's cover image as the source shows it. */
    readonly cover: StagedImage | null;
  };
}

export const stagedWorkPayloadSchema = z
  .object({
    kind: z.literal('library.work'),
    slug: stagedSlugSchema,
    primaryLocale: localeSchema,
    languageCode: languageCodeSchema,
    labels: z.array(stagedLabelSchema).min(1).max(3),
    legacyIdentifier: z.string().max(200).nullable(),
    edition: z
      .object({
        label: z.string().min(1).max(160),
        publisher: z.string().min(1).max(200).nullable(),
        publicationYear: z.number().int().min(1000).max(2200).nullable(),
        isbn: z
          .string()
          .regex(/^(?:97[89])?[0-9]{9}[0-9X]$/)
          .nullable(),
        pageCount: z.number().int().min(1).max(100_000).nullable(),
        readableAssetUrl: stagedAssetUrlSchema.nullable(),
        downloadAssetUrl: stagedAssetUrlSchema.nullable(),
        cover: stagedImageSchema.nullable().default(null),
      })
      .strict(),
  })
  .strict();

/* ===========================================================================
 * library.magazine and library.magazine-issue
 * ========================================================================= */

export interface StagedMagazinePayload {
  readonly kind: 'library.magazine';
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly StagedLabel[];
  readonly legacyIdentifier: string | null;
}

export const stagedMagazinePayloadSchema = z
  .object({
    kind: z.literal('library.magazine'),
    slug: stagedSlugSchema,
    primaryLocale: localeSchema,
    labels: z.array(stagedLabelSchema).min(1).max(3),
    legacyIdentifier: z.string().max(200).nullable(),
  })
  .strict();

export interface StagedMagazineIssuePayload {
  readonly kind: 'library.magazine-issue';
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly languageCode: string;
  readonly labels: readonly StagedLabel[];
  readonly publishedOn: string | null;
  readonly volume: string | null;
  readonly issueNumber: string | null;
  /** The magazine this issue belongs to — published first, resolved by mapping. */
  readonly magazine: StagedReference;
  /** The issue's table of contents or editorial words, when the page carries them. */
  readonly body: readonly StagedBlock[] | null;
  readonly legacyIdentifier: string | null;
  /** Phase 30-R: the issue's cover image as the source shows it. */
  readonly cover: StagedImage | null;
}

export const stagedMagazineIssuePayloadSchema = z
  .object({
    kind: z.literal('library.magazine-issue'),
    slug: stagedSlugSchema,
    primaryLocale: localeSchema,
    languageCode: languageCodeSchema,
    labels: z.array(stagedLabelSchema).min(1).max(3),
    publishedOn: dateSchema.nullable(),
    volume: z.string().min(1).max(40).nullable(),
    issueNumber: z.string().min(1).max(40).nullable(),
    magazine: stagedReferenceSchema,
    body: stagedBodySchema.nullable(),
    legacyIdentifier: z.string().max(200).nullable(),
    cover: stagedImageSchema.nullable().default(null),
  })
  .strict();

/* ===========================================================================
 * editorial.news and editorial.article — one language version each
 * ========================================================================= */

/** The languages Editorial accepts as a record's primary language. */
export const EDITORIAL_MIGRATION_LANGUAGES = Object.freeze(['en', 'ur', 'ar'] as const);

/** The Editorial families that carry a dated, sourced record (Phase 30-R adds press releases). */
export type StagedEditorialKind =
  'editorial.news' | 'editorial.article' | 'editorial.press-release';

export interface StagedEditorialPayload {
  readonly kind: StagedEditorialKind;
  readonly slug: string;
  readonly languageCode: (typeof EDITORIAL_MIGRATION_LANGUAGES)[number];
  readonly title: string;
  readonly excerpt: string;
  readonly body: readonly StagedBlock[];
  /**
   * The source's own ORIGINAL publication date. Since Phase 30-R it is carried
   * into Editorial as the record's source date — its reader-facing chronology —
   * and is never replaced by the migration or approval date.
   */
  readonly publishedOn: string | null;
  readonly legacyIdentifier: string | null;
  /** Phase 30-R: the record's lead image as the source presents it. */
  readonly leadImage: StagedImage | null;
}

function editorialSchema<K extends StagedEditorialKind>(kind: K) {
  return z
    .object({
      kind: z.literal(kind),
      slug: stagedSlugSchema,
      languageCode: z.enum(EDITORIAL_MIGRATION_LANGUAGES),
      title: z.string().min(1).max(200),
      excerpt: z.string().max(600),
      body: stagedBodySchema,
      publishedOn: dateSchema.nullable(),
      legacyIdentifier: z.string().max(200).nullable(),
      leadImage: stagedImageSchema.nullable().default(null),
    })
    .strict();
}

export const stagedNewsPayloadSchema = editorialSchema('editorial.news');
export const stagedArticlePayloadSchema = editorialSchema('editorial.article');
export const stagedPressReleasePayloadSchema = editorialSchema('editorial.press-release');

/* ===========================================================================
 * editorial.page — one shell-bound organisational Page (Phase 30-R)
 * ========================================================================= */

/**
 * A public organisational Page bound to ONE reserved shell route
 * (`/explore/{section}` or `/explore/{section}/{page}`) that the committed
 * catalogue maps the source page to. The words are the source's; the binding
 * is the catalogue's statement of where that page belongs, never a guess, and
 * Editorial validates it against its own closed list.
 */
export interface StagedPagePayload {
  readonly kind: 'editorial.page';
  readonly binding: string;
  readonly languageCode: (typeof EDITORIAL_MIGRATION_LANGUAGES)[number];
  readonly title: string;
  readonly excerpt: string;
  readonly body: readonly StagedBlock[];
  readonly leadImage: StagedImage | null;
  readonly legacyIdentifier: string | null;
}

export const stagedPagePayloadSchema = z
  .object({
    kind: z.literal('editorial.page'),
    binding: z
      .string()
      .min(9)
      .max(100)
      .regex(/^\/explore\/[a-z]+(?:-[a-z]+)*(?:\/[a-z]+(?:-[a-z]+)*)?$/),
    languageCode: z.enum(EDITORIAL_MIGRATION_LANGUAGES),
    title: z.string().min(1).max(200),
    excerpt: z.string().max(600),
    body: stagedBodySchema,
    leadImage: stagedImageSchema.nullable(),
    legacyIdentifier: z.string().max(200).nullable(),
  })
  .strict();

/* ===========================================================================
 * people.person — one public profile (Phase 30-R)
 * ========================================================================= */

/**
 * A Person's public profile as the source states it: the name exactly as
 * written, and a biography of WHOLE source paragraphs within People's bound —
 * never cut mid-paragraph, never summarised. The portrait is the source's own
 * image of the person, used only when rights-cleared.
 */
export interface StagedPersonPayload {
  readonly kind: 'people.person';
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly {
    readonly locale: Locale;
    readonly name: string;
    readonly biography: string;
  }[];
  readonly portrait: StagedImage | null;
  readonly legacyIdentifier: string | null;
}

export const stagedPersonPayloadSchema = z
  .object({
    kind: z.literal('people.person'),
    slug: stagedSlugSchema,
    primaryLocale: localeSchema,
    labels: z
      .array(
        z
          .object({
            locale: localeSchema,
            name: z.string().min(1).max(200),
            biography: z.string().max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    portrait: stagedImageSchema.nullable(),
    legacyIdentifier: z.string().max(200).nullable(),
  })
  .strict();

/* ===========================================================================
 * global.country — a country the organisation states it is present in (30-R)
 * ========================================================================= */

/**
 * A Country, by its ISO 3166-1 alpha-2 code, with the name the source uses.
 * The code comes from a FIXED table in the adapter keyed by that exact name —
 * a structural fact, like the surah lengths — and a name missing from the
 * table is never guessed into one.
 */
export interface StagedCountryPayload {
  readonly kind: 'global.country';
  readonly code: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly { readonly locale: Locale; readonly name: string }[];
  readonly legacyIdentifier: string | null;
}

export const stagedCountryPayloadSchema = z
  .object({
    kind: z.literal('global.country'),
    code: z.string().regex(/^[A-Z]{2}$/),
    slug: stagedSlugSchema,
    primaryLocale: localeSchema,
    labels: z
      .array(
        z.object({ locale: localeSchema, name: z.string().min(1).max(120) }).strict(),
      )
      .min(1)
      .max(3),
    legacyIdentifier: z.string().max(200).nullable(),
  })
  .strict();

/* ===========================================================================
 * REVIEW-ONLY: fatwa.ruling and quran.translation
 * ========================================================================= */

export interface StagedFatwaPayload {
  readonly kind: 'fatwa.ruling';
  readonly slug: string;
  readonly languageCode: string;
  readonly title: string;
  /** The question as the source PUBLISHED it, incidental personal data redacted. */
  readonly question: readonly StagedBlock[];
  /** The published answer, exactly as the source gave it. */
  readonly answer: readonly StagedBlock[];
  /** The source's own reference number, when it shows one. */
  readonly sourceReference: string | null;
  /** Who the source names as answering — attribution evidence, never inferred. */
  readonly attributedTo: string | null;
  readonly publishedOn: string | null;
  readonly legacyIdentifier: string | null;
}

export const stagedFatwaPayloadSchema = z
  .object({
    kind: z.literal('fatwa.ruling'),
    slug: stagedSlugSchema,
    languageCode: languageCodeSchema,
    title: titleSchema,
    question: stagedBodySchema,
    answer: stagedBodySchema,
    sourceReference: z.string().min(1).max(80).nullable(),
    attributedTo: z.string().min(1).max(200).nullable(),
    publishedOn: dateSchema.nullable(),
    legacyIdentifier: z.string().max(200).nullable(),
  })
  .strict();

/** The number of ayat in each surah — a structural fact, used only to validate references. */
export const SURAH_AYAH_COUNTS: readonly number[] = Object.freeze([
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98,
  135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11,
  11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25,
  22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6,
  3, 5, 4, 5, 6,
]);

export interface StagedQuranTranslationPayload {
  readonly kind: 'quran.translation';
  /** The translation work, as the source names it (e.g. its title and language). */
  readonly work: string;
  readonly languageCode: string;
  readonly surah: number;
  /** One entry per ayah the source gives, its text EXACTLY as the source wrote it. */
  readonly ayat: readonly { readonly ayah: number; readonly text: string }[];
  readonly legacyIdentifier: string | null;
}

export const stagedQuranTranslationPayloadSchema = z
  .object({
    kind: z.literal('quran.translation'),
    work: z.string().min(1).max(200),
    languageCode: languageCodeSchema,
    surah: z.number().int().min(1).max(114),
    ayat: z
      .array(
        z
          .object({
            ayah: z.number().int().min(1).max(286),
            text: z.string().min(1).max(20_000),
          })
          .strict(),
      )
      .min(1)
      .max(286),
    legacyIdentifier: z.string().max(200).nullable(),
  })
  .strict()
  .refine(
    (value) => {
      const count = SURAH_AYAH_COUNTS[value.surah - 1] ?? 0;
      const seen = new Set<number>();
      for (const { ayah } of value.ayat) {
        if (ayah > count || seen.has(ayah)) return false;
        seen.add(ayah);
      }
      return true;
    },
    { message: 'ayah-out-of-range' },
  );

/* ===========================================================================
 * The union
 * ========================================================================= */

export type StagedPayload =
  | StagedVideoPayload
  | StagedWorkPayload
  | StagedMagazinePayload
  | StagedMagazineIssuePayload
  | StagedEditorialPayload
  | StagedPagePayload
  | StagedPersonPayload
  | StagedCountryPayload
  | StagedFatwaPayload
  | StagedQuranTranslationPayload;

/** Every kind has exactly one payload shape (checked at compile time). */
type KindsAgree = [StagedPayload['kind']] extends [MigrationContentKind]
  ? [MigrationContentKind] extends [StagedPayload['kind']]
    ? true
    : never
  : never;
export const STAGED_PAYLOAD_KINDS_AGREE: KindsAgree = true;

/** The strict schema of each kind — the one place a stored payload is judged. */
export const STAGED_PAYLOAD_SCHEMAS = Object.freeze({
  'media.video': stagedVideoPayloadSchema,
  'library.work': stagedWorkPayloadSchema,
  'library.magazine': stagedMagazinePayloadSchema,
  'library.magazine-issue': stagedMagazineIssuePayloadSchema,
  'editorial.news': stagedNewsPayloadSchema,
  'editorial.article': stagedArticlePayloadSchema,
  'editorial.press-release': stagedPressReleasePayloadSchema,
  'editorial.page': stagedPagePayloadSchema,
  'people.person': stagedPersonPayloadSchema,
  'global.country': stagedCountryPayloadSchema,
  'fatwa.ruling': stagedFatwaPayloadSchema,
  'quran.translation': stagedQuranTranslationPayloadSchema,
} satisfies Record<MigrationContentKind, z.ZodType>);

/**
 * A stored payload of `kind`, or `null`. The JSON must parse, carry exactly
 * `kind`, and pass that kind's strict schema — nothing else is a payload.
 */
export function parseStagedPayload(
  kind: MigrationContentKind,
  json: string,
): StagedPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { kind?: unknown }).kind !== kind
  )
    return null;
  const parsed = STAGED_PAYLOAD_SCHEMAS[kind].safeParse(value);
  return parsed.success ? (parsed.data as StagedPayload) : null;
}

/* ===========================================================================
 * Parsed records — what an adapter hands normalisation, BEFORE sanitisation
 * ========================================================================= */

/** Phase 30-R: an image the source presents with a record, before normalisation. */
export interface ParsedImage {
  readonly url: string;
  readonly alt: string;
  readonly credit: string | null;
}

/** An asset the page offers, with the rights evidence the source itself states. */
export interface ParsedAsset {
  readonly url: string;
  readonly licence: AssetLicence;
  readonly licenceEvidence: string | null;
  readonly rightsHolder: string | null;
}

/** What every parsed record carries. Markup is UNTRUSTED and as the source wrote it. */
interface ParsedCommon {
  readonly title: string;
  readonly primaryLocale: Locale;
  readonly languageCode: string | null;
  readonly publishedOn: string | null;
  readonly legacyIdentifier: string | null;
  readonly categories: readonly { readonly key: string; readonly label: string }[];
  /** Every href the record carries outside its markup, in document order. */
  readonly links: readonly string[];
  readonly assets: readonly ParsedAsset[];
}

export interface ParsedVideo extends ParsedCommon {
  readonly kind: 'media.video';
  readonly provider: string | null;
  readonly providerReference: string | null;
  readonly labels: readonly {
    readonly locale: Locale;
    readonly title: string;
    readonly descriptionHtml: string;
  }[];
  readonly descriptionHtml: string;
  readonly durationSeconds: number | null;
  /** Phase 30-R: the poster image the source shows for this video. */
  readonly poster: ParsedImage | null;
}

export interface ParsedWork extends ParsedCommon {
  readonly kind: 'library.work';
  readonly descriptionHtml: string;
  readonly edition: {
    readonly label: string | null;
    readonly publisher: string | null;
    readonly publicationYear: string | null;
    readonly isbn: string | null;
    readonly pageCount: string | null;
    readonly readableAssetUrl: string | null;
    readonly downloadAssetUrl: string | null;
    /** Phase 30-R: the cover image the source shows. */
    readonly cover: ParsedImage | null;
  };
}

export interface ParsedMagazine extends ParsedCommon {
  readonly kind: 'library.magazine';
  readonly descriptionHtml: string;
}

export interface ParsedMagazineIssue extends ParsedCommon {
  readonly kind: 'library.magazine-issue';
  readonly bodyHtml: string | null;
  readonly volume: string | null;
  readonly issueNumber: string | null;
  readonly magazineUrl: string;
  /** Phase 30-R: the cover image the source shows. */
  readonly cover: ParsedImage | null;
}

export interface ParsedEditorial extends ParsedCommon {
  readonly kind: StagedEditorialKind;
  readonly excerptHtml: string | null;
  readonly bodyHtml: string;
  /** Phase 30-R: the lead image the source presents with the record. */
  readonly leadImage: ParsedImage | null;
}

export interface ParsedPage extends ParsedCommon {
  readonly kind: 'editorial.page';
  /** The shell route the committed catalogue maps this source page to. */
  readonly binding: string;
  readonly excerptHtml: string | null;
  readonly bodyHtml: string;
  readonly leadImage: ParsedImage | null;
}

export interface ParsedPerson extends ParsedCommon {
  readonly kind: 'people.person';
  /** The person's name exactly as the source writes it. */
  readonly name: string;
  readonly biographyHtml: string;
  readonly portrait: ParsedImage | null;
}

export interface ParsedCountry extends ParsedCommon {
  readonly kind: 'global.country';
  /** The ISO 3166-1 alpha-2 code from the adapter's fixed table, or null. */
  readonly code: string | null;
}

export interface ParsedFatwa extends ParsedCommon {
  readonly kind: 'fatwa.ruling';
  readonly questionHtml: string;
  readonly answerHtml: string;
  readonly sourceReference: string | null;
  readonly attributedTo: string | null;
}

export interface ParsedQuranTranslation extends ParsedCommon {
  readonly kind: 'quran.translation';
  readonly work: string;
  readonly surah: number | null;
  readonly ayat: readonly { readonly ayah: number | null; readonly text: string }[];
}

export type ParsedRecord =
  | ParsedVideo
  | ParsedWork
  | ParsedMagazine
  | ParsedMagazineIssue
  | ParsedEditorial
  | ParsedPage
  | ParsedPerson
  | ParsedCountry
  | ParsedFatwa
  | ParsedQuranTranslation;
