import 'server-only';

import { Prisma } from '@prisma/client';

import {
  FATWA_PAGE_SIZE,
  FATWA_PERMISSIONS,
  fatwaQuestionStage,
  type FatwaCategoryStatus,
  type FatwaQuestionStatus,
  type FatwaRecord,
  type FatwaReviewState,
  type FatwaStaffReaderPort,
  type FatwaSummaryPage,
  type StaffQuestion,
  type StaffQuestionPage,
  type StaffQuestionSummary,
} from '@minhaj/contracts/fatwa';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  boundedOffset,
  CATEGORY_LIST,
  dateOf,
  holdsNow,
  maybeDate,
  namesOf,
  type Client,
} from './shared.ts';

/**
 * Fatwa's STAFF reads (DOMAIN_MODEL.md §12; SECURITY_BASELINE.md §6).
 *
 * SCOPED IN SQL, NOT ONLY BY A ROUTE GUARD. Every query carries, in its own
 * WHERE clause, the live-permission predicate for the acting account
 * (`holdsNow`) AND the rule for what that stage may see now:
 *
 *   intake   `question.receive` — questions submitted, triaged or assigned,
 *            not disposed of;
 *   assigned `fatwa.answer` — questions assigned to THIS account now, while
 *            assigned or answered (a correction is drafted after publication);
 *   review   `fatwa.publish` — rulings under review now, and their question
 *            only while they are;
 *   published `fatwa.publish` — rulings ever published;
 *   categories any of the three keys.
 *
 * So a revoked role, a closed account, a reassignment or a question that moved
 * on reads nothing, whatever the caller already decided.
 *
 * THE PRIVATE TEXT. No list ever selects a question's body. The three detail
 * reads that return it write ONE `fatwa.question.accessed` audit entry in the
 * same transaction — the question id, the stage and the permission, never the
 * text — so a body is never read without the record of who read it.
 */

/** The most recent revisions one ruling record shows. */
const REVISION_LIST = 100;

/** The most review decisions one ruling record shows. */
const NOTE_LIST = 200;

type Stage = 'intake' | 'assigned' | 'review';

/** The permission each detail stage reads under, and records. */
const STAGE_PERMISSION: Readonly<Record<Stage, string>> = Object.freeze({
  intake: FATWA_PERMISSIONS.receive,
  assigned: FATWA_PERMISSIONS.answer,
  review: FATWA_PERMISSIONS.publish,
});

/* ===========================================================================
 * Scopes — WHERE clauses over `q` (the question) and `f` (its ruling, if any)
 * ========================================================================= */

function intakeScope(actorId: string): Prisma.Sql {
  return Prisma.sql`WHERE q.[status] IN (N'submitted', N'triaged', N'assigned')
    AND q.[disposedAt] IS NULL
    AND ${holdsNow(actorId, FATWA_PERMISSIONS.receive)}`;
}

/** Intake questions an answerer holds now — the assignment view, scoped in SQL. */
function assignmentScope(actorId: string): Prisma.Sql {
  return Prisma.sql`WHERE q.[status] = N'assigned'
    AND q.[disposedAt] IS NULL
    AND ${holdsNow(actorId, FATWA_PERMISSIONS.receive)}`;
}

function assignedScope(actorId: string): Prisma.Sql {
  return Prisma.sql`WHERE q.[assigneeId] = ${actorId}
    AND q.[status] IN (N'assigned', N'answered')
    AND ${holdsNow(actorId, FATWA_PERMISSIONS.answer)}`;
}

function reviewScope(actorId: string): Prisma.Sql {
  return Prisma.sql`WHERE f.[reviewState] = N'in_review'
    AND ${holdsNow(actorId, FATWA_PERMISSIONS.publish)}`;
}

function publishedScope(actorId: string): Prisma.Sql {
  return Prisma.sql`WHERE f.[firstPublishedAt] IS NOT NULL
    AND ${holdsNow(actorId, FATWA_PERMISSIONS.publish)}`;
}

const QUESTIONS = Prisma.sql`FROM [dbo].[FatwaQuestion] q
  LEFT JOIN [dbo].[Fatwa] f ON f.[questionId] = q.[id]`;

const SUMMARY_COLUMNS = Prisma.sql`q.[id], q.[status], q.[categoryId], q.[assigneeId],
  f.[id] AS [fatwaId], f.[reviewState], q.[submittedAt], q.[updatedAt], q.[version]`;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface SummaryRow {
  readonly id: string;
  readonly status: string;
  readonly categoryId: string | null;
  readonly assigneeId: string | null;
  readonly fatwaId: string | null;
  readonly reviewState: string | null;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

function toSummary(row: SummaryRow): StaffQuestionSummary {
  return {
    id: row.id,
    stage: fatwaQuestionStage(
      row.status as FatwaQuestionStatus,
      row.reviewState as FatwaReviewState | null,
    ),
    categoryId: row.categoryId,
    assigneeId: row.assigneeId,
    fatwaId: row.fatwaId,
    submittedAt: dateOf(row.submittedAt),
    updatedAt: dateOf(row.updatedAt),
    version: Number(row.version),
  };
}

/* ===========================================================================
 * The factory
 * ========================================================================= */

export function createFatwaStaffReader(): FatwaStaffReaderPort {
  const db = getDatabaseClient();

  /** One page of questions in a scope, oldest first. Never the text. */
  async function questionPage(
    scope: Prisma.Sql,
    offset: number,
  ): Promise<StaffQuestionPage> {
    const skip = boundedOffset(offset);
    const [counted, rows] = await Promise.all([
      db.$queryRaw<{ total: number }[]>`SELECT COUNT(*) AS [total] ${QUESTIONS} ${scope}`,
      db.$queryRaw<SummaryRow[]>`SELECT ${SUMMARY_COLUMNS} ${QUESTIONS} ${scope}
        ORDER BY q.[submittedAt], q.[id]
        OFFSET ${skip} ROWS FETCH NEXT ${FATWA_PAGE_SIZE} ROWS ONLY`,
    ]);
    return {
      items: rows.map(toSummary),
      total: Number(counted[0]?.total ?? 0),
      offset: skip,
    };
  }

  /**
   * One question's detail in a scope — the text only while it exists — and,
   * in the SAME transaction, the audit entry recording that it was read.
   * Nothing is recorded when nothing is returned.
   */
  async function questionDetail(
    stage: Stage,
    scope: Prisma.Sql,
    actorId: string,
  ): Promise<StaffQuestion | null> {
    return db.$transaction(async (tx: Client) => {
      const [row] = await tx.$queryRaw<(SummaryRow & { body: string | null })[]>`
        SELECT TOP (1) ${SUMMARY_COLUMNS}, q.[body] ${QUESTIONS} ${scope}
          AND q.[disposedAt] IS NULL AND q.[body] IS NOT NULL`;
      if (row === undefined || row.body === null) return null;
      await tx.auditLog.create({
        data: auditRow({
          actorType: 'user',
          actorId,
          action: 'fatwa.question.accessed',
          targetType: 'fatwa-question',
          targetId: row.id,
          after: { stage },
          authorisingSource: STAGE_PERMISSION[stage],
        }),
      });
      return { ...toSummary(row), body: row.body };
    });
  }

  /** One page of rulings in a scope, with the title of the named revision. */
  async function fatwaPage(
    scope: Prisma.Sql,
    revision: 'pending' | 'published',
    order: Prisma.Sql,
    offset: number,
  ): Promise<FatwaSummaryPage> {
    const skip = boundedOffset(offset);
    const named =
      revision === 'pending'
        ? Prisma.sql`r.[id] = f.[pendingRevisionId]`
        : Prisma.sql`r.[id] = f.[publishedRevisionId]`;
    const [counted, rows] = await Promise.all([
      db.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*) AS [total] FROM [dbo].[Fatwa] f ${scope}`,
      db.$queryRaw<
        {
          id: string;
          questionId: string;
          slug: string;
          title: string | null;
          version: number;
          reviewState: string | null;
          firstPublishedAt: Date | null;
          withdrawnAt: Date | null;
          updatedAt: Date;
        }[]
      >`SELECT f.[id], f.[questionId], f.[slug], r.[title], f.[version], f.[reviewState],
               f.[firstPublishedAt], f.[withdrawnAt], f.[updatedAt]
        FROM [dbo].[Fatwa] f
        LEFT JOIN [dbo].[FatwaRevision] r ON ${named} AND r.[fatwaId] = f.[id]
        ${scope}
        ${order}
        OFFSET ${skip} ROWS FETCH NEXT ${FATWA_PAGE_SIZE} ROWS ONLY`,
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        questionId: row.questionId,
        slug: row.slug,
        title: row.title ?? '',
        version: Number(row.version),
        reviewState: row.reviewState as FatwaReviewState | null,
        firstPublishedAt: maybeDate(row.firstPublishedAt),
        withdrawnAt: maybeDate(row.withdrawnAt),
        updatedAt: dateOf(row.updatedAt),
      })),
      total: Number(counted[0]?.total ?? 0),
      offset: skip,
    };
  }

  /**
   * One ruling in a scope (over `f`, and `q` its question), with its most
   * recent revisions, their topics and publication instants, and its review
   * decisions. The scope decides WHETHER; the rest is read by the ruling's id.
   */
  async function fatwaRecord(scope: Prisma.Sql): Promise<FatwaRecord | null> {
    const [head] = await db.$queryRaw<
      {
        id: string;
        questionId: string;
        slug: string;
        version: number;
        reviewState: string | null;
        pendingRevisionId: string | null;
        publishedRevisionId: string | null;
        firstPublishedAt: Date | null;
        withdrawnAt: Date | null;
      }[]
    >`SELECT TOP (1) f.[id], f.[questionId], f.[slug], f.[version], f.[reviewState],
             f.[pendingRevisionId], f.[publishedRevisionId], f.[firstPublishedAt], f.[withdrawnAt]
      FROM [dbo].[Fatwa] f
      JOIN [dbo].[FatwaQuestion] q ON q.[id] = f.[questionId]
      ${scope}`;
    if (head === undefined) return null;
    const [revisions, notes] = await Promise.all([
      db.fatwaRevision.findMany({
        where: { fatwaId: head.id },
        select: {
          id: true,
          number: true,
          title: true,
          publicQuestion: true,
          ruling: true,
          language: true,
          categoryId: true,
          correctionReason: true,
          authorId: true,
          createdAt: true,
          topics: { select: { topicId: true }, orderBy: { topicId: 'asc' } },
          publications: { select: { publishedAt: true } },
        },
        orderBy: { number: 'desc' },
        take: REVISION_LIST,
      }),
      db.fatwaReviewDecision.findMany({
        where: { fatwaId: head.id },
        select: {
          revisionId: true,
          decision: true,
          note: true,
          actorId: true,
          decidedAt: true,
        },
        orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
        take: NOTE_LIST,
      }),
    ]);
    return {
      id: head.id,
      questionId: head.questionId,
      slug: head.slug,
      version: Number(head.version),
      reviewState: head.reviewState as FatwaReviewState | null,
      pendingRevisionId: head.pendingRevisionId,
      publishedRevisionId: head.publishedRevisionId,
      firstPublishedAt: maybeDate(head.firstPublishedAt),
      withdrawnAt: maybeDate(head.withdrawnAt),
      // Oldest first, as the drafting history reads.
      revisions: revisions.reverse().map((revision) => ({
        id: revision.id,
        number: revision.number,
        title: revision.title,
        publicQuestion: revision.publicQuestion,
        ruling: revision.ruling,
        language: revision.language,
        categoryId: revision.categoryId,
        topicIds: revision.topics.map((topic) => topic.topicId),
        correctionReason: revision.correctionReason,
        authorId: revision.authorId,
        createdAt: revision.createdAt,
        publishedAt: revision.publications[0]?.publishedAt ?? null,
      })),
      notes: notes.map((note) => ({
        revisionId: note.revisionId,
        decision: note.decision as 'returned' | 'withdrawn',
        note: note.note,
        actorId: note.actorId,
        decidedAt: note.decidedAt,
      })),
    };
  }

  return {
    intake: (actorId, offset) => questionPage(intakeScope(actorId), offset),
    assignment: (actorId, offset) => questionPage(assignmentScope(actorId), offset),

    intakeQuestion: (actorId, id) =>
      questionDetail(
        'intake',
        Prisma.sql`${intakeScope(actorId)} AND q.[id] = ${id}`,
        actorId,
      ),

    assigned: (actorId, offset) => questionPage(assignedScope(actorId), offset),

    assignedQuestion: (actorId, id) =>
      questionDetail(
        'assigned',
        Prisma.sql`${assignedScope(actorId)} AND q.[id] = ${id}`,
        actorId,
      ),

    assignedFatwa: (actorId, questionId) =>
      fatwaRecord(Prisma.sql`${assignedScope(actorId)} AND q.[id] = ${questionId}`),

    reviewQueue: (actorId, offset) =>
      fatwaPage(
        reviewScope(actorId),
        'pending',
        Prisma.sql`ORDER BY f.[updatedAt], f.[id]`,
        offset,
      ),

    reviewFatwa: (actorId, fatwaId) =>
      fatwaRecord(Prisma.sql`${reviewScope(actorId)} AND f.[id] = ${fatwaId}`),

    reviewQuestion: (actorId, fatwaId) =>
      questionDetail(
        'review',
        Prisma.sql`${reviewScope(actorId)} AND f.[id] = ${fatwaId}`,
        actorId,
      ),

    published: (actorId, offset) =>
      fatwaPage(
        publishedScope(actorId),
        'published',
        Prisma.sql`ORDER BY f.[firstPublishedAt] DESC, f.[id]`,
        offset,
      ),

    publishedFatwa: (actorId, fatwaId) =>
      fatwaRecord(Prisma.sql`${publishedScope(actorId)} AND f.[id] = ${fatwaId}`),

    async categories(actorId) {
      const rows = await db.$queryRaw<
        {
          id: string;
          slug: string;
          topicId: string;
          position: number;
          status: string;
          version: number;
        }[]
      >`SELECT TOP (${CATEGORY_LIST}) c.[id], c.[slug], c.[topicId], c.[position], c.[status], c.[version]
        FROM [dbo].[FatwaCategory] c
        WHERE (${holdsNow(actorId, FATWA_PERMISSIONS.receive)}
            OR ${holdsNow(actorId, FATWA_PERMISSIONS.answer)}
            OR ${holdsNow(actorId, FATWA_PERMISSIONS.publish)})
        ORDER BY c.[position], c.[slug]`;
      if (rows.length === 0) return [];
      const names = await db.fatwaCategoryName.findMany({
        where: { categoryId: { in: rows.map((row) => row.id) } },
        select: { categoryId: true, locale: true, name: true },
        orderBy: [{ categoryId: 'asc' }, { locale: 'asc' }],
      });
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        topicId: row.topicId,
        position: Number(row.position),
        status: row.status as FatwaCategoryStatus,
        names: namesOf(names.filter((name) => name.categoryId === row.id)),
        version: Number(row.version),
      }));
    },
  };
}
