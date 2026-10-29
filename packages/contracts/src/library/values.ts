import { z } from 'zod';
import { localeSchema } from '../env/shared.ts';
import { CONTRIBUTION_ROLES } from '../people/values.ts';

export const libraryIdSchema = z.uuid();
/** One slug grammar for every Library aggregate with a public address. */
export const librarySlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/**
 * Stated as a literal type rather than inferred from the schema, because Library
 * records carry it across the persistence boundary and that boundary's contract
 * must be explicit; `satisfies` keeps the two from drifting.
 */
export type LibraryState = 'draft' | 'published' | 'archived';
export const libraryStateSchema = z.enum([
  'draft',
  'published',
  'archived',
]) satisfies z.ZodType<LibraryState>;
/** A content-language reference, in the shape Taxonomy's `Language.code` takes. */
export const libraryLanguageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
export const libraryVersionSchema = z.number().int().positive().max(2_147_483_646);
const text = (max: number) => z.string().trim().max(max);
const ids = (max: number) =>
  z
    .array(libraryIdSchema)
    .max(max)
    .refine((v) => new Set(v).size === v.length);
export const workInputSchema = z
  .object({
    slug: librarySlugSchema,
    primaryLocale: localeSchema,
    state: libraryStateSchema,
    isFeatured: z.boolean(),
    labels: z
      .array(
        z
          .object({
            locale: localeSchema,
            title: text(240).min(1),
            description: text(4000),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    contributors: z
      .array(
        z
          .object({ personId: libraryIdSchema, role: z.enum(CONTRIBUTION_ROLES) })
          .strict(),
      )
      .max(24),
    topicIds: ids(24),
    salePointIds: ids(24),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !v.labels.some((l) => l.locale === v.primaryLocale) ||
      new Set(v.labels.map((l) => l.locale)).size !== v.labels.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'A unique primary locale label is required.',
      });
    if (
      new Set(v.contributors.map((c) => c.personId + ':' + c.role)).size !==
      v.contributors.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate contribution.' });
  });

/** Plain semantic text, never HTML. Authoritative section keys survive presentation changes. */
export const readerDocumentSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
            title: text(240).min(1),
            paragraphs: z.array(text(8000).min(1)).min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.sections.map((s) => s.key)).size !== v.sections.length ||
      JSON.stringify(v).length > 500_000
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Document exceeds bounds or repeats a section key.',
      });
  });

/**
 * The plain-text authoring format for an Edition's readable content, and its
 * inverse.
 *
 * WHY A FORMAT AT ALL, AND WHY THIS ONE. The reader needs authored STRUCTURE —
 * titled sections — because the stable position identifier is built from section
 * keys. It does not need rich text: there is no bold, no link, no embed and no
 * table in a `ReaderDocument`, so an editor for one would be a second rich-text
 * pipeline beside Editorial's, with a second sanitiser to keep correct, for a
 * requirement no accepted document makes (§46).
 *
 * So the format is the smallest thing that carries a heading and paragraphs:
 *
 *     ## First section
 *     A paragraph.
 *
 *     Another paragraph.
 *
 *     ## Second section
 *     …
 *
 * IT IS NOT MARKDOWN, and it is important that it is not. Nothing here interprets
 * emphasis, links or HTML; `##` is a line prefix and every other character is
 * literal text. The reader inserts each paragraph as a TEXT NODE, so there is no
 * markup path from this input to a rendered page and nothing to sanitise.
 *
 * SECTION KEYS ARE DERIVED, NOT TYPED. An operator writing a book should not also
 * have to invent stable identifiers — and an identifier somebody types by hand is
 * one somebody can accidentally change, which would move every reading position in
 * that edition. The key comes from the title, and a title that yields no usable
 * characters (Urdu or Arabic, for instance) gets a positional key instead, which is
 * still deterministic for the same input.
 *
 * THE INVERSE EXISTS SO EDITING IS NOT RETYPING. `formatReaderDocument` renders a
 * stored document back into the same text, which is what lets the administrative
 * form be a round trip rather than a one-way import.
 */
const SECTION_PREFIX = '## ';

export function parseReaderDocument(input: string): ReaderDocument | null {
  const lines = input.replaceAll('\r\n', '\n').split('\n');
  const sections: { key: string; title: string; paragraphs: string[] }[] = [];
  const used = new Set<string>();

  let current: { title: string; paragraphs: string[] } | null = null;
  let paragraph: string[] = [];

  const closeParagraph = (): void => {
    const text = paragraph.join(' ').trim();
    if (text !== '' && current !== null) current.paragraphs.push(text);
    paragraph = [];
  };

  const closeSection = (): void => {
    closeParagraph();
    if (current === null) return;
    // A section with a title and no text is dropped rather than stored as an
    // empty one: the reader would render a heading over nothing, and the schema
    // requires at least one paragraph.
    if (current.paragraphs.length > 0) {
      sections.push({
        key: uniqueSectionKey(current.title, sections.length, used),
        title: current.title,
        paragraphs: current.paragraphs,
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith(SECTION_PREFIX)) {
      closeSection();
      const title = line.slice(SECTION_PREFIX.length).trim();
      current = { title: title === '' ? '' : title, paragraphs: [] };
      continue;
    }

    // A BLANK LINE ENDS A PARAGRAPH, so a wrapped line stays one paragraph. Text
    // before the first heading is discarded: it would have no section to belong
    // to, and inventing an untitled one would invent structure.
    if (line.trim() === '') closeParagraph();
    else paragraph.push(line.trim());
  }

  closeSection();

  // Parsed, then VALIDATED by the same schema everything else is. A document that
  // exceeds the bounds is rejected here rather than saved and refused by SQL.
  const parsed = readerDocumentSchema.safeParse({ sections });
  return parsed.success ? parsed.data : null;
}

/**
 * A deterministic, schema-valid key for one section title, unique among the
 * keys already `used` (which it extends). Exported so every producer of a
 * `ReaderDocument` — the authoring format here, a migrated record's structured
 * body at Layer 4 — derives keys by the one rule.
 */
export function uniqueSectionKey(
  title: string,
  index: number,
  used: Set<string>,
): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  // A title in a non-Latin script yields nothing usable, which is the ORDINARY
  // case for this corpus rather than an edge case. A positional key is still
  // deterministic for the same input, which is all the position identifier needs.
  const base = /^[a-z]/.test(slug) ? slug : `section-${index + 1}`;

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

export function formatReaderDocument(document: ReaderDocument): string {
  return document.sections
    .map(
      (section) =>
        `${SECTION_PREFIX}${section.title}\n\n${section.paragraphs.join('\n\n')}`,
    )
    .join('\n\n');
}

export function validIsbn(value: string): boolean {
  if (/^\d{9}[\dX]$/.test(value))
    return (
      [...value].reduce((sum, c, i) => sum + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) %
        11 ===
      0
    );
  if (/^97[89]\d{10}$/.test(value))
    return (
      [...value].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0
    );
  return false;
}
const isbn = z
  .string()
  .transform((v) => v.replaceAll(/[-\s]/g, '').toUpperCase())
  .refine(validIsbn)
  .nullable();
/**
 * Phase 30-R — the optional COVER of an Edition or a MagazineIssue: ONE typed
 * reference to an application-owned stored still image, with its measured box
 * so a card reserves its space. Never a remote URL. On an UPDATE an omitted
 * cover keeps the stored one and `null` removes it, so a form that does not
 * offer covers cannot erase one by saving.
 */
export const libraryCoverSchema = z
  .object({
    assetId: libraryIdSchema,
    width: z.number().int().min(1).max(16_384),
    height: z.number().int().min(1).max(16_384),
  })
  .strict();
export type LibraryCover = z.infer<typeof libraryCoverSchema>;

export const editionInputSchema = z
  .object({
    workId: libraryIdSchema,
    label: text(160).min(1),
    languageCode: libraryLanguageCodeSchema,
    state: libraryStateSchema,
    publisher: text(240).nullable(),
    publicationYear: z.number().int().min(1).max(9999).nullable(),
    isbn,
    pageCount: z.number().int().positive().max(1_000_000).nullable(),
    reading: z.enum(['allowed', 'unavailable']),
    download: z.enum(['allowed', 'denied']),
    readableAssetId: libraryIdSchema.nullable(),
    downloadAssetId: libraryIdSchema.nullable(),
    document: readerDocumentSchema.nullable(),
    cover: libraryCoverSchema.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.reading === 'allowed' && !v.document && !v.readableAssetId)
      ctx.addIssue({ code: 'custom', message: 'Reading requires a source.' });
    if (v.download === 'allowed' && !v.downloadAssetId)
      ctx.addIssue({ code: 'custom', message: 'Download requires a file.' });
  });
export const translationInputSchema = z
  .object({
    editionId: libraryIdSchema,
    expectedVersion: libraryVersionSchema,
    sourceEditionId: libraryIdSchema.nullable(),
    translatorIds: ids(24).min(1),
  })
  .strict()
  .refine((v) => v.editionId !== v.sourceEditionId);
export const salePointInputSchema = z
  .object({
    name: text(200).min(1),
    address: text(1000),
    contact: text(200),
    url: z
      .url()
      .max(2000)
      .refine((v) => {
        const u = new URL(v);
        return u.protocol === 'https:' && !u.username && !u.password;
      })
      .nullable(),
    state: libraryStateSchema,
  })
  .strict();
export const libraryQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    language: z.string().max(16).nullable().default(null),
    topic: libraryIdSchema.nullable().default(null),
    contributor: libraryIdSchema.nullable().default(null),
    from: z.number().int().min(1).max(9999).nullable().default(null),
    to: z.number().int().min(1).max(9999).nullable().default(null),
    downloads: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.from === null || v.to === null || v.from <= v.to);

export type WorkInput = z.infer<typeof workInputSchema>;
export type EditionInput = z.infer<typeof editionInputSchema>;
export type ReaderDocument = z.infer<typeof readerDocumentSchema>;
export type TranslationInput = z.infer<typeof translationInputSchema>;
export type SalePointInput = z.infer<typeof salePointInputSchema>;
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;
export type AssetPurpose = 'read' | 'download' | 'preview';

/** Edition + content digest + section key: independent of font, viewport, or account. */
export function readerPosition(
  editionId: string,
  contentVersion: string,
  sectionKey: string,
): string {
  return `edition-${editionId}-${contentVersion}-${sectionKey}`;
}
