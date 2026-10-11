import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  COLLECTION_LIMITS,
  COLLECTION_MEMBER_CHOICES,
  COLLECTION_PAGE,
  type ArticleDetail,
  type CollectionMember,
  type CollectionMemberKind,
  type CollectionMemberTarget,
  type CollectionSummary,
  type EditorialEdit,
  type EditorialLanguage,
  type EditorialMemberKind,
  type EditorialPersistencePort,
  type EditorialPublicReaderPort,
  type EditorialQuery,
  type EditorialRevision,
  type EditorialState,
  type EditorialTransition,
  type EditorialWrite,
  type PublicCollection,
} from '@minhaj/contracts/editorial';
import type { ContributionRole } from '@minhaj/contracts/people';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  EditorialDataError,
  authorisingSource,
  limitOf,
  offsetOf,
  refuse,
  revisionReset,
  transitionUpdate,
} from './workflow.ts';

/**
 * Editorial's Phase-15 persistence: Collection (DOMAIN_MODEL.md §7.1, §7.3).
 *
 * THE ARTICLE'S SHAPE OF TABLES AND THE ARTICLE'S WORKFLOW, through the same
 * shared rules (`./workflow.ts`), plus what is genuinely a Collection's: its
 * ONE ordered list of typed members (`CollectionItem`). The members are
 * written WITH the revision, in its transaction, and are immutable with it — so
 * membership and order change only through a new revision, which returns the
 * Collection to draft and clears its approval and publication schedule.
 *
 * TYPED MEMBERS, AND OTHER OWNERS NAMED BUT NEVER READ. Each place holds
 * exactly one member in one of seven typed columns. Articles and the four News
 * families are Editorial's own, so their published titles are read here, under
 * the same published predicate every public Editorial read uses. A Work is
 * Library's and a Video is Media's: this module stores their identifiers under
 * real, non-cascading foreign keys and reads neither owner's tables. Whether an
 * editor may choose one, and what a visitor sees of it, is asked of its owner
 * at Layer 4.
 *
 * NOT SEARCHABLE. Phase 15 does not carry Search Foundation in its dependency
 * path, so no Collection write requests indexing and no Collection read feeds
 * Search.
 *
 * PRIVATE CAPABILITY. Only the two operation sets leave this module, each typed
 * by Editorial's own ports; no delegate, transaction handle or client escapes
 * (ARCHITECTURE.md §4.1).
 */

type Client = Prisma.TransactionClient;

const db = () => getDatabaseClient();

/* ===========================================================================
 * The typed member columns — ONE place per member, ONE column per type
 * ========================================================================= */

/**
 * Which column holds which member type. Code-owned, never input: a type that is
 * not a key here has no column, and so can never be a member.
 */
const MEMBER_COLUMNS = Object.freeze({
  article: 'articleId',
  'news-article': 'newsArticleId',
  'press-release': 'pressReleaseId',
  statement: 'statementId',
  'media-coverage': 'mediaCoverageId',
  work: 'workId',
  video: 'videoId',
} as const satisfies Record<CollectionMemberKind, string>);

type MemberColumn = (typeof MEMBER_COLUMNS)[CollectionMemberKind];
type ItemRow = Readonly<Record<MemberColumn, string | null>>;

const MEMBER_ENTRIES = Object.entries(MEMBER_COLUMNS) as [
  CollectionMemberKind,
  MemberColumn,
][];

/** The one member a stored place holds. A place holding none or two is corrupt. */
function memberOf(row: ItemRow): CollectionMember {
  const found = MEMBER_ENTRIES.flatMap(([kind, column]) => {
    const id = row[column];
    return id === null ? [] : [{ kind, id }];
  });
  const [member] = found;
  if (member === undefined || found.length !== 1)
    throw new EditorialDataError('unavailable');
  return member;
}

/** The row one member is written as: its place and its ONE typed column. */
function itemOf(member: CollectionMember, position: number) {
  return { position, [MEMBER_COLUMNS[member.kind]]: member.id };
}

/* ===========================================================================
 * Selections
 * ========================================================================= */

const ITEMS = {
  select: {
    articleId: true,
    newsArticleId: true,
    pressReleaseId: true,
    statementId: true,
    mediaCoverageId: true,
    workId: true,
    videoId: true,
  },
  orderBy: { position: 'asc' as const },
};

const revisionInclude = {
  translations: { orderBy: { languageCode: 'asc' as const } },
  topics: { orderBy: { topicId: 'asc' as const } },
  contributors: { orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }] },
  items: ITEMS,
} satisfies Prisma.CollectionRevisionInclude;

const detailInclude = {
  current: { include: revisionInclude },
} satisfies Prisma.CollectionInclude;

/** What a card needs: never the body, the authoring document or the members. */
const summarySelect = {
  slug: true,
  current: {
    select: {
      primaryLanguage: true,
      translations: {
        select: { languageCode: true, title: true, excerpt: true },
        orderBy: { languageCode: 'asc' as const },
      },
      topics: { select: { topicId: true }, orderBy: { topicId: 'asc' as const } },
    },
  },
} satisfies Prisma.CollectionSelect;

const publicSelect = {
  slug: true,
  publishedAt: true,
  updatedAt: true,
  current: {
    select: {
      primaryLanguage: true,
      translations: {
        select: {
          languageCode: true,
          title: true,
          excerpt: true,
          seoTitle: true,
          seoDescription: true,
          html: true,
        },
        orderBy: { languageCode: 'asc' as const },
      },
      topics: { select: { topicId: true }, orderBy: { topicId: 'asc' as const } },
      contributors: {
        select: { personId: true, role: true },
        orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }],
      },
      items: ITEMS,
    },
  },
} satisfies Prisma.CollectionSelect;

/* ===========================================================================
 * Row shapes — plain interfaces, never a generated type
 * ========================================================================= */

interface RevisionRow {
  readonly number: number;
  readonly editorId: string;
  readonly createdAt: Date;
  readonly slug: string;
  readonly primaryLanguage: string;
  readonly translations: readonly {
    readonly languageCode: string;
    readonly title: string;
    readonly excerpt: string;
    readonly seoTitle: string;
    readonly seoDescription: string;
    readonly document: string;
    readonly html: string;
  }[];
  readonly topics: readonly { readonly topicId: string }[];
  readonly contributors: readonly { readonly personId: string; readonly role: string }[];
  readonly items: readonly ItemRow[];
}

interface RecordRow {
  readonly id: string;
  readonly slug: string;
  readonly state: string;
  readonly version: number;
  readonly currentRevision: number | null;
  readonly creatorId: string;
  readonly approvedRevision: number | null;
  readonly approvedById: string | null;
  readonly scheduledRevision: number | null;
  readonly scheduledById: string | null;
  readonly scheduledAt: Date | null;
  readonly scheduleStatus: string | null;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
  readonly current: RevisionRow | null;
}

/* ===========================================================================
 * Mapping
 * ========================================================================= */

function language(code: string): EditorialLanguage {
  return code as EditorialLanguage;
}

function revisionOf(row: RevisionRow): EditorialRevision {
  return {
    number: row.number,
    editorId: row.editorId,
    createdAt: row.createdAt,
    slug: row.slug,
    primaryLanguage: language(row.primaryLanguage),
    translations: row.translations.map((t) => ({
      languageCode: language(t.languageCode),
      title: t.title,
      excerpt: t.excerpt,
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      document: t.document,
      html: t.html,
    })),
    topicIds: row.topics.map((t) => t.topicId),
    contributors: row.contributors.map((c) => ({
      personId: c.personId,
      role: c.role as ContributionRole,
    })),
    members: row.items.map(memberOf),
  };
}

function titleOf(current: {
  readonly primaryLanguage: string;
  readonly translations: readonly {
    readonly languageCode: string;
    readonly title: string;
  }[];
}): string | undefined {
  return current.translations.find((t) => t.languageCode === current.primaryLanguage)
    ?.title;
}

function detailOf(row: RecordRow): ArticleDetail {
  if (!row.current || row.currentRevision === null)
    throw new EditorialDataError('unavailable');
  return {
    id: row.id,
    slug: row.slug,
    state: row.state as EditorialState,
    version: row.version,
    currentRevision: row.currentRevision,
    title: titleOf(row.current) ?? row.slug,
    creatorId: row.creatorId,
    approvedRevision: row.approvedRevision,
    approvedById: row.approvedById,
    scheduledRevision: row.scheduledRevision,
    scheduledById: row.scheduledById,
    scheduledAt: row.scheduledAt,
    scheduleStatus: row.scheduleStatus,
    updatedAt: row.updatedAt,
    revision: revisionOf(row.current),
  };
}

interface SummaryRow {
  readonly slug: string;
  readonly current: {
    readonly primaryLanguage: string;
    readonly translations: readonly {
      readonly languageCode: string;
      readonly title: string;
      readonly excerpt: string;
    }[];
    readonly topics: readonly { readonly topicId: string }[];
  } | null;
}

function summaryOf(row: SummaryRow): CollectionSummary {
  if (!row.current) throw new EditorialDataError('unavailable');
  return {
    slug: row.slug,
    primaryLanguage: language(row.current.primaryLanguage),
    translations: row.current.translations.map((t) => ({
      languageCode: language(t.languageCode),
      title: t.title,
      excerpt: t.excerpt,
    })),
    topicIds: row.current.topics.map((t) => t.topicId),
  };
}

/* ===========================================================================
 * Writes
 * ========================================================================= */

/**
 * One immutable revision: its words, references and ordered members, every
 * column named. A content without a member, with more than the bound, with a
 * record twice, or carrying another family's fields is not a Collection's and
 * is refused here as well as by the contract and the database (51156, the
 * position CHECK and the filtered unique indexes).
 */
async function writeRevision(
  tx: Client,
  id: string,
  number: number,
  input: EditorialWrite,
): Promise<void> {
  const content = input.content;
  const members = content.members ?? [];
  if (
    members.length === 0 ||
    members.length > COLLECTION_LIMITS.members ||
    new Set(members.map((m) => `${m.kind}:${m.id}`)).size !== members.length ||
    members.some((m) => !(m.kind in MEMBER_COLUMNS)) ||
    content.coverage !== undefined ||
    content.schedule !== undefined ||
    content.centreId !== undefined ||
    content.galleryIds !== undefined ||
    content.translations.some((t) => t.issuer !== undefined)
  )
    throw new EditorialDataError('invalid');
  await tx.collectionRevision.create({
    data: {
      ownerId: id,
      number,
      editorId: input.actorId,
      slug: content.slug,
      primaryLanguage: content.primaryLanguage,
      translations: {
        create: content.translations.map((t) => ({
          languageCode: t.languageCode,
          title: t.title,
          excerpt: t.excerpt,
          seoTitle: t.seoTitle,
          seoDescription: t.seoDescription,
          document: t.document,
          html: t.html,
        })),
      },
      topics: { create: content.topicIds.map((topicId) => ({ topicId })) },
      contributors: {
        create: content.contributors.map((c, position) => ({
          personId: c.personId,
          role: c.role,
          position,
        })),
      },
      items: { create: members.map((member, position) => itemOf(member, position)) },
    },
  });
}

/**
 * An audit row: WHICH workflow facts changed, never the text. No title, body,
 * authoring document or member's title enters the audit log
 * (SECURITY_BASELINE.md §13.4); the revision number names what was written,
 * and a membership change records only how many members the revision holds.
 */
async function audit(
  tx: Client,
  id: string,
  action: string,
  actorId: string | null,
  version: number,
  extra: Readonly<Record<string, string>> = {},
): Promise<void> {
  const snapshot = await tx.collection.findUniqueOrThrow({
    where: { id },
    select: {
      state: true,
      currentRevision: true,
      approvedRevision: true,
      scheduledRevision: true,
      scheduledAt: true,
      scheduleStatus: true,
    },
  });
  await tx.auditLog.create({
    data: auditRow({
      actorType: actorId === null ? 'system' : 'user',
      actorId,
      action: `editorial.collection.${action}`,
      targetType: 'collection',
      targetId: id,
      ...(version > 1 ? { before: { version: String(version - 1) } } : {}),
      after: {
        version: String(version),
        state: snapshot.state,
        revision: String(snapshot.currentRevision),
        approvedRevision: String(snapshot.approvedRevision),
        scheduledRevision: String(snapshot.scheduledRevision),
        scheduledAt: snapshot.scheduledAt?.toISOString() ?? '',
        scheduleStatus: snapshot.scheduleStatus ?? '',
        ...extra,
      },
      authorisingSource: authorisingSource(action, actorId),
    }),
  });
}

/** Claims the row at its expected version, or refuses as a conflict. */
async function locked(tx: Client, id: string, version: number): Promise<RecordRow> {
  const claim = await tx.collection.updateMany({
    where: { id, version },
    data: { version: { increment: 1 } },
  });
  if (claim.count !== 1) throw new EditorialDataError('conflict');
  return tx.collection.findUniqueOrThrow({ where: { id }, include: detailInclude });
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The Collection facts a revision changed, each audited as its own event. The
 * action names the fact; a membership change carries only the member count.
 * `members-reordered` is the same members in a new order, `members-changed` a
 * different set.
 */
function collectionChanges(
  before: RevisionRow | null,
  after: EditorialWrite['content'],
): readonly (
  'members-changed' | 'members-reordered' | 'topics-changed' | 'contributors-changed'
)[] {
  if (before === null) return [];
  const previous = before.items.map((row) => {
    const member = memberOf(row);
    return `${member.kind}:${member.id}`;
  });
  const next = (after.members ?? []).map((m) => `${m.kind}:${m.id}`);
  const sameSet = sameList([...previous].sort(), [...next].sort());
  return [
    ...(!sameSet ? (['members-changed'] as const) : []),
    ...(sameSet && !sameList(previous, next) ? (['members-reordered'] as const) : []),
    ...(!sameList(
      before.topics.map((t) => t.topicId),
      [...after.topicIds].sort(),
    )
      ? (['topics-changed'] as const)
      : []),
    ...(!sameList(
      before.contributors.map((c) => `${c.personId}:${c.role}`),
      after.contributors.map((c) => `${c.personId}:${c.role}`),
    )
      ? (['contributors-changed'] as const)
      : []),
  ];
}

export function collectionOperations(): Pick<
  EditorialPersistencePort,
  | 'collection'
  | 'collectionDirectory'
  | 'collectionRevisions'
  | 'createCollection'
  | 'reviseCollection'
  | 'transitionCollection'
  | 'dueCollections'
  | 'failCollectionSchedule'
> {
  return {
    async collection(id) {
      const row = await db().collection.findUnique({
        where: { id },
        include: detailInclude,
      });
      return row ? detailOf(row) : null;
    },

    async collectionDirectory(query: EditorialQuery) {
      const limit = limitOf(query.limit);
      const rows = await db().collection.findMany({
        where: query.state ? { state: query.state } : {},
        select: {
          id: true,
          slug: true,
          state: true,
          version: true,
          currentRevision: true,
          updatedAt: true,
          scheduledAt: true,
          scheduleStatus: true,
          current: {
            select: {
              primaryLanguage: true,
              translations: { select: { languageCode: true, title: true } },
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        skip: offsetOf(query.offset),
      });
      return {
        items: rows.slice(0, limit).map((row) => {
          if (!row.current || row.currentRevision === null)
            throw new EditorialDataError('unavailable');
          return {
            id: row.id,
            slug: row.slug,
            state: row.state as EditorialState,
            version: row.version,
            currentRevision: row.currentRevision,
            updatedAt: row.updatedAt,
            scheduledAt: row.scheduledAt,
            scheduleStatus: row.scheduleStatus,
            title: titleOf(row.current) ?? row.slug,
          };
        }),
        more: rows.length > limit,
      };
    },

    async collectionRevisions(id, offset) {
      const rows = await db().collectionRevision.findMany({
        where: { ownerId: id },
        include: revisionInclude,
        orderBy: { number: 'desc' },
        take: 26,
        skip: offsetOf(offset),
      });
      return { items: rows.slice(0, 25).map(revisionOf), more: rows.length > 25 };
    },

    async createCollection(input: EditorialWrite) {
      try {
        return await db().$transaction(async (tx) => {
          const id = randomUUID();
          await tx.collection.create({
            data: {
              id,
              slug: input.content.slug,
              creatorId: input.actorId,
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await tx.collectionSlugHistory.create({
            data: { ownerId: id, slug: input.content.slug },
          });
          await writeRevision(tx, id, 1, input);
          const row = await tx.collection.update({
            where: { id },
            data: { currentRevision: 1 },
            include: detailInclude,
          });
          await audit(tx, id, 'created', input.actorId, 1, {
            members: String(input.content.members?.length ?? 0),
          });
          return detailOf(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async reviseCollection(input: EditorialEdit) {
      try {
        return await db().$transaction(async (tx) => {
          const row = await locked(tx, input.id, input.expectedVersion);
          const number = (row.currentRevision ?? 0) + 1;
          const history = await tx.collectionSlugHistory.findUnique({
            where: { slug: input.content.slug },
            select: { ownerId: true },
          });
          if (history && history.ownerId !== row.id)
            throw new EditorialDataError('duplicate-slug');
          if (!history)
            await tx.collectionSlugHistory.create({
              data: { ownerId: row.id, slug: input.content.slug },
            });
          await writeRevision(tx, row.id, number, input);
          const next = await tx.collection.update({
            where: { id: row.id },
            data: {
              slug: input.content.slug,
              currentRevision: number,
              ...revisionReset(row),
            },
            include: detailInclude,
          });
          await audit(tx, row.id, 'revised', input.actorId, next.version);
          if (row.slug !== next.slug)
            await audit(tx, row.id, 'slug-changed', input.actorId, next.version);
          for (const change of collectionChanges(row.current, input.content))
            await audit(
              tx,
              row.id,
              change,
              input.actorId,
              next.version,
              change === 'members-changed' || change === 'members-reordered'
                ? { members: String(input.content.members?.length ?? 0) }
                : {},
            );
          return detailOf(next);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async transitionCollection(input: EditorialTransition) {
      try {
        return await db().$transaction(async (tx) => {
          const row = await locked(tx, input.id, input.expectedVersion);
          const next = await tx.collection.update({
            where: { id: row.id },
            data: transitionUpdate(row, input),
            include: detailInclude,
          });
          await audit(tx, row.id, input.action, input.actorId, next.version);
          return detailOf(next);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async dueCollections(now, limit) {
      return db().collection.findMany({
        where: {
          state: 'scheduled',
          scheduleStatus: 'pending',
          scheduledAt: { lte: now },
        },
        select: { id: true, version: true, approvedById: true, scheduledById: true },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: limitOf(limit),
      });
    },

    async failCollectionSchedule(id, expectedVersion, reason) {
      await db().$transaction(async (tx) => {
        const result = await tx.collection.updateMany({
          where: {
            id,
            version: expectedVersion,
            state: 'scheduled',
            scheduleStatus: 'pending',
          },
          data: {
            scheduleStatus: reason,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (result.count) await audit(tx, id, reason, null, expectedVersion + 1);
      });
    },
  };
}

/* ===========================================================================
 * Editorial's own member records — PUBLISHED ONLY
 * ========================================================================= */

/** The narrow view of a generated delegate: a bounded read, nothing else. */
interface MemberRecords {
  findMany(args: object): Promise<unknown[]>;
}

const narrow = (delegate: unknown): MemberRecords => delegate as MemberRecords;

/**
 * Editorial's own member types, each read from its own record table. Code-owned
 * and closed: a Work or a Video is not here, because Editorial never reads
 * Library's or Media's tables.
 */
const MEMBER_RECORDS: Readonly<
  Record<EditorialMemberKind, (c: Client) => MemberRecords>
> = Object.freeze({
  article: (c) => narrow(c.article),
  'news-article': (c) => narrow(c.newsArticle),
  'press-release': (c) => narrow(c.pressRelease),
  statement: (c) => narrow(c.statement),
  'media-coverage': (c) => narrow(c.mediaCoverage),
});

function recordsOf(kind: EditorialMemberKind): MemberRecords {
  const records = MEMBER_RECORDS[kind];
  if (records === undefined) throw new EditorialDataError('invalid');
  return records(db());
}

const TARGET_SELECT = {
  id: true,
  slug: true,
  current: {
    select: {
      translations: {
        select: { languageCode: true, title: true },
        orderBy: { languageCode: 'asc' as const },
      },
    },
  },
};

interface TargetRow {
  readonly id: string;
  readonly slug: string;
  readonly current: {
    readonly translations: readonly {
      readonly languageCode: string;
      readonly title: string;
    }[];
  } | null;
}

function targetOf(row: TargetRow): CollectionMemberTarget {
  return {
    id: row.id,
    slug: row.slug,
    titles:
      row.current?.translations.map((t) => ({
        languageCode: t.languageCode,
        title: t.title,
      })) ?? [],
  };
}

/** No more identifiers than one Collection can hold travel in one read. */
function memberBatchOf(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length > COLLECTION_LIMITS.members) throw new EditorialDataError('invalid');
  return unique;
}

/* ===========================================================================
 * Public reads — PUBLISHED ONLY, and the predicate is in every query
 * ========================================================================= */

export function collectionReads(): Pick<
  EditorialPublicReaderPort,
  | 'collectionCanonicalSlug'
  | 'publicCollection'
  | 'collections'
  | 'collectionSitemap'
  | 'memberTargets'
  | 'memberChoices'
> {
  return {
    async collectionCanonicalSlug(slug) {
      const row = await db().collectionSlugHistory.findUnique({
        where: { slug },
        select: { owner: { select: { slug: true, state: true } } },
      });
      return row?.owner.state === 'published' ? row.owner.slug : null;
    },

    async publicCollection(slug): Promise<PublicCollection | null> {
      const row = await db().collection.findFirst({
        where: { slug, state: 'published' },
        select: publicSelect,
      });
      if (row === null || row.current === null || row.publishedAt === null) return null;
      const current = row.current;
      return {
        slug: row.slug,
        primaryLanguage: language(current.primaryLanguage),
        translations: current.translations.map((t) => ({
          languageCode: language(t.languageCode),
          title: t.title,
          excerpt: t.excerpt,
          seoTitle: t.seoTitle,
          seoDescription: t.seoDescription,
          html: t.html,
        })),
        topicIds: current.topics.map((t) => t.topicId),
        contributors: current.contributors.map((c) => ({
          personId: c.personId,
          role: c.role,
        })),
        members: current.items.map(memberOf),
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
      };
    },

    async collections(query) {
      const take = limitOf(query.limit, COLLECTION_PAGE);
      const rows = await db().collection.findMany({
        where: {
          state: 'published',
          ...(query.topicId === null
            ? {}
            : { current: { is: { topics: { some: { topicId: query.topicId } } } } }),
        },
        select: summarySelect,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: offsetOf(query.offset),
        take: take + 1,
      });
      return { items: rows.slice(0, take).map(summaryOf), more: rows.length > take };
    },

    async collectionSitemap(offset, limit) {
      const rows = await db().collection.findMany({
        where: { state: 'published' },
        select: {
          id: true,
          slug: true,
          updatedAt: true,
          current: { select: { translations: { select: { languageCode: true } } } },
        },
        orderBy: { id: 'asc' },
        skip: offsetOf(offset),
        take: limitOf(limit, 5000),
      });
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        routeBinding: null,
        languages: row.current?.translations.map((t) => language(t.languageCode)) ?? [],
        updatedAt: row.updatedAt,
      }));
    },

    async memberTargets(kind, ids) {
      if (ids.length === 0) return [];
      const rows = (await recordsOf(kind).findMany({
        where: { id: { in: memberBatchOf(ids) }, state: 'published' },
        select: TARGET_SELECT,
        orderBy: { id: 'asc' },
      })) as TargetRow[];
      return rows.map(targetOf);
    },

    async memberChoices(kind, text, limit) {
      const rows = (await recordsOf(kind).findMany({
        where: {
          state: 'published',
          ...(text === null
            ? {}
            : {
                current: {
                  is: { translations: { some: { title: { contains: text } } } },
                },
              }),
        },
        select: TARGET_SELECT,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: limitOf(limit, COLLECTION_MEMBER_CHOICES),
      })) as TargetRow[];
      return rows.map(targetOf);
    },
  };
}
