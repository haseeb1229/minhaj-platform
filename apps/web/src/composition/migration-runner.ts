import 'server-only';

import {
  createAssetPersistence,
  createAuthorizationReader,
  createMediaPublicReader,
  createPeopleReader,
  createTaxonomyPersistence,
  createTaxonomyReader,
} from '@minhaj/database';
import type { PrivilegedActor, ResolvedSession } from '@minhaj/contracts/identity';
import type { MediaReferencesPort } from '@minhaj/contracts/media';
import type { StorageServicePort } from '@minhaj/contracts/platform';
import { createAuthorizationService } from '@minhaj/server-core/authorization';
import {
  createClamAvScanner,
  createFilesystemStore,
  createStorageService,
  storageEnvSchema,
} from '@minhaj/storage';

import { createMediaReadService } from '../contexts/media/index.ts';
import { createPeopleReadService } from '../contexts/people-contributors/index.ts';
import { createTaxonomyService } from '../contexts/taxonomy/index.ts';
import { createMediaVideoTarget } from './migration-targets.ts';
import {
  livePermits,
  migrationAssetStorage,
  migrationAuthority,
  migrationDependencies,
  migrationTopics,
  type MigrationServices,
} from './migration-wiring.ts';

/**
 * The migration TOOLING's composition root — Layer 4 (Phase 29).
 *
 * WHY A SECOND ROOT. The fixture runner, the promotion CLI and the staging
 * proof run under plain Node (`node --conditions=react-server`), outside the
 * Next bundler, and must never reach the database package themselves
 * (`scripts/migration/` holds no database capability). Wiring Migration's
 * ports to their adapters is Layer 4's job, so the tools receive exactly what
 * this builds — the SAME seven services the web process builds, from the SAME
 * wiring (`./migration-wiring.ts`) — exactly as the realtime process has its
 * own root (`./realtime.ts`).
 *
 * WHAT IT SUPPLIES, NODE-LOADABLY:
 *
 *   - AUTHORITY: the server-core `AuthorizationService` over Identity's narrow
 *     authorisation reader — the very implementation the web process runs. It
 *     is also the ONLY minter of the privileged actor this process may present
 *     (`requirePrivilegedAction`), which is what lets it re-verify one.
 *   - TOPICS and OWNER REFERENCES: Taxonomy's and People's PUBLIC services,
 *     both node-loadable contexts, asked the questions Media's composition asks
 *     through `./owner-references.ts` (which is bundler-resolved and cannot
 *     load here), with the same answers: every identifier must resolve, and a
 *     retired language is not a valid choice.
 *   - THE TARGET: Media's public service (`./migration-targets.ts`).
 *   - STORAGE: the foundation's own service from `@minhaj/storage` over the
 *     storage adapter, read from `STORAGE_ROOT` and the ClamAV settings, built
 *     on first use only.
 *
 * THE DATABASE is whatever `DATABASE_URL` names — the RUNTIME principal's URL,
 * as for the web process. No migration-principal setting is read here.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

export interface MigrationRunner extends MigrationServices {
  /** `MINHAJ_RELEASE_SHA` when it is a full commit SHA, else `local`. */
  readonly codeRevision: string;
  /**
   * Identity's privileged-action gate for `migration.publish` with a live
   * `migration-publication` step-up — the actor publication, rollback and
   * promotion approval demand — or `null` with the gate's reason refused.
   */
  requirePrivilegedAction(session: ResolvedSession): Promise<PrivilegedActor | null>;
  /**
   * What the PUBLIC Watch page would render at a slug, through Media's own
   * public read: published Videos only. For proving what is and is not public.
   */
  publicVideo(
    slug: string,
  ): Promise<{ readonly id: string; readonly version: number } | null>;
}

const COMMIT = /^[0-9a-f]{40}$/;

/** The owner questions Media asks, answered by People's and Taxonomy's public reads. */
function ownerReferencesOf(
  people: ReturnType<typeof createPeopleReadService>,
  taxonomy: ReturnType<typeof createTaxonomyService>,
): MediaReferencesPort {
  return {
    async validPeople(ids) {
      if (ids.length === 0) return true;
      const unique = [...new Set(ids)];
      return (await people.contributorReferences(unique, 'en')).length === unique.length;
    },
    async validTopics(ids) {
      if (ids.length === 0) return true;
      return (await taxonomy.topicReferences([...ids], 'en')).length === ids.length;
    },
    async validLanguage(code) {
      const active = await taxonomy.listLanguages({ includeRetired: false });
      return active.some((entry) => entry.code === code);
    },
  };
}

export function composeMigrationRunner(
  env: Record<string, string | undefined> = process.env,
): MigrationRunner {
  const authorization = createAuthorizationService({
    reader: createAuthorizationReader(),
  });
  const taxonomy = createTaxonomyService({
    reader: createTaxonomyReader(),
    taxonomy: createTaxonomyPersistence(),
  });
  const people = createPeopleReadService({ reader: createPeopleReader() });
  const publicMedia = createMediaReadService(createMediaPublicReader());

  let storage: Promise<StorageServicePort> | null = null;
  const storageService = () =>
    (storage ??= (async () => {
      const settings = storageEnvSchema.parse({
        STORAGE_ROOT: env['STORAGE_ROOT'],
        STORAGE_MAX_BYTES: env['STORAGE_MAX_BYTES'],
        CLAMAV_HOST: env['CLAMAV_HOST'],
        CLAMAV_PORT: env['CLAMAV_PORT'],
        CLAMAV_TIMEOUT_MS: env['CLAMAV_TIMEOUT_MS'],
      });
      return createStorageService({
        files: await createFilesystemStore(settings.STORAGE_ROOT),
        assets: createAssetPersistence(),
        scanner: createClamAvScanner({
          host: settings.CLAMAV_HOST,
          port: settings.CLAMAV_PORT,
          timeoutMs: settings.CLAMAV_TIMEOUT_MS,
        }),
        maxBytes: settings.STORAGE_MAX_BYTES,
      });
    })());

  const services = migrationDependencies({
    authority: migrationAuthority(authorization),
    topics: migrationTopics((ids, locale) => taxonomy.topicReferences(ids, locale)),
    target: createMediaVideoTarget({
      authority: { permits: livePermits(authorization) },
      references: ownerReferencesOf(people, taxonomy),
    }),
    storage: migrationAssetStorage(storageService),
  });

  const release = env['MINHAJ_RELEASE_SHA'];
  return {
    ...services,
    codeRevision: release !== undefined && COMMIT.test(release) ? release : 'local',

    async requirePrivilegedAction(session) {
      const outcome = await authorization.requirePrivilegedAction({
        session,
        permission: 'migration.publish',
        stepUp: 'migration-publication',
      });
      return outcome.state === 'allowed' ? outcome.actor : null;
    },

    async publicVideo(slug) {
      const video = await publicMedia.video(slug);
      return video === null ? null : { id: video.id, version: video.version };
    },
  };
}
