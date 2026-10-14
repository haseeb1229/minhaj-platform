import type {
  AyahTarget,
  CollectionDetail,
  CollectionDetailsValue,
  CollectionMembershipValue,
  CollectionOrderValue,
  CollectionRemovalValue,
  CollectionSummary,
  CollectionUpdateValue,
  HistorySettingValue,
  NewsletterCounts,
  NewsletterOperationValue,
  NewsletterState,
  NewsletterTokenPurpose,
  NoteRemovalValue,
  NoteWriteValue,
  NotificationPreferenceState,
  NotificationPreferenceValue,
  NotificationProduction,
  OnboardingState,
  OnboardingWriteValue,
  PersonalExport,
  BookmarkPage,
  NewsletterAdminPage,
  NotePage,
  NotificationPage,
  ReadingPage,
  WatchPage,
  PersonalSettings,
  PersonalTarget,
  QuranProgress,
  QuranProgressWriteValue,
  ReadableTarget,
  SavedEntry,
} from './values.ts';
import type { Locale } from '../env/shared.ts';

/**
 * Personalisation's persistence ports (ARCHITECTURE.md §3.1.1, Model A).
 *
 * THE OWNER IS ALWAYS THE FIRST ARGUMENT, and every adapter puts it in the SQL
 * predicate itself — there is no "load, then check the owner" anywhere. An id
 * that belongs to somebody else answers exactly as a missing id does.
 *
 * NO CONTENT READS. Nothing here returns a title, a status or a body of the
 * content a target names: those are the owner's answers, asked at Layer 4.
 */

/** Bookmarks, notes and private collections. */
export interface PersonalSavedPort {
  /** What one target's private island shows: bookmark, note, collection membership. */
  targetState(
    accountId: string,
    target: PersonalTarget,
  ): Promise<{
    readonly bookmarked: boolean;
    readonly note: { readonly body: string; readonly version: number } | null;
    readonly collections: readonly {
      readonly id: string;
      readonly title: string;
      readonly version: number;
      readonly member: boolean;
    }[];
  }>;

  /** Idempotent: a second bookmark of the same target changes nothing. */
  bookmark(accountId: string, target: PersonalTarget, savedItemId: string): Promise<void>;
  /** Idempotent: removing what is not there changes nothing. */
  unbookmark(accountId: string, target: PersonalTarget): Promise<void>;
  bookmarks(accountId: string, offset: number): Promise<BookmarkPage>;

  writeNote(
    accountId: string,
    value: NoteWriteValue,
    savedItemId: string,
  ): Promise<{ readonly version: number }>;
  removeNote(accountId: string, value: NoteRemovalValue): Promise<void>;
  notes(accountId: string, offset: number): Promise<NotePage>;

  collections(accountId: string): Promise<readonly CollectionSummary[]>;
  collection(accountId: string, collectionId: string): Promise<CollectionDetail | null>;
  createCollection(
    accountId: string,
    collectionId: string,
    value: CollectionDetailsValue,
  ): Promise<void>;
  updateCollection(
    accountId: string,
    value: CollectionUpdateValue,
  ): Promise<{ readonly version: number }>;
  removeCollection(accountId: string, value: CollectionRemovalValue): Promise<void>;
  addToCollection(
    accountId: string,
    value: CollectionMembershipValue,
    savedItemId: string,
  ): Promise<{ readonly version: number }>;
  removeFromCollection(
    accountId: string,
    value: CollectionMembershipValue,
  ): Promise<{ readonly version: number }>;
  reorderCollection(
    accountId: string,
    value: CollectionOrderValue,
  ): Promise<{ readonly version: number }>;

  /** The most recently saved targets, newest first, for the `/my` landing. */
  recent(accountId: string, limit: number): Promise<readonly SavedEntry[]>;
  counts(accountId: string): Promise<{
    readonly bookmarks: number;
    readonly notes: number;
    readonly collections: number;
  }>;
}

/** Reading and watch history, and the one Quran position. */
export interface PersonalHistoryPort {
  /**
   * Records a read at a server instant — ONLY while the account has history
   * turned on, decided in the same statement. A late or out-of-order request
   * never moves `lastReadAt` backwards.
   */
  recordRead(accountId: string, target: ReadableTarget, at: Date): Promise<void>;
  recordWatch(accountId: string, videoId: string, at: Date): Promise<void>;
  reading(accountId: string, offset: number): Promise<ReadingPage>;
  watching(accountId: string, offset: number): Promise<WatchPage>;
  removeRead(accountId: string, target: ReadableTarget): Promise<void>;
  removeWatch(accountId: string, videoId: string): Promise<void>;
  clear(accountId: string): Promise<void>;

  quranProgress(accountId: string): Promise<QuranProgress | null>;
  setQuranProgress(
    accountId: string,
    value: QuranProgressWriteValue,
    at: Date,
  ): Promise<{ readonly version: number }>;
  clearQuranProgress(accountId: string, expectedVersion: number): Promise<void>;
}

/** Onboarding answers and the history switch. */
export interface PersonalSettingsPort {
  settings(accountId: string): Promise<PersonalSettings>;
  saveOnboarding(
    accountId: string,
    value: OnboardingWriteValue,
    state: OnboardingState,
    at: Date,
  ): Promise<{ readonly version: number }>;
  setHistory(
    accountId: string,
    value: HistorySettingValue,
    at: Date,
  ): Promise<{ readonly version: number }>;
}

/** In-app notifications and their preferences. */
export interface PersonalNotificationPort {
  /**
   * Stores one notification unless the account has turned its category off or
   * the same idempotency key already produced one — decided in one statement.
   */
  produce(
    value: NotificationProduction,
    notificationId: string,
    at: Date,
  ): Promise<'created' | 'duplicate' | 'muted'>;
  notifications(accountId: string, offset: number): Promise<NotificationPage>;
  unread(accountId: string): Promise<number>;
  markRead(accountId: string, notificationId: string, at: Date): Promise<void>;
  markAllRead(accountId: string, at: Date): Promise<number>;
  remove(accountId: string, notificationId: string): Promise<void>;
  clearRead(accountId: string): Promise<number>;
  preferences(accountId: string): Promise<readonly NotificationPreferenceState[]>;
  setPreference(
    accountId: string,
    value: NotificationPreferenceValue,
    at: Date,
  ): Promise<void>;
}

/** Everything one account owns here, for its own export. */
export interface PersonalExportPort {
  collect(
    accountId: string,
  ): Promise<Omit<PersonalExport, 'schema' | 'version' | 'generatedAt'>>;
}

/**
 * This context's part of account closure (SECURITY_BASELINE.md §19.1).
 *
 * The CALLER establishes that the account is closed — Identity's answer, asked
 * through Layer 4 — and the adapter deletes in bounded batches, so an
 * interruption leaves rows a retry finds and removes.
 */
export interface PersonalDispositionPort {
  /** Deletes up to `limit` of the account's rows; returns how many went. */
  disposeAccount(accountId: string, limit: number): Promise<number>;
  /** Accounts that still own rows here, by id, after `after` — a keyset page. */
  accountsWithData(after: string | null, limit: number): Promise<readonly string[]>;
}

/**
 * TYPED purge participation (DOMAIN_MODEL.md §14.3). One operation per target
 * family, each removing up to `limit` of this context's references to ONE
 * target and returning how many remain — never a `purge(type, id)`.
 */
export interface PersonalPurgePort {
  releaseArticle(articleId: string, limit: number): Promise<number>;
  releaseWork(workId: string, limit: number): Promise<number>;
  releaseVideo(videoId: string, limit: number): Promise<number>;
  releaseAyah(target: AyahTarget, limit: number): Promise<number>;
  releaseHadith(citationId: string, limit: number): Promise<number>;
}

/* ===========================================================================
 * Newsletter
 * ========================================================================= */

/** A freshly issued link pair. Hashes and salts only — never a token. */
export interface NewsletterIssue {
  readonly confirmHash: string;
  readonly confirmSalt: string;
  readonly unsubscribeHash: string;
  readonly unsubscribeSalt: string;
  readonly tokenKeyVersion: number;
  readonly expiresAt: Date;
}

export type NewsletterSubmitResult =
  | {
      readonly outcome: 'issued';
      readonly subscriberId: string;
      readonly generation: number;
    }
  | { readonly outcome: 'unchanged' };

/** What the dispatcher needs to write one confirmation, at send time. */
export interface NewsletterDeliverySource {
  readonly subscriberId: string;
  readonly email: string;
  readonly locale: Locale;
  readonly confirmSalt: string;
  readonly unsubscribeSalt: string;
  readonly tokenKeyVersion: number;
  readonly expiresAt: Date;
}

export interface NewsletterPort {
  /**
   * The whole submission decision in one serialised transaction keyed by the
   * address digest: a new or lapsed address becomes `pending` with the given
   * link pair; a confirmed or suppressed one is left exactly as it was.
   */
  submit(input: {
    readonly subscriberId: string;
    readonly emailDigest: string;
    readonly digestKeyVersion: number;
    readonly email: string;
    readonly locale: Locale;
    readonly issue: (subscriberId: string, generation: number) => NewsletterIssue;
    readonly at: Date;
  }): Promise<NewsletterSubmitResult>;
  /** Null unless that exact issuance is still pending — anything else is owed nothing. */
  deliverySource(
    subscriberId: string,
    generation: number,
  ): Promise<NewsletterDeliverySource | null>;
  linkIsCurrent(
    purpose: NewsletterTokenPurpose,
    tokenHash: string,
    at: Date,
  ): Promise<boolean>;
  /**
   * The address a CURRENT confirmation link would confirm — asked first, so the
   * service can consult provider suppression before anything changes.
   */
  confirmationAddress(tokenHash: string, at: Date): Promise<string | null>;
  /**
   * Consumes a confirmation once, re-checking the link, its state and its
   * expiry in the same statement; replay, expiry or any other state answers
   * `false` and changes nothing.
   */
  confirm(tokenHash: string, at: Date): Promise<boolean>;
  /** Idempotent: an already-unsubscribed link answers `true` and changes nothing. */
  unsubscribe(tokenHash: string, at: Date): Promise<boolean>;
  /** Pending subscriptions whose window lapsed lose their address. Bounded. */
  expireLapsed(at: Date, limit: number): Promise<number>;

  counts(): Promise<NewsletterCounts>;
  list(state: NewsletterState | null, offset: number): Promise<NewsletterAdminPage>;
  suppress(actorId: string, value: NewsletterOperationValue, at: Date): Promise<void>;
  reinstate(actorId: string, value: NewsletterOperationValue, at: Date): Promise<void>;
}
