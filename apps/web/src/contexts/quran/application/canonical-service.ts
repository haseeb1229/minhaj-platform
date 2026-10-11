import 'server-only';

import type { PrivilegedActor } from '@minhaj/contracts/identity';
import {
  ayahCorrectionSchema,
  citationOf,
  corpusAcceptanceSchema,
  type AyahCorrectionValue,
  type CanonicalAuthority,
  type CorpusAcceptanceValue,
  type QuranAuthorityPort,
  type QuranCanonicalPort,
  type QuranPersistencePort,
  type VerificationMismatch,
  type VerificationReport,
} from '@minhaj/contracts/quran';

import { QuranRefusal, asRefusal } from '../domain/refusal.ts';
import { compareExact, reportOf, verifyCorpus } from '../domain/verification.ts';

/**
 * The CANONICAL authority operations — accepting a verified corpus and
 * correcting one Ayah against a registered source (DOMAIN_MODEL.md §8.2,
 * §19.8; SECURITY_BASELINE.md §8.1).
 *
 * THE ONLY APPLICATION PATH TO CANONICAL ARABIC, AND IT IS NOT THE LAST GATE.
 * Each operation:
 *
 *   1. re-verifies the PrivilegedActor through Identity — this exact minted
 *      object, `quran.editCanonical`, a complete second-factor posture and a
 *      live step-up grant for the `quran-canonical-edit` purpose. A grant earned
 *      for privilege administration or a second factor answers no, and a
 *      look-alike object answers no;
 *   2. verifies the operator's text against the source HERE, code point for
 *      code point with no normalisation, so a mismatch is evidence with a
 *      reference and an offset rather than a bare refusal;
 *   3. on a mismatch, records that failure as immutable, content-free evidence
 *      and writes NOTHING canonical;
 *   4. otherwise hands the database procedure the verified authority ids, and
 *      the procedure checks permission, grant, source, expected version and the
 *      exact bytes AGAIN before it writes. This service passing is necessary,
 *      never sufficient.
 *
 * NO TEXT IS LOGGED. What is written to the log is identifiers, references,
 * counts and offsets — never a word of the candidate, the source or the Ayah.
 */

export type CorpusAcceptanceOutcome =
  | { readonly ok: true; readonly runId: string; readonly ayat: number }
  | { readonly ok: false; readonly runId: string; readonly report: VerificationReport };

export type AyahCorrectionOutcome =
  | { readonly ok: true; readonly runId: string; readonly version: number }
  | { readonly ok: false; readonly runId: string; readonly report: VerificationReport };

/** The first mismatch, as the log carries it: a category, a citation, an offset. */
export interface LoggedMismatch {
  readonly reason: string;
  readonly ref: string | null;
  readonly offset: number | null;
}

/** What may reach the log: identifiers, references, counts and offsets. */
export interface CanonicalLogDetail {
  readonly operation: 'quran.corpus.accept' | 'quran.ayah.correct';
  readonly outcome: 'passed' | 'failed' | 'denied';
  readonly actorId?: string;
  readonly sourceId?: string;
  readonly runId?: string;
  readonly ref?: string;
  readonly checked?: number;
  readonly mismatches?: number;
  readonly first?: LoggedMismatch | null;
  readonly ayat?: number;
  readonly version?: number;
}

/** The structured logger's narrow face, handed in by Layer 4. */
export interface CanonicalLog {
  info(detail: CanonicalLogDetail, message: string): void;
  warn(detail: CanonicalLogDetail, message: string): void;
}

function firstOf(report: VerificationReport): LoggedMismatch | null {
  const first = report.mismatches[0];
  return first === undefined
    ? null
    : {
        reason: first.reason,
        ref: first.ref === null ? null : citationOf(first.ref),
        offset: first.offset,
      };
}

export function createQuranCanonicalService(deps: {
  readonly canonical: QuranCanonicalPort;
  readonly persistence: QuranPersistencePort;
  readonly authority: QuranAuthorityPort;
  readonly log?: CanonicalLog;
}) {
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  /** Identity's answer, asked first and asked live. Anything but `true` is no. */
  async function verified(
    actor: PrivilegedActor,
    operation: CanonicalLogDetail['operation'],
  ): Promise<CanonicalAuthority> {
    if (
      actor === null ||
      typeof actor !== 'object' ||
      (await deps.authority.verifyCanonical(actor)) !== true
    ) {
      deps.log?.warn({ operation, outcome: 'denied' }, 'Canonical Quran edit refused.');
      throw new QuranRefusal('denied');
    }
    return {
      actorId: actor.accountId,
      sessionId: actor.sessionId,
      stepUpGrantId: actor.stepUpGrantId,
    };
  }

  /** A registered source, or `not-found` — evidence cannot name an unknown one. */
  async function registered(sourceId: string): Promise<void> {
    if ((await run(deps.persistence.source(sourceId))) === null)
      throw new QuranRefusal('not-found');
  }

  /** Records a failed verification as evidence; nothing canonical is written. */
  async function recordFailure(
    kind: 'corpus-acceptance' | 'ayah-correction',
    operation: CanonicalLogDetail['operation'],
    authority: CanonicalAuthority,
    sourceId: string,
    report: VerificationReport,
  ): Promise<string> {
    const { runId } = await run(
      deps.canonical.recordFailure({
        actorId: authority.actorId,
        kind,
        sourceId,
        checked: report.checked,
        mismatches: report.mismatchCount,
        first: report.mismatches[0] ?? null,
      }),
    );
    deps.log?.warn(
      {
        operation,
        outcome: 'failed',
        actorId: authority.actorId,
        sourceId,
        runId,
        checked: report.checked,
        mismatches: report.mismatchCount,
        first: firstOf(report),
      },
      'Canonical Quran verification failed; nothing was written.',
    );
    return runId;
  }

  return {
    /**
     * Accepts a candidate corpus that equals a registered source EXACTLY.
     *
     * The canonical store is materialised by the procedure FROM THE SOURCE'S
     * OWN ROWS after it re-compares the candidate byte for byte — the candidate
     * is the operator's proof of what they reviewed, not the text that is kept.
     */
    async acceptCorpus(
      actor: PrivilegedActor,
      value: CorpusAcceptanceValue,
    ): Promise<CorpusAcceptanceOutcome> {
      const authority = await verified(actor, 'quran.corpus.accept');
      const parsed = corpusAcceptanceSchema.safeParse(value);
      if (!parsed.success) throw new QuranRefusal('invalid');
      const { sourceId, candidate } = parsed.data;

      await registered(sourceId);
      const reference = await run(deps.canonical.sourceCorpus(sourceId));
      const report = verifyCorpus(reference, candidate);

      if (!report.passed) {
        const runId = await recordFailure(
          'corpus-acceptance',
          'quran.corpus.accept',
          authority,
          sourceId,
          report,
        );
        return { ok: false, runId, report };
      }

      const accepted = await run(
        deps.canonical.acceptCorpus({ authority, sourceId, candidate }),
      );
      deps.log?.info(
        {
          operation: 'quran.corpus.accept',
          outcome: 'passed',
          actorId: authority.actorId,
          sourceId,
          runId: accepted.runId,
          checked: report.checked,
          ayat: accepted.ayat,
        },
        'Canonical Quran corpus accepted.',
      );
      return { ok: true, runId: accepted.runId, ayat: accepted.ayat };
    },

    /**
     * Replaces one Ayah's text with the source's text for it.
     *
     * The operator submits the exact text they reviewed; it must BE the
     * source's text, so the approval binds to what was read. A source that does
     * not carry the Ayah is an `unknown-reference`, and any differing code
     * point is a `text-mismatch` at its offset — both recorded, neither written.
     */
    async correctAyah(
      actor: PrivilegedActor,
      value: AyahCorrectionValue,
    ): Promise<AyahCorrectionOutcome> {
      const authority = await verified(actor, 'quran.ayah.correct');
      const parsed = ayahCorrectionSchema.safeParse(value);
      if (!parsed.success) throw new QuranRefusal('invalid');
      const { surah, ayah, expectedVersion, sourceId, reviewedText, reason } =
        parsed.data;
      const ref = { surah, ayah };

      await registered(sourceId);
      const sourceText = await run(deps.persistence.sourceText(sourceId, ref));

      let mismatch: VerificationMismatch | null = null;
      if (sourceText === null) {
        mismatch = { reason: 'unknown-reference', ref, offset: null };
      } else {
        const offset = compareExact(reviewedText, sourceText);
        if (offset !== null) mismatch = { reason: 'text-mismatch', ref, offset };
      }

      if (mismatch !== null) {
        const report = reportOf(1, [mismatch]);
        const runId = await recordFailure(
          'ayah-correction',
          'quran.ayah.correct',
          authority,
          sourceId,
          report,
        );
        return { ok: false, runId, report };
      }

      const corrected = await run(
        deps.canonical.correctAyah({
          authority,
          ref,
          expectedVersion,
          sourceId,
          reviewedText,
          reason,
        }),
      );
      deps.log?.info(
        {
          operation: 'quran.ayah.correct',
          outcome: 'passed',
          actorId: authority.actorId,
          sourceId,
          runId: corrected.runId,
          ref: citationOf(ref),
          version: corrected.version,
        },
        'Canonical Quran Ayah corrected.',
      );
      return { ok: true, runId: corrected.runId, version: corrected.version };
    },
  };
}

export type QuranCanonicalService = ReturnType<typeof createQuranCanonicalService>;
