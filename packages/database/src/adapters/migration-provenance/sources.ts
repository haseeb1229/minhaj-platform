import 'server-only';

import { MIGRATION_LIMITS, type MigrationSourcePort } from '@minhaj/contracts/migration';

import { getDatabaseClient } from '../../client.ts';
import {
  ADMINISTER,
  LOCKED_TRANSACTION,
  MigrationDataError,
  SOURCE_KEY,
  SOURCE_SELECT,
  audit,
  isUniqueViolationOn,
  missedBecause,
  refuse,
  toSourceRecord,
} from './shared.ts';

/**
 * Sources — the registered origins a run may read.
 *
 * TWO CREATION PATHS, NEVER ONE WITH A KIND PARAMETER. `createFixtureSource`
 * makes a `fixture` (no authorisation evidence, a `*.fixture.invalid` base by
 * CHECK, only `*.fixture.invalid` hosts by 51371); `createAuthorisedSource`
 * makes an `authorised` source, INACTIVE, carrying its written authorisation
 * reference and date, a real `https` base outside `*.invalid` and the
 * politeness floor (CHECK), and only real hosts (51371). Neither ever changes
 * its key, authority, access, kind, base, evidence or hosts (51370, grants) —
 * so a fixture never becomes a real source, nor the reverse.
 */
export function createMigrationSources(): MigrationSourcePort {
  const db = getDatabaseClient();

  return {
    async createFixtureSource(input) {
      const hosts = [...new Set(input.hosts)];
      if (hosts.length > MIGRATION_LIMITS.hosts) throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          await tx.migrationSource.create({
            data: {
              id: input.id,
              key: input.key,
              name: input.name,
              authorityKind: 'fixture',
              accessMethod: input.accessMethod,
              contentKind: input.contentKind,
              baseUrl: input.baseUrl,
              licensingEvidence: input.licensingEvidence,
              policyNotes: input.policyNotes,
              defaultLanguageCode: input.defaultLanguageCode,
              ...input.policy,
              state: 'active',
              version: 1,
              createdAt: input.now,
              createdByUserId: input.actorId,
              updatedAt: input.now,
              updatedByUserId: input.actorId,
            },
            select: { id: true },
          });
          if (hosts.length > 0)
            await tx.migrationSourceHost.createMany({
              data: hosts.map((host) => ({ sourceId: input.id, host })),
            });
          await audit(tx, {
            action: 'migration.source.created',
            actorId: input.actorId,
            targetType: 'migration-source',
            targetId: input.id,
            after: {
              key: input.key,
              authorityKind: 'fixture',
              accessMethod: input.accessMethod,
              contentKind: input.contentKind,
              hosts: String(hosts.length),
              state: 'active',
              version: '1',
            },
            authorisingSource: ADMINISTER,
          });
          const row = await tx.migrationSource.findFirst({
            where: { id: input.id },
            select: SOURCE_SELECT,
          });
          if (row === null) throw new MigrationDataError('conflict');
          return toSourceRecord(row);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (isUniqueViolationOn(error, SOURCE_KEY)) {
          const taken = await db.migrationSource.findFirst({
            where: { key: input.key },
            select: { id: true },
          });
          if (taken !== null) throw new MigrationDataError('duplicate');
        }
        refuse(error);
      }
    },

    async createAuthorisedSource(input) {
      const hosts = [...new Set(input.hosts)];
      if (hosts.length < 1 || hosts.length > MIGRATION_LIMITS.hosts)
        throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          await tx.migrationSource.create({
            data: {
              id: input.id,
              key: input.key,
              name: input.name,
              authorityKind: 'authorised',
              accessMethod: 'http',
              contentKind: input.contentKind,
              baseUrl: input.baseUrl,
              authorisationReference: input.authorisationReference,
              authorisedOn: new Date(`${input.authorisedOn}T00:00:00Z`),
              licensingEvidence: input.licensingEvidence,
              policyNotes: input.policyNotes,
              defaultLanguageCode: input.defaultLanguageCode,
              ...input.policy,
              // Registered, not yet running: activation is its own audited act.
              state: 'inactive',
              version: 1,
              createdAt: input.now,
              createdByUserId: input.actorId,
              updatedAt: input.now,
              updatedByUserId: input.actorId,
            },
            select: { id: true },
          });
          await tx.migrationSourceHost.createMany({
            data: hosts.map((host) => ({ sourceId: input.id, host })),
          });
          await audit(tx, {
            action: 'migration.source.registered',
            actorId: input.actorId,
            targetType: 'migration-source',
            targetId: input.id,
            after: {
              key: input.key,
              authorityKind: 'authorised',
              accessMethod: 'http',
              contentKind: input.contentKind,
              hosts: String(hosts.length),
              authorisedOn: input.authorisedOn,
              state: 'inactive',
              version: '1',
            },
            authorisingSource: ADMINISTER,
          });
          const row = await tx.migrationSource.findFirst({
            where: { id: input.id },
            select: SOURCE_SELECT,
          });
          if (row === null) throw new MigrationDataError('conflict');
          return toSourceRecord(row);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (isUniqueViolationOn(error, SOURCE_KEY)) {
          const taken = await db.migrationSource.findFirst({
            where: { key: input.key },
            select: { id: true },
          });
          if (taken !== null) throw new MigrationDataError('duplicate');
        }
        refuse(error);
      }
    },

    async updateSource(input) {
      try {
        return await db.$transaction(async (tx) => {
          const before = await tx.migrationSource.findFirst({
            where: { id: input.id },
            select: { state: true, version: true },
          });
          const changed = await tx.migrationSource.updateMany({
            where: { id: input.id, version: input.expectedVersion },
            data: {
              name: input.name,
              state: input.state,
              defaultLanguageCode: input.defaultLanguageCode,
              ...input.policy,
              licensingEvidence: input.licensingEvidence,
              policyNotes: input.policyNotes,
              updatedAt: input.now,
              updatedByUserId: input.actorId,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1)
            missedBecause(before, input.expectedVersion, [before?.state ?? '']);
          await audit(tx, {
            action:
              before?.state !== 'active' && input.state === 'active'
                ? 'migration.source.activated'
                : 'migration.source.updated',
            actorId: input.actorId,
            targetType: 'migration-source',
            targetId: input.id,
            before: {
              state: before?.state ?? '',
              version: String(input.expectedVersion),
            },
            after: { state: input.state, version: String(input.expectedVersion + 1) },
            authorisingSource: ADMINISTER,
          });
          const row = await tx.migrationSource.findFirst({
            where: { id: input.id },
            select: SOURCE_SELECT,
          });
          if (row === null) throw new MigrationDataError('conflict');
          return toSourceRecord(row);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async source(id) {
      const row = await db.migrationSource.findFirst({
        where: { id },
        select: SOURCE_SELECT,
      });
      return row === null ? null : toSourceRecord(row);
    },

    async sourceByKey(key) {
      const row = await db.migrationSource.findFirst({
        where: { key },
        select: SOURCE_SELECT,
      });
      return row === null ? null : toSourceRecord(row);
    },
  };
}
