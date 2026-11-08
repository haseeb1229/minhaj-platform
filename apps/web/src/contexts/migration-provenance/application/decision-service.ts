import 'server-only';

import {
  clearsFinding,
  disappearanceDecisionSchema,
  findingDecisionSchema,
  duplicateDecisionSchema,
  errorDecisionSchema,
  legacyMappingDecisionSchema,
  MIGRATION_LIMITS,
  reviewBatchSchema,
  reviewDecisionSchema,
  rightsBatchSchema,
  rightsDecisionSchema,
  runApprovalSchema,
  runRightsSchema,
  topicMappingDecisionSchema,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationDecisionPort,
  type MigrationReadPort,
  type MigrationSourcePort,
  type MigrationTopicPort,
} from '@minhaj/contracts/migration';

import {
  MigrationRefusal,
  migrationFailure,
  type MigrationRefusalReason,
} from '../domain/refusal.ts';
import { ADMINISTER, candidateFingerprint, createGate, guarded } from './shared.ts';

/**
 * A person's decisions over what the pipeline produced: review, duplicates,
 * topic mappings, errors, disappearances, asset rights and legacy mappings —
 * every one under `migration.administer`, parsed, at an expected version, and
 * audited by the adapter in the same transaction.
 *
 * The service answers first only to be helpful; the database re-checks each
 * rule (an approval needs a valid revision free of personal data, a merge is
 * never cross-language, a retry needs a retry-eligible error, a disappearance
 * is classified only for a missing record).
 *
 * Dependencies (ports only):
 *  - `decisions` — `MigrationDecisionPort`;
 *  - `read`      — `MigrationReadPort` (`stagedDetail` and, for a cleared
 *                  revision, `personalDataFindings`, to answer an approval helpfully;
 *                  R2: `run` and the run-wide candidate keys a confirmation names);
 *  - `sources`   — `MigrationSourcePort` (`source`: a run's registered hosts, R2);
 *  - `topics`    — `MigrationTopicPort`, Taxonomy's answer;
 *  - `authority` — `MigrationAuthorityPort`;
 *  - `clock`     — injectable for tests.
 */
export function createMigrationDecisionService(deps: {
  readonly decisions: MigrationDecisionPort;
  readonly read: Pick<
    MigrationReadPort,
    | 'stagedDetail'
    | 'personalDataFindings'
    | 'run'
    | 'approvalCandidateKeys'
    | 'hasOpenDuplicate'
    | 'rightsCandidateKeys'
  >;
  readonly sources: Pick<MigrationSourcePort, 'source'>;
  readonly topics: MigrationTopicPort;
  readonly authority: MigrationAuthorityPort;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());
  const gate = createGate(deps.authority);

  /** One review, already authorised: the service's checks, then the port's. */
  async function decide(
    actorId: string,
    value: {
      readonly stagedRecordId: string;
      readonly expectedVersion: number;
      readonly decision: 'approve' | 'reject' | 'withdraw-approval';
      readonly note: string;
    },
    /** R2: what a run-wide approval checks of each revision on top of a single review's rules. */
    alsoBeforeApproval?: (recordId: string) => Promise<void>,
  ): Promise<void> {
    const staged = await guarded(deps.read.stagedDetail(value.stagedRecordId));
    if (staged === null) throw new MigrationRefusal('not-found');
    if (staged.version !== value.expectedVersion) throw new MigrationRefusal('conflict');
    if (value.decision === 'approve') {
      if (staged.review !== 'pending') throw new MigrationRefusal('invalid-state');
      if (staged.validation !== 'valid' || staged.personalData === 'flagged')
        throw new MigrationRefusal('not-publishable');
      // Phase 30-RD: a cleared revision is approved only by somebody who
      // cleared none of its findings, and only while each still stands.
      if (staged.personalData === 'cleared') {
        const clearance =
          staged.clearanceOfStagedRecordId === null
            ? []
            : await guarded(
                deps.read.personalDataFindings(staged.clearanceOfStagedRecordId),
              );
        if (
          clearance.length === 0 ||
          clearance.some((finding) => !clearsFinding(finding.classification))
        )
          throw new MigrationRefusal('not-publishable');
        if (clearance.some((finding) => finding.decidedByUserId === actorId))
          throw new MigrationRefusal('same-person');
      }
      if (alsoBeforeApproval !== undefined) await alsoBeforeApproval(staged.recordId);
    } else if (value.decision === 'reject') {
      // Review moves forward only: an approval is withdrawn first, then rejected.
      if (staged.review !== 'pending') throw new MigrationRefusal('invalid-state');
    } else if (staged.review !== 'approved') {
      throw new MigrationRefusal('invalid-state');
    }
    await guarded(
      deps.decisions.review({
        stagedRecordId: value.stagedRecordId,
        expectedVersion: value.expectedVersion,
        review:
          value.decision === 'approve'
            ? 'approved'
            : value.decision === 'reject'
              ? 'rejected'
              : 'pending',
        note: value.note.length === 0 ? null : value.note,
        actorId,
        now: now(),
      }),
    );
  }

  /**
   * R2. A run whose candidate set a person confirmed: it exists, it COMPLETED
   * and it BALANCED (an unreconciled run's revisions are not acted on in
   * bulk), and its current set is exactly the one shown — same size, same
   * fingerprint — or the act is refused `conflict` before anything is decided.
   */
  async function confirmed(
    value: {
      readonly runId: string;
      readonly expectedCount: number;
      readonly fingerprint: string;
    },
    keysOf: () => Promise<readonly { readonly id: string; readonly version: number }[]>,
  ) {
    const run = await guarded(deps.read.run(value.runId));
    if (run === null) throw new MigrationRefusal('not-found');
    if (run.state !== 'completed' || run.reconciliation !== 'balanced')
      throw new MigrationRefusal('run-unreconciled');
    const keys = await guarded(keysOf());
    if (
      keys.length !== value.expectedCount ||
      candidateFingerprint(keys) !== value.fingerprint
    )
      throw new MigrationRefusal('conflict');
    return { run, keys };
  }

  return {
    /**
     * Phase 30-RD. One person's classification of one personal-data finding —
     * the actor Identity minted for `migration.clearPersonalData` with a live
     * `migration-personal-data` step-up, re-verified here; the database
     * checks a third time. Only a pending flagged revision's finding is
     * decided; the next replay of the same bytes reads the decisions.
     */
    async classifyFinding(actor: unknown, input: unknown): Promise<void> {
      const actorId = await guarded(deps.authority.verifyClearer(actor));
      if (actorId === null) throw new MigrationRefusal('denied');
      const parsed = findingDecisionSchema.safeParse(input);
      if (!parsed.success) throw new MigrationRefusal('invalid');
      await guarded(
        deps.decisions.classifyFinding({
          findingId: parsed.data.findingId,
          expectedVersion: parsed.data.expectedVersion,
          classification: parsed.data.classification,
          note: parsed.data.note,
          actorId,
          now: now(),
        }),
      );
    },

    /** approve | reject | withdraw-approval of one staged revision. */
    async review(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        reviewDecisionSchema,
        input,
      );
      await decide(actorId, value);
    },

    /**
     * approve | reject a bounded selection the reviewer named, each item at the
     * version they saw. Every item is checked and audited on its own — an
     * invalid, flagged, changed or already-decided revision is refused for
     * that item only and reported, never forced.
     */
    async reviewMany(
      actor: MigrationActor,
      input: unknown,
    ): Promise<{
      readonly decided: number;
      readonly refused: readonly {
        readonly stagedRecordId: string;
        readonly reason: MigrationRefusalReason;
      }[];
    }> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        reviewBatchSchema,
        input,
      );
      let decided = 0;
      const refused: { stagedRecordId: string; reason: MigrationRefusalReason }[] = [];
      for (const item of value.items) {
        try {
          await decide(actorId, { ...item, decision: value.decision, note: value.note });
          decided += 1;
        } catch (error) {
          const reason = migrationFailure(error);
          // An outage is not a per-item verdict: stop, report what was done.
          if (reason === 'unavailable') throw error;
          refused.push({ stagedRecordId: item.stagedRecordId, reason });
        }
      }
      return { decided, refused };
    },

    /**
     * merge | distinct | reopen one duplicate candidate. A cross-language pair
     * is refused `cross-language` by the adapter and, again, by the database.
     */
    async duplicate(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        duplicateDecisionSchema,
        input,
      );
      await guarded(
        deps.decisions.decideDuplicate({
          candidateId: value.candidateId,
          expectedVersion: value.expectedVersion,
          state:
            value.decision === 'merge'
              ? 'merged'
              : value.decision === 'distinct'
                ? 'distinct'
                : 'open',
          note: value.note.length === 0 ? null : value.note,
          actorId,
          now: now(),
        }),
      );
    },

    /**
     * confirm (to a Topic Taxonomy says exists now) | exclude | reopen. A
     * mapping is never decided by similarity — only by this act.
     */
    async topicMapping(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        topicMappingDecisionSchema,
        input,
      );
      if (value.decision === 'confirm') {
        if (value.topicId === null) throw new MigrationRefusal('invalid');
        let existing: ReadonlySet<string>;
        try {
          existing = await deps.topics.existingTopics([value.topicId]);
        } catch {
          throw new MigrationRefusal('unavailable');
        }
        if (!existing.has(value.topicId)) throw new MigrationRefusal('topic-unknown');
      } else if (value.topicId !== null) {
        throw new MigrationRefusal('invalid');
      }
      await guarded(
        deps.decisions.decideTopicMapping({
          mappingId: value.mappingId,
          expectedVersion: value.expectedVersion,
          state:
            value.decision === 'confirm'
              ? 'confirmed'
              : value.decision === 'exclude'
                ? 'excluded'
                : 'unmapped',
          topicId: value.topicId,
          actorId,
          now: now(),
        }),
      );
    },

    /** retry (a retry-eligible error only — `not-retryable` otherwise) | dismiss. */
    async error(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        errorDecisionSchema,
        input,
      );
      await guarded(
        deps.decisions.decideError({
          errorId: value.errorId,
          expectedVersion: value.expectedVersion,
          resolution: value.decision === 'retry' ? 'retry-requested' : 'dismissed',
          actorId,
          now: now(),
        }),
      );
    },

    /** Classifies a MISSING record. Deletes and unpublishes nothing. */
    async disappearance(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        disappearanceDecisionSchema,
        input,
      );
      await guarded(
        deps.decisions.classifyDisappearance({
          recordId: value.recordId,
          expectedVersion: value.expectedVersion,
          classification: value.classification,
          note: value.note.length === 0 ? null : value.note,
          actorId,
          now: now(),
        }),
      );
    },

    /**
     * One acquisition's rights. Only organisation-owned or licensed material
     * may become eligible for public release (a database CHECK too).
     */
    async rights(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        rightsDecisionSchema,
        input,
      );
      if (
        value.visibility === 'public-eligible' &&
        value.licence !== 'organisation-owned' &&
        value.licence !== 'licensed'
      )
        throw new MigrationRefusal('invalid');
      await guarded(deps.decisions.decideRights({ ...value, actorId, now: now() }));
    },

    /**
     * Phase 30-R. A reviewer clears a SELECTION of one page of acquisitions
     * for release: each is decided on its own, at the version the reviewer
     * saw, with the evidence and holder the reviewer stated — and audited on
     * its own by the adapter, exactly as a single decision. One refused item
     * (moved since, decided since) does not undo the others; an outage stops
     * the batch and is reported, never mistaken for a verdict.
     */
    async rightsBatch(
      actor: MigrationActor,
      input: unknown,
    ): Promise<{
      readonly decided: number;
      readonly refused: readonly {
        readonly provenanceId: string;
        readonly reason: MigrationRefusalReason;
      }[];
    }> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        rightsBatchSchema,
        input,
      );
      let decided = 0;
      const refused: { provenanceId: string; reason: MigrationRefusalReason }[] = [];
      for (const item of value.items) {
        try {
          await guarded(
            deps.decisions.decideRights({
              provenanceId: item.provenanceId,
              expectedVersion: item.expectedVersion,
              licence: value.licence,
              visibility: 'public-eligible',
              licenceEvidence: value.licenceEvidence,
              rightsHolder: value.rightsHolder,
              actorId,
              now: now(),
            }),
          );
          decided += 1;
        } catch (error) {
          const reason = migrationFailure(error);
          // An outage is not a per-item verdict: stop, report what was done.
          if (reason === 'unavailable') throw error;
          refused.push({ provenanceId: item.provenanceId, reason });
        }
      }
      return { decided, refused };
    },

    /**
     * R2. APPROVES A RUN'S CONFIRMED CANDIDATE SET, one slice per act: the
     * person was shown the whole set (pending, valid, free of personal data,
     * of a publishable kind) and confirms its size and fingerprint; the first
     * `runChunk` of it is then decided item by item through the single
     * review's own path — its checks, the database's, and one audited approval
     * per revision attributed to the person — and, just before each, the
     * question whether an OPEN duplicate candidate now names its record
     * (`duplicate-open`: a pair opened after the set was read). Nothing is
     * decided in bulk, and a refused item is reported, never forced. The page then shows what
     * remains, under a new fingerprint, for the next confirmation.
     */
    async approveRun(
      actor: MigrationActor,
      input: unknown,
    ): Promise<{
      readonly decided: number;
      readonly refused: readonly {
        readonly stagedRecordId: string;
        readonly reason: MigrationRefusalReason;
      }[];
      readonly remaining: number;
    }> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        runApprovalSchema,
        input,
      );
      const { keys } = await confirmed(value, () =>
        deps.read.approvalCandidateKeys(value.runId, MIGRATION_LIMITS.runCandidates),
      );
      let decided = 0;
      const refused: { stagedRecordId: string; reason: MigrationRefusalReason }[] = [];
      for (const key of keys.slice(0, MIGRATION_LIMITS.runChunk)) {
        try {
          // A duplicate opened since the set was read: the fingerprint names
          // versions, not pairs, so each record is asked again just before.
          await decide(
            actorId,
            {
              stagedRecordId: key.id,
              expectedVersion: key.version,
              decision: 'approve',
              note: value.note,
            },
            async (recordId) => {
              if (await guarded(deps.read.hasOpenDuplicate(recordId)))
                throw new MigrationRefusal('duplicate-open');
            },
          );
          decided += 1;
        } catch (error) {
          const reason = migrationFailure(error);
          // An outage is not a per-item verdict: stop, report what was done.
          if (reason === 'unavailable') throw error;
          refused.push({ stagedRecordId: key.id, reason });
        }
      }
      return { decided, refused, remaining: keys.length - decided };
    },

    /**
     * R2. CLEARS FOR RELEASE A RUN'S CONFIRMED PICTURES ON ONE REGISTERED
     * HOST, one slice per act: only restricted acquisitions on a page or asset
     * host the run's source registers, whose source itself stated
     * organisational ownership with evidence, and which have a public copy the
     * person was shown. Unknown rights are never in the set. Each acquisition
     * is decided — and audited — on its own, under the licence, evidence and
     * holder the person states.
     */
    async rightsRun(
      actor: MigrationActor,
      input: unknown,
    ): Promise<{
      readonly decided: number;
      readonly refused: readonly {
        readonly provenanceId: string;
        readonly reason: MigrationRefusalReason;
      }[];
      readonly remaining: number;
    }> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        runRightsSchema,
        input,
      );
      const run = await guarded(deps.read.run(value.runId));
      if (run === null) throw new MigrationRefusal('not-found');
      const source = await guarded(deps.sources.source(run.sourceId));
      if (
        source === null ||
        (!source.hosts.includes(value.host) && !source.assetHosts.includes(value.host))
      )
        throw new MigrationRefusal('invalid');
      const { keys } = await confirmed(value, () =>
        deps.read.rightsCandidateKeys(
          value.runId,
          value.host,
          MIGRATION_LIMITS.runCandidates,
        ),
      );
      let decided = 0;
      const refused: { provenanceId: string; reason: MigrationRefusalReason }[] = [];
      for (const key of keys.slice(0, MIGRATION_LIMITS.runChunk)) {
        try {
          await guarded(
            deps.decisions.decideRights({
              provenanceId: key.id,
              expectedVersion: key.version,
              licence: value.licence,
              visibility: 'public-eligible',
              licenceEvidence: value.licenceEvidence,
              rightsHolder: value.rightsHolder,
              actorId,
              now: now(),
            }),
          );
          decided += 1;
        } catch (error) {
          const reason = migrationFailure(error);
          if (reason === 'unavailable') throw error;
          refused.push({ provenanceId: key.id, reason });
        }
      }
      return { decided, refused, remaining: keys.length - decided };
    },

    /** Disables or re-enables one legacy mapping (and so its 301). */
    async legacyMapping(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        legacyMappingDecisionSchema,
        input,
      );
      await guarded(
        deps.decisions.decideLegacyMapping({ ...value, actorId, now: now() }),
      );
    },
  };
}

export type MigrationDecisionService = ReturnType<typeof createMigrationDecisionService>;
