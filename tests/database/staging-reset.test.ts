import { describe, expect, it, vi } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  assertResetConfirmation,
  assertResetSafe,
  createStagingDatabase,
  materialData,
  MIGRATION_SEEDED_TABLES,
  RESET_BACKUP_MAX_AGE_MINUTES,
  resetConfirmationToken,
} from '../../packages/database/src/lifecycle/staging-database.ts';
import {
  resolveStagingConfiguration,
  STAGING_DATABASE,
} from '../../packages/database/src/lifecycle/staging-target.ts';

/**
 * Phase 28 — the preconditions in front of the destructive staging reset.
 *
 * The reset drops `MinhajStaging`, so every refusal here is a refusal that
 * must happen BEFORE a DROP could be issued: the exact confirmation phrase,
 * the migration principal (never runtime, never operator), and — when the
 * database holds material data — a verified staging backup of the current
 * database from the last 60 minutes. Sessions are fakes that record what was
 * asked, so the tests also prove no destructive statement was sent.
 */

const ENVIRONMENT_ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const HEX32 = 'd'.repeat(32);
const ARTIFACT = `/var/opt/mssql/backup/minhaj-staging-${HEX32}.bak`;

type Answer = (statement: string) => unknown[];

function fakeSession(answer: Answer): SqlSession & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async query<Row>(statement: string): Promise<Row[]> {
      statements.push(statement);
      return answer(statement) as Row[];
    },
    async runScript(): Promise<void> {
      throw new Error('runScript is not part of the path under test');
    },
    async execute(): Promise<void> {
      throw new Error('execute is not part of the path under test');
    },
    async close(): Promise<void> {
      // Nothing to release.
    },
  };
}

/** A live session holding `populated` rows in the named dbo tables. */
function liveSession(
  populated: Record<string, number>,
): SqlSession & { statements: string[] } {
  const tables = [
    '_prisma_migrations',
    ...MIGRATION_SEEDED_TABLES,
    'Asset',
    'User',
    'AuditLog',
  ];
  return fakeSession((statement) => {
    if (statement.includes('FROM sys.tables')) {
      return tables.map((tableName) => ({ schemaName: 'dbo', tableName }));
    }
    if (statement.includes('COUNT_BIG(*)')) {
      return [...statement.matchAll(/N'dbo\.(\w+)'/g)].map(([, table]) => ({
        tableName: `dbo.${table}`,
        total: populated[table ?? ''] ?? 0,
      }));
    }
    throw new Error('unexpected statement on the live session');
  });
}

/** A master session answering the msdb history and the artifact probe. */
function masterSession(options: {
  backups?: { physicalDeviceName: string; ageSeconds: number }[];
  fileExists?: number;
}): SqlSession & { statements: string[] } {
  return fakeSession((statement) => {
    if (statement.includes('msdb.dbo.backupset')) {
      return (options.backups ?? []).map((backup) => ({
        ...backup,
        backupFinishDate: new Date(Date.now() - backup.ageSeconds * 1000),
      }));
    }
    if (statement.includes('xp_fileexist')) {
      return [{ fileExists: options.fileExists ?? 1, isDirectory: 0 }];
    }
    throw new Error('unexpected statement on the master session');
  });
}

function noDestructiveStatement(...sessions: { statements: string[] }[]): void {
  for (const session of sessions) {
    for (const statement of session.statements) {
      expect(statement).not.toMatch(/\bDROP\b|\bALTER DATABASE\b|\bCREATE DATABASE\b/i);
    }
  }
}

describe('reset confirmation', () => {
  it('is exactly "reset MinhajStaging <environment-id>"', () => {
    expect(resetConfirmationToken(ENVIRONMENT_ID)).toBe(
      `reset MinhajStaging ${ENVIRONMENT_ID}`,
    );
    expect(() =>
      assertResetConfirmation(`reset MinhajStaging ${ENVIRONMENT_ID}`, ENVIRONMENT_ID),
    ).not.toThrow();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['without the id', 'reset MinhajStaging'],
    ['another environment', 'reset MinhajStaging 11111111-2222-4333-8444-555555555555'],
    ['a different database', `reset MinhajPlatform ${ENVIRONMENT_ID}`],
    ['different case', `Reset MinhajStaging ${ENVIRONMENT_ID}`],
    ['trailing whitespace', `reset MinhajStaging ${ENVIRONMENT_ID} `],
    ['an upper-case id', `reset MinhajStaging ${ENVIRONMENT_ID.toUpperCase()}`],
    ['a generic yes', 'yes'],
  ])('refuses a confirmation that is %s', (_label, token) => {
    expect(() => assertResetConfirmation(token, ENVIRONMENT_ID)).toThrow(/confirm/);
  });
});

describe('reset principal', () => {
  const base = {
    MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
    MINHAJ_STAGING_ENVIRONMENT_ID: ENVIRONMENT_ID,
    DATABASE_APP_LOGIN: 'minhaj_app',
    DATABASE_OPERATOR_LOGIN: 'minhaj_operator_staging',
  };
  const urlAs = (user: string) =>
    `sqlserver://sqlserver:1433;database=MinhajStaging;user=${user};` +
    `password={SYNTHETIC};encrypt=true;trustServerCertificate=true`;

  it('runs only as the migration principal', () => {
    expect(
      resolveStagingConfiguration({ ...base, DATABASE_MIGRATION_URL: urlAs('sa') })
        .connection.user,
    ).toBe('sa');
  });

  it.each([
    ['the runtime principal', 'minhaj_app', /same account as the runtime principal/],
    [
      'the operator principal',
      'minhaj_operator_staging',
      /same account as the operator principal/,
    ],
  ])('refuses %s', (_label, user, message) => {
    expect(() =>
      resolveStagingConfiguration({ ...base, DATABASE_MIGRATION_URL: urlAs(user) }),
    ).toThrow(message);
  });
});

describe('reset material-data rule', () => {
  it('ignores Prisma history and the migration-seeded catalogue', async () => {
    const report = await materialData(
      liveSession({
        _prisma_migrations: 27,
        Permission: 90,
        Role: 4,
        Topic: 12,
        Language: 3,
      }),
    );
    expect(report.tables).toEqual([]);
  });

  it.each(['Asset', 'User', 'AuditLog'])(
    'treats a row in %s as material',
    async (table) => {
      const report = await materialData(liveSession({ [table]: 1 }));
      expect(report.tables).toEqual([{ table: `dbo.${table}`, rows: 1 }]);
    },
  );

  it('counts audit rows only when the migration did not write them', async () => {
    const live = liveSession({});
    await materialData(live);
    const count = live.statements.find((statement) => statement.includes('COUNT_BIG'));
    expect(count).toMatch(
      /FROM \[dbo\]\.\[AuditLog\] WHERE \[actorType\] <> N'migration'/,
    );
    // Every other table is counted whole.
    expect(count).toMatch(/FROM \[dbo\]\.\[Asset\](\s|$)/m);
    expect(count).not.toMatch(/FROM \[dbo\]\.\[Asset\] WHERE/);
  });

  it('fails rather than skipping a table it cannot count', async () => {
    const session = fakeSession((statement) =>
      statement.includes('FROM sys.tables')
        ? [{ schemaName: 'dbo', tableName: 'Weird]Name' }]
        : [],
    );
    await expect(materialData(session)).rejects.toThrow(/cannot answer/);
  });

  it('fails when a count is missing rather than reading it as empty', async () => {
    const session = fakeSession((statement) =>
      statement.includes('FROM sys.tables')
        ? [{ schemaName: 'dbo', tableName: 'Asset' }]
        : [],
    );
    await expect(materialData(session)).rejects.toThrow(/not an empty one/);
  });
});

describe('reset backup requirement', () => {
  it('needs no backup when the database holds no material data', async () => {
    const master = masterSession({});
    await expect(assertResetSafe(master, liveSession({}))).resolves.toMatchObject({
      backup: null,
    });
    expect(master.statements).toEqual([]);
  });

  it('refuses material data with no recorded staging backup', async () => {
    const master = masterSession({ backups: [] });
    const live = liveSession({ Asset: 1, User: 2 });
    await expect(assertResetSafe(master, live)).rejects.toThrow(
      /holds material data .* no verified staging backup .* staging:db:backup/,
    );
    noDestructiveStatement(master, live);
  });

  it('asks msdb only for full, checksummed backups of the current database within 60 minutes', async () => {
    const master = masterSession({ backups: [] });
    await expect(assertResetSafe(master, liveSession({ Asset: 1 }))).rejects.toThrow();
    const [query] = master.statements;
    expect(query).toContain(`bs.database_name = N'${STAGING_DATABASE}'`);
    expect(query).toContain("bs.type = 'D'");
    expect(query).toContain('bs.has_backup_checksums = 1');
    expect(query).toContain('database_guid');
    expect(query).toContain(`BETWEEN 0 AND ${RESET_BACKUP_MAX_AGE_MINUTES * 60}`);
  });

  it('refuses a recent backup written somewhere other than a staging artifact', async () => {
    const master = masterSession({
      backups: [{ physicalDeviceName: '/tmp/manual.bak', ageSeconds: 60 }],
    });
    await expect(assertResetSafe(master, liveSession({ Asset: 1 }))).rejects.toThrow(
      /no verified staging backup/,
    );
  });

  it('refuses a recorded backup whose artifact is gone', async () => {
    const master = masterSession({
      backups: [{ physicalDeviceName: ARTIFACT, ageSeconds: 60 }],
      fileExists: 0,
    });
    await expect(assertResetSafe(master, liveSession({ User: 1 }))).rejects.toThrow(
      /no verified staging backup/,
    );
  });

  it('accepts a verified staging backup from the last hour', async () => {
    const master = masterSession({
      backups: [{ physicalDeviceName: ARTIFACT, ageSeconds: 600 }],
    });
    const safety = await assertResetSafe(master, liveSession({ Asset: 1 }));
    expect(safety.backup).toMatchObject({
      fileName: `minhaj-staging-${HEX32}.bak`,
      ageMinutes: 10,
    });
    noDestructiveStatement(master);
  });
});

describe('staging create never adopts an unknown database', () => {
  function createMaster(properties: { name: string; value: string }[] | null) {
    return fakeSession((statement) => {
      if (statement.includes('DB_ID(')) return [{ present: properties === null ? 0 : 1 }];
      if (statement.includes('sys.extended_properties')) return properties ?? [];
      throw new Error('unexpected statement');
    });
  }

  it('refuses an existing MinhajStaging without this environment fingerprint', async () => {
    const master = createMaster([]);
    const openLive = vi.fn();
    await expect(createStagingDatabase(master, ENVIRONMENT_ID, openLive)).rejects.toThrow(
      /already exists and is not this environment's .*it is never adopted/,
    );
    expect(openLive).not.toHaveBeenCalled();
    noDestructiveStatement(master);
  });

  it('changes nothing when the fingerprint already matches', async () => {
    const master = createMaster([
      { name: 'minhaj.environment', value: 'staging' },
      { name: 'minhaj.environment_id', value: ENVIRONMENT_ID },
    ]);
    const openLive = vi.fn();
    await expect(
      createStagingDatabase(master, ENVIRONMENT_ID, openLive),
    ).resolves.toEqual({
      created: false,
    });
    expect(openLive).not.toHaveBeenCalled();
    noDestructiveStatement(master);
  });
});
