import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  AUTHORISED_MAX_CONCURRENCY,
  AUTHORISED_MIN_INTERVAL_MS,
  MIGRATION_LIMITS,
  authorisedScopeIsReal,
  authorisedSourceCreateSchema,
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
 * Fields that would make a source REAL. The FIXTURE path refuses a request
 * naming any of them as what it is — an attempt to record an authorised
 * source through the wrong door — before anything else in it is read.
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
 * TWO DOORS, NEVER ONE WITH A KIND FIELD. `createFixture` makes a synthetic
 * source on `*.fixture.invalid` with no authorisation evidence.
 * `registerAuthorised` (Phase 30) makes a REAL source, inactive, and demands
 * its written authorisation REFERENCE and DATE, a real `https` scope of exact
 * hosts and the politeness floor. What it records is the reference: the
 * platform validates its shape and audits the act, and does not — cannot —
 * prove the organisational decision it names (OPEN_DECISIONS.md §3.1.1).
 * Neither door lets a source change authority, scope or evidence later.
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
     * Registers an AUTHORISED source under `migration.administer`, INACTIVE.
     * Refuses a missing or malformed reference or date, a date in the future,
     * a scope that is not real `https` exact hosts (`unsafe-scope`) and
     * politeness below the floor (`invalid`).
     */
    async registerAuthorised(
      actor: MigrationActor,
      input: unknown,
    ): Promise<SourceRecord> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        authorisedSourceCreateSchema,
        input,
      );
      const hosts = [...new Set(value.hosts)];
      if (hosts.length !== value.hosts.length) throw new MigrationRefusal('invalid');
      if (!authorisedScopeIsReal(value.baseUrl, hosts))
        throw new MigrationRefusal('unsafe-scope');
      const at = now();
      if (value.authorisedOn > at.toISOString().slice(0, 10))
        throw new MigrationRefusal('invalid');
      return guarded(
        deps.sources.createAuthorisedSource({
          id: ids(),
          key: value.key,
          name: value.name,
          contentKind: value.contentKind,
          baseUrl: value.baseUrl,
          hosts,
          defaultLanguageCode: value.defaultLanguageCode,
          policy: value.policy,
          authorisationReference: value.authorisationReference,
          authorisedOn: value.authorisedOn,
          licensingEvidence: value.licensingEvidence,
          policyNotes: value.policyNotes,
          actorId,
          now: at,
        }),
      );
    },

    /**
     * Changes what may change — never the key, kind, access, hosts or evidence
     * — at the expected version. Activating a real source needs its recorded
     * written authorisation; an authorised source keeps the politeness floor.
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
      if (
        current.authorityKind === 'authorised' &&
        value.state === 'active' &&
        (current.authorisationReference === null || current.authorisedOn === null)
      )
        throw new MigrationRefusal('real-source-not-authorised');
      if (
        current.authorityKind === 'authorised' &&
        (value.policy.minIntervalMs < AUTHORISED_MIN_INTERVAL_MS ||
          value.policy.maxConcurrency > AUTHORISED_MAX_CONCURRENCY)
      )
        throw new MigrationRefusal('invalid');
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
