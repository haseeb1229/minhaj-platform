import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { FATWA_PERMISSIONS, type FatwaWorkflowPort } from '@minhaj/contracts/fatwa';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexingMany } from '../../search-intent.ts';
import { FatwaDataError, holdsNow, refuse, type Client } from './shared.ts';

/**
 * The Fatwa workflow — the ONLY write path to questions and rulings
 * (DOMAIN_MODEL.md §12; SECURITY_BASELINE.md §6).
 *
 * EVERY QUESTION AND RULING WRITE IS A DATABASE PROCEDURE. This principal holds
 * SELECT and EXECUTE on the workflow tables and no INSERT, UPDATE or DELETE.
 * Each procedure re-checks, in SQL and inside its own transaction, the acting
 * account's CURRENT permission — and, to publish or withdraw, a live
 * `fatwa-publication` step-up grant bound to a live session of that account —
 * then the expected version and the state, before it writes anything. Each
 * records its own audit entry (identifiers only) and, where the public ruling
 * changes, its own search intent, so nothing here duplicates either.
 *
 * CATEGORIES are the one exception, by design: a classification row, not
 * workflow, written here through Prisma delegates under the column grants the
 * migration allows (no slug change, no delete). The service has already
 * checked `fatwa.publish`; the transaction checks it again, live, so a revoked
 * role between the two checks writes nothing.
 *
 * EVERY VALUE IS A BOUND PARAMETER. The topic list travels as one JSON array
 * the procedure reads with `OPENJSON`; no value is spliced into SQL text.
 */

/** How many public rulings one category re-mapping requests in one statement. */
const INTENT_BATCH = 1_000;

/** Refuses unless `actorId` holds `fatwa.publish` now, inside the writing transaction. */
async function assertPublisher(tx: Client, actorId: string): Promise<void> {
  const [row] = await tx.$queryRaw<{ held: number }[]>`
    SELECT CASE WHEN ${holdsNow(actorId, FATWA_PERMISSIONS.publish)} THEN 1 ELSE 0 END AS [held]`;
  if (Number(row?.held ?? 0) !== 1) throw new FatwaDataError('denied');
}

/**
 * Search intent for every ruling whose CURRENT published revision uses the
 * category — its projected topics include the category's topic — walked in
 * bounded batches so no single read is unbounded and none is skipped.
 */
async function requestCategoryScopes(tx: Client, categoryId: string): Promise<void> {
  let after: string | null = null;
  for (;;) {
    const page: { id: string }[] = await tx.$queryRaw<{ id: string }[]>`
      SELECT TOP (${INTENT_BATCH}) f.[id]
      FROM [dbo].[Fatwa] f
      JOIN [dbo].[FatwaRevision] r ON r.[id] = f.[publishedRevisionId] AND r.[fatwaId] = f.[id]
      WHERE r.[categoryId] = ${categoryId} AND f.[withdrawnAt] IS NULL
        ${after === null ? Prisma.empty : Prisma.sql`AND f.[id] > ${after}`}
      ORDER BY f.[id]`;
    await requestSearchIndexingMany(
      tx,
      'fatwa',
      page.map((row) => row.id),
    );
    const last = page.at(-1);
    if (last === undefined || page.length < INTENT_BATCH) return;
    after = last.id;
  }
}

/** A category audit entry: identifiers, slug, status and position — never a name. */
function categoryAudit(input: {
  readonly actorId: string;
  readonly action: 'fatwa.category.created' | 'fatwa.category.updated';
  readonly id: string;
  readonly before?: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
}) {
  return auditRow({
    actorType: 'user',
    actorId: input.actorId,
    action: input.action,
    targetType: 'fatwa-category',
    targetId: input.id,
    before: input.before,
    after: input.after,
    authorisingSource: FATWA_PERMISSIONS.publish,
  });
}

export function createFatwaWorkflow(): FatwaWorkflowPort {
  const db = getDatabaseClient();

  return {
    async triage({ actorId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaTriageQuestion]
          @id = ${value.id},
          @expectedVersion = ${value.expectedVersion},
          @categoryId = ${value.categoryId},
          @actorId = ${actorId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    async assign({ actorId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaAssignQuestion]
          @id = ${value.id},
          @expectedVersion = ${value.expectedVersion},
          @assigneeId = ${value.assigneeId},
          @actorId = ${actorId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    async decline({ actorId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaDeclineQuestion]
          @id = ${value.id},
          @expectedVersion = ${value.expectedVersion},
          @actorId = ${actorId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    async saveDraft({ actorId, fatwaId, revisionId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaSaveDraft]
          @fatwaId = ${fatwaId},
          @questionId = ${value.questionId},
          @expectedVersion = ${value.expectedVersion},
          @revisionId = ${revisionId},
          @slug = ${value.slug},
          @title = ${value.title},
          @publicQuestion = ${value.publicQuestion},
          @ruling = ${value.ruling},
          @language = ${value.language},
          @categoryId = ${value.categoryId},
          @topicIds = ${JSON.stringify(value.topicIds)},
          @correctionReason = ${value.correctionReason},
          @actorId = ${actorId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    async submitForReview({ actorId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaSubmitForReview]
          @fatwaId = ${value.fatwaId},
          @expectedVersion = ${value.expectedVersion},
          @revisionId = ${value.revisionId},
          @actorId = ${actorId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    async returnForRevision({ actorId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaReturnForRevision]
          @fatwaId = ${value.fatwaId},
          @expectedVersion = ${value.expectedVersion},
          @revisionId = ${value.revisionId},
          @decisionId = ${randomUUID()},
          @note = ${value.note},
          @actorId = ${actorId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    async askerOf(input) {
      try {
        const [row] =
          'questionId' in input
            ? await db.$queryRaw<{ askerId: string; id: string }[]>`
                SELECT q.[askerId], q.[id] FROM [dbo].[FatwaQuestion] q WHERE q.[id] = ${input.questionId}`
            : await db.$queryRaw<{ askerId: string; id: string }[]>`
                SELECT q.[askerId], q.[id] FROM [dbo].[Fatwa] f
                JOIN [dbo].[FatwaQuestion] q ON q.[id] = f.[questionId]
                WHERE f.[id] = ${input.fatwaId}
                  AND (SELECT COUNT(*) FROM [dbo].[FatwaPublication] p WHERE p.[fatwaId] = f.[id]) = 1`;
        return row === undefined ? null : { accountId: row.askerId, questionId: row.id };
      } catch (error) {
        refuse(error);
      }
    },

    async publish({ authority, publicationId, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaPublishRevision]
          @fatwaId = ${value.fatwaId},
          @expectedVersion = ${value.expectedVersion},
          @revisionId = ${value.revisionId},
          @publicationId = ${publicationId},
          @actorId = ${authority.actorId},
          @sessionId = ${authority.sessionId},
          @stepUpGrantId = ${authority.stepUpGrantId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    async withdraw({ authority, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[FatwaWithdraw]
          @fatwaId = ${value.fatwaId},
          @expectedVersion = ${value.expectedVersion},
          @decisionId = ${randomUUID()},
          @reason = ${value.reason},
          @actorId = ${authority.actorId},
          @sessionId = ${authority.sessionId},
          @stepUpGrantId = ${authority.stepUpGrantId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Categories ------------------------------------------------------- */

    async createCategory({ actorId, id, value }) {
      try {
        await db.$transaction(async (tx) => {
          await assertPublisher(tx, actorId);
          // `createMany`: a plain INSERT, reading nothing back.
          await tx.fatwaCategory.createMany({
            data: [
              {
                id,
                slug: value.slug,
                topicId: value.topicId,
                position: value.position,
                status: 'active',
              },
            ],
          });
          await tx.fatwaCategoryName.createMany({
            data: value.names.map((entry) => ({
              categoryId: id,
              locale: entry.locale,
              name: entry.name,
            })),
          });
          await tx.auditLog.create({
            data: categoryAudit({
              actorId,
              action: 'fatwa.category.created',
              id,
              after: {
                slug: value.slug,
                topic: value.topicId,
                position: String(value.position),
                status: 'active',
              },
            }),
          });
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * THE VERSION IS THE LOCK. The conditional update claims the version the
     * operator read FIRST — before the names are replaced — so of two edits of
     * one category exactly one succeeds and the other is told it changed.
     */
    async updateCategory({ actorId, value }) {
      try {
        await db.$transaction(async (tx) => {
          await assertPublisher(tx, actorId);
          const previous = await tx.fatwaCategory.findUnique({
            where: { id: value.id },
            select: {
              slug: true,
              topicId: true,
              position: true,
              status: true,
              version: true,
            },
          });
          if (previous === null) throw new FatwaDataError('not-found');
          if (previous.version !== value.expectedVersion)
            throw new FatwaDataError('conflict');
          const claimed = await tx.fatwaCategory.updateMany({
            where: { id: value.id, version: value.expectedVersion },
            data: {
              topicId: value.topicId,
              position: value.position,
              status: value.status,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (claimed.count !== 1) throw new FatwaDataError('conflict');
          await tx.fatwaCategoryName.deleteMany({ where: { categoryId: value.id } });
          await tx.fatwaCategoryName.createMany({
            data: value.names.map((entry) => ({
              categoryId: value.id,
              locale: entry.locale,
              name: entry.name,
            })),
          });
          await tx.auditLog.create({
            data: categoryAudit({
              actorId,
              action: 'fatwa.category.updated',
              id: value.id,
              before: {
                version: String(previous.version),
                topic: previous.topicId,
                position: String(previous.position),
                status: previous.status,
              },
              after: {
                slug: previous.slug,
                version: String(previous.version + 1),
                topic: value.topicId,
                position: String(value.position),
                status: value.status,
              },
            }),
          });
          // A ruling's projected topics include its category's topic.
          if (previous.topicId !== value.topicId)
            await requestCategoryScopes(tx, value.id);
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
