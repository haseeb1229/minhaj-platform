import { describe, expect, it } from 'vitest';

import {
  BROAD_DATABASE_PERMISSIONS,
  BROAD_DATABASE_ROLES,
  BROAD_SCHEMA_PERMISSIONS,
  createUngrantedSentinel,
  inspectPrincipalAuthority,
  overreachingGrants,
  recordedPermissions,
  SENTINEL_PROHIBITIONS,
  SENTINEL_TABLE,
  type RecordedPermission,
} from '../../packages/database/src/lifecycle/principal-authority.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * F8 — effective least-privilege, proven where a live server is not required.
 *
 * The authoritative proof is `npm run db:test:permissions`, which runs these
 * queries against SQL Server as the actual runtime login. These tests cover the
 * part that does not need a server: that the report SEES broad authority when
 * the server reports it, and that an inconclusive probe is not read as absence.
 *
 * The seam is `SqlSession`, which every function here already takes as a
 * parameter — so a fake session can answer as a misconfigured server would,
 * which is not something a live server will do to order.
 */

type Answer = (statement: string) => unknown[] | undefined;

function fakeSession(answer: Answer): SqlSession {
  return {
    async query<Row>(statement: string): Promise<Row[]> {
      return (answer(statement) ?? []) as Row[];
    },
    async runScript(): Promise<void> {
      // Nothing under test runs a script; reaching this would mean the module
      // changed shape rather than that this fake is incomplete.
      throw new Error('runScript is not part of the path under test');
    },
    async close(): Promise<void> {
      // No connection to release.
    },
  };
}

/** A server on which the principal holds nothing broad. */
function cleanServer(roles: string[] = []): Answer {
  return (statement) => {
    if (statement.includes('sys.database_role_members')) {
      return roles.map((role) => ({ role }));
    }
    if (statement.includes('IS_ROLEMEMBER')) {
      return BROAD_DATABASE_ROLES.map((role) => ({ role, member: 0 }));
    }
    if (statement.includes("N'DATABASE'")) {
      return BROAD_DATABASE_PERMISSIONS.map((permission) => ({ permission, held: 0 }));
    }
    if (statement.includes("N'SCHEMA'")) {
      return BROAD_SCHEMA_PERMISSIONS.map((permission) => ({ permission, held: 0 }));
    }
    return [];
  };
}

describe('F8 — broad role membership is detected', () => {
  it('lists the roles that would defeat the runtime boundary', () => {
    // The old check knew only the four administrative roles. These two are the
    // ones that actually grant data authority across every table.
    expect(BROAD_DATABASE_ROLES).toContain('db_datareader');
    expect(BROAD_DATABASE_ROLES).toContain('db_datawriter');
    expect(BROAD_DATABASE_ROLES).toContain('db_owner');
    expect(BROAD_DATABASE_ROLES).toContain('db_ddladmin');
    expect(BROAD_DATABASE_ROLES).toContain('db_securityadmin');
    expect(BROAD_DATABASE_ROLES).toContain('db_accessadmin');
  });

  it.each(BROAD_DATABASE_ROLES)('reports membership of %s', async (role) => {
    const report = await inspectPrincipalAuthority(fakeSession(cleanServer([role])));
    expect(report.broadRoles).toContain(role);
  });

  it('reports a role reached only through nesting', async () => {
    // A direct join over sys.database_role_members misses a role held through
    // another role; IS_ROLEMEMBER resolves it.
    const report = await inspectPrincipalAuthority(
      fakeSession((statement) => {
        if (statement.includes('IS_ROLEMEMBER')) {
          return BROAD_DATABASE_ROLES.map((role) => ({
            role,
            member: role === 'db_datareader' ? 1 : 0,
          }));
        }
        return cleanServer([])(statement);
      }),
    );

    expect(report.broadRoles).toEqual(['db_datareader']);
  });

  it.each([null, undefined, 2])(
    'fails rather than treating malformed role answer %s as non-membership',
    async (member) => {
      await expect(
        inspectPrincipalAuthority(
          fakeSession((statement) => {
            if (statement.includes('IS_ROLEMEMBER')) {
              return BROAD_DATABASE_ROLES.map((role) => ({
                role,
                member: role === 'db_datareader' ? member : 0,
              }));
            }
            return cleanServer([])(statement);
          }),
        ),
      ).rejects.toThrow(/not evidence that membership is absent/);
    },
  );

  it('reports nothing broad for a correctly provisioned principal', async () => {
    const report = await inspectPrincipalAuthority(fakeSession(cleanServer(['public'])));

    expect(report.broadRoles).toEqual([]);
    expect(report.databasePermissions.every((entry) => !entry.held)).toBe(true);
    expect(report.schemaPermissions.every((entry) => !entry.held)).toBe(true);
  });
});

describe('F8 — effective permissions, not merely recorded ones', () => {
  it.each(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CONTROL', 'ALTER', 'CREATE TABLE'])(
    'reports database-scope %s when it is effective',
    async (permission) => {
      const report = await inspectPrincipalAuthority(
        fakeSession((statement) =>
          statement.includes("N'DATABASE'")
            ? BROAD_DATABASE_PERMISSIONS.map((name) => ({
                permission: name,
                held: name === permission ? 1 : 0,
              }))
            : cleanServer([])(statement),
        ),
      );

      const held = report.databasePermissions
        .filter((entry) => entry.held)
        .map((entry) => entry.permission);
      expect(held).toEqual([permission]);
    },
  );

  it.each(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])(
    'reports dbo-schema %s when it is effective',
    async (permission) => {
      const report = await inspectPrincipalAuthority(
        fakeSession((statement) =>
          statement.includes("N'SCHEMA'")
            ? BROAD_SCHEMA_PERMISSIONS.map((name) => ({
                permission: name,
                held: name === permission ? 1 : 0,
              }))
            : cleanServer([])(statement),
        ),
      );

      const held = report.schemaPermissions
        .filter((entry) => entry.held)
        .map((entry) => entry.permission);
      expect(held).toEqual([permission]);
    },
  );

  it('fails rather than reading an unanswered probe as absence', async () => {
    // NULL means SQL Server did not recognise the permission for that class.
    // Counting it as "not held" would turn a broken probe into a clean result.
    await expect(
      inspectPrincipalAuthority(
        fakeSession((statement) =>
          statement.includes("N'DATABASE'")
            ? BROAD_DATABASE_PERMISSIONS.map((permission) => ({
                permission,
                held: permission === 'CONTROL' ? null : 0,
              }))
            : cleanServer([])(statement),
        ),
      ),
    ).rejects.toThrow(/not evidence that the permission is absent/);
  });

  it.each([undefined, 2, '0'])(
    'fails on malformed permission answer %s',
    async (held) => {
      await expect(
        inspectPrincipalAuthority(
          fakeSession((statement) =>
            statement.includes("N'DATABASE'")
              ? BROAD_DATABASE_PERMISSIONS.map((permission) => ({
                  permission,
                  held: permission === 'CONTROL' ? held : 0,
                }))
              : cleanServer([])(statement),
          ),
        ),
      ).rejects.toThrow(/not evidence that the permission is absent/);
    },
  );

  it('fails when the probe returns fewer answers than questions', async () => {
    await expect(
      inspectPrincipalAuthority(
        fakeSession((statement) =>
          statement.includes("N'DATABASE'")
            ? [{ permission: 'CONTROL', held: 0 }]
            : cleanServer([])(statement),
        ),
      ),
    ).rejects.toThrow(/Expected \d+ permission answers/);
  });
});

describe('F8 — recorded grants beyond the approved set', () => {
  const approved: RecordedPermission[] = [
    { class: 'DATABASE', object: '(database)', permission: 'CONNECT', state: 'GRANT' },
    { class: 'DATABASE', object: '(database)', permission: 'ALTER', state: 'DENY' },
    {
      class: 'DATABASE',
      object: '(database)',
      permission: 'CREATE TABLE',
      state: 'DENY',
    },
    {
      class: 'OBJECT_OR_COLUMN',
      object: '[dbo].[AuditLog]',
      permission: 'INSERT',
      state: 'GRANT',
    },
    {
      class: 'OBJECT_OR_COLUMN',
      object: '[dbo].[AuditLog]',
      permission: 'SELECT',
      state: 'GRANT',
    },
    {
      class: 'OBJECT_OR_COLUMN',
      object: '[dbo].[AuditLog]',
      permission: 'UPDATE',
      state: 'DENY',
    },
    {
      class: 'OBJECT_OR_COLUMN',
      object: '[dbo].[_prisma_migrations]',
      permission: 'SELECT',
      state: 'DENY',
    },
  ];

  it('finds nothing wrong with the Phase 1 grant set', () => {
    expect(overreachingGrants(approved)).toEqual([]);
  });

  it('never treats a DENY as a finding', () => {
    // The grant script writes several deliberately; flagging them would make
    // the proof fail on correct configuration.
    expect(
      overreachingGrants(approved.filter((entry) => entry.state === 'DENY')),
    ).toEqual([]);
  });

  it.each([
    ['a database-scope SELECT', 'DATABASE', '(database)', 'SELECT'],
    ['database CONTROL', 'DATABASE', '(database)', 'CONTROL'],
    ['a schema-scope SELECT', 'SCHEMA', 'dbo', 'SELECT'],
    ['a schema-scope INSERT', 'SCHEMA', 'dbo', 'INSERT'],
    ['UPDATE on the audit table', 'OBJECT_OR_COLUMN', '[dbo].[AuditLog]', 'UPDATE'],
    [
      'SELECT on the migration history',
      'OBJECT_OR_COLUMN',
      '[dbo].[_prisma_migrations]',
      'SELECT',
    ],
    // A table nothing grants on at all.
    [
      'SELECT on a table outside the inventory',
      'OBJECT_OR_COLUMN',
      '[dbo].[Phase1UngrantedSentinel]',
      'SELECT',
    ],
    // An APPROVED table, but a verb its row does not permit. The inventory is
    // per verb precisely so this is caught: closure retains the user row and
    // pseudonymises it, so a runtime able to DELETE one could erase the
    // subject of an audit trail.
    ['DELETE on the user table', 'OBJECT_OR_COLUMN', '[dbo].[User]', 'DELETE'],
    // Suppression is add-only to the runtime: silently un-suppressing an
    // address would resume sending to someone whose provider already rejected
    // or complained about the mail.
    [
      'DELETE on the suppression table',
      'OBJECT_OR_COLUMN',
      '[dbo].[EmailSuppression]',
      'DELETE',
    ],
  ])('flags %s', (_label, entryClass, object, permission) => {
    const found = overreachingGrants([
      ...approved,
      { class: entryClass, object, permission, state: 'GRANT' },
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.permission).toBe(permission);
  });

  it('flags a grant carrying the grant option', () => {
    const found = overreachingGrants([
      {
        class: 'DATABASE',
        object: '(database)',
        permission: 'SELECT',
        state: 'GRANT_WITH_GRANT_OPTION',
      },
    ]);

    expect(found).toHaveLength(1);
  });

  it('refuses a login name that is not a plain identifier', async () => {
    await expect(
      recordedPermissions(
        fakeSession(() => []),
        "x'; DROP DATABASE [master]; --",
      ),
    ).rejects.toThrow(/Invalid application login name/);
  });
});

describe('F8 — the ungranted sentinel is real before it is probed', () => {
  it('proves the table exists and holds its row', async () => {
    const proof = await createUngrantedSentinel(
      fakeSession((statement) =>
        statement.includes('OBJECT_ID') ? [{ objectId: 42, rowCount: 1 }] : [],
      ),
    );

    expect(proof).toEqual({ objectId: 42, rowCount: 1 });
  });

  it('fails when the table was not actually created', async () => {
    // A denial on a table that does not exist proves nothing: SQL Server
    // returns the same error for both, which is exactly why existence has to be
    // established by the session that can see it.
    await expect(
      createUngrantedSentinel(
        fakeSession((statement) =>
          statement.includes('OBJECT_ID') ? [{ objectId: null, rowCount: 0 }] : [],
        ),
      ),
    ).rejects.toThrow(/would prove nothing/);
  });

  it('fails when the sentinel does not hold exactly one row', async () => {
    await expect(
      createUngrantedSentinel(
        fakeSession((statement) =>
          statement.includes('OBJECT_ID') ? [{ objectId: 42, rowCount: 0 }] : [],
        ),
      ),
    ).rejects.toThrow(/expected exactly 1/);
  });

  it('probes all four data operations against it', () => {
    expect(SENTINEL_PROHIBITIONS.map(([label]) => label)).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
    ]);

    for (const [, statement] of SENTINEL_PROHIBITIONS) {
      expect(statement).toContain(SENTINEL_TABLE);
    }
  });
});
