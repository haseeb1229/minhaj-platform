import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  MIGRATION_LIMITS,
  fixtureScopeIsSynthetic,
  fixtureSourceCreateSchema,
  migrationIdSchema,
  migrationOffsetSchema,
  sourceKeySchema,
  sourceUpdateSchema,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationReadPort,
  type MigrationSourcePort,
  type SourcePage,
  type SourceRecord,
} from '@minhaj/contracts/migration';

import { MigrationRefusal } from '../domain/refusal.ts';
import { ADMINISTER, READ, createGate, guarded } from './shared.ts';

/**
 * Fields that would make a source REAL. Phase 29 registers fixtures only, so a
 * request naming any of them is refused as what it is — an attempt to record
 * an authorised source — before anything else in it is read.
 */
const AUTHORITY_FIELDS = Object.freeze([
  'authorityKind',
  'authorisationReference',
  'authorisedOn',
  'authorizationReference',
  'authorizedOn',
]);

/**
 * Legacy sources (DOMAIN_MODEL.md §16.1 LegacySource).
 *
 * FIXTURES ONLY IN PHASE 29 (OPEN_DECISIONS.md §3.1): a source is created with
 * `authorityKind = 'fixture'`, hosts under `*.fixture.invalid` and no
 * authorisation evidence; the kind is not the operator's to choose. A real
 * source is never created and never activated here.
 *
 * Dependencies (ports only):
 *  - `sources`   — `MigrationSourcePort`;
 *  - `read`      — `MigrationReadPort` (`sources` only, for the list);
 *  - `authority` — `MigrationAuthorityPort`;
 *  - `ids`, `clock` — injectable for tests.
 */
export function createMigrationSourceService(deps: {
  readonly sources: MigrationSourcePort;
  readonly read: Pick<MigrationReadPort, 'sources'>;
  readonly authority: MigrationAuthorityPort;
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const gate = createGate(deps.authority);

  return {
    /** Registers a fixture source under `migration.administer`. */
    async createFixture(actor: MigrationActor, input: unknown): Promise<SourceRecord> {
      const actorId = await gate.holds(actor, ADMINISTER);
      if (
        typeof input === 'object' &&
        input !== null &&
        AUTHORITY_FIELDS.some((field) => Object.hasOwn(input, field))
      )
        throw new MigrationRefusal('real-source-not-authorised');
      const parsed = fixtureSourceCreateSchema.safeParse(input);
      if (!parsed.success) throw new MigrationRefusal('invalid');
      const value = parsed.data;
      const hosts = [...new Set(value.hosts)];
      if (hosts.length !== value.hosts.length) throw new MigrationRefusal('invalid');
      // An HTTP source is reached at its base URL; an export has none.
      if (value.accessMethod === 'http' && (value.baseUrl === null || hosts.length === 0))
        throw new MigrationRefusal('invalid');
      if (value.accessMethod === 'export' && value.baseUrl !== null)
        throw new MigrationRefusal('invalid');
      if (!fixtureScopeIsSynthetic(value.baseUrl, hosts))
        throw new MigrationRefusal('unsafe-scope');
      return guarded(
        deps.sources.createFixtureSource({
          id: ids(),
          key: value.key,
          name: value.name,
          accessMethod: value.accessMethod,
          contentKind: value.contentKind,
          baseUrl: value.baseUrl,
          hosts,
          defaultLanguageCode: value.defaultLanguageCode,
          policy: value.policy,
          licensingEvidence: value.licensingEvidence,
          policyNotes: value.policyNotes,
          actorId,
          now: now(),
        }),
      );
    },

    /**
     * Changes what may change — never the key, kind, access or hosts — at the
     * expected version. A real source is never activated in Phase 29.
     */
    async update(actor: MigrationActor, input: unknown): Promise<SourceRecord> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        sourceUpdateSchema,
        input,
      );
      const current = await guarded(deps.sources.source(value.id));
      if (current === null) throw new MigrationRefusal('not-found');
      if (current.version !== value.expectedVersion)
        throw new MigrationRefusal('conflict');
      if (current.authorityKind !== 'fixture' && value.state === 'active')
        throw new MigrationRefusal('real-source-not-authorised');
      return guarded(deps.sources.updateSource({ ...value, actorId, now: now() }));
    },

    /** One source, or `null` when the id is malformed or names nothing. */
    async source(actor: MigrationActor, id: string): Promise<SourceRecord | null> {
      await gate.holds(actor, READ);
      if (!migrationIdSchema.safeParse(id).success) return null;
      return guarded(deps.sources.source(id));
    },

    async sourceByKey(actor: MigrationActor, key: string): Promise<SourceRecord | null> {
      await gate.holds(actor, READ);
      if (!sourceKeySchema.safeParse(key).success) return null;
      return guarded(deps.sources.sourceByKey(key));
    },

    async sources(actor: MigrationActor, offset: unknown = 0): Promise<SourcePage> {
      await gate.holds(actor, READ);
      const parsed = migrationOffsetSchema.safeParse(offset);
      if (!parsed.success) throw new MigrationRefusal('invalid');
      return guarded(deps.read.sources(parsed.data, MIGRATION_LIMITS.page));
    },
  };
}

export type MigrationSourceService = ReturnType<typeof createMigrationSourceService>;
