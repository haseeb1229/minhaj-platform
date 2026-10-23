import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  MIGRATION_LIMITS,
  manifestCommandSchema,
  manifestCreateSchema,
  rollbackCommandSchema,
  stagedVideoPayloadSchema,
  type ManifestEntryRecord,
  type ManifestRecord,
  type ManifestState,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationPublicationPort,
  type MigrationPublicationTargetPort,
  type MigrationReadPort,
  type StagedVideoPayload,
  type TargetInspection,
  type TargetPublication,
  type TargetWithdrawal,
} from '@minhaj/contracts/migration';

import { legacyUrlDigest } from '../domain/links.ts';
import { MigrationRefusal } from '../domain/refusal.ts';
import { ADMINISTER, createGate, guarded } from './shared.ts';

export interface PublicationSummary {
  readonly manifestId: string;
  readonly state: ManifestState;
  /** Entries this invocation published (or rolled back). */
  readonly done: number;
  /** Entries this invocation recorded as refused (or rollback-refused). */
  readonly refused: number;
  /** Why it stopped short, when it did; the manifest stays resumable. */
  readonly stopped: 'target-unavailable' | null;
}

/** A target's refusal, reduced to a short code the entry may store. */
function refusalCode(reason: string): string {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(reason) ? reason : 'target-refused';
}

/** A canonical path the legacy mapping may store: site-relative, single slash, bounded. */
function usablePath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    path.length <= 400 &&
    !/[\s\\]/.test(path)
  );
}

function payloadOf(json: string): StagedVideoPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = stagedVideoPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * PUBLICATION AND ITS REVERSAL (MIGRATION_STRATEGY.md §4.12, §6.3, §7).
 *
 * Migration publishes INTO a target through the target's own public interface
 * (`MigrationPublicationTargetPort`, composed at Layer 4) — never its tables —
 * so every target rule, its authority included, applies to migrated content
 * exactly as to hand-authored content. A target's refusal is final.
 *
 * THREE GATES. Publication and rollback take a PRIVILEGED actor (Identity's
 * gate for `migration.publish` + a live `migration-publication` step-up),
 * re-verified here through `verifyPublisher`; the database re-checks a third
 * time when the manifest moves.
 *
 * RESUMABLE. An entry is claimed before the target is asked, so a crash is
 * resumed by ADOPTION (the target's publish is idempotent per entry), and an
 * unavailable target stops the run with the manifest still `publishing` (or
 * `rolling-back`) for the next invocation. Rollback never touches raw
 * snapshots, staged records or assets.
 *
 * Dependencies (ports only):
 *  - `publication` — `MigrationPublicationPort`;
 *  - `read`        — `MigrationReadPort` (`run`, to refuse an unreconciled run helpfully);
 *  - `target`      — `MigrationPublicationTargetPort` (Layer 4: Media's public service);
 *  - `authority`   — `MigrationAuthorityPort`;
 *  - `ids`, `clock` — injectable for tests.
 */
export function createMigrationPublicationService(deps: {
  readonly publication: MigrationPublicationPort;
  readonly read: Pick<MigrationReadPort, 'run'>;
  readonly target: MigrationPublicationTargetPort;
  readonly authority: MigrationAuthorityPort;
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const gate = createGate(deps.authority);
  const { publication, target } = deps;

  async function load(manifestId: string) {
    const found = await guarded(publication.manifest(manifestId));
    if (found === null) throw new MigrationRefusal('not-found');
    return found;
  }

  /** A target call that throws is an unavailable target — never an assumed success. */
  async function ask<T extends { readonly status: string }>(
    work: () => Promise<T>,
  ): Promise<T | { readonly status: 'unavailable' }> {
    try {
      return await work();
    } catch {
      return { status: 'unavailable' };
    }
  }

  async function publishEntry(
    entry: ManifestEntryRecord,
    publishable: Awaited<ReturnType<MigrationPublicationPort['publishable']>>[number],
    publisher: MigrationActor,
  ): Promise<'published' | 'refused' | 'unavailable'> {
    // Claimed before the target is asked; an entry already in flight was
    // claimed by an interrupted invocation and is adopted as it is.
    const claimed =
      entry.state === 'pending'
        ? await guarded(publication.claimEntry(entry.id, entry.version))
        : entry;
    const refuse = async (refusal: string) => {
      await guarded(
        publication.recordRefused({
          entryId: claimed.id,
          expectedVersion: claimed.version,
          refusal,
          now: now(),
        }),
      );
      return 'refused' as const;
    };

    if (publishable.review !== 'approved') return refuse('approval-withdrawn');
    if (!target.supports(publishable.contentKind)) return refuse('no-target');
    const payload =
      publishable.validation === 'valid' ? payloadOf(publishable.payload) : null;
    if (payload === null) return refuse('invalid-payload');

    const result: TargetPublication = await ask(() =>
      target.publish({
        kind: publishable.contentKind,
        payload,
        topicIds: publishable.topicIds,
        actor: publisher,
        resumed: entry.state === 'publishing',
      }),
    );
    if (result.status === 'unavailable') return 'unavailable';
    if (result.status === 'refused') return refuse(refusalCode(result.reason));
    if (
      !usablePath(result.canonicalPath) ||
      !Number.isInteger(result.version) ||
      result.version < 1
    )
      return 'unavailable';
    await guarded(
      publication.recordPublished({
        entryId: claimed.id,
        expectedVersion: claimed.version,
        videoId: result.videoId,
        targetVersion: result.version,
        canonicalPath: result.canonicalPath,
        legacyUrls: publishable.legacyUrls.map((legacy) => ({
          recordId: legacy.recordId,
          url: legacy.url,
          digest: legacyUrlDigest(legacy.url),
        })),
        actorId: publisher.accountId,
        now: now(),
      }),
    );
    return 'published';
  }

  async function rollBackEntry(
    entry: ManifestEntryRecord,
    publisher: MigrationActor,
  ): Promise<'rolled-back' | 'refused' | 'unavailable'> {
    const refuse = async () => {
      await guarded(
        publication.recordRollbackRefused({
          entryId: entry.id,
          expectedVersion: entry.version,
          now: now(),
        }),
      );
      return 'refused' as const;
    };
    if (entry.videoId === null || entry.targetVersion === null) return refuse();
    const videoId = entry.videoId;
    const inspection: TargetInspection | null | { readonly status: 'unavailable' } =
      await (async () => {
        try {
          return await target.inspect({ kind: 'media.video', videoId, actor: publisher });
        } catch {
          return { status: 'unavailable' as const };
        }
      })();
    if (inspection !== null && 'status' in inspection) return 'unavailable';
    // Missing, edited since publication, or held by a person: a person decides (§7.2).
    if (
      inspection === null ||
      !inspection.exists ||
      inspection.version !== entry.targetVersion ||
      inspection.referencedByPeople
    )
      return refuse();
    const withdrawal: TargetWithdrawal = await ask(() =>
      target.withdraw({
        kind: 'media.video',
        videoId,
        expectedVersion: entry.targetVersion ?? 0,
        actor: publisher,
      }),
    );
    if (withdrawal.status === 'unavailable') return 'unavailable';
    if (withdrawal.status === 'refused') return refuse();
    await guarded(
      publication.recordRolledBack({
        entryId: entry.id,
        expectedVersion: entry.version,
        actorId: publisher.accountId,
        now: now(),
      }),
    );
    return 'rolled-back';
  }

  return {
    /** A draft manifest over approved revisions of one completed, BALANCED run. */
    async createManifest(actor: MigrationActor, input: unknown): Promise<ManifestRecord> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        manifestCreateSchema,
        input,
      );
      const run = await guarded(deps.read.run(value.runId));
      if (run === null) throw new MigrationRefusal('not-found');
      if (run.state !== 'completed' || run.reconciliation !== 'balanced')
        throw new MigrationRefusal('run-unreconciled');
      return guarded(
        publication.createManifest({
          id: ids(),
          runId: value.runId,
          stagedRecordIds: value.stagedRecordIds,
          actorId,
          now: now(),
        }),
      );
    },

    async discard(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        manifestCommandSchema,
        input,
      );
      await guarded(publication.discardManifest({ ...value, actorId, now: now() }));
    },

    /** Publishes — or resumes publishing — one manifest, as a verified publisher. */
    async publish(
      privilegedActor: unknown,
      command: unknown,
    ): Promise<PublicationSummary> {
      const publisherId = await gate.publisher(privilegedActor);
      const parsed = manifestCommandSchema.safeParse(command);
      if (!parsed.success) throw new MigrationRefusal('invalid');
      const { manifestId, expectedVersion } = parsed.data;
      const publisher: MigrationActor = { accountId: publisherId };

      const found = await load(manifestId);
      if (found.manifest.version !== expectedVersion)
        throw new MigrationRefusal('conflict');
      if (found.manifest.state === 'draft') {
        await guarded(
          publication.beginPublication({
            manifestId,
            expectedVersion,
            actorId: publisherId,
            now: now(),
          }),
        );
      } else if (found.manifest.state !== 'publishing') {
        throw new MigrationRefusal('invalid-state');
      }

      let done = 0;
      let refused = 0;
      const seen = new Set<string>();
      for (;;) {
        const batch = await guarded(
          publication.publishable(manifestId, MIGRATION_LIMITS.batch),
        );
        const fresh = batch.filter((candidate) => !seen.has(candidate.entry.id));
        if (fresh.length === 0) break;
        for (const candidate of fresh) {
          seen.add(candidate.entry.id);
          const outcome = await publishEntry(candidate.entry, candidate, publisher);
          if (outcome === 'unavailable')
            return {
              manifestId,
              state: 'publishing',
              done,
              refused,
              stopped: 'target-unavailable',
            };
          if (outcome === 'published') done += 1;
          else refused += 1;
        }
      }
      const completed = await guarded(
        publication.completePublication({ manifestId, now: now() }),
      );
      return { manifestId, state: completed.state, done, refused, stopped: null };
    },

    /**
     * Reverses — or resumes reversing — one published manifest, as a verified
     * publisher. An entry edited since publication, missing, or held by a
     * person is left for a person (`rollback-refused`), never forced.
     */
    async rollback(
      privilegedActor: unknown,
      command: unknown,
    ): Promise<PublicationSummary> {
      const publisherId = await gate.publisher(privilegedActor);
      const parsed = rollbackCommandSchema.safeParse(command);
      if (!parsed.success) throw new MigrationRefusal('invalid');
      const { manifestId, expectedVersion, reason } = parsed.data;
      const publisher: MigrationActor = { accountId: publisherId };

      const found = await load(manifestId);
      if (found.manifest.version !== expectedVersion)
        throw new MigrationRefusal('conflict');
      if (found.manifest.state === 'published') {
        await guarded(
          publication.beginRollback({
            manifestId,
            expectedVersion,
            reason,
            actorId: publisherId,
            now: now(),
          }),
        );
      } else if (found.manifest.state !== 'rolling-back') {
        throw new MigrationRefusal('invalid-state');
      }

      let done = 0;
      let refused = 0;
      const seen = new Set<string>();
      for (;;) {
        const batch = await guarded(
          publication.reversible(manifestId, MIGRATION_LIMITS.batch),
        );
        const fresh = batch.filter(
          (entry) => !seen.has(entry.id) && entry.state === 'published',
        );
        if (fresh.length === 0) break;
        for (const entry of fresh) {
          seen.add(entry.id);
          const outcome = await rollBackEntry(entry, publisher);
          if (outcome === 'unavailable')
            return {
              manifestId,
              state: 'rolling-back',
              done,
              refused,
              stopped: 'target-unavailable',
            };
          if (outcome === 'rolled-back') done += 1;
          else refused += 1;
        }
      }
      const completed = await guarded(
        publication.completeRollback({ manifestId, now: now() }),
      );
      return { manifestId, state: completed.state, done, refused, stopped: null };
    },
  };
}

export type MigrationPublicationService = ReturnType<
  typeof createMigrationPublicationService
>;
