import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type {
  ArticleDetail,
  PublicEditorialSummary,
  PageDetail,
  EditorialPersistencePort,
  EditorialPublicReaderPort,
  EditorialRevision,
  EditorialState,
  EditorialLanguage,
  EditorialSummary,
  EditorialWrite,
  EditorialEdit,
  EditorialTransition,
  EditorialQuery,
  EditorialSearchRecord,
  PublicEditorial,
  PublicPage,
} from '@minhaj/contracts/editorial';
import type { ContributionRole } from '@minhaj/contracts/people';
import { getDatabaseClient } from '../../client.ts';
import { auditRow } from '../../audit-row.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
import { eventOperations, eventReads } from './event.ts';
import { collectionOperations, collectionReads } from './collection.ts';
import { newsOperations, newsReads } from './news.ts';
import {
  EditorialDataError,
  authorisingSource,
  limitOf,
  offsetOf,
  refuse,
  chronologyUpdate,
  revisionReset,
  transitionUpdate,
} from './workflow.ts';
import {
  dateOnly,
  leadColumnsOf,
  leadImageNamed,
  leadImageOf,
  leadTranslationRows,
  publicLeadOf,
  type LeadColumns,
} from './lead.ts';
const revisionInclude = {
  translations: { orderBy: { languageCode: 'asc' as const } },
  topics: { orderBy: { topicId: 'asc' as const } },
  contributors: { orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }] },
};
const detailInclude = { current: { include: revisionInclude } };
/** Phase 30-R: the lead-image columns every lead family's revision carries. */
const leadSelect = {
  leadAssetId: true,
  leadWidth: true,
  leadHeight: true,
  leadCredit: true,
} as const;
const publicSelect = {
  id: true,
  slug: true,
  publishedAt: true,
  updatedAt: true,
  current: {
    select: {
      primaryLanguage: true,
      ...leadSelect,
      translations: {
        select: {
          languageCode: true,
          title: true,
          excerpt: true,
          seoTitle: true,
          seoDescription: true,
          html: true,
          leadAlt: true,
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
} satisfies Prisma.ArticleSelect;
/** An Article's public read also carries its chronology and source date (Phase 30-R). */
const articlePublicSelect = {
  ...publicSelect,
  chronologyAt: true,
  current: {
    select: { ...publicSelect.current.select, sourcePublishedOn: true },
  },
} satisfies Prisma.ArticleSelect;
interface PublicRow {
  id: string;
  slug: string;
  publishedAt: Date | null;
  chronologyAt?: Date | null;
  updatedAt: Date;
  current:
    | (LeadColumns & {
        primaryLanguage: string;
        sourcePublishedOn?: Date | null;
        translations: {
          languageCode: string;
          title: string;
          excerpt: string;
          seoTitle: string;
          seoDescription: string;
          html: string;
          leadAlt: string;
        }[];
        topics: { topicId: string }[];
        contributors: { personId: string; role: string }[];
      })
    | null;
}
const listingSelect = {
  slug: true,
  current: {
    select: {
      primaryLanguage: true,
      translations: {
        select: { languageCode: true, title: true, excerpt: true },
        orderBy: { languageCode: 'asc' as const },
      },
    },
  },
} as const;
function publicSummary(row: {
  slug: string;
  current: {
    primaryLanguage: string;
    translations: { languageCode: string; title: string; excerpt: string }[];
  } | null;
}): PublicEditorialSummary {
  if (!row.current) throw new EditorialDataError('unavailable');
  return {
    slug: row.slug,
    primaryLanguage: row.current.primaryLanguage as EditorialLanguage,
    translations: row.current.translations.map((t) => ({
      ...t,
      languageCode: t.languageCode as EditorialLanguage,
    })),
  };
}
/**
 * An Article card (Phase 30-R): its words, its reader-facing date and its lead
 * image with each translation's alt text. Never the body.
 */
const articleListingSelect = {
  id: true,
  slug: true,
  chronologyAt: true,
  current: {
    select: {
      primaryLanguage: true,
      ...leadSelect,
      translations: {
        select: { languageCode: true, title: true, excerpt: true, leadAlt: true },
        orderBy: { languageCode: 'asc' as const },
      },
    },
  },
} as const;
function articleSummary(row: {
  id: string;
  slug: string;
  chronologyAt: Date | null;
  current:
    | (LeadColumns & {
        primaryLanguage: string;
        translations: {
          languageCode: string;
          title: string;
          excerpt: string;
          leadAlt: string;
        }[];
      })
    | null;
}): PublicEditorialSummary {
  if (!row.current || !row.chronologyAt) throw new EditorialDataError('unavailable');
  return {
    ...publicSummary(row),
    chronologyAt: row.chronologyAt,
    leadImage: publicLeadOf('article', row.id, row.current),
  };
}
const summarySelect = {
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
function privateSummary(row: {
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
}): EditorialSummary {
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
    title:
      row.current.translations.find(
        (t) => t.languageCode === row.current?.primaryLanguage,
      )?.title ?? row.slug,
  };
}
async function audit(
  tx: Prisma.TransactionClient,
  kind: string,
  id: string,
  action: string,
  actorId: string | null,
  version: number,
) {
  const select = {
    state: true,
    currentRevision: true,
    approvedRevision: true,
    scheduledRevision: true,
    scheduledAt: true,
    scheduleStatus: true,
  } as const;
  const snapshot =
    kind === 'article'
      ? await tx.article.findUniqueOrThrow({ where: { id }, select })
      : await tx.page.findUniqueOrThrow({ where: { id }, select });
  await tx.auditLog.create({
    data: auditRow({
      actorType: actorId === null ? 'system' : 'user',
      actorId,
      action: 'editorial.' + kind + '.' + action,
      targetType: kind,
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

interface RevisionRow extends LeadColumns {
  number: number;
  editorId: string;
  createdAt: Date;
  slug: string;
  primaryLanguage: string;
  /** An Article revision's source date (Phase 30-R); a Page records none. */
  sourcePublishedOn?: Date | null;
  translations: {
    languageCode: string;
    title: string;
    excerpt: string;
    seoTitle: string;
    seoDescription: string;
    document: string;
    html: string;
    leadAlt: string;
  }[];
  topics: { topicId: string }[];
  contributors: { personId: string; role: string; position: number }[];
}
interface ArticleRow {
  id: string;
  slug: string;
  state: string;
  version: number;
  currentRevision: number | null;
  creatorId: string;
  approvedRevision: number | null;
  approvedById: string | null;
  scheduledRevision: number | null;
  scheduledById: string | null;
  scheduledAt: Date | null;
  scheduleStatus: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  current: RevisionRow | null;
}
function articleRevision(row: NonNullable<ArticleRow['current']>): EditorialRevision {
  return {
    number: row.number,
    editorId: row.editorId,
    createdAt: row.createdAt,
    slug: row.slug,
    primaryLanguage: row.primaryLanguage as EditorialLanguage,
    translations: row.translations.map((t) => ({
      languageCode: t.languageCode as EditorialLanguage,
      title: t.title,
      excerpt: t.excerpt,
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      document: t.document,
      html: t.html,
      leadAlt: t.leadAlt,
    })),
    topicIds: row.topics.map((t) => t.topicId),
    contributors: row.contributors.map((c) => ({
      personId: c.personId,
      role: c.role as ContributionRole,
    })),
    leadImage: leadImageOf(row),
    sourcePublishedOn: dateOnly(row.sourcePublishedOn),
  };
}
function articleDetail(row: ArticleRow): ArticleDetail {
  if (!row.current || row.currentRevision === null)
    throw new EditorialDataError('unavailable');
  return {
    id: row.id,
    slug: row.slug,
    state: row.state as EditorialState,
    version: row.version,
    currentRevision: row.currentRevision,
    title:
      row.current.translations.find(
        (t) => t.languageCode === row.current?.primaryLanguage,
      )?.title ?? row.slug,
    creatorId: row.creatorId,
    approvedRevision: row.approvedRevision,
    approvedById: row.approvedById,
    scheduledRevision: row.scheduledRevision,
    scheduledById: row.scheduledById,
    scheduledAt: row.scheduledAt,
    scheduleStatus: row.scheduleStatus,
    updatedAt: row.updatedAt,
    revision: articleRevision(row.current),
  };
}
function articlePublic(row: PublicRow): PublicEditorial {
  if (!row.current || !row.publishedAt) throw new EditorialDataError('unavailable');
  return {
    slug: row.slug,
    primaryLanguage: row.current.primaryLanguage as EditorialLanguage,
    translations: row.current.translations.map((t) => ({
      languageCode: t.languageCode as EditorialLanguage,
      title: t.title,
      excerpt: t.excerpt,
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      html: t.html,
      leadAlt: t.leadAlt,
    })),
    chronologyAt: row.chronologyAt ?? row.publishedAt,
    sourcePublishedOn: dateOnly(row.current.sourcePublishedOn),
    leadImage: publicLeadOf('article', row.id, row.current),
    topicIds: row.current.topics.map((t) => t.topicId),
    contributors: row.current.contributors.map((c) => ({
      personId: c.personId,
      role: c.role,
    })),
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}
async function writeArticleRevision(
  tx: Prisma.TransactionClient,
  id: string,
  number: number,
  input: EditorialWrite,
) {
  await tx.articleRevision.create({
    data: {
      ownerId: id,
      number,
      editorId: input.actorId,
      slug: input.content.slug,
      primaryLanguage: input.content.primaryLanguage,
      ...leadColumnsOf(input.content, { lead: true, dated: true }),
      translations: { create: leadTranslationRows(input.content.translations) },
      topics: { create: input.content.topicIds.map((topicId) => ({ topicId })) },
      contributors: {
        create: input.content.contributors.map((c, position) => ({ ...c, position })),
      },
    },
  });
}
async function articleLocked(
  tx: Prisma.TransactionClient,
  id: string,
  version: number,
): Promise<ArticleRow> {
  const claim = await tx.article.updateMany({
    where: { id, version },
    data: { version: { increment: 1 } },
  });
  if (claim.count !== 1) throw new EditorialDataError('conflict');
  const row = await tx.article.findUniqueOrThrow({
    where: { id },
    include: detailInclude,
  });
  return row;
}
function articleOperations(): Pick<
  EditorialPersistencePort,
  | 'article'
  | 'articles'
  | 'articleRevisions'
  | 'createArticle'
  | 'reviseArticle'
  | 'transitionArticle'
  | 'dueArticles'
  | 'failArticleSchedule'
> {
  return {
    async article(id: string) {
      const row = await getDatabaseClient().article.findUnique({
        where: { id },
        include: detailInclude,
      });
      return row ? articleDetail(row) : null;
    },
    async articles(query: EditorialQuery) {
      const limit = limitOf(query.limit);
      const rows = await getDatabaseClient().article.findMany({
        where: query.state ? { state: query.state } : {},
        select: summarySelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        skip: offsetOf(query.offset),
      });
      return {
        items: rows.slice(0, limit).map(privateSummary),
        more: rows.length > limit,
      };
    },
    async articleRevisions(id: string, offset: number) {
      const rows = await getDatabaseClient().articleRevision.findMany({
        where: { ownerId: id },
        include: revisionInclude,
        orderBy: { number: 'desc' },
        take: 26,
        skip: offsetOf(offset),
      });
      return { items: rows.slice(0, 25).map(articleRevision), more: rows.length > 25 };
    },
    async createArticle(input: EditorialWrite) {
      try {
        return await getDatabaseClient().$transaction(async (tx) => {
          const id = randomUUID();
          const now = new Date();
          await tx.article.create({
            data: {
              id,
              slug: input.content.slug,
              creatorId: input.actorId,
              state: 'draft',
              version: 1,
              updatedAt: now,
            },
          });
          await tx.articleSlugHistory.create({
            data: { ownerId: id, slug: input.content.slug },
          });
          await writeArticleRevision(tx, id, 1, input);
          return articleDetail(
            await tx.article
              .update({
                where: { id },
                data: { currentRevision: 1 },
                include: detailInclude,
              })
              .then(async (row) => {
                await audit(tx, 'article', id, 'created', input.actorId, 1);
                return row;
              }),
          );
        });
      } catch (error) {
        refuse(error);
      }
    },
    async reviseArticle(input: EditorialEdit) {
      try {
        return await getDatabaseClient().$transaction(async (tx) => {
          const row = await articleLocked(tx, input.id, input.expectedVersion);
          const number = (row.currentRevision ?? 0) + 1;
          const history = await tx.articleSlugHistory.findUnique({
            where: { slug: input.content.slug },
          });
          if (history && history.ownerId !== row.id)
            throw new EditorialDataError('duplicate-slug');
          if (!history)
            await tx.articleSlugHistory.create({
              data: { ownerId: row.id, slug: input.content.slug },
            });
          await writeArticleRevision(tx, row.id, number, input);
          const next = await tx.article.update({
            where: { id: row.id },
            data: {
              slug: input.content.slug,
              currentRevision: number,
              ...revisionReset(row),
            },
            include: detailInclude,
          });
          // A revision takes a published article back to draft and a transition may
          // publish or archive it, so both owe a re-projection (ARCHITECTURE.md §8.5).
          await requestSearchIndexing(tx, 'article', row.id);
          await audit(tx, 'article', row.id, 'revised', input.actorId, next.version);
          if (row.slug !== next.slug)
            await audit(
              tx,
              'article',
              row.id,
              'slug-changed',
              input.actorId,
              next.version,
            );
          return articleDetail(next);
        });
      } catch (error) {
        refuse(error);
      }
    },
    async transitionArticle(input: EditorialTransition) {
      try {
        return await getDatabaseClient().$transaction(async (tx) => {
          const row = await articleLocked(tx, input.id, input.expectedVersion);
          const action = input.action;
          const update = transitionUpdate(row, input);
          const data: Prisma.ArticleUncheckedUpdateInput = {
            ...update,
            ...chronologyUpdate(update, row.current?.sourcePublishedOn),
          };
          const next = await tx.article.update({
            where: { id: row.id },
            data,
            include: detailInclude,
          });
          // A revision takes a published article back to draft and a transition may
          // publish or archive it, so both owe a re-projection (ARCHITECTURE.md §8.5).
          await requestSearchIndexing(tx, 'article', row.id);
          await audit(tx, 'article', row.id, action, input.actorId, next.version);
          return articleDetail(next);
        });
      } catch (error) {
        refuse(error);
      }
    },
    async dueArticles(now: Date, limit: number) {
      const rows = await getDatabaseClient().article.findMany({
        where: {
          state: 'scheduled',
          scheduleStatus: 'pending',
          scheduledAt: { lte: now },
        },
        select: { id: true, version: true, approvedById: true, scheduledById: true },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: limitOf(limit),
      });
      return rows;
    },
    async failArticleSchedule(
      id: string,
      expectedVersion: number,
      reason: 'authority-revoked' | 'execution-failed',
    ) {
      await getDatabaseClient().$transaction(async (tx) => {
        const result = await tx.article.updateMany({
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
        if (result.count)
          await audit(tx, 'article', id, reason, null, expectedVersion + 1);
      });
    },
  };
}
function articleReads(): Pick<
  EditorialPublicReaderPort,
  'publicArticle' | 'publishedArticles' | 'articleSitemap' | 'articleCanonicalSlug'
> {
  return {
    async articleCanonicalSlug(slug: string) {
      const row = await getDatabaseClient().articleSlugHistory.findUnique({
        where: { slug },
        select: { owner: { select: { slug: true, state: true } } },
      });
      return row?.owner.state === 'published' ? row.owner.slug : null;
    },
    async publicArticle(slug: string) {
      const history = await getDatabaseClient().articleSlugHistory.findUnique({
        where: { slug },
        select: { owner: { select: { id: true, state: true } } },
      });
      if (!history || history.owner.state !== 'published') return null;
      const row = await getDatabaseClient().article.findFirst({
        where: { id: history.owner.id, state: 'published' },
        select: articlePublicSelect,
      });
      return row ? { ...articlePublic(row), id: history.owner.id } : null;
    },
    async publishedArticles(offset: number, limit: number) {
      // Newest by CHRONOLOGY (Phase 30-R): a migrated article sits at its own
      // source date, never at the day it was published here.
      const rows = await getDatabaseClient().article.findMany({
        where: { state: 'published' },
        select: articleListingSelect,
        orderBy: [{ chronologyAt: 'desc' }, { id: 'asc' }],
        skip: offsetOf(offset),
        take: limitOf(limit),
      });
      return rows.map(articleSummary);
    },
    async articleSitemap(offset: number, limit: number) {
      const rows = await getDatabaseClient().article.findMany({
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
        languages:
          row.current?.translations.map((t) => t.languageCode as EditorialLanguage) ?? [],
        updatedAt: row.updatedAt,
      }));
    },
  };
}

interface PageRow extends ArticleRow {
  routeBinding: string;
}
function pageRevision(row: NonNullable<PageRow['current']>): EditorialRevision {
  return {
    number: row.number,
    editorId: row.editorId,
    createdAt: row.createdAt,
    slug: row.slug,
    primaryLanguage: row.primaryLanguage as EditorialLanguage,
    translations: row.translations.map((t) => ({
      languageCode: t.languageCode as EditorialLanguage,
      title: t.title,
      excerpt: t.excerpt,
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      document: t.document,
      html: t.html,
      leadAlt: t.leadAlt,
    })),
    topicIds: row.topics.map((t) => t.topicId),
    contributors: row.contributors.map((c) => ({
      personId: c.personId,
      role: c.role as ContributionRole,
    })),
    leadImage: leadImageOf(row),
  };
}
function pageDetail(row: PageRow): PageDetail {
  if (!row.current || row.currentRevision === null)
    throw new EditorialDataError('unavailable');
  return {
    id: row.id,
    slug: row.slug,
    state: row.state as EditorialState,
    version: row.version,
    currentRevision: row.currentRevision,
    title:
      row.current.translations.find(
        (t) => t.languageCode === row.current?.primaryLanguage,
      )?.title ?? row.slug,
    creatorId: row.creatorId,
    approvedRevision: row.approvedRevision,
    approvedById: row.approvedById,
    scheduledRevision: row.scheduledRevision,
    scheduledById: row.scheduledById,
    scheduledAt: row.scheduledAt,
    scheduleStatus: row.scheduleStatus,
    updatedAt: row.updatedAt,
    revision: pageRevision(row.current),
    routeBinding: row.routeBinding,
  };
}
function pagePublic(row: PublicRow & { routeBinding: string }): PublicPage {
  if (!row.current || !row.publishedAt) throw new EditorialDataError('unavailable');
  return {
    slug: row.slug,
    primaryLanguage: row.current.primaryLanguage as EditorialLanguage,
    translations: row.current.translations.map((t) => ({
      languageCode: t.languageCode as EditorialLanguage,
      title: t.title,
      excerpt: t.excerpt,
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      html: t.html,
      leadAlt: t.leadAlt,
    })),
    leadImage: publicLeadOf('page', row.id, row.current),
    topicIds: row.current.topics.map((t) => t.topicId),
    contributors: row.current.contributors.map((c) => ({
      personId: c.personId,
      role: c.role,
    })),
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    routeBinding: row.routeBinding,
  };
}
async function writePageRevision(
  tx: Prisma.TransactionClient,
  id: string,
  number: number,
  input: EditorialWrite,
): Promise<void> {
  await tx.pageRevision.create({
    data: {
      ownerId: id,
      number,
      editorId: input.actorId,
      slug: input.content.slug,
      primaryLanguage: input.content.primaryLanguage,
      ...leadColumnsOf(input.content, { lead: true, dated: false }),
      translations: { create: leadTranslationRows(input.content.translations) },
      topics: { create: input.content.topicIds.map((topicId) => ({ topicId })) },
      contributors: {
        create: input.content.contributors.map((c, position) => ({ ...c, position })),
      },
    },
  });
}
async function pageLocked(
  tx: Prisma.TransactionClient,
  id: string,
  version: number,
): Promise<PageRow> {
  const claim = await tx.page.updateMany({
    where: { id, version },
    data: { version: { increment: 1 } },
  });
  if (claim.count !== 1) throw new EditorialDataError('conflict');
  const row = await tx.page.findUniqueOrThrow({ where: { id }, include: detailInclude });
  return row;
}
function pageOperations(): Pick<
  EditorialPersistencePort,
  | 'page'
  | 'pages'
  | 'pageRevisions'
  | 'createPage'
  | 'revisePage'
  | 'transitionPage'
  | 'duePages'
  | 'failPageSchedule'
> {
  return {
    async page(id: string) {
      const row = await getDatabaseClient().page.findUnique({
        where: { id },
        include: detailInclude,
      });
      return row ? pageDetail(row) : null;
    },
    async pages(query: EditorialQuery) {
      const limit = limitOf(query.limit);
      const rows = await getDatabaseClient().page.findMany({
        where: query.state ? { state: query.state } : {},
        select: summarySelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        skip: offsetOf(query.offset),
      });
      return {
        items: rows.slice(0, limit).map(privateSummary),
        more: rows.length > limit,
      };
    },
    async pageRevisions(id: string, offset: number) {
      const rows = await getDatabaseClient().pageRevision.findMany({
        where: { ownerId: id },
        include: revisionInclude,
        orderBy: { number: 'desc' },
        take: 26,
        skip: offsetOf(offset),
      });
      return { items: rows.slice(0, 25).map(pageRevision), more: rows.length > 25 };
    },
    async createPage(input: EditorialWrite & { readonly routeBinding: string }) {
      try {
        return await getDatabaseClient().$transaction(async (tx) => {
          const id = randomUUID();
          const now = new Date();
          await tx.page.create({
            data: {
              id,
              slug: input.content.slug,
              creatorId: input.actorId,
              state: 'draft',
              version: 1,
              updatedAt: now,
              routeBinding: input.routeBinding,
            },
          });
          await tx.pageSlugHistory.create({
            data: {
              ownerId: id,
              slug: input.content.slug,
              routeBinding: input.routeBinding,
            },
          });
          await writePageRevision(tx, id, 1, input);
          return pageDetail(
            await tx.page
              .update({
                where: { id },
                data: { currentRevision: 1 },
                include: detailInclude,
              })
              .then(async (row) => {
                await audit(tx, 'page', id, 'created', input.actorId, 1);
                return row;
              }),
          );
        });
      } catch (error) {
        refuse(error);
      }
    },
    async revisePage(input: EditorialEdit) {
      try {
        return await getDatabaseClient().$transaction(async (tx) => {
          const row = await pageLocked(tx, input.id, input.expectedVersion);
          const number = (row.currentRevision ?? 0) + 1;
          const history = await tx.pageSlugHistory.findUnique({
            where: {
              routeBinding_slug: {
                routeBinding: row.routeBinding,
                slug: input.content.slug,
              },
            },
          });
          if (history && history.ownerId !== row.id)
            throw new EditorialDataError('duplicate-slug');
          if (!history)
            await tx.pageSlugHistory.create({
              data: {
                ownerId: row.id,
                slug: input.content.slug,
                routeBinding: row.routeBinding,
              },
            });
          await writePageRevision(tx, row.id, number, input);
          const next = await tx.page.update({
            where: { id: row.id },
            data: {
              slug: input.content.slug,
              currentRevision: number,
              ...revisionReset(row),
            },
            include: detailInclude,
          });
          // A revision takes a published page back to draft and a transition may
          // publish or archive it, so both owe a re-projection (ARCHITECTURE.md §8.5).
          await requestSearchIndexing(tx, 'page', row.id);
          await audit(tx, 'page', row.id, 'revised', input.actorId, next.version);
          if (row.slug !== next.slug)
            await audit(tx, 'page', row.id, 'slug-changed', input.actorId, next.version);
          return pageDetail(next);
        });
      } catch (error) {
        refuse(error);
      }
    },
    async transitionPage(input: EditorialTransition) {
      try {
        return await getDatabaseClient().$transaction(async (tx) => {
          const row = await pageLocked(tx, input.id, input.expectedVersion);
          const action = input.action;
          const data: Prisma.PageUncheckedUpdateInput = transitionUpdate(row, input);
          const next = await tx.page.update({
            where: { id: row.id },
            data,
            include: detailInclude,
          });
          // A revision takes a published page back to draft and a transition may
          // publish or archive it, so both owe a re-projection (ARCHITECTURE.md §8.5).
          await requestSearchIndexing(tx, 'page', row.id);
          await audit(tx, 'page', row.id, action, input.actorId, next.version);
          return pageDetail(next);
        });
      } catch (error) {
        refuse(error);
      }
    },
    async duePages(now: Date, limit: number) {
      const rows = await getDatabaseClient().page.findMany({
        where: {
          state: 'scheduled',
          scheduleStatus: 'pending',
          scheduledAt: { lte: now },
        },
        select: { id: true, version: true, approvedById: true, scheduledById: true },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: limitOf(limit),
      });
      return rows;
    },
    async failPageSchedule(
      id: string,
      expectedVersion: number,
      reason: 'authority-revoked' | 'execution-failed',
    ) {
      await getDatabaseClient().$transaction(async (tx) => {
        const result = await tx.page.updateMany({
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
        if (result.count) await audit(tx, 'page', id, reason, null, expectedVersion + 1);
      });
    },
  };
}
function pageReads(): Pick<
  EditorialPublicReaderPort,
  | 'publicPage'
  | 'pageSitemap'
  | 'publishedHelpPages'
  | 'publishedExplorePages'
  | 'pageCanonicalSlug'
> {
  return {
    async publishedExplorePages(limit: number) {
      // Published only, in the query; the binding is unique per Page here
      // (slug `page`), so binding order is total.
      const rows = await getDatabaseClient().page.findMany({
        where: { state: 'published', routeBinding: { startsWith: '/explore/' } },
        select: {
          id: true,
          slug: true,
          routeBinding: true,
          current: {
            select: {
              primaryLanguage: true,
              ...leadSelect,
              translations: {
                select: { languageCode: true, title: true, excerpt: true, leadAlt: true },
                orderBy: { languageCode: 'asc' as const },
              },
            },
          },
        },
        orderBy: { routeBinding: 'asc' },
        take: limitOf(limit, 60),
      });
      return rows.map((row) => {
        if (!row.current) throw new EditorialDataError('unavailable');
        return {
          ...publicSummary(row),
          routeBinding: row.routeBinding,
          leadImage: publicLeadOf('page', row.id, row.current),
        };
      });
    },
    async publishedHelpPages(offset: number, limit: number) {
      const rows = await getDatabaseClient().page.findMany({
        where: { state: 'published', routeBinding: 'help-article' },
        select: listingSelect,
        orderBy: { slug: 'asc' },
        skip: offsetOf(offset),
        take: limitOf(limit),
      });
      return rows.map(publicSummary);
    },
    async pageCanonicalSlug(routeBinding: string, slug: string) {
      const row = await getDatabaseClient().pageSlugHistory.findUnique({
        where: { routeBinding_slug: { routeBinding, slug } },
        select: { owner: { select: { slug: true, state: true } } },
      });
      return row?.owner.state === 'published' ? row.owner.slug : null;
    },
    async publicPage(routeBinding: string, slug: string) {
      const history = await getDatabaseClient().pageSlugHistory.findUnique({
        where: { routeBinding_slug: { routeBinding, slug } },
        select: { owner: { select: { id: true, state: true } } },
      });
      if (!history || history.owner.state !== 'published') return null;
      const row = await getDatabaseClient().page.findFirst({
        where: { id: history.owner.id, state: 'published' },
        select: { ...publicSelect, routeBinding: true },
      });
      return row ? pagePublic(row) : null;
    },

    async pageSitemap(offset: number, limit: number) {
      const rows = await getDatabaseClient().page.findMany({
        where: { state: 'published' },
        select: {
          id: true,
          slug: true,
          updatedAt: true,
          routeBinding: true,
          current: { select: { translations: { select: { languageCode: true } } } },
        },
        orderBy: { id: 'asc' },
        skip: offsetOf(offset),
        take: limitOf(limit, 5000),
      });
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        routeBinding: row.routeBinding,
        languages:
          row.current?.translations.map((t) => t.languageCode as EditorialLanguage) ?? [],
        updatedAt: row.updatedAt,
      }));
    },
  };
}

/**
 * Search projection reads for Article and Page.
 *
 * `state = 'published'` IS IN EVERY QUERY, the same predicate the public routes
 * use, so a record revised back to draft, archived or merely scheduled is not
 * projected and not resolvable as a current result. The CURRENT revision is the
 * published one while the record is published — a revision moves it to draft.
 */
const searchSelect = {
  id: true,
  version: true,
  publishedAt: true,
  current: {
    select: {
      translations: {
        select: { languageCode: true, title: true, excerpt: true, document: true },
        orderBy: { languageCode: 'asc' as const },
      },
      topics: { select: { topicId: true }, orderBy: { topicId: 'asc' as const } },
    },
  },
} as const;

interface SearchRow {
  id: string;
  version: number;
  publishedAt: Date | null;
  chronologyAt?: Date | null;
  current: {
    translations: {
      languageCode: string;
      title: string;
      excerpt: string;
      document: string;
    }[];
    topics: { topicId: string }[];
  } | null;
}

function searchRecord(row: SearchRow | null): EditorialSearchRecord | null {
  if (row === null || row.current === null || row.publishedAt === null) return null;
  return {
    id: row.id,
    stamp: String(row.version),
    publishedAt: row.publishedAt,
    ...(row.chronologyAt ? { chronologyAt: row.chronologyAt } : {}),
    topicIds: row.current.topics.map((topic) => topic.topicId),
    translations: row.current.translations,
  };
}

/** Identifier batches for visibility rechecks and enumeration stay small. */
const searchBatchOf = (ids: readonly string[]) => {
  if (ids.length > 500) throw new Error('Editorial search batch exceeds its bound.');
  return [...ids];
};

function searchReads(): Pick<
  EditorialPublicReaderPort,
  | 'searchArticle'
  | 'searchPage'
  | 'searchArticles'
  | 'searchPages'
  | 'publishedArticleTargets'
  | 'publishedPageTargets'
> {
  const db = () => getDatabaseClient();
  return {
    async searchArticle(id) {
      return searchRecord(
        await db().article.findFirst({
          where: { id, state: 'published' },
          select: { ...searchSelect, chronologyAt: true },
        }),
      );
    },
    async searchPage(id) {
      return searchRecord(
        await db().page.findFirst({
          where: { id, state: 'published' },
          select: searchSelect,
        }),
      );
    },
    async searchArticles({ after, limit }) {
      const rows = await db().article.findMany({
        where: { state: 'published', ...(after === null ? {} : { id: { gt: after } }) },
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
        take: limitOf(limit, 500),
      });
      return rows.map((row) => ({ id: row.id, stamp: String(row.version) }));
    },
    async searchPages({ after, limit }) {
      const rows = await db().page.findMany({
        where: { state: 'published', ...(after === null ? {} : { id: { gt: after } }) },
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
        take: limitOf(limit, 500),
      });
      return rows.map((row) => ({ id: row.id, stamp: String(row.version) }));
    },
    async publishedArticleTargets(ids) {
      if (ids.length === 0) return [];
      return db().article.findMany({
        where: { id: { in: searchBatchOf(ids) }, state: 'published' },
        select: { id: true, slug: true },
        orderBy: { id: 'asc' },
      });
    },
    async publishedPageTargets(ids) {
      if (ids.length === 0) return [];
      return db().page.findMany({
        where: { id: { in: searchBatchOf(ids) }, state: 'published' },
        select: { id: true, routeBinding: true, slug: true },
        orderBy: { id: 'asc' },
      });
    },
  };
}

export function createEditorialPersistence(): EditorialPersistencePort {
  return {
    currentLeadImage: (family, recordId, assetId) =>
      leadImageNamed(family, recordId, assetId, 'current'),
    ...articleOperations(),
    ...pageOperations(),
    ...newsOperations(),
    ...eventOperations(),
    ...collectionOperations(),
  };
}
export function createEditorialPublicReader(): EditorialPublicReaderPort {
  return {
    publishedLeadImage: (family, recordId, assetId) =>
      leadImageNamed(family, recordId, assetId, 'published'),
    ...articleReads(),
    ...pageReads(),
    ...searchReads(),
    ...newsReads(),
    ...eventReads(),
    ...collectionReads(),
  };
}
