import 'server-only';

import type {
  LearningDispositionPort,
  LearningExportPort,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import { bounded, iso, refuse } from './shared.ts';

/**
 * Learning's part of a person's export and of their closed account's
 * disposition, coordinated at Layer 4.
 *
 * EVERY STATEMENT IS KEYED BY THE ACCOUNT. Nothing here decides whether the
 * account is closed — that is Identity's answer, asked by the caller — and
 * nothing here refuses: it reads or removes exactly the rows the account owns.
 *
 * THE EXPORT IS IDENTIFIERS AND INSTANTS. A Course's words and a lesson's body
 * are the catalogue's — public, or re-readable by the person — so none is
 * copied. Every list is in a fixed, documented order, so two exports of
 * unchanged data are identical apart from `generatedAt`.
 *
 * DISPOSITION IS BOUNDED, IDEMPOTENT AND RESUMABLE. Each call removes at most
 * `limit` rows per table, children before parents — nothing cascades — and
 * reports how many went. An interruption leaves only rows the next call finds:
 * the rows themselves are the pending work (SECURITY_BASELINE.md §19.1).
 */

const DISPOSAL_MAX = 1_000;

export function createLearningExport(): LearningExportPort {
  const db = getDatabaseClient();

  return {
    async collect(userId) {
      try {
        const [enrolments, progress, trialRequests] = await Promise.all([
          db.enrolment.findMany({
            where: { userId },
            select: {
              courseId: true,
              enrolledAt: true,
              course: { select: { slug: true } },
            },
            orderBy: [{ enrolledAt: 'asc' }, { courseId: 'asc' }],
          }),
          db.lessonProgress.findMany({
            where: { userId },
            select: { courseId: true, lessonId: true, completedAt: true },
            orderBy: [{ courseId: 'asc' }, { lessonId: 'asc' }],
          }),
          db.trialClassRequest.findMany({
            where: { userId },
            select: { id: true, courseId: true, requestedAt: true },
            orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
          }),
        ]);
        return {
          enrolments: enrolments.map((row) => ({
            courseId: row.courseId,
            // The CURRENT slug, so the export names an address that resolves.
            courseSlug: row.course.slug,
            enrolledAt: iso(row.enrolledAt),
          })),
          progress: progress.map((row) => ({
            courseId: row.courseId,
            lessonId: row.lessonId,
            completedAt: iso(row.completedAt),
          })),
          trialRequests: trialRequests.map((row) => ({
            id: row.id,
            courseId: row.courseId,
            requestedAt: iso(row.requestedAt),
          })),
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}

export function createLearningDisposition(): LearningDispositionPort {
  const db = getDatabaseClient();

  return {
    async disposeAccount(userId, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        return await db.$transaction(async (tx) => {
          let removed = await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[LessonProgress] WHERE [userId] = ${userId}`;
          // An Enrolment goes only once its Progress has: a batch that stopped
          // part-way through a Course's Progress leaves that Enrolment for the
          // next call rather than meeting the foreign key.
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[Enrolment]
            WHERE [userId] = ${userId}
              AND NOT EXISTS (
                SELECT 1 FROM [dbo].[LessonProgress] p
                WHERE p.[userId] = [Enrolment].[userId] AND p.[courseId] = [Enrolment].[courseId]
              )`;
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[TrialClassRequest] WHERE [userId] = ${userId}`;
          return removed;
        });
      } catch (error) {
        refuse(error);
      }
    },

    async accountsWithData(after, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        const rows = await db.$queryRaw<{ userId: string }[]>`
          SELECT TOP (${size}) [userId] FROM (
            SELECT [userId] FROM [dbo].[Enrolment]
            UNION SELECT [userId] FROM [dbo].[LessonProgress]
            UNION SELECT [userId] FROM [dbo].[TrialClassRequest]
          ) AS [owners]
          WHERE ${after} IS NULL OR [userId] > ${after}
          ORDER BY [userId]`;
        return rows.map((row) => row.userId);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
