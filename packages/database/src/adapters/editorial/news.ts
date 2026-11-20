import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  NEWS_FACET_PAGE,
  NEWS_CENTRE_BATCH,
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
  type NewsListingQuery,
  type NewsSummary,
  type PublicLeadImage,
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
  chronologyUpdate,
  revisionReset,
  transitionUpdate,
} from './workflow.ts';
import {
  dateOnly,
  leadAltOf,
  leadColumnsOf,
  leadImageOf,
  publicLeadOf,
  type LeadColumns,
} from './lead.ts';

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
 * date; a NewsArticle and a PressRelease revision may carry ONE lead image and
 * the source's own publication date, and their record keeps the reader-facing
 * chronology (Phase 30-R). Nothing else distinguishes the families here.
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
  readonly leadAlt?: string;
}

interface RevisionRow extends LeadColumns {
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
  readonly chronologyAt?: Date | null;
  readonly updatedAt: Date;
  readonly current:
    | (LeadColumns & {
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
          readonly leadAlt?: string;
        }[];
        readonly topics: readonly { readonly topicId: string }[];
        readonly contributors: readonly {
          readonly personId: string;
          readonly role: string;
        }[];
      })
    | null;
}

interface RecordDelegate {
  findUnique(args: object): Promise<RecordRow | null>;
  findUniqueOrThrow(args: object): Promise<RecordRow>;
  findFirst(args: object): Promise<PublicRow | null>;
  findMany(args: object): Promise<unknown[]>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<RecordRow>;
  updateMany(args: object): Promise<{ count: number }>;
  count(args: object): Promise<number>;
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
  /**
   * Phase 30-R: the revision may name ONE lead image and states the source's
   * own publication date, and the record keeps its reader-facing chronology.
   */
  readonly lead: boolean;
}

interface Family extends Shape {
  /** The record table, for the timeline's SQL. Code-owned, never input. */
  readonly table: Prisma.Sql;
  readonly topicTable: Prisma.Sql;
  /** Its revisions' translations, for the R2 content-language narrowing. */
  readonly translationTable: Prisma.Sql;
  /** Its revisions, for a coverage record's outlet (News & Events Part 1). */
  readonly revisionTable: Prisma.Sql;
  readonly delegates: (client: Client) => Delegates;
}

/** The narrow view of a generated delegate. See the module comment. */
const narrow = <T>(delegate: unknown): T => delegate as T;

const FAMILIES: Readonly<Record<NewsKind, Family>> = {
  'news-article': {
    kind: 'news-article',
    table: Prisma.sql`[dbo].[NewsArticle]`,
    topicTable: Prisma.sql`[dbo].[NewsArticleTopic]`,
    translationTable: Prisma.sql`[dbo].[NewsArticleRevisionTranslation]`,
    revisionTable: Prisma.sql`[dbo].[NewsArticleRevision]`,
    issuer: false,
    coverage: false,
    centre: true,
    lead: true,
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
    translationTable: Prisma.sql`[dbo].[PressReleaseRevisionTranslation]`,
    revisionTable: Prisma.sql`[dbo].[PressReleaseRevision]`,
    issuer: false,
    coverage: false,
    centre: false,
    lead: true,
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
    translationTable: Prisma.sql`[dbo].[StatementRevisionTranslation]`,
    revisionTable: Prisma.sql`[dbo].[StatementRevision]`,
    issuer: true,
    coverage: false,
    centre: false,
    lead: false,
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
    translationTable: Prisma.sql`[dbo].[MediaCoverageRevisionTranslation]`,
    revisionTable: Prisma.sql`[dbo].[MediaCoverageRevision]`,
    issuer: false,
    coverage: true,
    centre: false,
    lead: false,
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
/** Phase 30-R: a lead family's image and source date, and its alt text per language. */
const leadSelect = (family: Family) =>
  family.lead
    ? {
        leadAssetId: true,
        leadWidth: true,
        leadHeight: true,
        leadCredit: true,
        sourcePublishedOn: true,
      }
    : {};
const leadAltSelect = (family: Family) => (family.lead ? { leadAlt: true } : {});
const chronologySelect = (family: Family) => (family.lead ? { chronologyAt: true } : {});
/** Newest first, by the family's reader-facing date. */
const newestFirst = (family: Family) => [
  family.lead ? { chronologyAt: 'desc' as const } : { publishedAt: 'desc' as const },
  { id: 'asc' as const },
];

const publicSelect = (family: Family) => ({
  id: true,
  slug: true,
  version: true,
  publishedAt: true,
  ...chronologySelect(family),
  updatedAt: true,
  current: {
    select: {
      primaryLanguage: true,
      ...sourceSelect(family),
      ...centreSelect(family),
      ...leadSelect(family),
      translations: {
        select: {
          languageCode: true,
          title: true,
          excerpt: true,
          seoTitle: true,
          seoDescription: true,
          html: true,
          ...issuerSelect(family),
          ...leadAltSelect(family),
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
  ...chronologySelect(family),
  updatedAt: true,
  current: {
    select: {
      primaryLanguage: true,
      ...(family.coverage ? { outletName: true, sourcePublishedOn: true } : {}),
      ...leadSelect(family),
      translations: {
        select: {
          languageCode: true,
          title: true,
          excerpt: true,
          ...issuerSelect(family),
          ...leadAltSelect(family),
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
      ...(family.lead ? { leadAlt: t.leadAlt ?? '' } : {}),
    })),
    topicIds: row.topics.map((t) => t.topicId),
    contributors: row.contributors.map((c) => ({
      personId: c.personId,
      role: c.role as ContributionRole,
    })),
    ...(family.lead
      ? {
          leadImage: leadImageOf(row),
          sourcePublishedOn: dateOnly(row.sourcePublishedOn),
        }
      : {}),
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

/** The serving family of a News family that may carry a lead image, or null. */
function leadFamilyOf(family: Shape): 'news-article' | 'press-release' | null {
  return family.lead &&
    (family.kind === 'news-article' || family.kind === 'press-release')
    ? family.kind
    : null;
}

/** A public row's lead image, named by its record, or null. */
function leadImageFor(family: Shape, row: PublicRow): PublicLeadImage | null {
  const lead = leadFamilyOf(family);
  return lead === null || row.current === null
    ? null
    : publicLeadOf(lead, row.id, row.current);
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
      ...(family.lead ? { leadAlt: t.leadAlt ?? '' } : {}),
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
    chronologyAt: row.chronologyAt ?? row.publishedAt,
    sourcePublishedOn: family.lead ? dateOnly(row.current.sourcePublishedOn) : null,
    leadImage: leadImageFor(family, row),
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
      ...(family.lead ? { leadAlt: t.leadAlt ?? '' } : {}),
    })),
    publishedAt: row.publishedAt,
    chronologyAt: row.chronologyAt ?? row.publishedAt,
    leadImage: leadImageFor(family, row),
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
      ...leadColumnsOf(content, { lead: family.lead, dated: family.lead }),
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
          ...leadAltOf(t, family.lead),
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
          const update = transitionUpdate(row, input);
          const next = await family.delegates(tx).record.update({
            where: { id: row.id },
            data: family.lead
              ? { ...update, ...chronologyUpdate(update, row.current?.sourcePublishedOn) }
              : update,
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

/** A family's reader-facing date column (Phase 30-R): chronology, else publication. */
const chronologyOf = (family: Family): Prisma.Sql =>
  family.lead ? Prisma.sql`r.[chronologyAt]` : Prisma.sql`r.[publishedAt]`;

/** What narrows a family's published records; every member optional. */
interface RowFilter {
  readonly from: Date | null;
  readonly to: Date | null;
  readonly topicId: string | null;
  readonly language?: string | null | undefined;
  /** Media coverage only: the outlet its current revision names. */
  readonly outlet?: string | null | undefined;
  readonly preferLanguage?: string | null | undefined;
}

/** The UTC bounds of a year, or of one month of it; none without a year. */
function periodOf(
  year: number | null,
  month: number | null,
): { readonly from: Date | null; readonly to: Date | null } {
  if (year === null) return { from: null, to: null };
  return month === null
    ? { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year + 1, 0, 1)) }
    : {
        from: new Date(Date.UTC(year, month - 1, 1)),
        to: new Date(Date.UTC(year, month, 1)),
      };
}

/**
 * One family's PUBLISHED records under a filter, and the rank `preferLanguage`
 * gives them. A NewsArticle's and a PressRelease's date is its record's own
 * chronology (Phase 30-R); a Statement's and a MediaCoverage's is its
 * publication instant. `language` keeps the records whose CURRENT revision has
 * a translation in that language; `preferLanguage` ranks those 0 and every
 * other 1; `outlet` keeps the coverage records whose current revision names
 * it, and admits nothing of a family that names no outlet. Every value is a
 * bound parameter; the tables are code-owned, never input.
 */
function familyClauses(
  family: Family,
  filter: RowFilter,
): { readonly where: Prisma.Sql; readonly rank: Prisma.Sql } {
  const date = chronologyOf(family);
  const translated = (language: string) =>
    Prisma.sql`EXISTS (SELECT 1 FROM ${family.translationTable} l WHERE l.[ownerId] = r.[id] AND l.[revisionNumber] = r.[currentRevision] AND l.[languageCode] = ${language})`;
  const conditions = [Prisma.sql`r.[state] = N'published'`];
  if (filter.from !== null) conditions.push(Prisma.sql`${date} >= ${filter.from}`);
  if (filter.to !== null) conditions.push(Prisma.sql`${date} < ${filter.to}`);
  if (filter.topicId !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM ${family.topicTable} t WHERE t.[ownerId] = r.[id] AND t.[revisionNumber] = r.[currentRevision] AND t.[topicId] = ${filter.topicId})`,
    );
  if (filter.language !== null && filter.language !== undefined)
    conditions.push(translated(filter.language));
  if (filter.outlet !== null && filter.outlet !== undefined)
    conditions.push(
      family.coverage
        ? Prisma.sql`EXISTS (SELECT 1 FROM ${family.revisionTable} v WHERE v.[ownerId] = r.[id] AND v.[number] = r.[currentRevision] AND v.[outletName] = ${filter.outlet})`
        : Prisma.sql`1 = 0`,
    );
  return {
    where: Prisma.join(conditions, ' AND '),
    rank:
      filter.preferLanguage === null || filter.preferLanguage === undefined
        ? Prisma.sql`0`
        : Prisma.sql`CASE WHEN ${translated(filter.preferLanguage)} THEN 0 ELSE 1 END`,
  };
}

/**
 * The four families as one relation of (kind, id, chronologyAt, rank),
 * filtered (see `familyClauses`); `kind` keeps one family's rows only (R2).
 */
function timelineRows(
  filter: RowFilter & { readonly kind?: NewsKind | null | undefined },
): Prisma.Sql {
  const kinds = NEWS_KINDS.filter(
    (kind) => filter.kind === null || filter.kind === undefined || filter.kind === kind,
  );
  return Prisma.join(
    kinds.map((kind) => {
      const family = FAMILIES[kind];
      const { where, rank } = familyClauses(family, filter);
      return Prisma.sql`SELECT CAST(${kind} AS NVARCHAR(16)) AS [kind], r.[id], ${chronologyOf(family)} AS [chronologyAt], ${rank} AS [rank] FROM ${family.table} r WHERE ${where}`;
    }),
    ' UNION ALL ',
  );
}

/**
 * NEWS & EVENTS PART 1 — one family's published records as (id, revision, at,
 * rank): its current revision for the facets' joins, and its date.
 */
function familyRows(family: Family, filter: RowFilter): Prisma.Sql {
  const { where, rank } = familyClauses(family, filter);
  return Prisma.sql`SELECT r.[id], r.[currentRevision] AS [revision], ${chronologyOf(family)} AS [at], ${rank} AS [rank] FROM ${family.table} r WHERE ${where}`;
}

/** A listing query as a row filter: the period it names, and its narrowing. */
function listingFilter(query: NewsListingQuery): RowFilter {
  return {
    ...periodOf(query.year, query.month),
    topicId: query.topic,
    language: query.language,
    outlet: query.outlet,
    // Ordering by a preferred language means something only in the default
    // order of a view no language narrows.
    preferLanguage:
      query.sort === 'newest' && query.language === null ? query.prefer : null,
  };
}

/** What the driver answers for a `COUNT_BIG`, `COUNT` or `YEAR()` column. */
type SqlCount = bigint | number;

/** Such a value as a number, whatever the driver returned. */
function countOf(value: SqlCount | null | undefined): number {
  return Number(value ?? 0);
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
  | 'newsListing'
  | 'newsListingFacets'
  | 'newsNeighbours'
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
        orderBy: newestFirst(family),
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
      const refs = await db().$queryRaw<
        { kind: string; id: string; chronologyAt: Date }[]
      >`SELECT [kind], [id], [chronologyAt] FROM (${timelineRows({
        ...periodOf(query.year, query.month),
        topicId: query.topicId,
        kind: query.kind,
        language: query.language,
        preferLanguage: query.preferLanguage,
      })}) AS [timeline]
        ORDER BY [rank] ASC, [chronologyAt] DESC, [kind] ASC, [id] ASC
        OFFSET ${offsetOf(query.offset)} ROWS FETCH NEXT ${take + 1} ROWS ONLY`;
      const cards = await cardsFor(
        refs.slice(0, take).map((ref) => ({ kind: ref.kind as NewsKind, id: ref.id })),
      );
      return { items: cards, more: refs.length > take };
    },

    async newsArchivePeriods(filter) {
      const rows = await db().$queryRaw<{ year: number; month: number; count: number }[]>`
        SELECT TOP (1200) YEAR([chronologyAt]) AS [year], MONTH([chronologyAt]) AS [month], COUNT_BIG(*) AS [count]
        FROM (${timelineRows({
          from: null,
          to: null,
          topicId: null,
          kind: filter?.kind,
          language: filter?.language,
        })}) AS [timeline]
        GROUP BY YEAR([chronologyAt]), MONTH([chronologyAt])
        ORDER BY [year] DESC, [month] ASC`;
      return rows.map((row) => ({
        year: Number(row.year),
        month: Number(row.month),
        count: Number(row.count),
      }));
    },

    async newsListing(query) {
      const family = familyOf(query.kind);
      const take = limitOf(query.limit, NEWS_PAGE);
      const rows = familyRows(family, listingFilter(query));
      const order =
        query.sort === 'oldest'
          ? Prisma.sql`[at] ASC, [id] ASC`
          : Prisma.sql`[rank] ASC, [at] DESC, [id] ASC`;
      const [refs, totals] = await Promise.all([
        db().$queryRaw<{ id: string }[]>`SELECT [id] FROM (${rows}) AS [listing]
          ORDER BY ${order}
          OFFSET ${offsetOf(query.offset)} ROWS FETCH NEXT ${take + 1} ROWS ONLY`,
        db().$queryRaw<
          { total: SqlCount | null }[]
        >`SELECT COUNT_BIG(*) AS [total] FROM (${rows}) AS [listing]`,
      ]);
      const items = await cardsFor(
        refs.slice(0, take).map((ref) => ({ kind: family.kind, id: ref.id })),
      );
      return { items, total: countOf(totals[0]?.total), hasMore: refs.length > take };
    },

    async newsListingFacets(query) {
      const family = familyOf(query.kind);
      const filter: RowFilter = { ...listingFilter(query), preferLanguage: null };
      // Each facet counts under every OTHER filter, its own left out.
      const rows = (change: Partial<RowFilter>) =>
        familyRows(family, { ...filter, ...change });
      const whole = familyRows(family, { from: null, to: null, topicId: null });
      const translations = (relation: Prisma.Sql) =>
        Prisma.sql`(${relation}) AS [x] JOIN ${family.translationTable} l ON l.[ownerId] = [x].[id] AND l.[revisionNumber] = [x].[revision]`;
      const revisions = (relation: Prisma.Sql) =>
        Prisma.sql`(${relation}) AS [x] JOIN ${family.revisionTable} v ON v.[ownerId] = [x].[id] AND v.[number] = [x].[revision]`;
      const nothing = <T>(): Promise<T[]> => Promise.resolve([]);
      const [
        all,
        allLanguages,
        allOutlets,
        kinds,
        topics,
        years,
        months,
        languages,
        outlets,
      ] = await Promise.all([
        db().$queryRaw<
          {
            records: SqlCount | null;
            firstYear: SqlCount | null;
            lastYear: SqlCount | null;
          }[]
        >`
            SELECT COUNT_BIG(*) AS [records], MIN(YEAR([at])) AS [firstYear], MAX(YEAR([at])) AS [lastYear]
            FROM (${whole}) AS [x]`,
        db().$queryRaw<{ total: SqlCount | null }[]>`
            SELECT COUNT(DISTINCT l.[languageCode]) AS [total] FROM ${translations(whole)}`,
        family.coverage
          ? db().$queryRaw<{ total: SqlCount | null }[]>`
                SELECT COUNT(DISTINCT v.[outletName]) AS [total] FROM ${revisions(whole)}`
          : nothing<{ total: SqlCount | null }>(),
        db().$queryRaw<{ kind: string; records: SqlCount | null }[]>`
            SELECT [kind], COUNT_BIG(*) AS [records]
            FROM (${timelineRows({ ...filter, outlet: null })}) AS [timeline]
            GROUP BY [kind]`,
        db().$queryRaw<{ id: string; records: SqlCount | null }[]>`
            SELECT TOP (${NEWS_FACET_PAGE + 1}) t.[topicId] AS [id], COUNT_BIG(*) AS [records]
            FROM (${rows({ topicId: null })}) AS [x]
            JOIN ${family.topicTable} t ON t.[ownerId] = [x].[id] AND t.[revisionNumber] = [x].[revision]
            GROUP BY t.[topicId]
            ORDER BY [records] DESC, t.[topicId] ASC`,
        db().$queryRaw<{ year: SqlCount | null; records: SqlCount | null }[]>`
            SELECT TOP (300) YEAR([at]) AS [year], COUNT_BIG(*) AS [records]
            FROM (${rows({ from: null, to: null })}) AS [x]
            GROUP BY YEAR([at])
            ORDER BY [year] DESC`,
        query.year === null
          ? nothing<{ month: SqlCount | null; records: SqlCount | null }>()
          : db().$queryRaw<{ month: SqlCount | null; records: SqlCount | null }[]>`
                SELECT MONTH([at]) AS [month], COUNT_BIG(*) AS [records]
                FROM (${rows(periodOf(query.year, null))}) AS [x]
                GROUP BY MONTH([at])
                ORDER BY [month] ASC`,
        db().$queryRaw<{ code: string; records: SqlCount | null }[]>`
            SELECT l.[languageCode] AS [code], COUNT_BIG(*) AS [records]
            FROM ${translations(rows({ language: null }))}
            GROUP BY l.[languageCode]
            ORDER BY [records] DESC, l.[languageCode] ASC`,
        family.coverage
          ? db().$queryRaw<{ name: string; records: SqlCount | null }[]>`
                SELECT TOP (${NEWS_FACET_PAGE + 1}) v.[outletName] AS [name], COUNT_BIG(*) AS [records]
                FROM ${revisions(rows({ outlet: null }))}
                GROUP BY v.[outletName]
                ORDER BY [records] DESC, v.[outletName] ASC`
          : nothing<{ name: string; records: SqlCount | null }>(),
      ]);
      const [figures] = all;
      const year = (value: SqlCount | null | undefined): number | null =>
        value === null || value === undefined ? null : countOf(value);
      const counted = new Map(kinds.map((row) => [row.kind, countOf(row.records)]));
      return {
        all: {
          records: countOf(figures?.records),
          languages: countOf(allLanguages[0]?.total),
          firstYear: year(figures?.firstYear),
          lastYear: year(figures?.lastYear),
          outlets: countOf(allOutlets[0]?.total),
        },
        kinds: NEWS_KINDS.map((kind) => ({ kind, records: counted.get(kind) ?? 0 })),
        topics: {
          items: topics
            .slice(0, NEWS_FACET_PAGE)
            .map((row) => ({ id: row.id, records: countOf(row.records) })),
          hasMore: topics.length > NEWS_FACET_PAGE,
        },
        years: years.map((row) => ({
          year: countOf(row.year),
          records: countOf(row.records),
        })),
        months: months.map((row) => ({
          month: countOf(row.month),
          records: countOf(row.records),
        })),
        languages: languages.map((row) => ({
          code: language(row.code),
          records: countOf(row.records),
        })),
        outlets: {
          items: outlets
            .slice(0, NEWS_FACET_PAGE)
            .map((row) => ({ name: row.name, records: countOf(row.records) })),
          hasMore: outlets.length > NEWS_FACET_PAGE,
        },
      };
    },

    /**
     * The published record just older and just newer than the one named, in
     * the family's newest-first order (date, then identifier) — both read in
     * ONE statement against the record's own stored date, so no precision is
     * lost in a round trip. Nothing at all for a record not published now.
     */
    async newsNeighbours({ kind, slug }) {
      const family = familyOf(kind);
      const date = chronologyOf(family);
      const rows = await db().$queryRaw<{ direction: string; id: string }[]>`
        WITH [me] AS (
          SELECT r.[id], ${date} AS [at] FROM ${family.table} r
          WHERE r.[slug] = ${slug} AND r.[state] = N'published'
        )
        SELECT N'older' AS [direction], [o].[id] FROM (
          SELECT TOP (1) r.[id] FROM ${family.table} r CROSS JOIN [me]
          WHERE r.[state] = N'published'
            AND (${date} < [me].[at] OR (${date} = [me].[at] AND r.[id] > [me].[id]))
          ORDER BY ${date} DESC, r.[id] ASC
        ) AS [o]
        UNION ALL
        SELECT N'newer' AS [direction], [n].[id] FROM (
          SELECT TOP (1) r.[id] FROM ${family.table} r CROSS JOIN [me]
          WHERE r.[state] = N'published'
            AND (${date} > [me].[at] OR (${date} = [me].[at] AND r.[id] < [me].[id]))
          ORDER BY ${date} ASC, r.[id] DESC
        ) AS [n]`;
      const card = async (direction: 'newer' | 'older') => {
        const row = rows.find((entry) => entry.direction === direction);
        // A record withdrawn between the two reads is simply absent.
        return row === undefined
          ? null
          : ((await cardsFor([{ kind, id: row.id }]))[0] ?? null);
      };
      const [newer, older] = await Promise.all([card('newer'), card('older')]);
      return { newer, older };
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
          ...chronologySelect(family),
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
        ...(row.chronologyAt ? { chronologyAt: row.chronologyAt } : {}),
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
    async centreNews(centreIds, offset, limit) {
      if (centreIds.length === 0) return { items: [], more: false, total: 0 };
      const family = FAMILIES['news-article'];
      const take = limitOf(limit, NEWS_PAGE);
      const where = {
        state: 'published',
        current: { is: { centreId: { in: [...centreIds].slice(0, NEWS_CENTRE_BATCH) } } },
      };
      const delegate = family.delegates(db()).record;
      const [rows, total] = await Promise.all([
        delegate.findMany({
          where,
          select: summarySelect(family),
          orderBy: newestFirst(family),
          skip: offsetOf(offset),
          take: take + 1,
        }) as Promise<PublicRow[]>,
        delegate.count({ where }),
      ]);
      return {
        items: rows.slice(0, take).map((row) => summaryOf(family, row)),
        more: rows.length > take,
        total,
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
