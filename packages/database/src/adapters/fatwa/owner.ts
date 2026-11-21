import 'server-only';

import { Prisma } from '@prisma/client';

import {
  FATWA_OWNER_STATUS_SOURCES,
  FATWA_OWNER_STATUSES,
  FATWA_PAGE_SIZE,
  fatwaOwnerStatus,
  fatwaQuestionStage,
  type FatwaOwnerPort,
  type FatwaOwnerStatus,
  type FatwaQuestionStatus,
  type FatwaReviewState,
} from '@minhaj/contracts/fatwa';

import { getDatabaseClient } from '../../client.ts';
import { boundedOffset, dateOf, PUBLIC_NOW, refuse } from './shared.ts';

/**
 * The asker's own questions (DOMAIN_MODEL.md §12; SECURITY_BASELINE.md §6).
 *
 * KEYED BY THE ASKER IN THE QUERY. Every read carries `askerId = @askerId` in
 * its own WHERE clause, so a question id guessed or copied from another
 * account reads nothing — there is no "load, then check the owner" step that a
 * caller could skip.
 *
 * WHAT THE ASKER IS TOLD is the coarse owner status (`fatwaOwnerStatus`), never
 * who is drafting, who was assigned or whether a revision was returned; and
 * the public ruling's slug only while the ruling is public now.
 *
 * Submission is the `FatwaSubmitQuestion` procedure, which refuses while the
 * service is not activated and for an asker who is not an active account, and
 * writes its own audit entry naming the question — never its words.
 */

function ownerStatus(status: string, reviewState: string | null): FatwaOwnerStatus {
  return fatwaOwnerStatus(
    fatwaQuestionStage(
      status as FatwaQuestionStatus,
      reviewState as FatwaReviewState | null,
    ),
  );
}

export function createFatwaOwner(): FatwaOwnerPort {
  const db = getDatabaseClient();

  return {
    async submit({ id, askerId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaSubmitQuestion]
          @id = ${id},
          @askerId = ${askerId},
          @body = ${value.body},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The asker's questions, newest first. The text is never selected by a list.
     *
     * NARROWED BY BOUND VALUES (My Minhaj Part 2). One owner status is the
     * stored statuses it is derived from (`FATWA_OWNER_STATUS_SOURCES`), each
     * a bound parameter; the statement's shape is fixed, and the count carries
     * the same predicate as the page, so the total is the narrowed list's.
     */
    async questions(askerId, offset, status = null) {
      const skip = boundedOffset(offset);
      const narrowed =
        status === null
          ? Prisma.empty
          : Prisma.sql`AND q.[status] IN (${Prisma.join([...FATWA_OWNER_STATUS_SOURCES[status]])})`;
      const [counted, rows] = await Promise.all([
        db.$queryRaw<{ total: number }[]>`
          SELECT COUNT(*) AS [total] FROM [dbo].[FatwaQuestion] q
          WHERE q.[askerId] = ${askerId} ${narrowed}`,
        db.$queryRaw<
          { id: string; status: string; reviewState: string | null; submittedAt: Date }[]
        >`SELECT q.[id], q.[status], f.[reviewState], q.[submittedAt]
          FROM [dbo].[FatwaQuestion] q
          LEFT JOIN [dbo].[Fatwa] f ON f.[questionId] = q.[id]
          WHERE q.[askerId] = ${askerId} ${narrowed}
          ORDER BY q.[submittedAt] DESC, q.[id]
          OFFSET ${skip} ROWS FETCH NEXT ${FATWA_PAGE_SIZE} ROWS ONLY`,
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          status: ownerStatus(row.status, row.reviewState),
          submittedAt: dateOf(row.submittedAt),
        })),
        total: Number(counted[0]?.total ?? 0),
        offset: skip,
      };
    },

    /** Every owner status counted for the asker, in ONE statement; a status held by none is 0. */
    async questionCounts(askerId) {
      const rows = await db.$queryRaw<{ status: string; total: number }[]>`
        SELECT q.[status], COUNT(*) AS [total] FROM [dbo].[FatwaQuestion] q
        WHERE q.[askerId] = ${askerId}
        GROUP BY q.[status]`;
      const counts = Object.fromEntries(
        FATWA_OWNER_STATUSES.map((owner) => [owner, 0]),
      ) as Record<FatwaOwnerStatus, number>;
      for (const row of rows) {
        const owner = FATWA_OWNER_STATUSES.find((candidate) =>
          FATWA_OWNER_STATUS_SOURCES[candidate].includes(
            row.status as FatwaQuestionStatus,
          ),
        );
        if (owner !== undefined) counts[owner] += Number(row.total);
      }
      return counts;
    },

    async question(askerId, id) {
      const [row] = await db.$queryRaw<
        {
          id: string;
          status: string;
          reviewState: string | null;
          submittedAt: Date;
          body: string | null;
          answerSlug: string | null;
        }[]
      >`SELECT q.[id], q.[status], f.[reviewState], q.[submittedAt], q.[body],
               CASE WHEN f.[id] IS NOT NULL AND ${PUBLIC_NOW} THEN f.[slug] END AS [answerSlug]
        FROM [dbo].[FatwaQuestion] q
        LEFT JOIN [dbo].[Fatwa] f ON f.[questionId] = q.[id]
        WHERE q.[askerId] = ${askerId} AND q.[id] = ${id}`;
      if (row === undefined) return null;
      return {
        id: row.id,
        status: ownerStatus(row.status, row.reviewState),
        submittedAt: dateOf(row.submittedAt),
        body: row.body,
        answerSlug: row.answerSlug,
      };
    },
  };
}
