import 'server-only';

import type { z } from 'zod';

import type { PrivilegedActor } from '@minhaj/contracts/identity';
import {
  bookCreateSchema,
  chapterCreateSchema,
  citationSetSchema,
  collectionCreateSchema,
  recordCorrectionSchema,
  recordCreateSchema,
  recordVerificationSchema,
  type HadithAuthorityPort,
  type HadithCanonicalAuthority,
  type HadithCanonicalPort,
} from '@minhaj/contracts/hadith';

import { HadithRefusal, asRefusal } from '../domain/refusal.ts';

/**
 * The CANONICAL Hadith operations — structure, source-qualified records with
 * their chains and gradings, human verification and the public citation
 * mapping (DOMAIN_MODEL.md §9; SECURITY_BASELINE.md §8.1).
 *
 * THE ONLY APPLICATION PATH TO A SOURCED FACT, AND IT IS NOT THE LAST GATE.
 * Each operation:
 *
 *   1. re-verifies the PrivilegedActor through Identity — this exact minted
 *      object, `hadith.editCanonical`, a complete second-factor posture and a
 *      live step-up grant for the `hadith-canonical-edit` purpose. A grant
 *      earned for a Quran correction, privilege administration or a second
 *      factor answers no, and a look-alike object answers no;
 *   2. parses the operator's input with the contract's strict schema — exact
 *      text is refused rather than repaired;
 *   3. hands the database procedure the verified authority ids, and the
 *      procedure checks permission, grant, edition, structure, expected
 *      version, candidacy, verification and conflict evidence AGAIN before it
 *      writes. This service passing is necessary, never sufficient.
 *
 * NO TEXT IS LOGGED. What is written to the log is identifiers, citation
 * numbers, versions and counts — never a word of a record, a chain, a grading,
 * a grader, a source reference, evidence or a reason.
 */

/** What may reach the log: identifiers, citation numbers, versions and counts. */
export interface HadithCanonicalLogDetail {
  readonly operation:
    | 'hadith.collection.create'
    | 'hadith.book.create'
    | 'hadith.chapter.create'
    | 'hadith.record.create'
    | 'hadith.record.correct'
    | 'hadith.record.verify'
    | 'hadith.citation.set';
  readonly outcome: 'passed' | 'denied';
  readonly actorId?: string;
  readonly id?: string;
  readonly collectionId?: string;
  readonly number?: number;
  readonly version?: number;
  readonly conflicts?: number;
}

/** The structured logger's narrow face, handed in by Layer 4. */
export interface HadithCanonicalLog {
  info(detail: HadithCanonicalLogDetail, message: string): void;
  warn(detail: HadithCanonicalLogDetail, message: string): void;
}

type Operation = HadithCanonicalLogDetail['operation'];

export function createHadithCanonicalService(deps: {
  readonly canonical: HadithCanonicalPort;
  readonly authority: HadithAuthorityPort;
  readonly log?: HadithCanonicalLog;
}) {
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  /** Identity's answer, asked first and asked live. Anything but `true` is no. */
  async function verified(
    actor: PrivilegedActor,
    operation: Operation,
  ): Promise<HadithCanonicalAuthority> {
    if (
      actor === null ||
      typeof actor !== 'object' ||
      (await deps.authority.verifyCanonical(actor)) !== true
    ) {
      deps.log?.warn({ operation, outcome: 'denied' }, 'Canonical Hadith edit refused.');
      throw new HadithRefusal('denied');
    }
    return {
      actorId: actor.accountId,
      sessionId: actor.sessionId,
      stepUpGrantId: actor.stepUpGrantId,
    };
  }

  /** Verified first, parsed second: an unauthorised caller learns nothing of the rules. */
  async function authorised<S extends z.ZodType>(
    actor: PrivilegedActor,
    operation: Operation,
    schema: S,
    input: unknown,
  ): Promise<{ authority: HadithCanonicalAuthority; value: z.output<S> }> {
    const authority = await verified(actor, operation);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HadithRefusal('invalid');
    return { authority, value: parsed.data };
  }

  const passed = (detail: HadithCanonicalLogDetail, message: string) =>
    deps.log?.info(detail, message);

  return {
    async createCollection(
      actor: PrivilegedActor,
      input: z.input<typeof collectionCreateSchema>,
    ) {
      const operation = 'hadith.collection.create';
      const call = await authorised(actor, operation, collectionCreateSchema, input);
      const created = await run(deps.canonical.createCollection(call));
      passed(
        { operation, outcome: 'passed', actorId: call.authority.actorId, id: created.id },
        'Hadith collection created.',
      );
      return created;
    },

    async createBook(actor: PrivilegedActor, input: z.input<typeof bookCreateSchema>) {
      const operation = 'hadith.book.create';
      const call = await authorised(actor, operation, bookCreateSchema, input);
      const created = await run(deps.canonical.createBook(call));
      passed(
        { operation, outcome: 'passed', actorId: call.authority.actorId, id: created.id },
        'Hadith book created.',
      );
      return created;
    },

    async createChapter(
      actor: PrivilegedActor,
      input: z.input<typeof chapterCreateSchema>,
    ) {
      const operation = 'hadith.chapter.create';
      const call = await authorised(actor, operation, chapterCreateSchema, input);
      const created = await run(deps.canonical.createChapter(call));
      passed(
        { operation, outcome: 'passed', actorId: call.authority.actorId, id: created.id },
        'Hadith chapter created.',
      );
      return created;
    },

    /** A new source-qualified record at version 1; disagreement is recorded, never resolved. */
    async createRecord(
      actor: PrivilegedActor,
      input: z.input<typeof recordCreateSchema>,
    ) {
      const operation = 'hadith.record.create';
      const call = await authorised(actor, operation, recordCreateSchema, input);
      const created = await run(deps.canonical.createRecord(call));
      passed(
        {
          operation,
          outcome: 'passed',
          actorId: call.authority.actorId,
          id: created.id,
          version: created.version,
          conflicts: created.conflicts,
        },
        'Hadith record created.',
      );
      return created;
    },

    /** Every sourced fact replaced under the expected version, with its reason. */
    async correctRecord(
      actor: PrivilegedActor,
      input: z.input<typeof recordCorrectionSchema>,
    ) {
      const operation = 'hadith.record.correct';
      const call = await authorised(actor, operation, recordCorrectionSchema, input);
      const corrected = await run(deps.canonical.correctRecord(call));
      passed(
        {
          operation,
          outcome: 'passed',
          actorId: call.authority.actorId,
          id: call.value.id,
          version: corrected.version,
          conflicts: corrected.conflicts,
        },
        'Hadith record corrected.',
      );
      return corrected;
    },

    /** A human verification of exactly the version the operator reviewed. */
    async verifyRecord(
      actor: PrivilegedActor,
      input: z.input<typeof recordVerificationSchema>,
    ) {
      const operation = 'hadith.record.verify';
      const call = await authorised(actor, operation, recordVerificationSchema, input);
      await run(deps.canonical.verifyRecord(call));
      passed(
        {
          operation,
          outcome: 'passed',
          actorId: call.authority.actorId,
          id: call.value.id,
          version: call.value.expectedVersion,
        },
        'Hadith record verified.',
      );
    },

    /** Maps a public citation to one candidate, or withdraws it. */
    async setCitation(actor: PrivilegedActor, input: z.input<typeof citationSetSchema>) {
      const operation = 'hadith.citation.set';
      const call = await authorised(actor, operation, citationSetSchema, input);
      const set = await run(deps.canonical.setCitation(call));
      passed(
        {
          operation,
          outcome: 'passed',
          actorId: call.authority.actorId,
          id: set.id,
          collectionId: call.value.collectionId,
          number: call.value.number,
          version: set.version,
        },
        'Hadith citation set.',
      );
      return set;
    },
  };
}

export type HadithCanonicalService = ReturnType<typeof createHadithCanonicalService>;
