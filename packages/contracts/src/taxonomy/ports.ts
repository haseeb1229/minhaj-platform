import type { Locale } from '../env/shared.ts';
import type {
  LanguageDirection,
  LanguageStatus,
  LanguageView,
  TagPage,
  TagStatus,
  TagView,
  TopicAssignmentStatus,
  TopicDetail,
  TopicStatus,
  TopicView,
} from './values.ts';

/**
 * The ports between the Taxonomy context and its private adapter.
 *
 * Here for the same reason Identity's are: the context lives under
 * `apps/web/src/contexts/taxonomy/`, the adapter is physically inside
 * `packages/database`, and neither may import the other. Both import this
 * (ARCHITECTURE.md §3.1.1).
 *
 * NAMED ADMINISTRATIVE ACTS, NEVER A REPOSITORY. There is no `update`, no
 * `find(where)`, no `save`, no transaction handle, no delegate and no generic
 * page type. Each operation below is one thing an administrator does, with its
 * own invariants, and the surface is narrow enough to be read as a list of
 * what Taxonomy can be made to do (ARCHITECTURE.md §6.3 rule 13).
 *
 * WHO WRITES THE AUDIT ROW. The adapter does, inside the transaction that makes
 * the change — which is why every mutation takes an `auditAction` and an
 * `actorId`. The context owns the audit VOCABULARY; the payload is composed
 * where the before and after state is actually known, because a "before" read
 * outside the transaction is a value another writer can move.
 */

/* ===========================================================================
 * Reading
 * ========================================================================= */

/**
 * WHAT A TOPIC LISTING IS ALLOWED TO BE.
 *
 * Bounded in every direction: one subtree at a time, an explicit depth, an
 * explicit row cap. A taxonomy is small today and the design must not assume it
 * stays small, so there is deliberately no "give me everything" shape here.
 */
export interface TopicTreeQuery {
  /** The subtree to read. `null` reads the roots. */
  readonly parentId: string | null;
  /** How many generations below `parentId` to include. */
  readonly depth: number;
  /** Include archived topics as well as active ones. */
  readonly includeArchived: boolean;
  /** The interface locale to resolve each Topic's label in. */
  readonly locale: Locale;
  readonly limit: number;
}

export interface TaxonomyReaderPort {
  /**
   * One bounded slice of the hierarchy, each Topic resolved for one locale.
   *
   * THE LOCALE RESOLUTION HAPPENS IN THE QUERY, not afterwards in a loop. A
   * caller that read topics and then fetched each one's translation would
   * perform one query per row — the N+1 that turns a 19-row taxonomy into 20
   * round trips and a 2000-row one into a timeout.
   */
  listTopicTree(query: TopicTreeQuery): Promise<readonly TopicView[]>;

  /** One Topic with every stored translation, for the administrative editor. */
  findTopic(input: {
    readonly topicId: string;
    readonly locale: Locale;
  }): Promise<TopicDetail | null>;

  findTopicBySlug(input: {
    readonly slug: string;
    readonly locale: Locale;
  }): Promise<TopicView | null>;

  listLanguages(input: {
    readonly includeRetired: boolean;
  }): Promise<readonly LanguageView[]>;

  /** Bounded search over tags. Never an unbounded table load. */
  listTags(input: {
    readonly query: string | null;
    readonly includeRetired: boolean;
    readonly limit: number;
    readonly offset: number;
  }): Promise<TagPage>;

  /**
   * Every typed topic-assignment relationship the DATABASE enforces.
   *
   * Read from the foreign-key catalogue, so what it returns is what is true of
   * the schema rather than what a registry claims. An empty result is the
   * honest answer while no target-owning context has shipped, and it becomes
   * populated the moment one adds its own typed junction — with no change here
   * (DOMAIN_MODEL.md §6.2).
   */
  topicAssignmentStatus(): Promise<TopicAssignmentStatus>;
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

/** What every taxonomy mutation carries, for the audit row it writes. */
export interface TaxonomyActorInput {
  /** The authenticated account performing the change. */
  readonly actorId: string;
  /** The permission that authorised it, recorded as `authorisingSource`. */
  readonly authorisingSource: string;
  /** The audited action name, owned by the Taxonomy context. */
  readonly auditAction: string;
}

export interface CreateTopicInput extends TaxonomyActorInput {
  readonly slug: string;
  readonly parentId: string | null;
  readonly position: number;
  /**
   * The fallback-locale name, required.
   *
   * A Topic created without one would have no total fallback, so resolving it
   * in a locale nobody had translated would yield nothing — and "nothing" is
   * not a name a navigation surface can render.
   */
  readonly name: string;
  readonly description: string | null;
}

export interface TaxonomyPersistencePort {
  /* ---- Topics ---------------------------------------------------------- */

  createTopic(input: CreateTopicInput): Promise<TopicDetail>;

  /**
   * Writes one locale's name and description.
   *
   * UPSERT ON (topicId, locale), which the composite primary key makes
   * race-safe: two concurrent editors of the same locale produce one row, and
   * neither had to read first to find out.
   */
  setTopicTranslation(
    input: TaxonomyActorInput & {
      readonly topicId: string;
      readonly locale: Locale;
      readonly name: string;
      readonly description: string | null;
    },
  ): Promise<TopicDetail>;

  /**
   * Removes one locale's translation.
   *
   * Refused for the fallback locale — by the adapter AND by a database trigger,
   * because a Topic with no fallback translation is a Topic that renders as
   * nothing in some locale, and that invariant should not depend on which
   * writer is running.
   */
  removeTopicTranslation(
    input: TaxonomyActorInput & { readonly topicId: string; readonly locale: Locale },
  ): Promise<TopicDetail>;

  /**
   * Moves a Topic under a new parent, or to the root.
   *
   * CYCLE SAFETY IS NOT THIS METHOD'S TO PROMISE. It is enforced by a database
   * trigger holding a transaction-scoped application lock, so two concurrent
   * moves cannot both observe the old shape and commit a loop between them.
   * This method surfaces the refusal; it does not implement it.
   */
  moveTopic(
    input: TaxonomyActorInput & {
      readonly topicId: string;
      readonly parentId: string | null;
      readonly position: number;
    },
  ): Promise<TopicDetail>;

  /** Sets the sibling order of one parent's children, as a whole list. */
  reorderTopics(
    input: TaxonomyActorInput & {
      readonly parentId: string | null;
      readonly orderedTopicIds: readonly string[];
    },
  ): Promise<readonly TopicView[]>;

  /**
   * Archives or restores a Topic.
   *
   * There is NO delete. The runtime principal holds no DELETE on `Topic`, so
   * this is the whole of the lifecycle — and a later context's typed assignment
   * can therefore never be orphaned by an administrator pressing a button.
   */
  setTopicStatus(
    input: TaxonomyActorInput & {
      readonly topicId: string;
      readonly status: TopicStatus;
    },
  ): Promise<TopicDetail>;

  /* ---- Languages ------------------------------------------------------- */

  createLanguage(
    input: TaxonomyActorInput & {
      readonly code: string;
      readonly englishName: string;
      readonly nativeName: string;
      readonly direction: LanguageDirection;
    },
  ): Promise<LanguageView>;

  updateLanguage(
    input: TaxonomyActorInput & {
      readonly code: string;
      readonly englishName: string;
      readonly nativeName: string;
      readonly direction: LanguageDirection;
    },
  ): Promise<LanguageView>;

  setLanguageStatus(
    input: TaxonomyActorInput & {
      readonly code: string;
      readonly status: LanguageStatus;
    },
  ): Promise<LanguageView>;

  /* ---- Tags ------------------------------------------------------------ */

  createTag(
    input: TaxonomyActorInput & { readonly slug: string; readonly label: string },
  ): Promise<TagView>;

  relabelTag(
    input: TaxonomyActorInput & { readonly tagId: string; readonly label: string },
  ): Promise<TagView>;

  setTagStatus(
    input: TaxonomyActorInput & {
      readonly tagId: string;
      readonly status: TagStatus;
    },
  ): Promise<TagView>;
}
