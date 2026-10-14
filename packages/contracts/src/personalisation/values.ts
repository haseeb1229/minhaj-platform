import { z } from 'zod';

import { localeSchema } from '../env/shared.ts';
import type { Locale } from '../env/shared.ts';
import { hasControlCharacter, isWellFormedText } from '../exact-text.ts';
import { canonicaliseEmail } from '../identity/values.ts';

/**
 * Personalisation & Notifications — a person's OWN continuity, never a
 * picture of them (DOMAIN_MODEL.md §14; SECURITY_BASELINE.md §17, §19.1).
 *
 * EVERY RECORD HAS ONE OWNER. Saved items, notes, private collections,
 * history, Quran progress, onboarding answers, notification preferences and
 * notifications belong to exactly one account, and every read and write names
 * that account in its own predicate. No staff permission browses them.
 *
 * TYPED REFERENCES, NEVER COPIES. A saved Article is a foreign key to the
 * Article row; its title, status and address are asked of Editorial at Layer 4
 * when the page renders. Nothing here holds a title, a body or a snapshot, and
 * there is no `targetType + targetId` anywhere: a kind with no column cannot be
 * saved at all (DOMAIN_MODEL.md §6.2, §14.2).
 *
 * THE NEWSLETTER IS NOT AN ACCOUNT. A subscriber is an address that proved it
 * wanted the newsletter by double opt-in. Registering never subscribes, and
 * closing an account never unsubscribes (DOMAIN_MODEL.md §14.5).
 */

/* ===========================================================================
 * Identity and bounds
 * ========================================================================= */

export const personalIdSchema = z.uuid();

/** An account id as Identity issues it — opaque here, never parsed. */
export const personalAccountIdSchema = z.string().min(1).max(36);

/** An expected version, compared and never trusted. */
export const personalVersionSchema = z.number().int().min(0).max(2_147_483_646);

/**
 * Structural ceilings. They keep every list bounded and every write cheap;
 * none is a retention period (OPEN_DECISIONS.md §2.2 stays open).
 */
export const PERSONAL_LIMITS = Object.freeze({
  /** Rows in one page of any owner list. */
  page: 20,
  /** A list never walks further than this. */
  offsetMax: 10_000,
  /** Saved targets — bookmarks, notes and collection members together. */
  savedItems: 2_000,
  noteMax: 2_000,
  collections: 50,
  collectionMembers: 200,
  collectionTitle: 120,
  collectionDescription: 500,
  /**
   * History keeps ONE row per account and target, and only the most recent
   * this many of each list; recording a newer one drops the oldest.
   */
  history: 500,
  /** Notifications kept per account; producing a newer one drops the oldest. */
  notifications: 200,
  interests: 8,
  goals: 6,
  /** Targets resolved in one owner round-trip at Layer 4. */
  resolveBatch: 100,
} as const);

/* ===========================================================================
 * Typed content targets
 * ========================================================================= */

/**
 * THE FIVE THINGS A PERSON MAY SAVE — exactly what INFORMATION_ARCHITECTURE.md
 * §5 promises: Quran ayat, Hadith, articles, videos and books. Each is a real
 * foreign key to its owner's canonical row:
 *
 * - `article` → Editorial `Article`
 * - `work` → Library `Work` (a book; never one of its Editions)
 * - `video` → Media `Video`
 * - `ayah` → Quran `Ayah`, by its canonical `(surah, ayah)` identity
 * - `hadith` → Hadith `HadithCitation`, the public citation — never a
 *   source-qualified record or variant, which can be remapped beneath it
 *
 * Appending a kind is a typed column and a migration, never a string.
 */
export type PersonalTargetKind = 'article' | 'work' | 'video' | 'ayah' | 'hadith';
export const PERSONAL_TARGET_KINDS = Object.freeze([
  'ayah',
  'hadith',
  'article',
  'work',
  'video',
] as const) satisfies readonly PersonalTargetKind[];

/** What reading history records — every saved kind but the one that is watched. */
export type ReadableTargetKind = Exclude<PersonalTargetKind, 'video'>;
export const READABLE_TARGET_KINDS = Object.freeze([
  'ayah',
  'hadith',
  'article',
  'work',
] as const) satisfies readonly ReadableTargetKind[];

export const SURAH_COUNT = 114;
/** The longest Surah's length; the Ayah foreign key is what proves existence. */
export const AYAH_NUMBER_MAX = 286;

const ayahTargetSchema = z.strictObject({
  kind: z.literal('ayah'),
  surah: z.number().int().min(1).max(SURAH_COUNT),
  ayah: z.number().int().min(1).max(AYAH_NUMBER_MAX),
});

function idTarget<K extends Exclude<PersonalTargetKind, 'ayah'>>(kind: K) {
  return z.strictObject({ kind: z.literal(kind), id: personalIdSchema });
}

export const personalTargetSchema = z.discriminatedUnion('kind', [
  ayahTargetSchema,
  idTarget('hadith'),
  idTarget('article'),
  idTarget('work'),
  idTarget('video'),
]);
export type PersonalTarget = z.output<typeof personalTargetSchema>;

export const readableTargetSchema = z.discriminatedUnion('kind', [
  ayahTargetSchema,
  idTarget('hadith'),
  idTarget('article'),
  idTarget('work'),
]);
export type ReadableTarget = z.output<typeof readableTargetSchema>;

export type AyahTarget = Extract<PersonalTarget, { kind: 'ayah' }>;

/** One stable string per target — a map key, never stored. */
export function targetKey(target: PersonalTarget): string {
  return target.kind === 'ayah'
    ? `ayah:${target.surah}:${target.ayah}`
    : `${target.kind}:${target.id}`;
}

/* ===========================================================================
 * Saved items, bookmarks, notes and private collections
 * ========================================================================= */

/**
 * Private, plain text. No markup, no rich editor, no control character but a
 * line break or tab. Leading and trailing space is trimmed because it carries
 * nothing a person meant; an empty note is a removal, not a value.
 */
export function privateText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(isWellFormedText, 'Text must be well-formed Unicode.')
    .refine(
      (value) => !hasControlCharacter(value.replace(/[\t\n\r]/g, '')),
      'Text holds a control character.',
    );
}

/** A single-line private label: a collection's title. */
export function privateLabel(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(isWellFormedText, 'Text must be well-formed Unicode.')
    .refine((value) => !hasControlCharacter(value), 'Text holds a control character.');
}

export const noteWriteSchema = z.strictObject({
  target: personalTargetSchema,
  body: privateText(PERSONAL_LIMITS.noteMax),
  /** 0 for a new note; otherwise the version that was read. */
  expectedVersion: personalVersionSchema,
});
export type NoteWriteValue = z.output<typeof noteWriteSchema>;

export const noteRemovalSchema = z.strictObject({
  target: personalTargetSchema,
  expectedVersion: personalVersionSchema.min(1),
});
export type NoteRemovalValue = z.output<typeof noteRemovalSchema>;

export const collectionDetailsSchema = z.strictObject({
  title: privateLabel(PERSONAL_LIMITS.collectionTitle),
  description: z.union([privateText(PERSONAL_LIMITS.collectionDescription), z.null()]),
});
export type CollectionDetailsValue = z.output<typeof collectionDetailsSchema>;

export const collectionUpdateSchema = collectionDetailsSchema.extend({
  collectionId: personalIdSchema,
  expectedVersion: personalVersionSchema.min(1),
});
export type CollectionUpdateValue = z.output<typeof collectionUpdateSchema>;

export const collectionMembershipSchema = z.strictObject({
  collectionId: personalIdSchema,
  target: personalTargetSchema,
  expectedVersion: personalVersionSchema.min(1),
});
export type CollectionMembershipValue = z.output<typeof collectionMembershipSchema>;

/**
 * A whole new order for one collection, replacing the old one under the
 * version that was read. Exactly the collection's current members, each once.
 */
export const collectionOrderSchema = z
  .strictObject({
    collectionId: personalIdSchema,
    savedItemIds: z.array(personalIdSchema).min(1).max(PERSONAL_LIMITS.collectionMembers),
    expectedVersion: personalVersionSchema.min(1),
  })
  .refine((value) => new Set(value.savedItemIds).size === value.savedItemIds.length, {
    message: 'Each member appears once.',
  });
export type CollectionOrderValue = z.output<typeof collectionOrderSchema>;

export const collectionRemovalSchema = z.strictObject({
  collectionId: personalIdSchema,
  expectedVersion: personalVersionSchema.min(1),
});
export type CollectionRemovalValue = z.output<typeof collectionRemovalSchema>;

/** One saved target as its owner list shows it — identity and private state only. */
export interface SavedEntry {
  readonly savedItemId: string;
  readonly target: PersonalTarget;
  readonly savedAt: string;
}

export interface BookmarkEntry extends SavedEntry {
  readonly bookmarkedAt: string;
}

export interface NoteEntry extends SavedEntry {
  readonly body: string;
  readonly version: number;
  readonly updatedAt: string;
}

/* One page of an owner list: its rows, the total, and where it starts. */
export interface BookmarkPage {
  readonly items: readonly BookmarkEntry[];
  readonly total: number;
  readonly offset: number;
}

export interface NotePage {
  readonly items: readonly NoteEntry[];
  readonly total: number;
  readonly offset: number;
}

export interface CollectionSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly itemCount: number;
  readonly version: number;
  readonly updatedAt: string;
}

export interface CollectionMember extends SavedEntry {
  readonly position: number;
}

export interface CollectionDetail extends CollectionSummary {
  readonly members: readonly CollectionMember[];
}

/** What a public page's private island is told about ONE target. */
export interface TargetState {
  readonly bookmarked: boolean;
  readonly note: { readonly body: string; readonly version: number } | null;
  readonly collections: readonly {
    readonly id: string;
    readonly title: string;
    readonly version: number;
    readonly member: boolean;
  }[];
  readonly quranPosition: boolean;
  readonly quranProgressVersion: number;
  readonly historyEnabled: boolean;
}

/* ===========================================================================
 * History and Quran progress
 * ========================================================================= */

export interface ReadingEntry {
  readonly target: ReadableTarget;
  readonly firstReadAt: string;
  readonly lastReadAt: string;
}

export interface WatchEntry {
  readonly videoId: string;
  readonly firstWatchedAt: string;
  readonly lastWatchedAt: string;
}

export interface ReadingPage {
  readonly items: readonly ReadingEntry[];
  readonly total: number;
  readonly offset: number;
}

export interface WatchPage {
  readonly items: readonly WatchEntry[];
  readonly total: number;
  readonly offset: number;
}

/**
 * THE ONE CURRENT POSITION in the Quran — a typed Ayah, never a copy of its
 * text. It moves only when the reader says so, under the version they read, so
 * a late or replayed request can never move it backwards (DOMAIN_MODEL.md
 * §19.8). Course progress is Learning's, not this (DELIVERY_PLAN.md Phase 22).
 */
export interface QuranProgress {
  readonly surah: number;
  readonly ayah: number;
  readonly version: number;
  readonly updatedAt: string;
}

export const quranProgressWriteSchema = z.strictObject({
  surah: ayahTargetSchema.shape.surah,
  ayah: ayahTargetSchema.shape.ayah,
  /** 0 when no position exists yet. */
  expectedVersion: personalVersionSchema,
});
export type QuranProgressWriteValue = z.output<typeof quranProgressWriteSchema>;

export const quranProgressClearSchema = z.strictObject({
  expectedVersion: personalVersionSchema.min(1),
});

/* ===========================================================================
 * Onboarding and privacy settings
 * ========================================================================= */

/**
 * WHAT A PERSON SAYS THEY ARE INTERESTED IN — the public areas of the platform,
 * nothing about who they are. No religion, sect, belief, health, ethnicity,
 * gender or age is asked, and nothing is inferred from reading or watching
 * (SECURITY_BASELINE.md §19.1: these answers personalise and are never
 * repurposed). Each maps to the public section it names.
 */
export type PersonalInterest =
  | 'quran'
  | 'hadith'
  | 'library'
  | 'watch'
  | 'listen'
  | 'fatwa'
  | 'news-events'
  | 'global-network';
export const PERSONAL_INTERESTS = Object.freeze([
  'quran',
  'hadith',
  'library',
  'watch',
  'listen',
  'fatwa',
  'news-events',
  'global-network',
] as const) satisfies readonly PersonalInterest[];

export type PersonalGoal =
  | 'read-quran-regularly'
  | 'study-hadith'
  | 'read-books-and-research'
  | 'follow-lectures'
  | 'stay-informed';
export const PERSONAL_GOALS = Object.freeze([
  'read-quran-regularly',
  'study-hadith',
  'read-books-and-research',
  'follow-lectures',
  'stay-informed',
] as const) satisfies readonly PersonalGoal[];

const uniqueList = <T extends string>(values: readonly [T, ...T[]], max: number) =>
  z
    .array(z.enum(values))
    .max(max)
    .refine((list) => new Set(list).size === list.length, {
      message: 'Each choice once.',
    });

/** Optional, skippable, editable later — never a gate on anything. */
export const onboardingWriteSchema = z.strictObject({
  interests: uniqueList(
    PERSONAL_INTERESTS as unknown as [PersonalInterest, ...PersonalInterest[]],
    PERSONAL_LIMITS.interests,
  ),
  goals: uniqueList(
    PERSONAL_GOALS as unknown as [PersonalGoal, ...PersonalGoal[]],
    PERSONAL_LIMITS.goals,
  ),
  expectedVersion: personalVersionSchema,
});
export type OnboardingWriteValue = z.output<typeof onboardingWriteSchema>;

/** `completed` once answered, `skipped` when declined; absent until either. */
export type OnboardingState = 'completed' | 'skipped';

export const historySettingSchema = z.strictObject({
  enabled: z.boolean(),
  expectedVersion: personalVersionSchema,
});
export type HistorySettingValue = z.output<typeof historySettingSchema>;

/**
 * Everything this context keeps about one account's own settings.
 *
 * HISTORY IS OFF UNTIL THE PERSON TURNS IT ON. Recording what somebody reads is
 * private continuity they may want, not something the platform decides for
 * them; with it off nothing is recorded at all (SECURITY_BASELINE.md §19.1 —
 * no automatic behavioural tracking).
 */
export interface PersonalSettings {
  readonly onboarding: OnboardingState | null;
  readonly interests: readonly PersonalInterest[];
  readonly goals: readonly PersonalGoal[];
  readonly historyEnabled: boolean;
  /** 0 until a settings row exists. */
  readonly version: number;
}

/* ===========================================================================
 * Notifications
 * ========================================================================= */

/**
 * CATEGORIES ARE ONLY WHAT IS PRODUCED. `questions` — updates about the
 * person's own Fatwa questions — is the one producer that exists. Learning,
 * Messaging and the rest add their own category when they ship.
 */
export type NotificationCategory = 'questions';
export const NOTIFICATION_CATEGORIES = Object.freeze([
  'questions',
] as const) satisfies readonly NotificationCategory[];

/**
 * CHANNELS ARE ONLY WHAT IS DELIVERED. In-app is the only notification channel:
 * no notification is emailed, so there is no email preference to offer, and
 * nothing here can touch verification, password-reset or account-security
 * mail — those are Identity's and are never optional (ARCHITECTURE.md §4.6.1).
 */
export type NotificationChannel = 'in-app';
export const NOTIFICATION_CHANNELS = Object.freeze([
  'in-app',
] as const) satisfies readonly NotificationChannel[];

/** In-app notifications are on until the person turns a category off. */
export const NOTIFICATION_DEFAULTS: Readonly<
  Record<NotificationCategory, Readonly<Record<NotificationChannel, boolean>>>
> = Object.freeze({ questions: Object.freeze({ 'in-app': true }) });

/** What a notification SAYS is a key the interface translates — never stored prose. */
export type NotificationKind = 'question-answered' | 'question-declined';
export const NOTIFICATION_KINDS = Object.freeze([
  'question-answered',
  'question-declined',
] as const) satisfies readonly NotificationKind[];

export const NOTIFICATION_KIND_CATEGORY: Readonly<
  Record<NotificationKind, NotificationCategory>
> = Object.freeze({
  'question-answered': 'questions',
  'question-declined': 'questions',
});

export const NOTIFICATION_DESTINATION_MAX = 300;

/**
 * A notification may link only to a path on this site.
 *
 * One leading slash, then a path made of unreserved characters — no scheme, no
 * authority, no doubled slash anywhere (so no protocol-relative URL), no
 * backslash (which browsers read as a slash), no percent-encoding that could
 * smuggle either, no credentials, no query or fragment, and no segment that
 * starts with a dot. Exactly the rule the `Notification` CHECK enforces, so
 * nothing accepted here is refused by the store. Refused, never repaired.
 */
export function isInternalDestination(value: string): boolean {
  if (value.length < 2 || value.length > NOTIFICATION_DESTINATION_MAX) return false;
  if (!/^\/[A-Za-z0-9\-._~/]+$/.test(value)) return false;
  if (value.includes('//')) return false;
  return !value.split('/').some((segment) => segment.startsWith('.'));
}

export const notificationDestinationSchema = z
  .string()
  .refine(isInternalDestination, 'Only a path on this site.');

/**
 * What a Layer-4 producer hands in. The account is the one the producer's own
 * owner decided is concerned — never something a visitor named — and the key
 * makes a retried production a single notification.
 */
export const notificationProductionSchema = z.strictObject({
  accountId: personalAccountIdSchema,
  kind: z.enum(
    NOTIFICATION_KINDS as unknown as [NotificationKind, ...NotificationKind[]],
  ),
  destination: z.union([notificationDestinationSchema, z.null()]),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9:._-]+$/),
});
export type NotificationProduction = z.output<typeof notificationProductionSchema>;

export interface NotificationEntry {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly category: NotificationCategory;
  readonly destination: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NotificationPage {
  readonly items: readonly NotificationEntry[];
  readonly total: number;
  readonly offset: number;
}

export interface NotificationPreferenceState {
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

export const notificationPreferenceSchema = z.strictObject({
  category: z.enum(
    NOTIFICATION_CATEGORIES as unknown as [
      NotificationCategory,
      ...NotificationCategory[],
    ],
  ),
  channel: z.enum(
    NOTIFICATION_CHANNELS as unknown as [NotificationChannel, ...NotificationChannel[]],
  ),
  enabled: z.boolean(),
});
export type NotificationPreferenceValue = z.output<typeof notificationPreferenceSchema>;

/* ===========================================================================
 * Newsletter
 * ========================================================================= */

/**
 * submitted → pending → confirmed → unsubscribed / suppressed, plus `expired`
 * for a confirmation window that lapsed (DOMAIN_MODEL.md §14.5).
 *
 * WHAT EACH STATE HOLDS. `pending` and `confirmed` keep the address — it is
 * what the newsletter is sent to. `unsubscribed`, `expired` and `suppressed`
 * keep only its keyed digest: enough to recognise the address if it comes
 * back, and nothing that names it.
 */
export type NewsletterState =
  'pending' | 'confirmed' | 'unsubscribed' | 'expired' | 'suppressed';
export const NEWSLETTER_STATES = Object.freeze([
  'pending',
  'confirmed',
  'unsubscribed',
  'expired',
  'suppressed',
] as const) satisfies readonly NewsletterState[];

/**
 * The version of the subscription notice shown beside the form. Consent
 * evidence records it, so what was agreed to is answerable later. Changing the
 * notice's wording means a new version here.
 */
export const NEWSLETTER_NOTICE_VERSION = 'newsletter-notice-1' as const;
export const NEWSLETTER_PURPOSE = 'newsletter' as const;

/** How long a confirmation link works. A security bound, not a retention period. */
export const NEWSLETTER_CONFIRMATION_HOURS = 48;

export type NewsletterConsentEvent =
  'submitted' | 'confirmed' | 'unsubscribed' | 'expired' | 'suppressed' | 'reinstated';
export const NEWSLETTER_CONSENT_EVENTS = Object.freeze([
  'submitted',
  'confirmed',
  'unsubscribed',
  'expired',
  'suppressed',
  'reinstated',
] as const) satisfies readonly NewsletterConsentEvent[];

export type NewsletterConsentSource =
  'newsletter-page' | 'email-link' | 'operator' | 'system';

/**
 * The address, compared exactly as Identity compares one — `canonicaliseEmail`,
 * trimmed and lower-cased and nothing else. No provider-specific dot or
 * plus-tag rewriting (DOMAIN_MODEL.md §4.6).
 */
export const newsletterSubmissionSchema = z.strictObject({
  email: z.string().trim().min(3).max(320).pipe(z.email()).transform(canonicaliseEmail),
  locale: localeSchema,
});
export type NewsletterSubmission = z.output<typeof newsletterSubmissionSchema>;

/**
 * A newsletter link's token, as it arrives: 43 base64url characters (256 bits).
 * Shape only — whether it is current is the subscriber row's answer.
 */
export const newsletterTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export type NewsletterTokenPurpose = 'confirm' | 'unsubscribe';

/** What a link's GET may show — status, never an address. */
export type NewsletterLinkStatus = 'valid' | 'invalid';

export type NewsletterOutcome = 'confirmed' | 'unsubscribed' | 'invalid';

export interface NewsletterAdminEntry {
  readonly id: string;
  /** `a•••@example.org` while an address is held; null once only a digest remains. */
  readonly maskedEmail: string | null;
  readonly state: NewsletterState;
  readonly locale: Locale;
  readonly submittedAt: string;
  readonly confirmedAt: string | null;
  readonly endedAt: string | null;
  readonly version: number;
}

export interface NewsletterAdminPage {
  readonly items: readonly NewsletterAdminEntry[];
  readonly total: number;
  readonly offset: number;
}

export interface NewsletterCounts {
  readonly pending: number;
  readonly confirmed: number;
  readonly unsubscribed: number;
  readonly expired: number;
  readonly suppressed: number;
}

export const NEWSLETTER_PERMISSIONS = Object.freeze({
  read: 'newsletter.read',
  operate: 'newsletter.operate',
} as const);

export const newsletterOperationSchema = z.strictObject({
  subscriberId: personalIdSchema,
  expectedVersion: personalVersionSchema.min(1),
});
export type NewsletterOperationValue = z.output<typeof newsletterOperationSchema>;

/** Masks an address for an operator list: first character, then the domain. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/* ===========================================================================
 * Export and disposition
 * ========================================================================= */

export const PERSONAL_EXPORT_SCHEMA = 'minhaj.personalisation.export' as const;
export const PERSONAL_EXPORT_VERSION = 1 as const;

/**
 * Everything this context holds about one account — and nothing it does not
 * own. Targets are typed identities, never titles or bodies; the newsletter is
 * absent because a subscription is not the account's (§14.5).
 */
export interface PersonalExport {
  readonly schema: typeof PERSONAL_EXPORT_SCHEMA;
  readonly version: typeof PERSONAL_EXPORT_VERSION;
  readonly generatedAt: string;
  readonly settings: {
    readonly onboarding: OnboardingState | null;
    readonly interests: readonly PersonalInterest[];
    readonly goals: readonly PersonalGoal[];
    readonly historyEnabled: boolean;
  };
  readonly bookmarks: readonly {
    readonly target: PersonalTarget;
    readonly createdAt: string;
  }[];
  readonly notes: readonly {
    readonly target: PersonalTarget;
    readonly body: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
  readonly collections: readonly {
    readonly title: string;
    readonly description: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly members: readonly {
      readonly target: PersonalTarget;
      readonly addedAt: string;
    }[];
  }[];
  readonly readingHistory: readonly ReadingEntry[];
  readonly watchHistory: readonly {
    readonly target: { readonly kind: 'video'; readonly id: string };
    readonly firstWatchedAt: string;
    readonly lastWatchedAt: string;
  }[];
  readonly quranProgress: {
    readonly surah: number;
    readonly ayah: number;
    readonly updatedAt: string;
  } | null;
  readonly notificationPreferences: readonly NotificationPreferenceState[];
  readonly notifications: readonly {
    readonly kind: NotificationKind;
    readonly destination: string | null;
    readonly createdAt: string;
    readonly readAt: string | null;
  }[];
}

/** Remaining work for one account; zero everywhere means disposal is complete. */
export interface DispositionProgress {
  readonly removed: number;
  readonly complete: boolean;
}
