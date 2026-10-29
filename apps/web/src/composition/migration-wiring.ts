import 'server-only';

import {
  createMigrationDecisions,
  createMigrationPipeline,
  createMigrationPromotion,
  createMigrationPublication,
  createMigrationRaw,
  createMigrationReader,
  createMigrationSources,
} from '@minhaj/database';
import { isPermissionKey, type PrivilegedActor } from '@minhaj/contracts/identity';
import type {
  MigrationActor,
  MigrationAssetStoragePort,
  MigrationAuthorityPort,
  MigrationPublicationTargetPort,
  MigrationTopicPort,
} from '@minhaj/contracts/migration';
import type { StorageServicePort } from '@minhaj/contracts/platform';
import type { AuthorizationService } from '@minhaj/server-core/authorization';

import {
  createMigrationDecisionService,
  createMigrationPipelineService,
  createMigrationPromotionService,
  createMigrationPublicationService,
  createMigrationRawService,
  createMigrationReadService,
  createMigrationSourceService,
  type MigrationDecisionService,
  type MigrationPipelineService,
  type MigrationPromotionService,
  type MigrationPublicationService,
  type MigrationRawService,
  type MigrationReadService,
  type MigrationSourceService,
  type PipelineRunInput,
  type PipelineRunSummary,
} from '../contexts/migration-provenance/index.ts';

/**
 * Migration & Provenance's dependencies — ONE wiring for both processes
 * (Phase 29).
 *
 * The web process builds the administrative services from this
 * (`./migration.ts`), and the migration CLIs and the staging proof build the
 * SAME services from this (`./migration-runner.ts`). Each process supplies only
 * what it alone can answer — Identity's live authority, Taxonomy's topics, the
 * Media publication target and Storage — and everything else is Migration's own
 * context-owned adapter in `packages/database`.
 *
 * STORAGE IS BOUND HERE, NOT BY THE CALLER. A pipeline run receives the Storage
 * port this wiring was given; no caller can hand a run a different place to put
 * acquired bytes.
 *
 * NODE-RUNNABLE. Imported outside the Next bundler by the CLIs, so it names
 * packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** A pipeline whose runs always store acquired assets through the composed Storage. */
export type MigrationPipelineRunner = Omit<MigrationPipelineService, 'run'> & {
  run(
    actor: MigrationActor,
    input: Omit<PipelineRunInput, 'assets'>,
  ): Promise<PipelineRunSummary>;
};

export interface MigrationServices {
  readonly sources: MigrationSourceService;
  readonly pipeline: MigrationPipelineRunner;
  readonly decisions: MigrationDecisionService;
  readonly raw: MigrationRawService;
  readonly publication: MigrationPublicationService;
  readonly promotion: MigrationPromotionService;
  readonly read: MigrationReadService;
}

export function migrationDependencies(input: {
  readonly authority: MigrationAuthorityPort;
  readonly topics: MigrationTopicPort;
  readonly target: MigrationPublicationTargetPort;
  readonly storage: MigrationAssetStoragePort;
}): MigrationServices {
  const { authority, topics, target, storage } = input;
  const sources = createMigrationSources();
  const read = createMigrationReader();
  const publication = createMigrationPublication();
  const promotions = createMigrationPromotion();
  const pipeline = createMigrationPipelineService({
    pipeline: createMigrationPipeline(),
    sources,
    authority,
  });

  return {
    sources: createMigrationSourceService({ sources, read, authority }),
    pipeline: {
      cancel: (actor, command) => pipeline.cancel(actor, command),
      run: (actor, run) => pipeline.run(actor, { ...run, assets: storage }),
    },
    decisions: createMigrationDecisionService({
      decisions: createMigrationDecisions(),
      read,
      topics,
      authority,
    }),
    raw: createMigrationRawService({ raw: createMigrationRaw(), authority }),
    publication: createMigrationPublicationService({
      publication,
      read,
      target,
      authority,
    }),
    promotion: createMigrationPromotionService({ promotions, authority }),
    read: createMigrationReadService({ read, publication, promotions, authority }),
  };
}

/* ===========================================================================
 * The answers each process supplies, built the same way in both
 * ========================================================================= */

/** Identity's live authorisation, as each process's runtime holds it. */
export type LiveAuthorization = Pick<
  AuthorizationService,
  'hasPermission' | 'verifyPrivilegedActor'
>;

/**
 * A live permission read. A key the catalogue does not know is a denial, never
 * a question put to the database.
 */
export function livePermits(
  authorization: LiveAuthorization,
): (accountId: string, permission: string) => Promise<boolean> {
  return async (accountId, permission) =>
    isPermissionKey(permission) && authorization.hasPermission(accountId, permission);
}

/**
 * Migration's authority port: the live permission read, and the
 * re-verification of a privileged actor Identity minted for EXACTLY
 * `migration.publish` with a live `migration-publication` step-up. Anything
 * else — a plain object, an actor minted for another permission or purpose, an
 * expired grant — answers `null`.
 */
export function migrationAuthority(
  authorization: LiveAuthorization,
): MigrationAuthorityPort {
  return {
    permits: livePermits(authorization),
    async verifyPublisher(actor) {
      if (typeof actor !== 'object' || actor === null) return null;
      const candidate = actor as PrivilegedActor;
      const verified = await authorization.verifyPrivilegedActor({
        actor: candidate,
        permission: 'migration.publish',
        stepUp: 'migration-publication',
      });
      return verified ? candidate.accountId : null;
    },
  };
}

/** Taxonomy's own bound on one reference question. */
const TOPIC_BATCH = 300;

/**
 * Which Topic ids exist now, answered by Taxonomy's PUBLIC reference read — an
 * archived Topic is not one an operator may map a category to.
 */
export function migrationTopics(
  topicReferences: (
    ids: readonly string[],
    locale: 'en',
  ) => Promise<readonly { readonly id: string }[]>,
): MigrationTopicPort {
  return {
    async existingTopics(topicIds) {
      const unique = [...new Set(topicIds)];
      const found = new Set<string>();
      for (let start = 0; start < unique.length; start += TOPIC_BATCH) {
        const rows = await topicReferences(
          unique.slice(start, start + TOPIC_BATCH),
          'en',
        );
        for (const row of rows) found.add(row.id);
      }
      return found;
    },
  };
}

/**
 * What acquisition may store: still images and PDFs, as the bytes sniff — the
 * declared type only ever refuses a mismatch.
 */
export const MIGRATION_ASSET_MEDIA_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'application/pdf',
]);

/** One acquired asset, at most. Far above a poster or a leaflet. */
export const MIGRATION_ASSET_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Phase 30-R. What a PUBLIC copy may be: the two raster types Storage's image
 * pipeline admits, within the same pixel bounds as a Photo — so a decompression
 * bomb or an oversized scan is refused, never shown.
 */
export const MIGRATION_PUBLIC_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg']);
export const MIGRATION_PUBLIC_IMAGE_LIMITS = Object.freeze({
  maxPixels: 40_000_000,
  maxEdge: 16_384,
});

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/**
 * The Storage foundation, narrowed to what acquisition needs.
 *
 * Every byte goes through the foundation's own custody: sniffed, size-capped,
 * written under a generated key, quarantined, scanned by ClamAV and cleared
 * only against the checksum scanned. The bytes are stored EXACTLY as fetched —
 * no image re-encoding — because they are provenance evidence and Migration
 * compares their checksum with what it fetched. Nothing serves them: no route
 * and no serving policy names a migrated asset, so a stored file is never
 * public whatever its scan verdict.
 */
export function migrationAssetStorage(
  storage: () => Promise<StorageServicePort>,
): MigrationAssetStoragePort {
  return {
    async store({ bytes, declaredMediaType, displayName }) {
      const service = await storage();
      const stored = await service.store(once(bytes), {
        allowedMediaTypes: MIGRATION_ASSET_MEDIA_TYPES,
        maxBytes: MIGRATION_ASSET_MAX_BYTES,
        declaredMediaType,
        displayName,
      });
      if (stored.state === 'rejected')
        return { status: 'rejected', reason: stored.rejection ?? 'rejected' };
      if (stored.state !== 'clean' && stored.state !== 'quarantined')
        throw new Error('Storage did not complete custody of the acquired asset.');
      return {
        status: 'stored',
        assetId: stored.id,
        mediaType: stored.mediaType,
        byteSize: stored.byteSize,
        checksum: stored.checksum,
        clean: stored.state === 'clean',
      };
    },

    async storePublicImage({ bytes, displayName }) {
      const service = await storage();
      const stored = await service.store(once(bytes), {
        allowedMediaTypes: MIGRATION_PUBLIC_IMAGE_TYPES,
        maxBytes: MIGRATION_ASSET_MAX_BYTES,
        declaredMediaType: null,
        displayName,
        image: MIGRATION_PUBLIC_IMAGE_LIMITS,
      });
      if (stored.state === 'rejected')
        return { status: 'rejected', reason: stored.rejection ?? 'rejected' };
      if (stored.state !== 'clean' && stored.state !== 'quarantined')
        throw new Error('Storage did not complete custody of the public image.');
      if (stored.image === undefined)
        throw new Error('Storage stored an image without measuring it.');
      return {
        status: 'stored',
        assetId: stored.id,
        checksum: stored.checksum,
        width: stored.image.width,
        height: stored.image.height,
      };
    },
  };
}
