import type { Locale } from '@minhaj/contracts';
import type {
  LanguageDirection,
  LanguageStatus,
  LanguageView,
  TagPage,
  TagStatus,
  TagView,
  TaxonomyPersistencePort,
  TaxonomyReaderPort,
  TopicAssignmentStatus,
  TopicDetail,
  TopicStatus,
  TopicView,
} from '@minhaj/contracts/taxonomy';
import { MAX_TOPIC_DEPTH } from '@minhaj/contracts/taxonomy';

import { nextPosition } from '../domain/topic.ts';

/**
 * Taxonomy — THE application service.
 *
 * WHAT IT IS. The policy for the canonical subject taxonomy, the content
 * language reference data and the editorial tag vocabulary: what may be
 * created, what a change is called in the audit record, and what a listing is
 * allowed to be.
 *
 * WHAT IT IS NOT. It is not an authorisation check. Whether the caller may
 * perform any of these is settled BEFORE they are reachable, at the Layer-4
 * gate, and the `TaxonomyActor` below is audit attribution rather than a
 * capability — see its own note.
 *
 * WHY THERE IS NO STEP-UP HERE. SECURITY_BASELINE.md §8.1 names the operations
 * that cost a step-up grant: permission and role grants, canonical Quran and
 * Hadith edits, Fatwa publication, migration publication, account
 * administration and destructive bulk operations. Taxonomy administration is
 * none of them, and §8.2 says the requirement is "deliberately not universal".
 * Inventing a fourth `StepUpPurpose` for it would be a scope with no operation
 * behind it in the vocabulary Phase 2 deliberately closed at three. What every
 * mutation DOES cost is `taxonomy.administer`, re-checked at the action layer
 * on every submit (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * Layer 1: Layer-0 interfaces only, never infrastructure and never another
 * context. Taxonomy's accepted dependency list is empty — Layer 0 and nothing
 * else (DOMAIN_MODEL.md §3.1).
 */

export type TaxonomyFailure =
  /** The topic, language or tag named does not exist. */
  | 'not-found'
  /** Canonical seed data: its slug, place and lifecycle are not administrable. */
  | 'topic-protected'
  /** The parent is archived, or the topic being restored has an archived one. */
  | 'topic-archived'
  /** Archiving would strand active children. */
  | 'topic-has-active-children'
  | 'duplicate-slug'
  | 'duplicate-language-code'
  /** The move would place a topic beneath its own descendant. */
  | 'hierarchy-cycle'
  | 'hierarchy-too-deep'
  /** The fallback translation is what every other locale resolves to. */
  | 'fallback-translation-required'
  | 'unavailable';

export interface TaxonomyError {
  readonly ok: false;
  readonly failure: TaxonomyFailure;
}

export type TaxonomyResult<T> = ({ readonly ok: true } & T) | TaxonomyError;

function fail(failure: TaxonomyFailure): TaxonomyError {
  return { ok: false, failure };
}

/** Maps a data-invariant refusal from the adapter onto a failure class. */
function classify(error: unknown): TaxonomyFailure {
  const reason = (error as { reason?: unknown } | null)?.reason;

  switch (reason) {
    case 'topic-not-found':
    case 'language-not-found':
    case 'tag-not-found':
      return 'not-found';
    case 'topic-protected':
      return 'topic-protected';
    case 'topic-archived':
      return 'topic-archived';
    case 'topic-has-active-children':
      return 'topic-has-active-children';
    case 'duplicate-slug':
    case 'duplicate-tag-slug':
      return 'duplicate-slug';
    case 'duplicate-language-code':
      return 'duplicate-language-code';
    case 'hierarchy-cycle':
      return 'hierarchy-cycle';
    case 'hierarchy-too-deep':
      return 'hierarchy-too-deep';
    case 'fallback-translation-required':
      return 'fallback-translation-required';
    default:
      return 'unavailable';
  }
}

/**
 * Who performed a taxonomy change, for the audit record.
 *
 * DELIBERATELY NOT A `PrivilegedActor`. That type is a capability: the
 * authorisation service mints it only after permission, privileged posture and
 * a purpose-bound step-up grant have all been verified, and the sensitive
 * services re-verify the exact instance because a structural value can be
 * forged. None of that applies here, and pretending it did would be worse than
 * useless — it would suggest a proof this phase does not perform.
 *
 * What actually guards these operations is the Layer-4 gate: every Server
 * Action calls `requirePermittedAction(locale, 'taxonomy.administer')`, which
 * re-resolves the session, re-reads the permission set live and refuses before
 * the service is reached. This value is what the audit row needs afterwards —
 * who did it, and under which permission — and nothing else.
 */
export interface TaxonomyActor {
  readonly accountId: string;
  /** The permission the Layer-4 gate verified. Recorded as the authorising source. */
  readonly permission: string;
}

/**
 * The audited action names this context owns.
 *
 * The context owns the VOCABULARY; the adapter composes the payload inside the
 * transaction, which is the only place the before and after state is known.
 */
const AUDIT = {
  topicCreated: 'taxonomy.topic.created',
  topicTranslated: 'taxonomy.topic.translated',
  topicTranslationRemoved: 'taxonomy.topic.translation-removed',
  topicMoved: 'taxonomy.topic.moved',
  topicReordered: 'taxonomy.topic.reordered',
  topicStatusChanged: 'taxonomy.topic.status-changed',
  languageCreated: 'taxonomy.language.created',
  languageUpdated: 'taxonomy.language.updated',
  languageStatusChanged: 'taxonomy.language.status-changed',
  tagCreated: 'taxonomy.tag.created',
  tagRelabelled: 'taxonomy.tag.relabelled',
  tagStatusChanged: 'taxonomy.tag.status-changed',
} as const;

/**
 * How many topics one administrative listing returns.
 *
 * The canonical seed is nineteen rows. The bound exists because the design must
 * not assume it stays nineteen: a surface that loaded the whole table worked
 * perfectly until the day somebody imported a real taxonomy into it.
 */
const TOPIC_PAGE = 200;

export interface TaxonomyServiceDependencies {
  readonly reader: TaxonomyReaderPort;
  readonly taxonomy: TaxonomyPersistencePort;
}

export function createTaxonomyService({ reader, taxonomy }: TaxonomyServiceDependencies) {
  function actorInput(actor: TaxonomyActor, auditAction: string) {
    return {
      actorId: actor.accountId,
      authorisingSource: actor.permission,
      auditAction,
    };
  }

  return {
    /* ---- Reading --------------------------------------------------------- */

    /**
     * One level of the hierarchy, resolved for one interface locale.
     *
     * ONE LEVEL AT A TIME, which is what keeps the administrative surface
     * bounded however large the taxonomy becomes. The whole subtree is
     * available by navigating into it, and the depth itself is capped by the
     * accepted bound.
     */
    async listChildren(input: {
      readonly parentId: string | null;
      readonly locale: Locale;
      readonly includeArchived: boolean;
    }): Promise<readonly TopicView[]> {
      return reader.listTopicTree({
        parentId: input.parentId,
        depth: 1,
        includeArchived: input.includeArchived,
        locale: input.locale,
        limit: TOPIC_PAGE,
      });
    },

    /**
     * Every topic the administrative surface needs in order to name an ancestor.
     *
     * Bounded by the accepted depth and the page cap, and used for the
     * breadcrumb and the parent chooser — both of which need the WHOLE shallow
     * tree rather than one level.
     */
    async listTree(input: {
      readonly locale: Locale;
      readonly includeArchived: boolean;
    }): Promise<readonly TopicView[]> {
      return reader.listTopicTree({
        parentId: null,
        depth: MAX_TOPIC_DEPTH,
        includeArchived: input.includeArchived,
        locale: input.locale,
        limit: TOPIC_PAGE,
      });
    },

    async findTopic(input: {
      readonly topicId: string;
      readonly locale: Locale;
    }): Promise<TopicDetail | null> {
      return reader.findTopic(input);
    },

    async findTopicBySlug(input: {
      readonly slug: string;
      readonly locale: Locale;
    }): Promise<TopicView | null> {
      return reader.findTopicBySlug(input);
    },

    async listLanguages(input: {
      readonly includeRetired: boolean;
    }): Promise<readonly LanguageView[]> {
      return reader.listLanguages(input);
    },

    async listTags(input: {
      readonly query: string | null;
      readonly includeRetired: boolean;
      readonly limit: number;
      readonly offset: number;
    }): Promise<TagPage> {
      return reader.listTags(input);
    },

    /**
     * The typed topic-assignment relationships the DATABASE enforces.
     *
     * The honest answer to "what can be classified by a topic right now". It is
     * empty until a context that owns a taxonomy target ships its own typed
     * junction, and the administrative surface says so in those words rather
     * than offering a control over nothing (DOMAIN_MODEL.md §6.2).
     */
    async assignmentStatus(): Promise<TopicAssignmentStatus> {
      return reader.topicAssignmentStatus();
    },

    /* ---- Topics ---------------------------------------------------------- */

    async createTopic(
      actor: TaxonomyActor,
      input: {
        readonly slug: string;
        readonly parentId: string | null;
        readonly name: string;
        readonly description: string | null;
      },
    ): Promise<TaxonomyResult<{ topic: TopicDetail }>> {
      try {
        // APPENDED AFTER ITS SIBLINGS. Read here rather than in the adapter
        // because "where a new topic goes" is a product decision, and the
        // adapter's job is to write the position it is given.
        const siblings = await reader.listTopicTree({
          parentId: input.parentId,
          depth: 1,
          includeArchived: true,
          locale: 'en',
          limit: TOPIC_PAGE,
        });

        const topic = await taxonomy.createTopic({
          ...input,
          position: nextPosition(siblings),
          ...actorInput(actor, AUDIT.topicCreated),
        });
        return { ok: true, topic };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setTopicTranslation(
      actor: TaxonomyActor,
      input: {
        readonly topicId: string;
        readonly locale: Locale;
        readonly name: string;
        readonly description: string | null;
      },
    ): Promise<TaxonomyResult<{ topic: TopicDetail }>> {
      try {
        const topic = await taxonomy.setTopicTranslation({
          ...input,
          ...actorInput(actor, AUDIT.topicTranslated),
        });
        return { ok: true, topic };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async removeTopicTranslation(
      actor: TaxonomyActor,
      input: { readonly topicId: string; readonly locale: Locale },
    ): Promise<TaxonomyResult<{ topic: TopicDetail }>> {
      try {
        const topic = await taxonomy.removeTopicTranslation({
          ...input,
          ...actorInput(actor, AUDIT.topicTranslationRemoved),
        });
        return { ok: true, topic };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /**
     * Moves a topic to a new parent.
     *
     * The cycle and the depth bound are refused by the database, under a lock
     * every hierarchy write takes — so two administrators moving A under B and
     * B under A at the same moment cannot both succeed. This method turns that
     * refusal into a failure the interface can explain; it does not re-check it
     * beforehand, because a check performed before the write reads a state the
     * other transaction is in the middle of replacing.
     */
    async moveTopic(
      actor: TaxonomyActor,
      input: { readonly topicId: string; readonly parentId: string | null },
    ): Promise<TaxonomyResult<{ topic: TopicDetail }>> {
      try {
        const siblings = await reader.listTopicTree({
          parentId: input.parentId,
          depth: 1,
          includeArchived: true,
          locale: 'en',
          limit: TOPIC_PAGE,
        });

        const topic = await taxonomy.moveTopic({
          ...input,
          position: nextPosition(
            siblings.filter((sibling) => sibling.id !== input.topicId),
          ),
          ...actorInput(actor, AUDIT.topicMoved),
        });
        return { ok: true, topic };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async reorderTopics(
      actor: TaxonomyActor,
      input: {
        readonly parentId: string | null;
        readonly orderedTopicIds: readonly string[];
      },
    ): Promise<TaxonomyResult<{ siblings: readonly TopicView[] }>> {
      try {
        const siblings = await taxonomy.reorderTopics({
          ...input,
          ...actorInput(actor, AUDIT.topicReordered),
        });
        return { ok: true, siblings };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setTopicStatus(
      actor: TaxonomyActor,
      input: { readonly topicId: string; readonly status: TopicStatus },
    ): Promise<TaxonomyResult<{ topic: TopicDetail }>> {
      try {
        const topic = await taxonomy.setTopicStatus({
          ...input,
          ...actorInput(actor, AUDIT.topicStatusChanged),
        });
        return { ok: true, topic };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /* ---- Content languages ----------------------------------------------- */

    async createLanguage(
      actor: TaxonomyActor,
      input: {
        readonly code: string;
        readonly englishName: string;
        readonly nativeName: string;
        readonly direction: LanguageDirection;
      },
    ): Promise<TaxonomyResult<{ language: LanguageView }>> {
      try {
        const language = await taxonomy.createLanguage({
          ...input,
          ...actorInput(actor, AUDIT.languageCreated),
        });
        return { ok: true, language };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async updateLanguage(
      actor: TaxonomyActor,
      input: {
        readonly code: string;
        readonly englishName: string;
        readonly nativeName: string;
        readonly direction: LanguageDirection;
      },
    ): Promise<TaxonomyResult<{ language: LanguageView }>> {
      try {
        const language = await taxonomy.updateLanguage({
          ...input,
          ...actorInput(actor, AUDIT.languageUpdated),
        });
        return { ok: true, language };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setLanguageStatus(
      actor: TaxonomyActor,
      input: { readonly code: string; readonly status: LanguageStatus },
    ): Promise<TaxonomyResult<{ language: LanguageView }>> {
      try {
        const language = await taxonomy.setLanguageStatus({
          ...input,
          ...actorInput(actor, AUDIT.languageStatusChanged),
        });
        return { ok: true, language };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /* ---- Tags ------------------------------------------------------------ */

    async createTag(
      actor: TaxonomyActor,
      input: { readonly slug: string; readonly label: string },
    ): Promise<TaxonomyResult<{ tag: TagView }>> {
      try {
        const tag = await taxonomy.createTag({
          ...input,
          ...actorInput(actor, AUDIT.tagCreated),
        });
        return { ok: true, tag };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async relabelTag(
      actor: TaxonomyActor,
      input: { readonly tagId: string; readonly label: string },
    ): Promise<TaxonomyResult<{ tag: TagView }>> {
      try {
        const tag = await taxonomy.relabelTag({
          ...input,
          ...actorInput(actor, AUDIT.tagRelabelled),
        });
        return { ok: true, tag };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setTagStatus(
      actor: TaxonomyActor,
      input: { readonly tagId: string; readonly status: TagStatus },
    ): Promise<TaxonomyResult<{ tag: TagView }>> {
      try {
        const tag = await taxonomy.setTagStatus({
          ...input,
          ...actorInput(actor, AUDIT.tagStatusChanged),
        });
        return { ok: true, tag };
      } catch (error) {
        return fail(classify(error));
      }
    },
  };
}

export type TaxonomyService = ReturnType<typeof createTaxonomyService>;
