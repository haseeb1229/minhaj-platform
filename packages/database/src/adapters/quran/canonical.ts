import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  citationOf,
  QURAN_LIMITS,
  type QuranCanonicalPort,
} from '@minhaj/contracts/quran';

import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
import { CANONICAL_ORDER, refuse } from './shared.ts';

/**
 * The Quran adapter's CANONICAL half — the only write path to canonical Arabic
 * and structure (DOMAIN_MODEL.md §8; DELIVERY_PLAN.md Phase 18).
 *
 * EVERY WRITE IS A DATABASE PROCEDURE. This principal holds no INSERT, UPDATE
 * or DELETE on Juz, Surah, Ayah, their history or the verification evidence;
 * it holds EXECUTE on three procedures, which re-verify in SQL the actor's live
 * `quran.editCanonical` assignment and purpose-bound step-up grant, the source,
 * the expected version and the exact text before they write anything. Nothing
 * here composes canonical text: acceptance copies the SOURCE's own rows after
 * the database proves the candidate equal to them, and a correction writes the
 * source's text after proving the reviewed text equal to it.
 *
 * EVERY VALUE IS A BOUND PARAMETER. The candidate travels as one JSON document
 * the procedure reads with `OPENJSON`; no value is spliced into SQL text.
 */

export function createQuranCanonical(): QuranCanonicalPort {
  const db = getDatabaseClient();
  return {
    async sourceCorpus(sourceId) {
      const rows = await db.quranSourceAyah.findMany({
        where: { sourceId },
        select: { surahNumber: true, ayahNumber: true, juzNumber: true, text: true },
        orderBy: [...CANONICAL_ORDER],
        // A source larger than a corpus can be is truncated here, and the
        // verifier then reports the candidate's surplus — it fails closed.
        take: QURAN_LIMITS.corpusAyat,
      });
      return rows.map((row) => ({
        surah: row.surahNumber,
        ayah: row.ayahNumber,
        juz: row.juzNumber,
        text: row.text,
      }));
    },

    async acceptCorpus({ authority, sourceId, candidate }) {
      const runId = randomUUID();
      // Exactly the four fields the procedure reads, in a fixed shape; the text
      // is carried as supplied, never trimmed or re-composed.
      const document = JSON.stringify(
        candidate.map((entry) => ({
          surah: entry.surah,
          ayah: entry.ayah,
          juz: entry.juz,
          text: entry.text,
        })),
      );
      try {
        await db.$executeRaw`EXEC [dbo].[QuranAcceptCorpus]
          @runId = ${runId},
          @sourceId = ${sourceId},
          @candidate = ${document},
          @actorId = ${authority.actorId},
          @sessionId = ${authority.sessionId},
          @stepUpGrantId = ${authority.stepUpGrantId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
      // The procedure accepts exactly the candidate's ayat or nothing.
      return { runId, ayat: candidate.length };
    },

    /**
     * The correction and its durable search intent commit together: the
     * procedure's own transaction nests inside this one, so a refusal anywhere
     * leaves neither the new text nor a request for it.
     */
    async correctAyah({
      authority,
      ref,
      expectedVersion,
      sourceId,
      reviewedText,
      reason,
    }) {
      const runId = randomUUID();
      try {
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`EXEC [dbo].[QuranCorrectAyah]
            @runId = ${runId},
            @surah = ${ref.surah},
            @ayah = ${ref.ayah},
            @expectedVersion = ${expectedVersion},
            @sourceId = ${sourceId},
            @reviewedText = ${reviewedText},
            @reason = ${reason},
            @actorId = ${authority.actorId},
            @sessionId = ${authority.sessionId},
            @stepUpGrantId = ${authority.stepUpGrantId},
            @at = ${new Date()}`;
          await requestSearchIndexing(tx, 'quran-ayah', citationOf(ref));
        });
      } catch (error) {
        refuse(error);
      }
      // The procedure refuses any version but `expectedVersion` and advances it
      // by exactly one (and the Ayah trigger enforces both).
      return { runId, version: expectedVersion + 1 };
    },

    async recordFailure({ actorId, kind, sourceId, checked, mismatches, first }) {
      const runId = randomUUID();
      try {
        await db.$executeRaw`EXEC [dbo].[QuranRecordVerificationFailure]
          @runId = ${runId},
          @kind = ${kind},
          @sourceId = ${sourceId},
          @checked = ${checked},
          @mismatches = ${mismatches},
          @firstSurah = ${first?.ref?.surah ?? null},
          @firstAyah = ${first?.ref?.ayah ?? null},
          @firstOffset = ${first?.offset ?? null},
          @firstReason = ${first?.reason ?? null},
          @actorId = ${actorId},
          @at = ${new Date()}`;
      } catch (error) {
        refuse(error);
      }
      return { runId };
    },
  };
}
