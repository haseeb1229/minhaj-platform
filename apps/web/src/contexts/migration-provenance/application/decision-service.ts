import 'server-only';

import {
  disappearanceDecisionSchema,
  duplicateDecisionSchema,
  errorDecisionSchema,
  legacyMappingDecisionSchema,
  reviewBatchSchema,
  reviewDecisionSchema,
  rightsBatchSchema,
  rightsDecisionSchema,
  topicMappingDecisionSchema,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationDecisionPort,
  type MigrationReadPort,
  type MigrationTopicPort,
} from '@minhaj/contracts/migration';

import {
  MigrationRefusal,
  migrationFailure,
  type MigrationRefusalReason,
} from '../domain/refusal.ts';
import { ADMINISTER, createGate, guarded } from './shared.ts';

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
 *  - `read`      — `MigrationReadPort` (`stagedDetail`, to answer an approval helpfully);
 *  - `topics`    — `MigrationTopicPort`, Taxonomy's answer;
 *  - `authority` — `MigrationAuthorityPort`;
 *  - `clock`     — injectable for tests.
 */
export function createMigrationDecisionService(deps: {
  readonly decisions: MigrationDecisionPort;
  readonly read: Pick<MigrationReadPort, 'stagedDetail'>;
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
  ): Promise<void> {
    const staged = await guarded(deps.read.stagedDetail(value.stagedRecordId));
    if (staged === null) throw new MigrationRefusal('not-found');
    if (staged.version !== value.expectedVersion) throw new MigrationRefusal('conflict');
    if (value.decision === 'approve') {
      if (staged.review !== 'pending') throw new MigrationRefusal('invalid-state');
      if (staged.validation !== 'valid' || staged.personalData !== 'none')
        throw new MigrationRefusal('not-publishable');
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

  return {
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
