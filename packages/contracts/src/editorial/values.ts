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
import {
  EVENT_LIMITS,
  EVENT_SCHEDULE_REFUSALS,
  eventScheduleInputSchema,
  resolveEventSchedule,
  type EventSchedule,
} from './event.ts';
import { collectionMembersSchema, type CollectionMember } from './collection.ts';
import {
  editorialLeadImageSchema,
  sourcePublishedOnSchema,
  type EditorialLeadImage,
  type PublicLeadImage,
} from './lead.ts';

/**
 * Every aggregate the shared editorial workflow governs: Phase 6's Article and
 * Page, Phase 13's four News families, Phase 14's Event and Phase 15's
 * Collection. One workflow, eight sets of tables.
 */
export const editorialKindSchema = z.enum([
  'article',
  'page',
  ...NEWS_KINDS,
  'event',
  'collection',
]);
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

/* ===========================================================================
 * Phase 30-R — the optional lead image and the source chronology
 * ========================================================================= */

/** A lead family's translation: its words, and the lead image's alt text. */
const leadTranslationSchema = editorialTranslationSchema.extend({
  leadAlt: z.string().trim().max(300).optional(),
});

/**
 * OMITTED KEEPS, NULL CLEARS. On a revision, a lead image, source date or alt
 * text the input does not mention is the current revision's, kept by the
 * service; `null` removes it. On creation, omitted means none.
 */
const leadShape = {
  translations: z.array(leadTranslationSchema).min(1).max(3),
  leadImage: editorialLeadImageSchema.nullable().optional(),
};
const datedShape = {
  ...leadShape,
  sourcePublishedOn: sourcePublishedOnSchema.nullable().optional(),
};

/** An Article or a PressRelease: lead image and source date. */
const datedContentSchema = z
  .strictObject({ ...editorialContentSchema.shape, ...datedShape })
  .superRefine(referencesAreUnique);

/** A Page: a lead image, but no source date — a Page is not a dated report. */
const pageContentSchema = z
  .strictObject({ ...editorialContentSchema.shape, ...leadShape })
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
    ...datedShape,
    centreId: editorialIdSchema.nullable().default(null),
  })
  .superRefine(referencesAreUnique)
  .refine((value) => !isReservedNewsSlug(value.slug), {
    message: 'This slug names a reserved News route.',
    path: ['slug'],
  });

/**
 * PHASE 14 — an Event's content: the shared editorial content, the ONE Global
 * Network Centre it is held at or none, its schedule and its ordered Media
 * Galleries. All of it is revision state, so changing any of it is an ordinary
 * edit that returns the Event to draft and needs fresh review.
 *
 * THE SCHEDULE IS RESOLVED HERE, ON THE SERVER: each local time becomes its
 * authoritative UTC instant in the Event's zone, or the schedule is refused
 * with the reason as the issue's message — a skipped or repeated local time is
 * never silently moved (`./event.ts`).
 */
const eventContentSchema = z
  .strictObject({
    ...editorialContentSchema.shape,
    centreId: editorialIdSchema.nullable().default(null),
    schedule: eventScheduleInputSchema.transform((value, context): EventSchedule => {
      const resolved = resolveEventSchedule(value);
      if (resolved.ok) return resolved.schedule;
      context.addIssue({ code: 'custom', message: resolved.refusal });
      return z.NEVER;
    }),
    galleryIds: z
      .array(editorialIdSchema)
      .max(EVENT_LIMITS.galleries)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'A Gallery is associated once.',
      })
      .default([]),
  })
  .superRefine(referencesAreUnique);

/**
 * PHASE 15 — a Collection's content: the shared editorial content and its ONE
 * ordered list of typed members. The members are revision state, so adding,
 * removing or reordering one is an ordinary edit that returns the Collection to
 * draft and needs fresh review. Whether each member may be newly chosen is its
 * owner's answer, asked by the service — never this schema's.
 */
const collectionContentSchema = z
  .strictObject({
    ...editorialContentSchema.shape,
    members: collectionMembersSchema,
  })
  .superRefine(referencesAreUnique);

/** The schedule refusal a failed Event parse carries, if that is why it failed. */
export function eventScheduleRefusalOf(error: z.ZodError): string | null {
  return (
    error.issues.find((issue) =>
      (EVENT_SCHEDULE_REFUSALS as readonly string[]).includes(issue.message),
    )?.message ?? null
  );
}

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
  if (kind === 'event') return eventContentSchema;
  if (kind === 'collection') return collectionContentSchema;
  if (kind === 'page') return pageContentSchema;
  // An Article and a PressRelease: the lead image and the source date.
  return datedContentSchema;
}

export interface EditorialTranslation extends z.infer<typeof editorialTranslationSchema> {
  /** A Statement's issuing authority; absent for every other family. */
  readonly issuer?: string;
  /**
   * Phase 30-R: the lead image's alternative text in this language. Absent on
   * input means "keep" (a revision) or "none" (a creation); once resolved by
   * the service, a lead family always carries it, possibly empty.
   */
  readonly leadAlt?: string | undefined;
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
  /**
   * The Global Network Centre a NewsArticle is scoped to or an Event is held
   * at, or `null`; absent for every other family.
   */
  readonly centreId?: string | null;
  /**
   * Phase 30-R: an Article's, NewsArticle's or PressRelease's ORIGINAL source
   * publication date (YYYY-MM-DD), or `null`. Absent on input keeps (revision)
   * or means none (creation); absent for every other family once resolved.
   */
  readonly sourcePublishedOn?: string | null | undefined;
  /**
   * Phase 30-R: an Article's, Page's, NewsArticle's or PressRelease's lead
   * image, or `null`. Same omission rule; absent for every other family.
   */
  readonly leadImage?: EditorialLeadImage | null | undefined;
  /** An Event's resolved schedule; absent for every other family. */
  readonly schedule?: EventSchedule;
  /** An Event's ordered Media Galleries; absent for every other family. */
  readonly galleryIds?: readonly string[];
  /** A Collection's ordered, typed members; absent for every other family. */
  readonly members?: readonly CollectionMember[];
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
  /**
   * Phase 30-R, lead and dated families only: the READER-FACING date — the
   * source's own publication date when the record states one, else the first
   * publication here — and that source date itself.
   */
  readonly chronologyAt?: Date;
  readonly sourcePublishedOn?: string | null;
  /** Phase 30-R, lead families only: the published lead image, or null. */
  readonly leadImage?: PublicLeadImage | null;
}

/**
 * A published Article, with its identity: the typed key a person's saved
 * item or reading history holds (Phase 21), and nothing else that the shared
 * public shape does not already disclose.
 */
export interface PublicArticle extends PublicEditorial {
  readonly id: string;
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
/**
 * One published Event, as a visitor may see it: its words, its schedule, and
 * its Centre and Galleries as IDENTIFIERS only. Whether a Centre or a Gallery is
 * shown is decided at Layer 4 by asking Global and Media what is public now;
 * Editorial holds no Centre or Gallery word and reads neither owner's tables.
 */
export interface PublicEvent extends PublicEditorial {
  readonly schedule: EventSchedule;
  readonly centreId: string | null;
  readonly galleryIds: readonly string[];
}
/**
 * One published Collection, as a visitor may see it: its words and its members
 * as TYPED IDENTIFIERS in their one order. What each member is called and where
 * it lives is its owner's answer at render time — Editorial for Articles and
 * News, Library for Works, Media for Videos — and a member its owner no longer
 * publishes is simply not shown.
 */
export interface PublicCollection extends PublicEditorial {
  readonly members: readonly CollectionMember[];
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
    /** Phase 30-R: the lead image's alt text in this language (Articles). */
    readonly leadAlt?: string;
  }[];
  /** Phase 30-R (Articles): the reader-facing date and the lead image. */
  readonly chronologyAt?: Date;
  readonly leadImage?: PublicLeadImage | null;
}
/**
 * Phase 30-R. One published shell-bound Page as a card shows it: its binding
 * (its address), its words per language with the lead image's alt text, and
 * its lead image. Never the body.
 */
export interface PublicPageSummary extends PublicEditorialSummary {
  readonly routeBinding: string;
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
