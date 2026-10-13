import 'server-only';

import {
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

    /** The asker's questions, newest first. The text is never selected by a list. */
    async questions(askerId, offset) {
      const skip = boundedOffset(offset);
      const [counted, rows] = await Promise.all([
        db.$queryRaw<{ total: number }[]>`
          SELECT COUNT(*) AS [total] FROM [dbo].[FatwaQuestion] q WHERE q.[askerId] = ${askerId}`,
        db.$queryRaw<
          { id: string; status: string; reviewState: string | null; submittedAt: Date }[]
        >`SELECT q.[id], q.[status], f.[reviewState], q.[submittedAt]
          FROM [dbo].[FatwaQuestion] q
          LEFT JOIN [dbo].[Fatwa] f ON f.[questionId] = q.[id]
          WHERE q.[askerId] = ${askerId}
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
