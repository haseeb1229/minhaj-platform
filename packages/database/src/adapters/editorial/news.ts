import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  NEWS_KINDS,
  NEWS_PAGE,
  type ArticleDetail,
  type EditorialEdit,
  type EditorialLanguage,
  type EditorialPersistencePort,
  type EditorialPublicReaderPort,
  type EditorialQuery,
  type EditorialRevision,
  type EditorialSearchRecord,
  type EditorialState,
  type EditorialTransition,
  type EditorialWrite,
  type NewsKind,
  type NewsSummary,
  type PublicNews,
} from '@minhaj/contracts/editorial';
import type { ContributionRole } from '@minhaj/contracts/people';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
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
 * Editorial's Phase-13 persistence: NewsArticle, PressRelease, Statement and
 * MediaCoverage (DOMAIN_MODEL.md §7.1).
 *
 * FOUR FAMILIES OF TABLES, ONE IMPLEMENTATION OF EACH OPERATION. Each aggregate
 * has its own record, revision, translation, topic, contributor and slug tables
 * — the Article's shape — and the workflow over them is the Article's workflow,
 * through the same shared rules (`./workflow.ts`). Writing each operation four
 * times would be four places for "a stale approval cannot publish" to stop
 * being true, so each family is described ONCE by the delegates of its own
 * tables, and every operation below is written once over that description —
 * the pattern the Library's six scholarly aggregates established.
 *
 * WHAT DIFFERS IS DECLARED, NOT INFERRED. A Statement's translations carry an
 * issuer; a MediaCoverage revision carries its outlet, source address and
 * date. Nothing else distinguishes the families here.
 *
 * THE DESCRIPTION IS PRIVATE. Only the two operation sets leave this module,
 * each typed by Editorial's own ports, so no delegate, transaction handle or
 * client escapes (ARCHITECTURE.md §4.1, §6.3 rule 13). The delegates are
 * addressed through a deliberately narrow structural shape; the queries are
 * checked against the real schema by the live SQL proofs, which drive every
 * family through every operation.
 */

type Client = Prisma.TransactionClient;

interface TranslationRow {
  readonly languageCode: string;
  readonly title: string;
  readonly excerpt: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly document: string;
  readonly html: string;
  readonly issuer?: string;
}

interface RevisionRow {
  readonly number: number;
  readonly editorId: string;
  readonly createdAt: Date;
  readonly slug: string;
  readonly primaryLanguage: string;
  readonly outletName?: string;
  readonly sourceUrl?: string | null;
  readonly sourcePublishedOn?: Date | null;
  readonly centreId?: string | null;
  readonly translations: readonly TranslationRow[];
  readonly topics: readonly { readonly topicId: string }[];
  readonly contributors: readonly {
    readonly personId: string;
    readonly role: string;
    readonly position: number;
  }[];
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

/** The public projection of a record: published fields only, never an actor. */
interface PublicRow {
  readonly id: string;
  readonly slug: string;
  readonly version: number;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
  readonly current: {
    readonly primaryLanguage: string;
    readonly outletName?: string;
    readonly sourceUrl?: string | null;
    readonly sourcePublishedOn?: Date | null;
    readonly centreId?: string | null;
    readonly translations: readonly {
      readonly languageCode: string;
      readonly title: string;
      readonly excerpt: string;
      readonly seoTitle?: string;
      readonly seoDescription?: string;
      readonly html?: string;
      readonly document?: string;
      readonly issuer?: string;
    }[];
    readonly topics: readonly { readonly topicId: string }[];
    readonly contributors: readonly {
      readonly personId: string;
      readonly role: string;
    }[];
  } | null;
}

interface RecordDelegate {
  findUnique(args: object): Promise<RecordRow | null>;
  findUniqueOrThrow(args: object): Promise<RecordRow>;
  findFirst(args: object): Promise<PublicRow | null>;
  findMany(args: object): Promise<unknown[]>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<RecordRow>;
  updateMany(args: object): Promise<{ count: number }>;
}

interface RevisionDelegate {
  create(args: object): Promise<unknown>;
  findMany(args: object): Promise<RevisionRow[]>;
}

interface SlugDelegate {
  findUnique(args: object): Promise<{
    readonly ownerId: string;
    readonly owner: {
      readonly id: string;
      readonly slug: string;
      readonly state: string;
    };
  } | null>;
  create(args: object): Promise<unknown>;
}

interface Delegates {
  readonly record: RecordDelegate;
  readonly revision: RevisionDelegate;
  readonly slug: SlugDelegate;
}

/**
 * What a family's rows LOOK like — the pure facts the mappings need, and no
 * delegate. Every function that shapes a returned value takes this, never the
 * family itself, so no table capability can reach a result.
 */
interface Shape {
  readonly kind: NewsKind;
  /** Each translation names an issuing authority. */
  readonly issuer: boolean;
  /** The revision names an outlet, a source address and a source date. */
  readonly coverage: boolean;
  /** The revision may name one Global Network Centre (Phase 16). */
  readonly centre: boolean;
}

interface Family extends Shape {
  /** The record table, for the timeline's SQL. Code-owned, never input. */
  readonly table: Prisma.Sql;
  readonly topicTable: Prisma.Sql;
  readonly delegates: (client: Client) => Delegates;
}

/** The narrow view of a generated delegate. See the module comment. */
const narrow = <T>(delegate: unknown): T => delegate as T;

const FAMILIES: Readonly<Record<NewsKind, Family>> = {
  'news-article': {
    kind: 'news-article',
    table: Prisma.sql`[dbo].[NewsArticle]`,
    topicTable: Prisma.sql`[dbo].[NewsArticleTopic]`,
    issuer: false,
    coverage: false,
    centre: true,
    delegates: (c) => ({
      record: narrow(c.newsArticle),
      revision: narrow(c.newsArticleRevision),
      slug: narrow(c.newsArticleSlugHistory),
    }),
  },
  'press-release': {
    kind: 'press-release',
    table: Prisma.sql`[dbo].[PressRelease]`,
    topicTable: Prisma.sql`[dbo].[PressReleaseTopic]`,
    issuer: false,
    coverage: false,
    centre: false,
    delegates: (c) => ({
      record: narrow(c.pressRelease),
      revision: narrow(c.pressReleaseRevision),
      slug: narrow(c.pressReleaseSlugHistory),
    }),
  },
  statement: {
    kind: 'statement',
    table: Prisma.sql`[dbo].[Statement]`,
    topicTable: Prisma.sql`[dbo].[StatementTopic]`,
    issuer: true,
    coverage: false,
    centre: false,
    delegates: (c) => ({
      record: narrow(c.statement),
      revision: narrow(c.statementRevision),
      slug: narrow(c.statementSlugHistory),
    }),
  },
  'media-coverage': {
    kind: 'media-coverage',
    table: Prisma.sql`[dbo].[MediaCoverage]`,
    topicTable: Prisma.sql`[dbo].[MediaCoverageTopic]`,
    issuer: false,
    coverage: true,
    centre: false,
    delegates: (c) => ({
      record: narrow(c.mediaCoverage),
      revision: narrow(c.mediaCoverageRevision),
      slug: narrow(c.mediaCoverageSlugHistory),
    }),
  },
};

const familyOf = (kind: NewsKind): Family => {
  const family = FAMILIES[kind];
  if (family === undefined) throw new EditorialDataError('invalid');
  return family;
};

const db = () => getDatabaseClient();

/* ===========================================================================
 * Selections
 * ========================================================================= */

const revisionInclude = {
  translations: { orderBy: { languageCode: 'asc' as const } },
  topics: { orderBy: { topicId: 'asc' as const } },
  contributors: { orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }] },
};
const detailInclude = { current: { include: revisionInclude } };

const sourceSelect = (family: Family) =>
  family.coverage ? { outletName: true, sourceUrl: true, sourcePublishedOn: true } : {};
const issuerSelect = (family: Family) => (family.issuer ? { issuer: true } : {});
const centreSelect = (family: Family) => (family.centre ? { centreId: true } : {});

const publicSelect = (family: Family) => ({
  id: true,
  slug: true,
  version: true,
  publishedAt: true,
  updatedAt: true,
  current: {
    select: {
      primaryLanguage: true,
      ...sourceSelect(family),
      ...centreSelect(family),
      translations: {
        select: {
          languageCode: true,
          title: true,
          excerpt: true,
          seoTitle: true,
          seoDescription: true,
          html: true,
          ...issuerSelect(family),
        },
        orderBy: { languageCode: 'asc' as const },
      },
      topics: { select: { topicId: true }, orderBy: { topicId: 'asc' as const } },
      contributors: {
        select: { personId: true, role: true },
        orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }],
      },
    },
  },
});

/** What a card needs: never the body, never the authoring document. */
const summarySelect = (family: Family) => ({
  id: true,
  slug: true,
  version: true,
  publishedAt: true,
  updatedAt: true,
  current: {
    select: {
      primaryLanguage: true,
      ...(family.coverage ? { outletName: true, sourcePublishedOn: true } : {}),
      translations: {
        select: {
          languageCode: true,
          title: true,
          excerpt: true,
          ...issuerSelect(family),
        },
        orderBy: { languageCode: 'asc' as const },
      },
      topics: { select: { topicId: true }, orderBy: { topicId: 'asc' as const } },
      contributors: {
        select: { personId: true, role: true },
        orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }],
      },
    },
  },
});

const privateSummarySelect = {
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
} as const;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

function language(code: string): EditorialLanguage {
  return code as EditorialLanguage;
}
/** A `date` column as the calendar date it holds, never shifted by a zone. */
function dateOnly(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString().slice(0, 10);
}

function revisionOf(family: Shape, row: RevisionRow): EditorialRevision {
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
      ...(family.issuer ? { issuer: t.issuer ?? '' } : {}),
    })),
    topicIds: row.topics.map((t) => t.topicId),
    contributors: row.contributors.map((c) => ({
      personId: c.personId,
      role: c.role as ContributionRole,
    })),
    ...(family.coverage
      ? {
          coverage: {
            outlet: row.outletName ?? '',
            sourceUrl: row.sourceUrl ?? null,
            sourceDate: dateOnly(row.sourcePublishedOn),
          },
        }
      : {}),
    ...(family.centre ? { centreId: row.centreId ?? null } : {}),
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

function detailOf(family: Shape, row: RecordRow): ArticleDetail {
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
    revision: revisionOf(family, row.current),
  };
}

function publicOf(family: Shape, row: PublicRow): PublicNews {
  if (!row.current || !row.publishedAt) throw new EditorialDataError('unavailable');
  return {
    kind: family.kind,
    slug: row.slug,
    primaryLanguage: language(row.current.primaryLanguage),
    translations: row.current.translations.map((t) => ({
      languageCode: language(t.languageCode),
      title: t.title,
      excerpt: t.excerpt,
      seoTitle: t.seoTitle ?? '',
      seoDescription: t.seoDescription ?? '',
      html: t.html ?? '',
      ...(family.issuer ? { issuer: t.issuer ?? '' } : {}),
    })),
    topicIds: row.current.topics.map((t) => t.topicId),
    contributors: row.current.contributors.map((c) => ({
      personId: c.personId,
      role: c.role,
    })),
    coverage: family.coverage
      ? {
          outlet: row.current.outletName ?? '',
          sourceUrl: row.current.sourceUrl ?? null,
          sourceDate: dateOnly(row.current.sourcePublishedOn),
        }
      : null,
    centreId: family.centre ? (row.current.centreId ?? null) : null,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

function summaryOf(family: Shape, row: PublicRow): NewsSummary {
  if (!row.current || !row.publishedAt) throw new EditorialDataError('unavailable');
  return {
    kind: family.kind,
    slug: row.slug,
    primaryLanguage: language(row.current.primaryLanguage),
    translations: row.current.translations.map((t) => ({
      languageCode: language(t.languageCode),
      title: t.title,
      excerpt: t.excerpt,
      ...(family.issuer ? { issuer: t.issuer ?? '' } : {}),
    })),
    publishedAt: row.publishedAt,
    topicIds: row.current.topics.map((t) => t.topicId),
    contributors: row.current.contributors.map((c) => ({
      personId: c.personId,
      role: c.role,
    })),
    coverage: family.coverage
      ? {
          outlet: row.current.outletName ?? '',
          sourceDate: dateOnly(row.current.sourcePublishedOn),
        }
      : null,
  };
}

/* ===========================================================================
 * Writes
 * ========================================================================= */

async function writeRevision(
  tx: Client,
  family: Family,
  id: string,
  number: number,
  input: EditorialWrite,
): Promise<void> {
  const content = input.content;
  const coverage = content.coverage;
  if (family.coverage !== (coverage !== undefined))
    throw new EditorialDataError('invalid');
  if (
    family.issuer
      ? content.translations.some((t) => !t.issuer)
      : content.translations.some((t) => t.issuer !== undefined)
  )
    throw new EditorialDataError('invalid');
  // Only a NewsArticle has a place for a Centre; any other family naming one is
  // refused rather than silently dropped.
  if (!family.centre && content.centreId !== undefined && content.centreId !== null)
    throw new EditorialDataError('invalid');
  // Every column is named: nothing the caller supplied reaches the table unless
  // this family genuinely has a place for it.
  await family.delegates(tx).revision.create({
    data: {
      ownerId: id,
      number,
      editorId: input.actorId,
      slug: content.slug,
      primaryLanguage: content.primaryLanguage,
      ...(coverage === undefined
        ? {}
        : {
            outletName: coverage.outlet,
            sourceUrl: coverage.sourceUrl,
            sourcePublishedOn:
              coverage.sourceDate === null
                ? null
                : new Date(`${coverage.sourceDate}T00:00:00.000Z`),
          }),
      ...(family.centre ? { centreId: content.centreId ?? null } : {}),
      translations: {
        create: content.translations.map((t) => ({
          languageCode: t.languageCode,
          title: t.title,
          excerpt: t.excerpt,
          seoTitle: t.seoTitle,
          seoDescription: t.seoDescription,
          document: t.document,
          html: t.html,
          ...(family.issuer ? { issuer: t.issuer } : {}),
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
    },
  });
}

/**
 * An audit row: WHICH workflow facts changed, never the text. No title, body,
 * authoring document, issuer or source address is copied into the audit log
 * (SECURITY_BASELINE.md §13.4); the revision number names what was written.
 */
async function audit(
  tx: Client,
  family: Family,
  id: string,
  action: string,
  actorId: string | null,
  version: number,
): Promise<void> {
  const snapshot = await family.delegates(tx).record.findUniqueOrThrow({
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
      action: `editorial.${family.kind}.${action}`,
      targetType: family.kind,
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
      },
      authorisingSource: authorisingSource(action, actorId),
    }),
  });
}

/** Claims the row at its expected version, or refuses as a conflict. */
async function locked(
  tx: Client,
  family: Family,
  id: string,
  version: number,
): Promise<RecordRow> {
  const records = family.delegates(tx).record;
  const claim = await records.updateMany({
    where: { id, version },
    data: { version: { increment: 1 } },
  });
  if (claim.count !== 1) throw new EditorialDataError('conflict');
  return records.findUniqueOrThrow({ where: { id }, include: detailInclude });
}

/**
 * Did this revision change a NewsArticle's Centre? Audited as its own event —
 * the action names the fact; no Centre name or address enters the audit row.
 */
function centreChange(
  family: Family,
  before: RevisionRow | null,
  after: EditorialWrite['content'],
): boolean {
  return (
    family.centre &&
    before !== null &&
    (before.centreId ?? null) !== (after.centreId ?? null)
  );
}

/** Did this revision change a Statement's issuers or a MediaCoverage's source? */
function metadataChange(
  family: Family,
  before: RevisionRow | null,
  after: EditorialWrite['content'],
): 'issuer-changed' | 'source-changed' | null {
  if (before === null) return null;
  if (family.issuer) {
    const previous = new Map(before.translations.map((t) => [t.languageCode, t.issuer]));
    const changed =
      previous.size !== after.translations.length ||
      after.translations.some((t) => previous.get(t.languageCode) !== t.issuer);
    return changed ? 'issuer-changed' : null;
  }
  if (family.coverage && after.coverage !== undefined) {
    const changed =
      before.outletName !== after.coverage.outlet ||
      (before.sourceUrl ?? null) !== after.coverage.sourceUrl ||
      dateOnly(before.sourcePublishedOn) !== after.coverage.sourceDate;
    return changed ? 'source-changed' : null;
  }
  return null;
}

export function newsOperations(): Pick<
  EditorialPersistencePort,
  | 'news'
  | 'newsDirectory'
  | 'newsRevisions'
  | 'createNews'
  | 'reviseNews'
  | 'transitionNews'
  | 'dueNews'
  | 'failNewsSchedule'
> {
  return {
    async news(kind, id) {
      const family = familyOf(kind);
      const row = await family.delegates(db()).record.findUnique({
        where: { id },
        include: detailInclude,
      });
      return row ? detailOf(family, row) : null;
    },

    async newsDirectory(kind, query: EditorialQuery) {
      const family = familyOf(kind);
      const limit = limitOf(query.limit);
      const rows = (await family.delegates(db()).record.findMany({
        where: query.state ? { state: query.state } : {},
        select: privateSummarySelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        skip: offsetOf(query.offset),
      })) as {
        id: string;
        slug: string;
        state: string;
        version: number;
        currentRevision: number | null;
        updatedAt: Date;
        scheduledAt: Date | null;
        scheduleStatus: string | null;
        current: {
          primaryLanguage: string;
          translations: { languageCode: string; title: string }[];
        } | null;
      }[];
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

    async newsRevisions(kind, id, offset) {
      const family = familyOf(kind);
      const rows = await family.delegates(db()).revision.findMany({
        where: { ownerId: id },
        include: revisionInclude,
        orderBy: { number: 'desc' },
        take: 26,
        skip: offsetOf(offset),
      });
      return {
        items: rows.slice(0, 25).map((row) => revisionOf(family, row)),
        more: rows.length > 25,
      };
    },

    async createNews(kind, input: EditorialWrite) {
      const family = familyOf(kind);
      try {
        return await db().$transaction(async (tx) => {
          const delegates = family.delegates(tx);
          const id = randomUUID();
          await delegates.record.create({
            data: {
              id,
              slug: input.content.slug,
              creatorId: input.actorId,
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await delegates.slug.create({
            data: { ownerId: id, slug: input.content.slug },
          });
          await writeRevision(tx, family, id, 1, input);
          const row = await delegates.record.update({
            where: { id },
            data: { currentRevision: 1 },
            include: detailInclude,
          });
          await audit(tx, family, id, 'created', input.actorId, 1);
          return detailOf(family, row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async reviseNews(kind, input: EditorialEdit) {
      const family = familyOf(kind);
      try {
        return await db().$transaction(async (tx) => {
          const delegates = family.delegates(tx);
          const row = await locked(tx, family, input.id, input.expectedVersion);
          const number = (row.currentRevision ?? 0) + 1;
          const history = await delegates.slug.findUnique({
            where: { slug: input.content.slug },
            select: {
              ownerId: true,
              owner: { select: { id: true, slug: true, state: true } },
            },
          });
          if (history && history.ownerId !== row.id)
            throw new EditorialDataError('duplicate-slug');
          if (!history)
            await delegates.slug.create({
              data: { ownerId: row.id, slug: input.content.slug },
            });
          await writeRevision(tx, family, row.id, number, input);
          const next = await delegates.record.update({
            where: { id: row.id },
            data: {
              slug: input.content.slug,
              currentRevision: number,
              ...revisionReset(row),
            },
            include: detailInclude,
          });
          // A revision takes a published record back to draft, so the public
          // projection is owed a re-projection in this same transaction.
          await requestSearchIndexing(tx, family.kind, row.id);
          await audit(tx, family, row.id, 'revised', input.actorId, next.version);
          if (row.slug !== next.slug)
            await audit(tx, family, row.id, 'slug-changed', input.actorId, next.version);
          const change = metadataChange(family, row.current, input.content);
          if (change !== null)
            await audit(tx, family, row.id, change, input.actorId, next.version);
          if (centreChange(family, row.current, input.content))
            await audit(
              tx,
              family,
              row.id,
              'centre-changed',
              input.actorId,
              next.version,
            );
          return detailOf(family, next);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async transitionNews(kind, input: EditorialTransition) {
      const family = familyOf(kind);
      try {
        return await db().$transaction(async (tx) => {
          const row = await locked(tx, family, input.id, input.expectedVersion);
          const next = await family.delegates(tx).record.update({
            where: { id: row.id },
            data: transitionUpdate(row, input),
            include: detailInclude,
          });
          await requestSearchIndexing(tx, family.kind, row.id);
          await audit(tx, family, row.id, input.action, input.actorId, next.version);
          return detailOf(family, next);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async dueNews(kind, now, limit) {
      const family = familyOf(kind);
      return (await family.delegates(db()).record.findMany({
        where: {
          state: 'scheduled',
          scheduleStatus: 'pending',
          scheduledAt: { lte: now },
        },
        select: { id: true, version: true, approvedById: true, scheduledById: true },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: limitOf(limit),
      })) as {
        id: string;
        version: number;
        approvedById: string | null;
        scheduledById: string | null;
      }[];
    },

    async failNewsSchedule(kind, id, expectedVersion, reason) {
      const family = familyOf(kind);
      await db().$transaction(async (tx) => {
        const result = await family.delegates(tx).record.updateMany({
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
        if (result.count) await audit(tx, family, id, reason, null, expectedVersion + 1);
      });
    },
  };
}

/* ===========================================================================
 * Public reads — PUBLISHED ONLY, and the predicate is in every query
 * ========================================================================= */

/** Identifier batches for visibility rechecks and enumeration stay small. */
const batchOf = (ids: readonly string[]) => {
  if (ids.length > 500) throw new Error('News batch exceeds its bound.');
  return [...ids];
};

/** The four families as one relation of (kind, id, publishedAt), filtered. */
function timelineRows(filter: {
  readonly from: Date | null;
  readonly to: Date | null;
  readonly topicId: string | null;
}): Prisma.Sql {
  return Prisma.join(
    NEWS_KINDS.map((kind) => {
      const family = FAMILIES[kind];
      const conditions = [Prisma.sql`r.[state] = N'published'`];
      if (filter.from !== null)
        conditions.push(Prisma.sql`r.[publishedAt] >= ${filter.from}`);
      if (filter.to !== null) conditions.push(Prisma.sql`r.[publishedAt] < ${filter.to}`);
      if (filter.topicId !== null)
        conditions.push(
          Prisma.sql`EXISTS (SELECT 1 FROM ${family.topicTable} t WHERE t.[ownerId] = r.[id] AND t.[revisionNumber] = r.[currentRevision] AND t.[topicId] = ${filter.topicId})`,
        );
      return Prisma.sql`SELECT CAST(${kind} AS NVARCHAR(16)) AS [kind], r.[id], r.[publishedAt] FROM ${family.table} r WHERE ${Prisma.join(conditions, ' AND ')}`;
    }),
    ' UNION ALL ',
  );
}

/** Reads the cards for a mixed set of (kind, id), in the given order. */
async function cardsFor(
  refs: readonly { readonly kind: NewsKind; readonly id: string }[],
): Promise<NewsSummary[]> {
  const byKind = new Map<NewsKind, string[]>();
  for (const ref of refs) byKind.set(ref.kind, [...(byKind.get(ref.kind) ?? []), ref.id]);
  const cards = new Map<string, NewsSummary>();
  await Promise.all(
    [...byKind].map(async ([kind, ids]) => {
      const family = FAMILIES[kind];
      const rows = (await family.delegates(db()).record.findMany({
        where: { id: { in: batchOf(ids) }, state: 'published' },
        select: summarySelect(family),
      })) as PublicRow[];
      for (const row of rows) cards.set(`${kind}:${row.id}`, summaryOf(family, row));
    }),
  );
  // A record withdrawn between the two reads is simply absent, never shown.
  return refs.flatMap((ref) => cards.get(`${ref.kind}:${ref.id}`) ?? []);
}

export function newsReads(): Pick<
  EditorialPublicReaderPort,
  | 'newsCanonicalSlug'
  | 'publicNews'
  | 'publishedNews'
  | 'newsTimeline'
  | 'newsArchivePeriods'
  | 'newsSitemap'
  | 'searchNews'
  | 'searchNewsList'
  | 'publishedNewsTargets'
  | 'centreNews'
> {
  return {
    async newsCanonicalSlug(kind, slug) {
      const row = await familyOf(kind)
        .delegates(db())
        .slug.findUnique({
          where: { slug },
          select: {
            ownerId: true,
            owner: { select: { id: true, slug: true, state: true } },
          },
        });
      return row?.owner.state === 'published' ? row.owner.slug : null;
    },

    async publicNews(kind, slug) {
      const family = familyOf(kind);
      const delegates = family.delegates(db());
      const history = await delegates.slug.findUnique({
        where: { slug },
        select: {
          ownerId: true,
          owner: { select: { id: true, slug: true, state: true } },
        },
      });
      if (!history || history.owner.state !== 'published') return null;
      const row = await delegates.record.findFirst({
        where: { id: history.owner.id, state: 'published' },
        select: publicSelect(family),
      });
      return row ? publicOf(family, row) : null;
    },

    async publishedNews(kind, offset, limit) {
      const family = familyOf(kind);
      const take = limitOf(limit, NEWS_PAGE);
      const rows = (await family.delegates(db()).record.findMany({
        where: { state: 'published' },
        select: summarySelect(family),
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: offsetOf(offset),
        take: take + 1,
      })) as PublicRow[];
      return {
        items: rows.slice(0, take).map((row) => summaryOf(family, row)),
        more: rows.length > take,
      };
    },

    async newsTimeline(query) {
      const take = limitOf(query.limit, NEWS_PAGE);
      const from =
        query.year === null
          ? null
          : new Date(Date.UTC(query.year, (query.month ?? 1) - 1, 1));
      const to =
        query.year === null
          ? null
          : query.month === null
            ? new Date(Date.UTC(query.year + 1, 0, 1))
            : new Date(Date.UTC(query.year, query.month, 1));
      const refs = await db().$queryRaw<
        { kind: string; id: string; publishedAt: Date }[]
      >`SELECT [kind], [id], [publishedAt] FROM (${timelineRows({ from, to, topicId: query.topicId })}) AS [timeline]
        ORDER BY [publishedAt] DESC, [kind] ASC, [id] ASC
        OFFSET ${offsetOf(query.offset)} ROWS FETCH NEXT ${take + 1} ROWS ONLY`;
      const cards = await cardsFor(
        refs.slice(0, take).map((ref) => ({ kind: ref.kind as NewsKind, id: ref.id })),
      );
      return { items: cards, more: refs.length > take };
    },

    async newsArchivePeriods() {
      const rows = await db().$queryRaw<{ year: number; month: number; count: number }[]>`
        SELECT TOP (1200) YEAR([publishedAt]) AS [year], MONTH([publishedAt]) AS [month], COUNT_BIG(*) AS [count]
        FROM (${timelineRows({ from: null, to: null, topicId: null })}) AS [timeline]
        GROUP BY YEAR([publishedAt]), MONTH([publishedAt])
        ORDER BY [year] DESC, [month] ASC`;
      return rows.map((row) => ({
        year: Number(row.year),
        month: Number(row.month),
        count: Number(row.count),
      }));
    },

    async newsSitemap(kind, offset, limit) {
      const family = familyOf(kind);
      const rows = (await family.delegates(db()).record.findMany({
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
      })) as {
        id: string;
        slug: string;
        updatedAt: Date;
        current: { translations: { languageCode: string }[] } | null;
      }[];
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        routeBinding: null,
        languages: row.current?.translations.map((t) => language(t.languageCode)) ?? [],
        updatedAt: row.updatedAt,
      }));
    },

    async searchNews(kind, id): Promise<EditorialSearchRecord | null> {
      const family = familyOf(kind);
      const row = await family.delegates(db()).record.findFirst({
        where: { id, state: 'published' },
        select: {
          id: true,
          version: true,
          publishedAt: true,
          current: {
            select: {
              ...(family.coverage ? { outletName: true } : {}),
              translations: {
                select: {
                  languageCode: true,
                  title: true,
                  excerpt: true,
                  document: true,
                  ...issuerSelect(family),
                },
                orderBy: { languageCode: 'asc' as const },
              },
              topics: { select: { topicId: true }, orderBy: { topicId: 'asc' as const } },
            },
          },
        },
      });
      if (row === null || row.current === null || row.publishedAt === null) return null;
      return {
        id: row.id,
        stamp: String(row.version),
        publishedAt: row.publishedAt,
        topicIds: row.current.topics.map((t) => t.topicId),
        translations: row.current.translations.map((t) => ({
          languageCode: t.languageCode,
          title: t.title,
          excerpt: t.excerpt,
          document: t.document ?? '',
          ...(family.issuer ? { issuer: t.issuer ?? '' } : {}),
        })),
        ...(family.coverage ? { outlet: row.current.outletName ?? '' } : {}),
      };
    },

    async searchNewsList(kind, { after, limit }) {
      const rows = (await familyOf(kind)
        .delegates(db())
        .record.findMany({
          where: { state: 'published', ...(after === null ? {} : { id: { gt: after } }) },
          select: { id: true, version: true },
          orderBy: { id: 'asc' },
          take: limitOf(limit, 500),
        })) as { id: string; version: number }[];
      return rows.map((row) => ({ id: row.id, stamp: String(row.version) }));
    },

    /**
     * NewsArticle only, and only while PUBLISHED: a record revised back to draft
     * — including one whose Centre is being changed — leaves this list until it
     * is published again. The Centre is matched as an identifier; no Global
     * table is joined or read.
     */
    async centreNews(centreId, offset, limit) {
      const family = FAMILIES['news-article'];
      const take = limitOf(limit, NEWS_PAGE);
      const rows = (await family.delegates(db()).record.findMany({
        where: { state: 'published', current: { is: { centreId } } },
        select: summarySelect(family),
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: offsetOf(offset),
        take: take + 1,
      })) as PublicRow[];
      return {
        items: rows.slice(0, take).map((row) => summaryOf(family, row)),
        more: rows.length > take,
      };
    },

    async publishedNewsTargets(kind, ids) {
      if (ids.length === 0) return [];
      return (await familyOf(kind)
        .delegates(db())
        .record.findMany({
          where: { id: { in: batchOf(ids) }, state: 'published' },
          select: { id: true, slug: true },
          orderBy: { id: 'asc' },
        })) as { id: string; slug: string }[];
    },
  };
}
