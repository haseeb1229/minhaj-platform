import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type {
  LanguageView,
  TagView,
  TaxonomyActorInput,
  TaxonomyPersistencePort,
  TaxonomyReaderPort,
  TopicAssignmentStatus,
  TopicDetail,
  TopicLabel,
  TopicTranslationView,
  TopicView,
} from '@minhaj/contracts/taxonomy';
import { MAX_TOPIC_DEPTH, TOPIC_FALLBACK_LOCALE } from '@minhaj/contracts/taxonomy';
import type { Prisma } from '@prisma/client';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
import { taxonomyRefusalOf } from './refusals.ts';

/**
 * Taxonomy's persistence — topics, their per-interface-locale translations, the
 * content-language reference data and tags.
 *
 * Semantic owner: `taxonomy`, declared in this package's manifest under
 * `minhaj.persistenceAdapters`. Physically here because it needs the private
 * Prisma client; owned by the context, which is the only place its rules may
 * change (ARCHITECTURE.md §4.1, §6.3 rule 14).
 *
 * WHAT IT DECIDES: nothing about WHO may act. The permission is settled before
 * any of these operations is reachable, which is why each mutation takes an
 * actor IDENTIFIER for the audit row rather than anything it could authorise
 * with.
 *
 * WHAT IT DOES ENFORCE, and must: the invariants that are properties of the
 * DATA. A canonical seed topic cannot be re-slugged, re-parented or archived; a
 * Topic always keeps its fallback translation; every mutation writes its audit
 * record INSIDE the transaction that makes the change. Those are checked here
 * as well as in the context because this module is the only writer, and an
 * invariant enforced only by its caller is an invariant one new caller removes.
 *
 * WHAT IT DOES NOT ENFORCE, deliberately: cycles and depth. Those cannot be
 * decided by reading rows another transaction is in the middle of changing, so
 * they live in the `TaxonomyTopicHierarchy` trigger, behind a transaction-owned
 * application lock. This module recognises the refusal and names it; it does
 * not re-implement it.
 */

/** How many rows a bounded listing may return in one page. */
const MAX_PAGE = 100;

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.trunc(limit), MAX_PAGE);
}

function boundedOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

/** How deep one `listTopicTree` call may reach, whatever it is asked for. */
function boundedDepth(depth: number): number {
  if (!Number.isFinite(depth) || depth < 1) return 1;
  return Math.min(Math.trunc(depth), MAX_TOPIC_DEPTH);
}

/**
 * Raised when a taxonomy operation is refused by a DATA invariant.
 *
 * Distinct from an authorisation denial, which never reaches this module: by
 * the time one of these is thrown the caller was permitted to try, and what
 * stopped them is what the data is allowed to be.
 */
export class TaxonomyDataError extends Error {
  readonly reason:
    | 'topic-not-found'
    | 'topic-protected'
    | 'topic-archived'
    | 'topic-has-active-children'
    | 'duplicate-slug'
    | 'fallback-translation-required'
    | 'hierarchy-cycle'
    | 'hierarchy-too-deep'
    | 'language-not-found'
    | 'duplicate-language-code'
    | 'tag-not-found'
    | 'duplicate-tag-slug';

  constructor(reason: TaxonomyDataError['reason'], message: string) {
    super(message);
    this.name = 'TaxonomyDataError';
    this.reason = reason;
  }
}

/**
 * Maps a SQL Server error raised by a taxonomy trigger onto a named refusal.
 *
 * The recognition itself lives in `./refusals.ts`, which walks the error GRAPH
 * — Prisma and the driver put the server's number and message in different
 * places depending on how the statement was issued, and reading only the outer
 * error reported most refusals as "unavailable", which is the message a
 * connection failure produces.
 *
 * A LOCK FAILURE IS DELIBERATELY NOT TRANSLATED. It means the invariant could
 * not be EVALUATED, and reporting that as an ordinary validation message would
 * describe a check that did not happen as one that did. It is recognised so it
 * cannot be mistaken for a cycle, and then re-raised as itself.
 */
function hierarchyRefusal(error: unknown): TaxonomyDataError | null {
  switch (taxonomyRefusalOf(error)) {
    case 'hierarchy-cycle':
      return new TaxonomyDataError(
        'hierarchy-cycle',
        'A Topic cannot be moved beneath its own descendant.',
      );
    case 'hierarchy-too-deep':
      return new TaxonomyDataError(
        'hierarchy-too-deep',
        `The Topic hierarchy may not exceed ${MAX_TOPIC_DEPTH} levels.`,
      );
    case 'fallback-translation-required':
      return new TaxonomyDataError(
        'fallback-translation-required',
        `A Topic must keep its ${TOPIC_FALLBACK_LOCALE} translation.`,
      );
    default:
      return null;
  }
}

/** Re-raises anything that is not a recognised data refusal, unchanged. */
function rethrowHierarchy(error: unknown): never {
  const refusal = hierarchyRefusal(error);
  if (refusal !== null) throw refusal;
  throw error;
}

/* ===========================================================================
 * Row shapes
 * ========================================================================= */

/**
 * A topic row as the queries below select it.
 *
 * Stated STRUCTURALLY rather than as `Prisma.TopicGetPayload<…>`. The helper
 * type is accurate and it names `Prisma`, which would put the client's own
 * namespace on a module the encapsulation boundary re-exports — and a boundary
 * that names raw capability cannot be shown to be narrow (ARCHITECTURE.md §6.3
 * rule 13).
 */
interface TopicRow {
  readonly id: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly position: number;
  readonly status: string;
  readonly system: boolean;
  readonly translations: readonly {
    readonly locale: string;
    readonly name: string;
    readonly description: string | null;
  }[];
}

/** Physical catalogue detail kept private to the database adapter. */
interface PhysicalTopicAssignmentRelationship {
  readonly table: string;
  readonly topicColumn: string;
  readonly onTopicDelete: string;
  readonly targets: readonly { readonly table: string; readonly column: string }[];
}

const TOPIC_INCLUDE = {
  translations: {
    select: { locale: true, name: true, description: true },
    orderBy: { locale: 'asc' },
  },
} as const;

/**
 * Resolves one Topic's label for one interface locale.
 *
 * REQUESTED LOCALE, THEN FALLBACK, and the result says which it used.
 *
 * WHY THE FALLBACK IS RELIABLE, stated precisely rather than generously. Two
 * different mechanisms hold it up, and neither covers the other's half:
 *
 *   - `createTopic` writes the topic and its fallback translation in ONE
 *     transaction, so no path this application has produces a topic without
 *     one — not even briefly, and not after a crash;
 *   - `TaxonomyTopicFallback` refuses any delete or update that would REMOVE
 *     it, so no later writer — including one that never touches this adapter —
 *     can take it away.
 *
 * What neither can enforce is a direct INSERT that creates a topic and stops
 * there: the translation is a separate row, so an AFTER INSERT trigger on
 * `Topic` would have to fire before it could exist. The `?? slug` below is for
 * exactly that case and no other, and showing the stable identifier is more
 * honest than showing an empty heading.
 */
function labelFor(row: TopicRow, locale: Locale): TopicLabel {
  const requested = row.translations.find((entry) => entry.locale === locale);
  if (requested !== undefined) {
    return {
      name: requested.name,
      description: requested.description,
      resolvedLocale: locale,
      fallback: false,
    };
  }

  const fallback = row.translations.find(
    (entry) => entry.locale === TOPIC_FALLBACK_LOCALE,
  );

  return {
    name: fallback?.name ?? row.slug,
    description: fallback?.description ?? null,
    resolvedLocale: TOPIC_FALLBACK_LOCALE,
    fallback: true,
  };
}

function toTopicView(row: TopicRow, locale: Locale, depth: number): TopicView {
  return {
    id: row.id,
    slug: row.slug,
    parentId: row.parentId,
    position: row.position,
    status: row.status as TopicView['status'],
    system: row.system,
    depth,
    label: labelFor(row, locale),
    translatedLocales: row.translations.map((entry) => entry.locale as Locale),
  };
}

function toTopicDetail(row: TopicRow, locale: Locale, depth: number): TopicDetail {
  const translations: TopicTranslationView[] = row.translations.map((entry) => ({
    locale: entry.locale as Locale,
    name: entry.name,
    description: entry.description,
  }));

  return { ...toTopicView(row, locale, depth), translations };
}

function toLanguageView(row: {
  code: string;
  englishName: string;
  nativeName: string;
  direction: string;
  status: string;
}): LanguageView {
  return {
    code: row.code,
    englishName: row.englishName,
    nativeName: row.nativeName,
    direction: row.direction as LanguageView['direction'],
    status: row.status as LanguageView['status'],
  };
}

function toTagView(row: {
  id: string;
  slug: string;
  label: string;
  status: string;
}): TagView {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    status: row.status as TagView['status'],
  };
}

/* ===========================================================================
 * The read side
 * ========================================================================= */

export function createTaxonomyReader(): TaxonomyReaderPort {
  const prisma = getDatabaseClient();

  /**
   * How far below the roots one topic sits.
   *
   * Computed from the rows ALREADY LOADED for this listing rather than by a
   * second query per row. A listing that asked the database for each topic's
   * depth would be the N+1 this method exists to avoid.
   */
  function depthWithin(
    row: TopicRow,
    byId: ReadonlyMap<string, TopicRow>,
    baseDepth: number,
  ): number {
    let depth = baseDepth;
    let cursor = row.parentId;

    // Bounded by the accepted depth, so a hierarchy the trigger somehow let
    // through cannot turn this into an unbounded loop.
    for (let step = 0; step < MAX_TOPIC_DEPTH && cursor !== null; step += 1) {
      const parent = byId.get(cursor);
      if (parent === undefined) break;
      depth += 1;
      cursor = parent.parentId;
    }

    return depth;
  }

  /**
   * How deep one topic sits in the WHOLE tree, counting a root as 1.
   *
   * Used by the two single-row reads, where there is no already-loaded listing
   * to derive it from. Bounded by the accepted depth, so it terminates whatever
   * the data says.
   */
  async function absoluteDepth(parentId: string | null): Promise<number> {
    let depth = 1;
    let cursor = parentId;

    for (let step = 0; step < MAX_TOPIC_DEPTH && cursor !== null; step += 1) {
      const parent: { parentId: string | null } | null = await prisma.topic.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (parent === null) break;
      depth += 1;
      cursor = parent.parentId;
    }

    return depth;
  }

  return {
    async topicReferences(ids, locale) {
      if (ids.length > 300) throw new Error('Topic reference batch exceeds bound');
      const rows = await getDatabaseClient().topic.findMany({
        where: { id: { in: [...ids] }, status: 'active' },
        select: {
          id: true,
          slug: true,
          translations: { select: { locale: true, name: true } },
        },
        take: 300,
        orderBy: { id: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name:
          (
            row.translations.find((t) => t.locale === locale) ??
            row.translations.find((t) => t.locale === 'en')
          )?.name ?? row.slug,
      }));
    },
    async listTopicTree({ parentId, depth, includeArchived, locale, limit }) {
      const levels = boundedDepth(depth);
      const cap = boundedLimit(limit);
      const status = includeArchived ? undefined : 'active';

      // ONE QUERY PER LEVEL, not one per row. A subject taxonomy is shallow by
      // design and the depth is bounded, so this is a small fixed number of
      // round trips whose ceiling is known — rather than a recursive walk whose
      // cost depends on how many topics somebody created.
      const collected: TopicRow[] = [];
      let frontier: (string | null)[] = [parentId];

      for (let level = 0; level < levels && frontier.length > 0; level += 1) {
        const remaining = cap - collected.length;
        if (remaining <= 0) break;

        const rows = await prisma.topic.findMany({
          where: {
            ...(frontier.length === 1 && frontier[0] === null
              ? { parentId: null }
              : {
                  parentId: {
                    in: frontier.filter((value): value is string => value !== null),
                  },
                }),
            ...(status === undefined ? {} : { status }),
          },
          include: TOPIC_INCLUDE,
          // `position` then `slug`: slug is globally unique, so the pair is a
          // TOTAL order and two siblings sharing a position still render the
          // same way on every request.
          orderBy: [{ position: 'asc' }, { slug: 'asc' }],
          take: remaining,
        });

        if (rows.length === 0) break;
        collected.push(...rows);
        frontier = rows.map((row) => row.id);
      }

      const byId = new Map(collected.map((row) => [row.id, row]));

      // ABSOLUTE DEPTH, not depth within this listing. `TopicView.depth` says
      // "counting a root as 1", and a listing that reported its own first level
      // as 1 wherever the caller happened to start would make the same field
      // mean two different things depending on which method returned it — which
      // is how a breadcrumb ends up one level short.
      //
      // ONE extra bounded walk for the whole listing, not one per row: every
      // row below the first level is reached through rows already loaded.
      const baseDepth = await absoluteDepth(parentId);

      return collected.map((row) =>
        toTopicView(row, locale, depthWithin(row, byId, baseDepth)),
      );
    },

    async findTopic({ topicId, locale }) {
      const row = await prisma.topic.findUnique({
        where: { id: topicId },
        include: TOPIC_INCLUDE,
      });
      if (row === null) return null;

      return toTopicDetail(row, locale, await absoluteDepth(row.parentId));
    },

    async findTopicBySlug({ slug, locale }) {
      const row = await prisma.topic.findUnique({
        where: { slug },
        include: TOPIC_INCLUDE,
      });
      if (row === null) return null;

      return toTopicView(row, locale, await absoluteDepth(row.parentId));
    },

    async listLanguages({ includeRetired }) {
      const rows = await prisma.language.findMany({
        where: includeRetired ? {} : { status: 'active' },
        orderBy: { code: 'asc' },
      });
      return rows.map(toLanguageView);
    },

    async listTags({ query, includeRetired, limit, offset }) {
      const cap = boundedLimit(limit);
      const skip = boundedOffset(offset);

      // PREFIX SEARCH, on the two indexed columns. A `contains` search would be
      // a leading wildcard, which no index can seek, so a tag table of any size
      // would become a scan on every keystroke.
      const rows = await prisma.tag.findMany({
        where: {
          ...(includeRetired ? {} : { status: 'active' }),
          ...(query === null
            ? {}
            : {
                OR: [{ slug: { startsWith: query } }, { label: { startsWith: query } }],
              }),
        },
        orderBy: { slug: 'asc' },
        // One more than asked for, so `more` is a fact rather than a count
        // query over a table that may be large.
        take: cap + 1,
        skip,
      });

      return {
        items: rows.slice(0, cap).map(toTagView),
        more: rows.length > cap,
      };
    },

    /**
     * SEARCH PROJECTION READS. The visibility predicate — active — is in the
     * query, exactly as it is for every other public Topic read, so Search can
     * never be handed an archived Topic to index.
     */
    async searchTopic(id) {
      const row = await prisma.topic.findFirst({
        where: { id, status: 'active' },
        select: {
          id: true,
          slug: true,
          updatedAt: true,
          translations: {
            select: { locale: true, name: true, description: true, updatedAt: true },
            orderBy: { locale: 'asc' },
          },
        },
      });
      if (row === null) return null;
      return {
        id: row.id,
        slug: row.slug,
        stamp: topicStamp(row),
        translations: row.translations.map((entry) => ({
          locale: entry.locale as Locale,
          name: entry.name,
          description: entry.description,
        })),
      };
    },

    async searchTopics({ after, limit }) {
      const rows = await prisma.topic.findMany({
        where: { status: 'active', ...(after === null ? {} : { id: { gt: after } }) },
        select: {
          id: true,
          updatedAt: true,
          translations: { select: { locale: true, updatedAt: true } },
        },
        orderBy: { id: 'asc' },
        take: boundedLimit(limit),
      });
      return rows.map((row) => ({ id: row.id, stamp: topicStamp(row) }));
    },

    async topicAssignmentStatus(): Promise<TopicAssignmentStatus> {
      // READ FROM THE DATABASE'S OWN FOREIGN-KEY CATALOGUE.
      //
      // Not from a list this repository declares. A declared registry would
      // report what somebody INTENDED; this reports what the database will
      // refuse to violate, which is the only claim DOMAIN_MODEL.md §6.2
      // actually makes. It returns nothing today because no context owning a
      // taxonomy target has shipped, and it will report a later owner's typed
      // junction with no change here.
      //
      // TAXONOMY'S OWN TABLES ARE EXCLUDED, and the distinction is the whole
      // meaning of this surface. Two foreign keys into `Topic` exist today and
      // neither is an assignment: `Topic.parentId` is the HIERARCHY, and
      // `TopicTranslation.topicId` is part of the Topic AGGREGATE — its name in
      // one interface locale, not a classification of somebody else's record.
      //
      // An assignment is a foreign key into `Topic` from a table belonging to a
      // context that owns the thing being classified. Reporting the aggregate's
      // own edges as assignments would show an administrator two relationships
      // on a page whose whole message is that there are none yet.
      const rows = await prisma.$queryRaw<
        {
          junctionTable: string;
          topicColumn: string;
          onTopicDelete: string;
          targetTable: string | null;
          targetColumn: string | null;
        }[]
      >`
        SELECT
            OBJECT_NAME(fk.[parent_object_id])                    AS [junctionTable],
            COL_NAME(fkc.[parent_object_id], fkc.[parent_column_id]) AS [topicColumn],
            fk.[delete_referential_action_desc]                   AS [onTopicDelete],
            OBJECT_NAME(other.[referenced_object_id])             AS [targetTable],
            COL_NAME(otherc.[parent_object_id], otherc.[parent_column_id]) AS [targetColumn]
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc
            ON fkc.[constraint_object_id] = fk.[object_id]
        LEFT JOIN sys.foreign_keys other
            ON other.[parent_object_id] = fk.[parent_object_id]
           AND other.[object_id] <> fk.[object_id]
           AND other.[referenced_object_id] <> fk.[referenced_object_id]
        LEFT JOIN sys.foreign_key_columns otherc
            ON otherc.[constraint_object_id] = other.[object_id]
        WHERE fk.[referenced_object_id] = OBJECT_ID(N'[dbo].[Topic]')
          AND fk.[parent_object_id] NOT IN (
              OBJECT_ID(N'[dbo].[Topic]'),
              OBJECT_ID(N'[dbo].[TopicTranslation]')
          )
        ORDER BY [junctionTable], [topicColumn], [targetTable];
      `;

      const byTable = new Map<string, PhysicalTopicAssignmentRelationship>();

      for (const row of rows) {
        const existing = byTable.get(row.junctionTable);
        const target =
          row.targetTable === null || row.targetColumn === null
            ? null
            : { table: row.targetTable, column: row.targetColumn };

        if (existing === undefined) {
          byTable.set(row.junctionTable, {
            table: row.junctionTable,
            topicColumn: row.topicColumn,
            onTopicDelete: row.onTopicDelete,
            targets: target === null ? [] : [target],
          });
          continue;
        }

        if (
          target !== null &&
          !existing.targets.some(
            (entry) => entry.table === target.table && entry.column === target.column,
          )
        ) {
          byTable.set(row.junctionTable, {
            ...existing,
            targets: [...existing.targets, target],
          });
        }
      }

      const relationships = [...byTable.values()];
      return {
        enforcedRelationships: relationships.length,
        incompleteRelationships: relationships.filter(
          (relationship) => relationship.targets.length === 0,
        ).length,
      };
    },
  };
}

/* ===========================================================================
 * The write side
 * ========================================================================= */

export function createTaxonomyPersistence(): TaxonomyPersistencePort {
  const prisma = getDatabaseClient();

  /**
   * Takes an update lock on one Topic for the rest of the transaction.
   *
   * WITHOUT IT, two concurrent edits both read the same "before" state and the
   * loser's audit record describes a change that never happened. The lock
   * serialises them, so the second one's before-state is the first one's
   * after-state — which is what makes the audit trail reconstructable. It is
   * the same device `lockRole` is for on the Identity side.
   */
  async function lockTopic(
    tx: Prisma.TransactionClient,
    topicId: string,
  ): Promise<{
    id: string;
    slug: string;
    parentId: string | null;
    position: number;
    status: string;
    system: boolean;
  } | null> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        slug: string;
        parentId: string | null;
        position: number;
        status: string;
        system: boolean;
      }[]
    >`
      SELECT [id], [slug], [parentId], [position], [status], [system]
      FROM [dbo].[Topic] WITH (UPDLOCK, HOLDLOCK)
      WHERE [id] = ${topicId}
    `;
    return rows[0] ?? null;
  }

  async function requireTopic(tx: Prisma.TransactionClient, topicId: string) {
    const locked = await lockTopic(tx, topicId);
    if (locked === null) {
      throw new TaxonomyDataError('topic-not-found', 'No such topic.');
    }
    return locked;
  }

  /**
   * Refuses a change to canonical seed data.
   *
   * The nineteen seeded topics are foundation data the migration controls:
   * their slug is what a public URL and a later context's data will reference,
   * and their place at the root is what the accepted model says the taxonomy
   * IS. Their localised names and descriptions are deliberately NOT covered —
   * wording a subject in Urdu is editorial work, not a schema decision.
   */
  function refuseProtected(topic: { system: boolean }, what: string): void {
    if (topic.system) {
      throw new TaxonomyDataError(
        'topic-protected',
        `A canonical topic's ${what} is foundation data and cannot be changed here.`,
      );
    }
  }

  async function recordAudit(
    tx: Prisma.TransactionClient,
    actor: TaxonomyActorInput,
    input: {
      readonly targetType: string;
      readonly targetId: string;
      readonly before?: Readonly<Record<string, string>>;
      readonly after?: Readonly<Record<string, string>>;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: auditRow({
        action: actor.auditAction,
        actorType: 'user',
        actorId: actor.actorId,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before,
        after: input.after,
        // The PERMISSION the actor used — the honest answer to "what
        // authorised this", and the one thing an investigation needs that the
        // action name does not already say.
        authorisingSource: actor.authorisingSource,
      }),
    });
  }

  async function detailOf(
    tx: Prisma.TransactionClient,
    topicId: string,
  ): Promise<TopicDetail> {
    const row = await tx.topic.findUnique({
      where: { id: topicId },
      include: TOPIC_INCLUDE,
    });
    if (row === null) {
      throw new TaxonomyDataError('topic-not-found', 'The topic no longer exists.');
    }

    let depth = 1;
    let cursor = row.parentId;
    for (let step = 0; step < MAX_TOPIC_DEPTH && cursor !== null; step += 1) {
      const parent: { parentId: string | null } | null = await tx.topic.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (parent === null) break;
      depth += 1;
      cursor = parent.parentId;
    }

    return toTopicDetail(row, TOPIC_FALLBACK_LOCALE, depth);
  }

  /**
   * Turns a unique-constraint violation into the refusal that names WHICH value
   * collided, and leaves every other error alone.
   *
   * P2002 is Prisma's unique-constraint code. Catching it is what turns "the
   * database said no" into "that slug is already in use" — and doing it here
   * rather than reading first is what makes the check race-safe: two concurrent
   * creates of the same slug produce one row and one clear refusal.
   */
  function refuseDuplicate(error: unknown, refusal: TaxonomyDataError): never {
    if ((error as { code?: string }).code === 'P2002') throw refusal;
    rethrowHierarchy(error);
  }

  return {
    /* ---- Topics -------------------------------------------------------- */

    async createTopic(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          if (input.parentId !== null) {
            // The parent must exist AND be usable. A child created under an
            // archived parent would be active content hanging off something
            // the taxonomy has retired — visible nowhere and reachable by
            // nothing.
            const parent = await requireTopic(tx, input.parentId);
            if (parent.status !== 'active') {
              throw new TaxonomyDataError(
                'topic-archived',
                'A topic cannot be created beneath an archived parent.',
              );
            }
          }

          const created = await tx.topic.create({
            // `system: false` is passed EXPLICITLY. There is no runtime path to
            // canonical seed data: the nineteen that exist arrive with the
            // migration, and this is the only place a topic is created.
            data: {
              slug: input.slug,
              parentId: input.parentId,
              position: input.position,
              status: 'active',
              system: false,
            },
          });

          // The fallback translation is written in the SAME transaction, so a
          // Topic never exists — not even briefly, not even after a crash —
          // without a name to render.
          await tx.topicTranslation.create({
            data: {
              topicId: created.id,
              locale: TOPIC_FALLBACK_LOCALE,
              name: input.name,
              description: input.description,
            },
          });

          await requestSearchIndexing(tx, 'topic', created.id);

          await recordAudit(tx, input, {
            targetType: 'topic',
            targetId: created.id,
            after: {
              slug: input.slug,
              parent: input.parentId ?? '(root)',
              position: String(input.position),
            },
          });

          return detailOf(tx, created.id);
        });
      } catch (error) {
        if (error instanceof TaxonomyDataError) throw error;
        refuseDuplicate(
          error,
          new TaxonomyDataError(
            'duplicate-slug',
            `A topic with the slug '${input.slug}' already exists.`,
          ),
        );
      }
    },

    async setTopicTranslation(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          await requireTopic(tx, input.topicId);

          const before = await tx.topicTranslation.findUnique({
            where: {
              topicId_locale: { topicId: input.topicId, locale: input.locale },
            },
            select: { name: true },
          });

          // UPSERT on the composite primary key, which is what makes two
          // concurrent editors of the same locale produce one row rather than
          // a duplicate or a lost update.
          await tx.topicTranslation.upsert({
            where: {
              topicId_locale: { topicId: input.topicId, locale: input.locale },
            },
            create: {
              topicId: input.topicId,
              locale: input.locale,
              name: input.name,
              description: input.description,
            },
            update: {
              name: input.name,
              description: input.description,
              updatedAt: new Date(),
            },
          });

          await requestSearchIndexing(tx, 'topic', input.topicId);

          await recordAudit(tx, input, {
            targetType: 'topic',
            targetId: input.topicId,
            // WHICH LOCALE CHANGED and what the name was — never the
            // description, which is prose and belongs on the record rather
            // than duplicated into the audit table (SECURITY_BASELINE.md §13.4).
            ...(before === null
              ? {}
              : { before: { locale: input.locale, name: before.name } }),
            after: { locale: input.locale, name: input.name },
          });

          return detailOf(tx, input.topicId);
        });
      } catch (error) {
        if (error instanceof TaxonomyDataError) throw error;
        rethrowHierarchy(error);
      }
    },

    async removeTopicTranslation(input) {
      // Refused HERE as well as by the trigger. The trigger is what makes the
      // invariant hold for every writer; this is what makes the refusal a
      // named outcome the interface can explain rather than a SQL error.
      if (input.locale === TOPIC_FALLBACK_LOCALE) {
        throw new TaxonomyDataError(
          'fallback-translation-required',
          `The ${TOPIC_FALLBACK_LOCALE} translation is what every other locale falls back to and cannot be removed.`,
        );
      }

      try {
        return await prisma.$transaction(async (tx) => {
          await requireTopic(tx, input.topicId);

          const removed = await tx.topicTranslation.deleteMany({
            where: { topicId: input.topicId, locale: input.locale },
          });

          if (removed.count > 0) {
            await requestSearchIndexing(tx, 'topic', input.topicId);
            await recordAudit(tx, input, {
              targetType: 'topic',
              targetId: input.topicId,
              before: { locale: input.locale, translation: 'present' },
              after: { locale: input.locale, translation: 'removed' },
            });
          }

          return detailOf(tx, input.topicId);
        });
      } catch (error) {
        if (error instanceof TaxonomyDataError) throw error;
        rethrowHierarchy(error);
      }
    },

    async moveTopic(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const topic = await requireTopic(tx, input.topicId);
          refuseProtected(topic, 'place in the hierarchy');

          if (input.parentId !== null) {
            const parent = await requireTopic(tx, input.parentId);
            if (parent.status !== 'active') {
              throw new TaxonomyDataError(
                'topic-archived',
                'A topic cannot be moved beneath an archived parent.',
              );
            }
          }

          // The cycle and depth refusals come from the trigger, which fires on
          // this statement. Nothing above re-implements them.
          await tx.topic.update({
            where: { id: input.topicId },
            data: {
              parentId: input.parentId,
              position: input.position,
              updatedAt: new Date(),
            },
          });

          await recordAudit(tx, input, {
            targetType: 'topic',
            targetId: input.topicId,
            // BOUNDED before and after identifiers. A hierarchy change's full
            // subtree would be an unbounded payload describing rows that did
            // not themselves change.
            before: {
              parent: topic.parentId ?? '(root)',
              position: String(topic.position),
            },
            after: {
              parent: input.parentId ?? '(root)',
              position: String(input.position),
            },
          });

          return detailOf(tx, input.topicId);
        });
      } catch (error) {
        if (error instanceof TaxonomyDataError) throw error;
        rethrowHierarchy(error);
      }
    },

    async reorderTopics(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          // Every named topic must actually be a child of the named parent.
          // Without this, a reorder could be used to move a topic — bypassing
          // the protected-seed and archived-parent rules `moveTopic` enforces.
          const siblings = await tx.topic.findMany({
            where: { parentId: input.parentId },
            select: { id: true, position: true },
            orderBy: [{ position: 'asc' }, { slug: 'asc' }],
          });
          const known = new Set(siblings.map((row) => row.id));

          for (const topicId of input.orderedTopicIds) {
            if (!known.has(topicId)) {
              throw new TaxonomyDataError(
                'topic-not-found',
                'A topic in the new order is not a child of that parent.',
              );
            }
          }

          for (const [index, topicId] of input.orderedTopicIds.entries()) {
            await tx.topic.update({
              where: { id: topicId },
              data: { position: index, updatedAt: new Date() },
            });
          }

          await recordAudit(tx, input, {
            targetType: 'topic-order',
            targetId: input.parentId ?? '(root)',
            // IDENTIFIERS, not the rows. "These, in this order" is the whole
            // of what changed.
            after: { order: input.orderedTopicIds.join(' ') },
          });

          const rows = await tx.topic.findMany({
            where: { parentId: input.parentId },
            include: TOPIC_INCLUDE,
            orderBy: [{ position: 'asc' }, { slug: 'asc' }],
          });

          return rows.map((row) => toTopicView(row, TOPIC_FALLBACK_LOCALE, 1));
        });
      } catch (error) {
        if (error instanceof TaxonomyDataError) throw error;
        rethrowHierarchy(error);
      }
    },

    async setTopicStatus(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const topic = await requireTopic(tx, input.topicId);

          if (input.status === 'archived') {
            refuseProtected(topic, 'lifecycle');

            // ARCHIVING IS NOT RECURSIVE, and it refuses rather than cascading.
            //
            // A cascade would archive a subtree an administrator could not see
            // from the row they clicked. Refusing keeps one invariant simple
            // and checkable: an ACTIVE topic never has an archived ancestor,
            // so the active tree is always well formed.
            const activeChildren = await tx.topic.count({
              where: { parentId: input.topicId, status: 'active' },
            });
            if (activeChildren > 0) {
              throw new TaxonomyDataError(
                'topic-has-active-children',
                'Archive or move the child topics first.',
              );
            }
          }

          if (input.status === 'active' && topic.parentId !== null) {
            // Restoring beneath an archived parent would create the same
            // malformed shape from the other direction.
            const parent = await tx.topic.findUnique({
              where: { id: topic.parentId },
              select: { status: true },
            });
            if (parent?.status !== 'active') {
              throw new TaxonomyDataError(
                'topic-archived',
                'Restore the parent topic first.',
              );
            }
          }

          await tx.topic.update({
            where: { id: input.topicId },
            data: { status: input.status, updatedAt: new Date() },
          });

          await requestSearchIndexing(tx, 'topic', input.topicId);

          await recordAudit(tx, input, {
            targetType: 'topic',
            targetId: input.topicId,
            before: { status: topic.status },
            after: { status: input.status },
          });

          return detailOf(tx, input.topicId);
        });
      } catch (error) {
        if (error instanceof TaxonomyDataError) throw error;
        rethrowHierarchy(error);
      }
    },

    /* ---- Languages ----------------------------------------------------- */

    async createLanguage(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const created = await tx.language.create({
            data: {
              code: input.code,
              englishName: input.englishName,
              nativeName: input.nativeName,
              direction: input.direction,
              status: 'active',
            },
          });

          await recordAudit(tx, input, {
            targetType: 'language',
            targetId: created.code,
            after: { code: created.code, englishName: created.englishName },
          });

          return toLanguageView(created);
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new TaxonomyDataError(
            'duplicate-language-code',
            `A content language with the code '${input.code}' already exists.`,
          );
        }
        throw error;
      }
    },

    async updateLanguage(input) {
      return prisma.$transaction(async (tx) => {
        const before = await tx.language.findUnique({
          where: { code: input.code },
          select: { englishName: true, nativeName: true, direction: true },
        });
        if (before === null) {
          throw new TaxonomyDataError('language-not-found', 'No such content language.');
        }

        const updated = await tx.language.update({
          where: { code: input.code },
          data: {
            englishName: input.englishName,
            nativeName: input.nativeName,
            direction: input.direction,
            updatedAt: new Date(),
          },
        });

        await recordAudit(tx, input, {
          targetType: 'language',
          targetId: input.code,
          before: { englishName: before.englishName, direction: before.direction },
          after: { englishName: input.englishName, direction: input.direction },
        });

        return toLanguageView(updated);
      });
    },

    async setLanguageStatus(input) {
      return prisma.$transaction(async (tx) => {
        const before = await tx.language.findUnique({
          where: { code: input.code },
          select: { status: true },
        });
        if (before === null) {
          throw new TaxonomyDataError('language-not-found', 'No such content language.');
        }

        const updated = await tx.language.update({
          where: { code: input.code },
          data: { status: input.status, updatedAt: new Date() },
        });

        await recordAudit(tx, input, {
          targetType: 'language',
          targetId: input.code,
          before: { status: before.status },
          after: { status: input.status },
        });

        return toLanguageView(updated);
      });
    },

    /* ---- Tags ---------------------------------------------------------- */

    async createTag(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const created = await tx.tag.create({
            data: { slug: input.slug, label: input.label, status: 'active' },
          });

          await recordAudit(tx, input, {
            targetType: 'tag',
            targetId: created.id,
            after: { slug: created.slug, label: created.label },
          });

          return toTagView(created);
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new TaxonomyDataError(
            'duplicate-tag-slug',
            `A tag with the slug '${input.slug}' already exists.`,
          );
        }
        throw error;
      }
    },

    async relabelTag(input) {
      return prisma.$transaction(async (tx) => {
        const before = await tx.tag.findUnique({
          where: { id: input.tagId },
          select: { label: true },
        });
        if (before === null) {
          throw new TaxonomyDataError('tag-not-found', 'No such tag.');
        }

        // THE SLUG IS NOT TOUCHED. A tag's label is what an editor reads and
        // its slug is what identifies it; letting a relabel move the slug
        // would silently split one tag into two.
        const updated = await tx.tag.update({
          where: { id: input.tagId },
          data: { label: input.label, updatedAt: new Date() },
        });

        await recordAudit(tx, input, {
          targetType: 'tag',
          targetId: input.tagId,
          before: { label: before.label },
          after: { label: input.label },
        });

        return toTagView(updated);
      });
    },

    async setTagStatus(input) {
      return prisma.$transaction(async (tx) => {
        const before = await tx.tag.findUnique({
          where: { id: input.tagId },
          select: { status: true },
        });
        if (before === null) {
          throw new TaxonomyDataError('tag-not-found', 'No such tag.');
        }

        const updated = await tx.tag.update({
          where: { id: input.tagId },
          data: { status: input.status, updatedAt: new Date() },
        });

        await recordAudit(tx, input, {
          targetType: 'tag',
          targetId: input.tagId,
          before: { status: before.status },
          after: { status: input.status },
        });

        return toTagView(updated);
      });
    },
  };
}

/**
 * A Topic's staleness stamp for search reconciliation.
 *
 * A translation edit does not move `Topic.updatedAt`, so the stamp is the latest
 * moment ANY part of the record changed, together with how many translations
 * it has — removing one that was not the newest changes the count even when it
 * leaves the newest moment where it was.
 */
function topicStamp(row: {
  readonly updatedAt: Date;
  readonly translations: readonly { readonly updatedAt: Date }[];
}): string {
  const latest = Math.max(
    row.updatedAt.getTime(),
    ...row.translations.map((entry) => entry.updatedAt.getTime()),
  );
  return `${String(latest)}:${String(row.translations.length)}`;
}
