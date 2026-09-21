import { z } from 'zod';
import { CONTRIBUTION_ROLES } from '../people/values.ts';

export const editorialKindSchema = z.enum(['article', 'page']);
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
export const editorialContentSchema = z
  .strictObject({
    slug: editorialSlugSchema,
    primaryLanguage: editorialLanguageSchema,
    translations: z.array(editorialTranslationSchema).min(1).max(3),
    topicIds: z.array(editorialIdSchema).max(12),
    contributors: z
      .array(
        z.strictObject({
          personId: editorialIdSchema,
          role: z.enum(CONTRIBUTION_ROLES),
        }),
      )
      .max(12),
  })
  .superRefine((value, context) => {
    const codes = value.translations.map((translation) => translation.languageCode);
    if (
      !codes.includes(value.primaryLanguage) ||
      new Set(codes).size !== codes.length ||
      new Set(value.topicIds).size !== value.topicIds.length ||
      new Set(value.contributors.map((entry) => `${entry.personId}:${entry.role}`))
        .size !== value.contributors.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Primary translation and unique references are required.',
      });
    }
  });
export type EditorialContent = z.infer<typeof editorialContentSchema>;
export interface SafeEditorialTranslation extends z.infer<
  typeof editorialTranslationSchema
> {
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
