import 'server-only';

import { randomUUID } from 'node:crypto';

import type { GradingValue, HadithCanonicalPort } from '@minhaj/contracts/hadith';

import { getDatabaseClient } from '../../client.ts';
import { HadithDataError, refuse, uniqueViolationOn, type Client } from './shared.ts';

/**
 * The Hadith adapter's CANONICAL half — the only write path to structure,
 * source-qualified records, their chains and gradings, verification and the
 * public citation mapping (DOMAIN_MODEL.md §9; DELIVERY_PLAN.md Phase 19).
 *
 * EVERY WRITE IS A DATABASE PROCEDURE. This principal holds no INSERT, UPDATE
 * or DELETE on canonical Hadith; it holds EXECUTE on the procedures, which
 * re-verify in SQL the actor's live `hadith.editCanonical` assignment and
 * purpose-bound step-up grant, then the expected version, the structure, the
 * evidence and the gradings, before they write anything. Each one records its
 * own audit entry and the affected citations' search intent in its own
 * transaction, so nothing here duplicates either.
 *
 * EVERY VALUE IS A BOUND PARAMETER. The gradings travel as one JSON document
 * the procedure reads with `OPENJSON`, element by element, in array order; no
 * value is spliced into SQL text and no text is trimmed or re-composed.
 */

/** Exactly the five fields the procedure reads, in a fixed shape and order. */
function gradingsDocument(gradings: readonly GradingValue[]): string {
  return JSON.stringify(
    gradings.map((grading, position) => ({
      position,
      grader: grading.grader,
      label: grading.label,
      labelLanguage: grading.labelLanguage,
      reference: grading.reference,
    })),
  );
}

/** How many conflict rows the write of one version recorded. */
function conflictsOf(tx: Client, hadithId: string, version: number): Promise<number> {
  return tx.hadithConflict.count({ where: { hadithId, hadithVersion: version } });
}

export function createHadithCanonical(): HadithCanonicalPort {
  const db = getDatabaseClient();

  /**
   * A book or chapter holds two caller-chosen unique values, and the database
   * names only the table that refused. Asked AFTER that refusal — never before
   * the procedure has checked the actor's authority — whether the slug is the
   * one taken; otherwise it was the source reference or the position.
   */
  async function duplicateStructure(
    error: unknown,
    table: 'dbo.HadithBook' | 'dbo.HadithChapter',
    slugTaken: () => Promise<boolean>,
  ): Promise<never> {
    if (!uniqueViolationOn(error, table)) refuse(error);
    let taken: boolean;
    try {
      taken = await slugTaken();
    } catch {
      refuse(error);
    }
    throw new HadithDataError(taken ? 'duplicate-slug' : 'duplicate-reference');
  }

  return {
    async createCollection({ authority, value }) {
      const id = randomUUID();
      try {
        await db.$executeRaw`EXEC [dbo].[HadithCreateCollection]
          @id = ${id},
          @slug = ${value.slug},
          @position = ${value.position},
          @actorId = ${authority.actorId},
          @sessionId = ${authority.sessionId},
          @stepUpGrantId = ${authority.stepUpGrantId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
      return { id };
    },

    async createBook({ authority, value }) {
      const id = randomUUID();
      try {
        await db.$executeRaw`EXEC [dbo].[HadithCreateBook]
          @id = ${id},
          @editionId = ${value.editionId},
          @slug = ${value.slug},
          @reference = ${value.reference},
          @position = ${value.position},
          @title = ${value.title},
          @titleLanguage = ${value.titleLanguage},
          @actorId = ${authority.actorId},
          @sessionId = ${authority.sessionId},
          @stepUpGrantId = ${authority.stepUpGrantId},
          @at = ${new Date()}`;
      } catch (error) {
        await duplicateStructure(error, 'dbo.HadithBook', async () => {
          const edition = await db.hadithEdition.findUnique({
            where: { id: value.editionId },
            select: { collectionId: true },
          });
          if (edition === null) return false;
          const book = await db.hadithBook.findUnique({
            where: {
              collectionId_slug: { collectionId: edition.collectionId, slug: value.slug },
            },
            select: { id: true },
          });
          return book !== null;
        });
      }
      return { id };
    },

    async createChapter({ authority, value }) {
      const id = randomUUID();
      try {
        await db.$executeRaw`EXEC [dbo].[HadithCreateChapter]
          @id = ${id},
          @bookId = ${value.bookId},
          @slug = ${value.slug},
          @reference = ${value.reference},
          @position = ${value.position},
          @title = ${value.title},
          @titleLanguage = ${value.titleLanguage},
          @actorId = ${authority.actorId},
          @sessionId = ${authority.sessionId},
          @stepUpGrantId = ${authority.stepUpGrantId},
          @at = ${new Date()}`;
      } catch (error) {
        await duplicateStructure(error, 'dbo.HadithChapter', async () => {
          const chapter = await db.hadithChapter.findUnique({
            where: { bookId_slug: { bookId: value.bookId, slug: value.slug } },
            select: { id: true },
          });
          return chapter !== null;
        });
      }
      return { id };
    },

    /**
     * The record, its version-1 revision, its gradings, the conflict evidence
     * against every disagreeing candidate, its audit entry and its citation's
     * search intent are one procedure call; the count of conflict rows it
     * recorded is read in the same transaction.
     */
    async createRecord({ authority, value }) {
      const id = randomUUID();
      try {
        const conflicts = await db.$transaction(async (tx) => {
          await tx.$executeRaw`EXEC [dbo].[HadithWriteRecord]
            @hadithId = ${id},
            @editionId = ${value.editionId},
            @expectedVersion = ${0},
            @sourceReference = ${value.sourceReference},
            @citationNumber = ${value.citationNumber},
            @bookId = ${value.bookId},
            @chapterId = ${value.chapterId},
            @text = ${value.text},
            @textLanguage = ${value.textLanguage},
            @chain = ${value.chain},
            @chainLanguage = ${value.chainLanguage},
            @gradings = ${gradingsDocument(value.gradings)},
            @evidence = ${value.evidence},
            @reason = ${null},
            @actorId = ${authority.actorId},
            @sessionId = ${authority.sessionId},
            @stepUpGrantId = ${authority.stepUpGrantId},
            @at = ${new Date()}`;
          return conflictsOf(tx, id, 1);
        });
        return { id, version: 1, conflicts };
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Every sourced fact of the next version, under the version the operator
     * reviewed. The record stays in its own edition: the procedure is handed
     * the edition the record already has, never one the caller names.
     */
    async correctRecord({ authority, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const record = await tx.hadith.findUnique({
            where: { id: value.id },
            select: { editionId: true },
          });
          if (record === null) throw new HadithDataError('not-found');
          await tx.$executeRaw`EXEC [dbo].[HadithWriteRecord]
            @hadithId = ${value.id},
            @editionId = ${record.editionId},
            @expectedVersion = ${value.expectedVersion},
            @sourceReference = ${value.sourceReference},
            @citationNumber = ${value.citationNumber},
            @bookId = ${value.bookId},
            @chapterId = ${value.chapterId},
            @text = ${value.text},
            @textLanguage = ${value.textLanguage},
            @chain = ${value.chain},
            @chainLanguage = ${value.chainLanguage},
            @gradings = ${gradingsDocument(value.gradings)},
            @evidence = ${value.evidence},
            @reason = ${value.reason},
            @actorId = ${authority.actorId},
            @sessionId = ${authority.sessionId},
            @stepUpGrantId = ${authority.stepUpGrantId},
            @at = ${new Date()}`;
          // The procedure refuses any version but `expectedVersion` and
          // advances it by exactly one (and the record's trigger enforces both).
          const version = value.expectedVersion + 1;
          return { version, conflicts: await conflictsOf(tx, value.id, version) };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async verifyRecord({ authority, value }) {
      try {
        await db.$executeRaw`EXEC [dbo].[HadithVerifyRecord]
          @id = ${randomUUID()},
          @hadithId = ${value.id},
          @expectedVersion = ${value.expectedVersion},
          @evidence = ${value.evidence},
          @actorId = ${authority.actorId},
          @sessionId = ${authority.sessionId},
          @stepUpGrantId = ${authority.stepUpGrantId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The citation keeps the identity it was created with; a fresh one is
     * offered and used only when the citation does not exist yet. What the
     * procedure wrote is read back in the same transaction.
     */
    async setCitation({ authority, value }) {
      try {
        return await db.$transaction(async (tx) => {
          await tx.$executeRaw`EXEC [dbo].[HadithSetCitation]
            @id = ${randomUUID()},
            @collectionId = ${value.collectionId},
            @number = ${value.number},
            @hadithId = ${value.hadithId},
            @state = ${value.state},
            @expectedVersion = ${value.expectedVersion},
            @evidence = ${value.evidence},
            @reason = ${value.reason},
            @actorId = ${authority.actorId},
            @sessionId = ${authority.sessionId},
            @stepUpGrantId = ${authority.stepUpGrantId},
            @at = ${new Date()}`;
          const citation = await tx.hadithCitation.findUnique({
            where: {
              collectionId_number: {
                collectionId: value.collectionId,
                number: value.number,
              },
            },
            select: { id: true, version: true },
          });
          if (citation === null) throw new HadithDataError('conflict');
          return citation;
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
