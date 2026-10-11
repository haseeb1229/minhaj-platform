import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  EVENT_LIMITS,
  EVENT_PAGE,
  type ArticleDetail,
  type EditorialEdit,
  type EditorialLanguage,
  type EditorialPersistencePort,
  type EditorialPublicReaderPort,
  type EditorialQuery,
  type EditorialRevision,
  type EditorialState,
  type EditorialTransition,
  type EditorialWrite,
  type EventOccurrence,
  type EventSchedule,
  type EventSummary,
  type PublicEvent,
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
 * Editorial's Phase-14 persistence: Event (DOMAIN_MODEL.md §7.1).
 *
 * THE ARTICLE'S SHAPE OF TABLES AND THE ARTICLE'S WORKFLOW, through the same
 * shared rules (`./workflow.ts`), plus what is genuinely an Event's: the
 * revision's zone and Centre, its occurrences (`EventSchedule`) and its ordered
 * Gallery associations (`EventGallery`). All four are written WITH the
 * revision, in its transaction, and are immutable with it — so a schedule, a
 * Centre or a Gallery can only change through a new revision, which returns the
 * Event to draft and clears its approval and publication schedule.
 *
 * TWO OTHER OWNERS, NAMED AND NEVER READ. A Centre is Global's and a Gallery is
 * Media's: this module stores their identifiers under real, non-cascading
 * foreign keys and reads neither owner's tables. Whether an editor may choose
 * one is asked of its owner at Layer 4 before a write reaches here; whether one
 * is shown is asked again at render.
 *
 * NOT SEARCHABLE. Phase 14 does not carry Search Foundation in its dependency
 * path, so no Event write requests indexing and no Event read feeds Search.
 *
 * PRIVATE CAPABILITY. Only the two operation sets leave this module, each typed
 * by Editorial's own ports; no delegate, transaction handle or client escapes
 * (ARCHITECTURE.md §4.1).
 */

type Client = Prisma.TransactionClient;

const db = () => getDatabaseClient();

/* ===========================================================================
 * Selections
 * ========================================================================= */

const OCCURRENCES = {
  select: { startsLocal: true, startsAt: true, endsLocal: true, endsAt: true },
  orderBy: { position: 'asc' as const },
};

const GALLERIES = {
  select: { galleryId: true },
  orderBy: { position: 'asc' as const },
};

const revisionInclude = {
  translations: { orderBy: { languageCode: 'asc' as const } },
  topics: { orderBy: { topicId: 'asc' as const } },
  contributors: { orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }] },
  occurrences: OCCURRENCES,
  galleries: GALLERIES,
} satisfies Prisma.EventRevisionInclude;

const detailInclude = {
  current: { include: revisionInclude },
} satisfies Prisma.EventInclude;

/** What a card needs: never the body, never the authoring document. */
const summarySelect = {
  id: true,
  slug: true,
  current: {
    select: {
      primaryLanguage: true,
      timezone: true,
      centreId: true,
      translations: {
        select: { languageCode: true, title: true, excerpt: true },
        orderBy: { languageCode: 'asc' as const },
      },
      topics: { select: { topicId: true }, orderBy: { topicId: 'asc' as const } },
      occurrences: OCCURRENCES,
    },
  },
} satisfies Prisma.EventSelect;

const publicSelect = {
  id: true,
  slug: true,
  publishedAt: true,
  updatedAt: true,
  current: {
    select: {
      primaryLanguage: true,
      timezone: true,
      centreId: true,
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
      occurrences: OCCURRENCES,
      galleries: GALLERIES,
    },
  },
} satisfies Prisma.EventSelect;

/* ===========================================================================
 * Row shapes — plain interfaces, never a generated type
 * ========================================================================= */

interface OccurrenceRow {
  readonly startsLocal: Date;
  readonly startsAt: Date;
  readonly endsLocal: Date | null;
  readonly endsAt: Date | null;
}

interface RevisionRow {
  readonly number: number;
  readonly editorId: string;
  readonly createdAt: Date;
  readonly slug: string;
  readonly primaryLanguage: string;
  readonly timezone: string;
  readonly centreId: string | null;
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
  readonly occurrences: readonly OccurrenceRow[];
  readonly galleries: readonly { readonly galleryId: string }[];
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

/**
 * A wall-clock time is stored in a `datetime2` with no zone, written and read
 * as if it were UTC so no conversion ever touches it: `2026-11-14T19:00` in,
 * `2026-11-14T19:00` out, whatever zone the server runs in.
 */
const localToColumn = (local: string) => new Date(`${local}:00.000Z`);
const columnToLocal = (value: Date) => value.toISOString().slice(0, 16);

function occurrenceOf(row: OccurrenceRow): EventOccurrence {
  return {
    startsLocal: columnToLocal(row.startsLocal),
    startsAt: row.startsAt,
    endsLocal: row.endsLocal === null ? null : columnToLocal(row.endsLocal),
    endsAt: row.endsAt,
  };
}

function scheduleOf(row: {
  readonly timezone: string;
  readonly occurrences: readonly OccurrenceRow[];
}): EventSchedule {
  return { timezone: row.timezone, occurrences: row.occurrences.map(occurrenceOf) };
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
    centreId: row.centreId,
    schedule: scheduleOf(row),
    galleryIds: row.galleries.map((g) => g.galleryId),
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
  readonly id: string;
  readonly slug: string;
  readonly current: {
    readonly primaryLanguage: string;
    readonly timezone: string;
    readonly centreId: string | null;
    readonly translations: readonly {
      readonly languageCode: string;
      readonly title: string;
      readonly excerpt: string;
    }[];
    readonly topics: readonly { readonly topicId: string }[];
    readonly occurrences: readonly OccurrenceRow[];
  } | null;
}

function summaryOf(row: SummaryRow): EventSummary {
  if (!row.current) throw new EditorialDataError('unavailable');
  return {
    slug: row.slug,
    primaryLanguage: language(row.current.primaryLanguage),
    translations: row.current.translations.map((t) => ({
      languageCode: language(t.languageCode),
      title: t.title,
      excerpt: t.excerpt,
    })),
    schedule: scheduleOf(row.current),
    centreId: row.current.centreId,
    topicIds: row.current.topics.map((t) => t.topicId),
  };
}

/* ===========================================================================
 * Writes
 * ========================================================================= */

/**
 * One immutable revision: its words, references, zone, Centre, occurrences and
 * Gallery associations, every column named. A content without a schedule is
 * not an Event's and is refused here as well as by the contract and the
 * database (51146).
 */
async function writeRevision(
  tx: Client,
  id: string,
  number: number,
  input: EditorialWrite,
): Promise<void> {
  const content = input.content;
  const schedule = content.schedule;
  const galleryIds = content.galleryIds ?? [];
  if (
    schedule === undefined ||
    schedule.occurrences.length === 0 ||
    schedule.occurrences.length > EVENT_LIMITS.occurrences ||
    galleryIds.length > EVENT_LIMITS.galleries ||
    content.coverage !== undefined ||
    content.translations.some((t) => t.issuer !== undefined)
  )
    throw new EditorialDataError('invalid');
  await tx.eventRevision.create({
    data: {
      ownerId: id,
      number,
      editorId: input.actorId,
      slug: content.slug,
      primaryLanguage: content.primaryLanguage,
      timezone: schedule.timezone,
      centreId: content.centreId ?? null,
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
      occurrences: {
        create: schedule.occurrences.map((o, position) => ({
          position,
          startsLocal: localToColumn(o.startsLocal),
          startsAt: o.startsAt,
          endsLocal: o.endsLocal === null ? null : localToColumn(o.endsLocal),
          endsAt: o.endsAt,
        })),
      },
      galleries: {
        create: galleryIds.map((galleryId, position) => ({ position, galleryId })),
      },
    },
  });
}

/**
 * An audit row: WHICH workflow facts changed, never the text. No title, body,
 * authoring document, schedule time or Centre or Gallery word enters the audit
 * log (SECURITY_BASELINE.md §13.4); the revision number names what was written.
 */
async function audit(
  tx: Client,
  id: string,
  action: string,
  actorId: string | null,
  version: number,
): Promise<void> {
  const snapshot = await tx.event.findUniqueOrThrow({
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
      action: `editorial.event.${action}`,
      targetType: 'event',
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
async function locked(tx: Client, id: string, version: number): Promise<RecordRow> {
  const claim = await tx.event.updateMany({
    where: { id, version },
    data: { version: { increment: 1 } },
  });
  if (claim.count !== 1) throw new EditorialDataError('conflict');
  return tx.event.findUniqueOrThrow({ where: { id }, include: detailInclude });
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The Event facts a revision changed, each audited as its own event — the
 * action names the fact; no time, zone, Centre or Gallery word is recorded.
 */
function eventChanges(
  before: RevisionRow | null,
  after: EditorialWrite['content'],
): readonly ('schedule-changed' | 'centre-changed' | 'galleries-changed')[] {
  if (before === null) return [];
  const schedule = after.schedule;
  const previous = before.occurrences.map(occurrenceOf);
  const scheduleChanged =
    schedule === undefined ||
    before.timezone !== schedule.timezone ||
    previous.length !== schedule.occurrences.length ||
    schedule.occurrences.some((o, index) => {
      const old = previous[index];
      return (
        old === undefined ||
        old.startsLocal !== o.startsLocal ||
        old.startsAt.getTime() !== o.startsAt.getTime() ||
        old.endsLocal !== o.endsLocal ||
        (old.endsAt?.getTime() ?? null) !== (o.endsAt?.getTime() ?? null)
      );
    });
  return [
    ...(scheduleChanged ? (['schedule-changed'] as const) : []),
    ...(before.centreId !== (after.centreId ?? null)
      ? (['centre-changed'] as const)
      : []),
    ...(!sameList(
      before.galleries.map((g) => g.galleryId),
      after.galleryIds ?? [],
    )
      ? (['galleries-changed'] as const)
      : []),
  ];
}

export function eventOperations(): Pick<
  EditorialPersistencePort,
  | 'event'
  | 'eventDirectory'
  | 'eventRevisions'
  | 'createEvent'
  | 'reviseEvent'
  | 'transitionEvent'
  | 'dueEvents'
  | 'failEventSchedule'
> {
  return {
    async event(id) {
      const row = await db().event.findUnique({ where: { id }, include: detailInclude });
      return row ? detailOf(row) : null;
    },

    async eventDirectory(query: EditorialQuery) {
      const limit = limitOf(query.limit);
      const rows = await db().event.findMany({
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

    async eventRevisions(id, offset) {
      const rows = await db().eventRevision.findMany({
        where: { ownerId: id },
        include: revisionInclude,
        orderBy: { number: 'desc' },
        take: 26,
        skip: offsetOf(offset),
      });
      return { items: rows.slice(0, 25).map(revisionOf), more: rows.length > 25 };
    },

    async createEvent(input: EditorialWrite) {
      try {
        return await db().$transaction(async (tx) => {
          const id = randomUUID();
          await tx.event.create({
            data: {
              id,
              slug: input.content.slug,
              creatorId: input.actorId,
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await tx.eventSlugHistory.create({
            data: { ownerId: id, slug: input.content.slug },
          });
          await writeRevision(tx, id, 1, input);
          const row = await tx.event.update({
            where: { id },
            data: { currentRevision: 1 },
            include: detailInclude,
          });
          await audit(tx, id, 'created', input.actorId, 1);
          return detailOf(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async reviseEvent(input: EditorialEdit) {
      try {
        return await db().$transaction(async (tx) => {
          const row = await locked(tx, input.id, input.expectedVersion);
          const number = (row.currentRevision ?? 0) + 1;
          const history = await tx.eventSlugHistory.findUnique({
            where: { slug: input.content.slug },
            select: { ownerId: true },
          });
          if (history && history.ownerId !== row.id)
            throw new EditorialDataError('duplicate-slug');
          if (!history)
            await tx.eventSlugHistory.create({
              data: { ownerId: row.id, slug: input.content.slug },
            });
          await writeRevision(tx, row.id, number, input);
          const next = await tx.event.update({
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
          for (const change of eventChanges(row.current, input.content))
            await audit(tx, row.id, change, input.actorId, next.version);
          return detailOf(next);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async transitionEvent(input: EditorialTransition) {
      try {
        return await db().$transaction(async (tx) => {
          const row = await locked(tx, input.id, input.expectedVersion);
          const next = await tx.event.update({
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

    async dueEvents(now, limit) {
      return db().event.findMany({
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

    async failEventSchedule(id, expectedVersion, reason) {
      await db().$transaction(async (tx) => {
        const result = await tx.event.updateMany({
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
 * Public reads — PUBLISHED ONLY, and the predicate is in every query
 * ========================================================================= */

/** Identifier batches stay small; a geography filter's list travels as one JSON value. */
const ID_BATCH = 500;

/**
 * One page of published Event identifiers in the view's order, the rule of
 * `eventTiming` written in SQL over the CURRENT revision's occurrences:
 *
 *   upcoming — the latest occurrence end (its end, or its start when it has
 *              none) has not passed; ordered by the earliest occurrence that
 *              has not ended, so an ongoing Event comes first;
 *   past     — every occurrence has ended; latest end first.
 *
 * Ties break on the identifier, so the order is total. A Centre filter is the
 * revision's own `centreId` against identifiers Global resolved at Layer 4,
 * passed as ONE JSON parameter; no Global table is joined.
 */
async function pageOf(query: {
  readonly when: 'upcoming' | 'past';
  readonly now: Date;
  readonly offset: number;
  readonly limit: number;
  readonly centreIds: readonly string[] | null;
  readonly topicId: string | null;
}): Promise<{ readonly ids: readonly string[]; readonly more: boolean }> {
  const take = limitOf(query.limit, EVENT_PAGE);
  const conditions = [Prisma.sql`e.[state] = N'published'`];
  if (query.centreIds !== null)
    conditions.push(
      Prisma.sql`r.[centreId] IN (SELECT [value] FROM OPENJSON(${JSON.stringify(query.centreIds)}))`,
    );
  if (query.topicId !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[EventTopic] t WHERE t.[ownerId] = e.[id] AND t.[revisionNumber] = e.[currentRevision] AND t.[topicId] = ${query.topicId})`,
    );
  const ending = Prisma.sql`COALESCE(s.[endsAt], s.[startsAt])`;
  const upcoming = query.when === 'upcoming';
  const rows = await db().$queryRaw<{ id: string }[]>`
    SELECT e.[id]
    FROM [dbo].[Event] e
    JOIN [dbo].[EventRevision] r ON r.[ownerId] = e.[id] AND r.[number] = e.[currentRevision]
    JOIN [dbo].[EventSchedule] s ON s.[ownerId] = e.[id] AND s.[revisionNumber] = e.[currentRevision]
    WHERE ${Prisma.join(conditions, ' AND ')}
    GROUP BY e.[id]
    HAVING ${upcoming ? Prisma.sql`MAX(${ending}) >= ${query.now}` : Prisma.sql`MAX(${ending}) < ${query.now}`}
    ORDER BY ${
      upcoming
        ? Prisma.sql`MIN(CASE WHEN ${ending} >= ${query.now} THEN s.[startsAt] END) ASC`
        : Prisma.sql`MAX(${ending}) DESC`
    }, e.[id] ASC
    OFFSET ${offsetOf(query.offset)} ROWS FETCH NEXT ${take + 1} ROWS ONLY`;
  return { ids: rows.slice(0, take).map((row) => row.id), more: rows.length > take };
}

export function eventReads(): Pick<
  EditorialPublicReaderPort,
  'eventCanonicalSlug' | 'publicEvent' | 'events' | 'hasPublishedEvents' | 'eventSitemap'
> {
  return {
    async eventCanonicalSlug(slug) {
      const row = await db().eventSlugHistory.findUnique({
        where: { slug },
        select: { owner: { select: { slug: true, state: true } } },
      });
      return row?.owner.state === 'published' ? row.owner.slug : null;
    },

    async publicEvent(slug): Promise<PublicEvent | null> {
      const row = await db().event.findFirst({
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
        schedule: scheduleOf(current),
        centreId: current.centreId,
        galleryIds: current.galleries.map((g) => g.galleryId),
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
      };
    },

    async events(query) {
      const page = await pageOf(query);
      if (page.ids.length === 0) return { items: [], more: page.more };
      const rows = await db().event.findMany({
        where: { id: { in: [...page.ids].slice(0, ID_BATCH) }, state: 'published' },
        select: summarySelect,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      // An Event withdrawn between the two reads is simply absent, never shown.
      return {
        items: page.ids.flatMap((id) => {
          const row = byId.get(id);
          return row === undefined ? [] : [summaryOf(row)];
        }),
        more: page.more,
      };
    },

    async hasPublishedEvents() {
      return (
        (await db().event.findFirst({
          where: { state: 'published' },
          select: { id: true },
        })) !== null
      );
    },

    async eventSitemap(offset, limit) {
      const rows = await db().event.findMany({
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
  };
}
