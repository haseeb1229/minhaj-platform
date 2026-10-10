import { z } from 'zod';
import { CONTRIBUTION_ROLES, type ContributionRole } from '../people/values.ts';
import {
  NEWS_KINDS,
  isReservedNewsSlug,
  mediaCoverageSourceSchema,
  statementIssuerSchema,
  type MediaCoverageSource,
  type NewsKind,
} from './news.ts';

/**
 * Every aggregate the shared editorial workflow governs: Phase 6's Article and
 * Page, and Phase 13's four News families. One workflow, six sets of tables.
 */
export const editorialKindSchema = z.enum(['article', 'page', ...NEWS_KINDS]);
export type EditorialKind = z.infer<typeof editorialKindSchema>;
export const editorialStateSchema = z.enum([
  'draft',
  'in-review',
  'scheduled',
  'published',
  'archived',
]);
export type EditorialState = z.infer<typeof editorialStateSchema>;
export const editorialSlugSchema = z
  .string()
  .normalize()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u)
  .refine((value) => value === value.toLowerCase());
export const editorialIdSchema = z.uuid();
// Content language is a Taxonomy reference, independent of the requesting UI locale.
export const editorialLanguageSchema = z.enum(['en', 'ur', 'ar']);
export type EditorialLanguage = z.infer<typeof editorialLanguageSchema>;
export const editorialTranslationSchema = z.strictObject({
  languageCode: editorialLanguageSchema,
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().max(600),
  seoTitle: z.string().trim().max(200),
  seoDescription: z.string().trim().max(300),
  document: z.string().min(2).max(200_000),
});
const contributorsSchema = z
  .array(
    z.strictObject({
      personId: editorialIdSchema,
      role: z.enum(CONTRIBUTION_ROLES),
    }),
  )
  .max(12);

function referencesAreUnique(
  value: {
    readonly primaryLanguage: string;
    readonly translations: readonly { readonly languageCode: string }[];
    readonly topicIds: readonly string[];
    readonly contributors: readonly {
      readonly personId: string;
      readonly role: string;
    }[];
  },
  context: z.RefinementCtx,
): void {
  const codes = value.translations.map((translation) => translation.languageCode);
  if (
    !codes.includes(value.primaryLanguage) ||
    new Set(codes).size !== codes.length ||
    new Set(value.topicIds).size !== value.topicIds.length ||
    new Set(value.contributors.map((entry) => `${entry.personId}:${entry.role}`)).size !==
      value.contributors.length
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Primary translation and unique references are required.',
    });
  }
}

export const editorialContentSchema = z
  .strictObject({
    slug: editorialSlugSchema,
    primaryLanguage: editorialLanguageSchema,
    translations: z.array(editorialTranslationSchema).min(1).max(3),
    topicIds: z.array(editorialIdSchema).max(12),
    contributors: contributorsSchema,
  })
  .superRefine(referencesAreUnique);

/** A Statement's translation names its issuing authority in that language. */
const statementTranslationSchema = z.strictObject({
  ...editorialTranslationSchema.shape,
  issuer: statementIssuerSchema,
});

const statementContentSchema = z
  .strictObject({
    slug: editorialSlugSchema,
    primaryLanguage: editorialLanguageSchema,
    translations: z.array(statementTranslationSchema).min(1).max(3),
    topicIds: z.array(editorialIdSchema).max(12),
    contributors: contributorsSchema,
  })
  .superRefine(referencesAreUnique);

const mediaCoverageContentSchema = z
  .strictObject({
    slug: editorialSlugSchema,
    primaryLanguage: editorialLanguageSchema,
    translations: z.array(editorialTranslationSchema).min(1).max(3),
    topicIds: z.array(editorialIdSchema).max(12),
    contributors: contributorsSchema,
    coverage: mediaCoverageSourceSchema,
  })
  .superRefine(referencesAreUnique);

/**
 * A NewsArticle slug may not name a static sibling of `/news/{slug}`.
 *
 * PHASE 16 — CENTRE-SCOPED NEWS. A NewsArticle revision may name ONE Global
 * Network Centre, or none for general News. It is part of the revision, so
 * choosing or changing it is an ordinary edit: it returns the record to draft
 * and needs fresh review. No other family carries a Centre.
 */
const newsArticleContentSchema = z
  .strictObject({
    ...editorialContentSchema.shape,
    centreId: editorialIdSchema.nullable().default(null),
  })
  .superRefine(referencesAreUnique)
  .refine((value) => !isReservedNewsSlug(value.slug), {
    message: 'This slug names a reserved News route.',
    path: ['slug'],
  });

/**
 * THE content schema of one aggregate. Each is strict, so a field another family
 * owns — an issuer on an Article, an outlet on a Statement — is refused rather
 * than silently stored or silently dropped.
 */
export function editorialContentSchemaFor(
  kind: EditorialKind,
): z.ZodType<EditorialContent> {
  if (kind === 'statement') return statementContentSchema;
  if (kind === 'media-coverage') return mediaCoverageContentSchema;
  if (kind === 'news-article') return newsArticleContentSchema;
  return editorialContentSchema;
}

export interface EditorialTranslation extends z.infer<typeof editorialTranslationSchema> {
  /** A Statement's issuing authority; absent for every other family. */
  readonly issuer?: string;
}
export interface EditorialContent {
  readonly slug: string;
  readonly primaryLanguage: EditorialLanguage;
  readonly translations: readonly EditorialTranslation[];
  readonly topicIds: readonly string[];
  readonly contributors: readonly {
    readonly personId: string;
    readonly role: ContributionRole;
  }[];
  /** A MediaCoverage record's source; absent for every other family. */
  readonly coverage?: MediaCoverageSource;
  /** A NewsArticle's Global Network Centre, or `null`; absent for every other family. */
  readonly centreId?: string | null;
}
export interface SafeEditorialTranslation extends EditorialTranslation {
  readonly html: string;
}
export interface SafeEditorialContent extends Omit<EditorialContent, 'translations'> {
  readonly translations: SafeEditorialTranslation[];
}

export const workflowActionSchema = z.enum([
  'submit',
  'approve',
  'reject',
  'publish',
  'schedule',
  'cancel',
  'archive',
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export const workflowCommandSchema = z.strictObject({
  id: editorialIdSchema,
  expectedVersion: z.number().int().positive(),
  action: workflowActionSchema,
  scheduledAt: z.iso.datetime().nullable(),
  timezone: z.string().max(64).nullable(),
});
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;

export interface EditorialSummary {
  readonly id: string;
  readonly slug: string;
  readonly state: EditorialState;
  readonly version: number;
  readonly currentRevision: number;
  readonly title: string;
  readonly updatedAt: Date;
  readonly scheduledAt: Date | null;
  readonly scheduleStatus: string | null;
}
export interface EditorialRevision extends SafeEditorialContent {
  readonly number: number;
  readonly editorId: string;
  readonly createdAt: Date;
}
export interface ArticleDetail extends EditorialSummary {
  readonly creatorId: string;
  readonly approvedRevision: number | null;
  readonly approvedById: string | null;
  readonly scheduledById: string | null;
  readonly scheduledRevision: number | null;
  readonly revision: EditorialRevision;
}
export interface PageDetail extends ArticleDetail {
  readonly routeBinding: string;
}
export interface EditorialDirectory {
  readonly items: readonly EditorialSummary[];
  readonly more: boolean;
}
export interface RevisionDirectory {
  readonly items: readonly EditorialRevision[];
  readonly more: boolean;
}
export interface PublicEditorial {
  readonly slug: string;
  readonly primaryLanguage: EditorialLanguage;
  readonly translations: readonly Omit<SafeEditorialTranslation, 'document'>[];
  readonly topicIds: readonly string[];
  readonly contributors: readonly { readonly personId: string; readonly role: string }[];
  readonly publishedAt: Date;
  readonly updatedAt: Date;
}
export interface PublicPage extends PublicEditorial {
  readonly routeBinding: string;
}
/**
 * One published News record, as a visitor may see it. Like every public
 * editorial DTO it carries no authoring document and no workflow actor.
 */
export interface PublicNews extends PublicEditorial {
  readonly kind: NewsKind;
  readonly coverage: MediaCoverageSource | null;
  /**
   * The Centre a NewsArticle is scoped to, as an IDENTIFIER only. Whether and how
   * it is shown is decided at Layer 4 by asking Global whether that Centre is
   * public now; Editorial holds no Centre name and reads no Global table.
   */
  readonly centreId: string | null;
}
export interface EditorialSitemapEntry {
  readonly id: string;
  readonly slug: string;
  readonly routeBinding: string | null;
  readonly languages: readonly EditorialLanguage[];
  readonly updatedAt: Date;
}

export const correspondenceKindSchema = z.enum(['contact', 'feedback']);
export type CorrespondenceKind = z.infer<typeof correspondenceKindSchema>;
export const contactInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8_000),
});
export const feedbackInputSchema = z.strictObject({
  category: z.enum(['suggestion', 'problem', 'accessibility']),
  body: z.string().trim().min(1).max(8_000),
});
export const correspondenceStateSchema = z.enum([
  'submitted',
  'triaged',
  'in-progress',
  'resolved',
  'closed',
  'spam',
]);
export type CorrespondenceState = z.infer<typeof correspondenceStateSchema>;
export const triageSchema = z.strictObject({
  id: editorialIdSchema,
  expectedVersion: z.number().int().positive(),
  state: correspondenceStateSchema,
  note: z.string().trim().max(2_000),
});
export interface ContactInquiryView extends z.infer<typeof contactInputSchema> {
  readonly id: string;
  readonly version: number;
  readonly state: CorrespondenceState;
  readonly note: string;
  readonly createdAt: Date;
  readonly retainUntil: Date;
}
export interface FeedbackView extends z.infer<typeof feedbackInputSchema> {
  readonly id: string;
  readonly version: number;
  readonly state: CorrespondenceState;
  readonly note: string;
  readonly createdAt: Date;
  readonly retainUntil: Date;
}
export interface ContactDirectory {
  readonly items: readonly ContactInquiryView[];
  readonly more: boolean;
}
export interface FeedbackDirectory {
  readonly items: readonly FeedbackView[];
  readonly more: boolean;
}

export interface PublicEditorialSummary {
  readonly slug: string;
  readonly primaryLanguage: EditorialLanguage;
  readonly translations: readonly {
    readonly languageCode: EditorialLanguage;
    readonly title: string;
    readonly excerpt: string;
  }[];
}
export interface EditorialScheduleCandidate {
  readonly id: string;
  readonly version: number;
  readonly approvedById: string | null;
  readonly scheduledById: string | null;
}

export const correspondenceRetentionDaysSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(3650)
  .optional();
