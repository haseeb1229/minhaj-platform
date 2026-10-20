import { describe, expect, it, vi } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  assertApprovedStagingTarget,
  assertStagingFingerprint,
  assertStagingServer,
  fingerprintRefusal,
  isApprovedStagingHost,
  resolveStagingConfiguration,
  resolveStagingIdentity,
  STAGING_DATABASE,
  STAGING_SQL_MACHINE_NAME,
  StagingTargetError,
  stagingTargetPolicy,
  withVerifiedStagingTarget,
} from '../../packages/database/src/lifecycle/staging-target.ts';

/**
 * Phase 28 — POSITIVE identification of the staging database target.
 *
 * "A database name alone is insufficient": the guard proves configuration
 * (declared environment and instance id), address (internal host, port,
 * database, principal, TLS), the server's machine name and the database's own
 * fingerprint. Each test here removes exactly one of those facts and expects a
 * refusal; the last block proves a refusal means the mutation never runs.
 *
 * Every credential is synthetic and nothing connects to a server.
 */

const MARKER = 'SYNTHETIC_STAGING_PASSWORD_MARKER';
const ENVIRONMENT_ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const TLS = 'encrypt=true;trustServerCertificate=true';

function url(
  options: {
    host?: string;
    port?: number | string;
    database?: string;
    user?: string;
    tls?: string;
  } = {},
): string {
  return (
    `sqlserver://${options.host ?? 'sqlserver'}:${options.port ?? 1433};` +
    `database=${options.database ?? STAGING_DATABASE};user=${options.user ?? 'sa'};` +
    `password={${MARKER}};${options.tls ?? TLS}`
  );
}

function values(overrides: Record<string, string | undefined> = {}) {
  return {
    MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
    MINHAJ_STAGING_ENVIRONMENT_ID: ENVIRONMENT_ID,
    DATABASE_MIGRATION_URL: url(),
    DATABASE_APP_LOGIN: 'minhaj_app',
    DATABASE_OPERATOR_LOGIN: 'minhaj_operator_staging',
    ...overrides,
  };
}

const livePolicy = stagingTargetPolicy(values(), 'live', 'migration');

/** A fake `master` session answering the server and fingerprint probes. */
function fakeMaster(answers: {
  machineName?: string | null;
  present?: number | null;
  properties?: { name: string; value: string | null }[];
}): SqlSession & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async query<Row>(statement: string): Promise<Row[]> {
      statements.push(statement);
      if (statement.includes("SERVERPROPERTY('MachineName')")) {
        return [
          {
            machineName:
              answers.machineName === undefined
                ? STAGING_SQL_MACHINE_NAME
                : answers.machineName,
            productVersion: '16.0.4265.3',
            productUpdateLevel: 'CU26',
            edition: 'Developer Edition (64-bit)',
            fullTextInstalled: 1,
          },
        ] as Row[];
      }
      if (statement.includes('DB_ID(')) {
        return [
          { present: answers.present === undefined ? 1 : answers.present },
        ] as Row[];
      }
      if (statement.includes('sys.extended_properties')) {
        return (answers.properties ?? [
          { name: 'minhaj.environment', value: 'staging' },
          { name: 'minhaj.environment_id', value: ENVIRONMENT_ID },
        ]) as Row[];
      }
      throw new Error('unexpected statement in the fake master session');
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

describe('staging identity — the process must declare itself THIS staging environment', () => {
  it('accepts the exact valid shape', () => {
    expect(resolveStagingIdentity(values())).toEqual({ environmentId: ENVIRONMENT_ID });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['production', 'production'],
    ['capitalised Staging', 'Staging'],
    ['upper-case STAGING', 'STAGING'],
    ['trailing whitespace', 'staging '],
    ['development', 'development'],
  ])('refuses a deployment environment that is %s', (_label, environment) => {
    expect(() =>
      resolveStagingIdentity(values({ MINHAJ_DEPLOYMENT_ENVIRONMENT: environment })),
    ).toThrow(StagingTargetError);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['upper-case', ENVIRONMENT_ID.toUpperCase()],
    ['not version 4', '3f2b8c1e-5a4d-1e6f-9b7a-1c2d3e4f5a6b'],
    ['wrong variant', '3f2b8c1e-5a4d-4e6f-cb7a-1c2d3e4f5a6b'],
    ['without hyphens', ENVIRONMENT_ID.replaceAll('-', '')],
    ['with surrounding text', `x${ENVIRONMENT_ID}`],
    ['a word', 'staging'],
  ])('refuses an environment id that is %s', (_label, id) => {
    expect(() =>
      resolveStagingIdentity(values({ MINHAJ_STAGING_ENVIRONMENT_ID: id })),
    ).toThrow(/lowercase UUID v4/);
  });
});

describe('staging address — host, port, database, principal and TLS', () => {
  it('accepts the exact valid shape', () => {
    const connection = assertApprovedStagingTarget(url(), livePolicy);
    expect(connection).toMatchObject({
      server: 'sqlserver',
      port: 1433,
      database: STAGING_DATABASE,
      user: 'sa',
    });
    expect(resolveStagingConfiguration(values()).environmentId).toBe(ENVIRONMENT_ID);
  });

  it('accepts the staging host only as the exact service name', () => {
    expect(isApprovedStagingHost('sqlserver')).toBe(true);
  });

  it.each([
    'localhost',
    '127.0.0.1',
    'sqlserver.evil',
    'evil.sqlserver',
    'SQLSERVER',
    'sqlserver.',
    'sqlserver-prod',
    'minhaj-staging-sql',
    '10.0.0.5',
    '',
  ])('refuses host %s', (host) => {
    expect(isApprovedStagingHost(host)).toBe(false);
    if (host !== '') {
      expect(() => assertApprovedStagingTarget(url({ host }), livePolicy)).toThrow(
        /not the internal staging SQL host/,
      );
    }
  });

  it.each([14330, 1434, 1533])('refuses port %s', (port) => {
    expect(() => assertApprovedStagingTarget(url({ port }), livePolicy)).toThrow(
      /not the internal staging SQL Server port 1433/,
    );
  });

  it('refuses the local engineering database by name', () => {
    expect(() =>
      assertApprovedStagingTarget(url({ database: 'MinhajPlatform' }), livePolicy),
    ).toThrow(/local engineering database/);
  });

  it.each([
    `MinhajPhase1Test_${'a'.repeat(32)}`,
    'MinhajPhase1Test_x',
    `MinhajPhase1Restore_${'a'.repeat(32)}`,
  ])('refuses the local rehearsal namespace: %s', (database) => {
    expect(() => assertApprovedStagingTarget(url({ database }), livePolicy)).toThrow(
      /local Phase 1 rehearsal namespace/,
    );
  });

  it.each([
    'MinhajStaging2',
    'minhajstaging',
    'MinhajProduction',
    'Minhaj',
    'MinhajPlatformProd',
    'master',
    'msdb',
    `MinhajStagingRestore_${'a'.repeat(32)}`,
  ])('refuses %s for a live operation', (database) => {
    expect(() => assertApprovedStagingTarget(url({ database }), livePolicy)).toThrow(
      StagingTargetError,
    );
  });

  it('admits only a staging restore name for a restore operation — never the live DB', () => {
    const restorePolicy = stagingTargetPolicy(values(), 'restore', 'migration');
    expect(() =>
      assertApprovedStagingTarget(
        url({ database: `MinhajStagingRestore_${'b'.repeat(32)}` }),
        restorePolicy,
      ),
    ).not.toThrow();
    for (const database of [
      STAGING_DATABASE,
      `MinhajStagingRestore_${'b'.repeat(31)}`,
      `MinhajStagingRestore_${'B'.repeat(32)}`,
      `MinhajPhase1Restore_${'b'.repeat(32)}`,
    ]) {
      expect(() =>
        assertApprovedStagingTarget(url({ database }), restorePolicy),
      ).toThrow();
    }
  });

  it('refuses the runtime principal as the migration principal', () => {
    expect(() =>
      assertApprovedStagingTarget(url({ user: 'minhaj_app' }), livePolicy),
    ).toThrow(/migration authority must be held separately/);
  });

  it('refuses the operator principal as the migration principal', () => {
    expect(() =>
      assertApprovedStagingTarget(url({ user: 'minhaj_operator_staging' }), livePolicy),
    ).toThrow(/same account as the operator principal/);
  });

  it('refuses an operator login equal to the runtime login', () => {
    const policy = stagingTargetPolicy(
      values({ DATABASE_OPERATOR_LOGIN: 'minhaj_app' }),
      'live',
      'migration',
    );
    expect(() => assertApprovedStagingTarget(url(), policy)).toThrow(
      /operator principal is the same account as the runtime principal/,
    );
  });

  it.each(['DATABASE_APP_LOGIN', 'DATABASE_OPERATOR_LOGIN'])(
    'refuses when %s is not configured',
    (key) => {
      const policy = stagingTargetPolicy(
        values({ [key]: undefined }),
        'live',
        'migration',
      );
      expect(() => assertApprovedStagingTarget(url(), policy)).toThrow(
        /cannot be positively identified/,
      );
    },
  );

  it('requires the runtime path to be exactly the configured runtime login', () => {
    const runtime = stagingTargetPolicy(values(), 'live', 'runtime');
    expect(() =>
      assertApprovedStagingTarget(url({ user: 'minhaj_app' }), runtime),
    ).not.toThrow();
    expect(() => assertApprovedStagingTarget(url({ user: 'sa' }), runtime)).toThrow(
      /not the configured least-privilege principal/,
    );
  });

  it('refuses an unencrypted connection', () => {
    expect(() =>
      assertApprovedStagingTarget(url({ tls: 'encrypt=false' }), livePolicy),
    ).toThrow(/not encrypted/);
  });

  it('refuses a connection without the internal certificate accommodation', () => {
    expect(() =>
      assertApprovedStagingTarget(url({ tls: 'encrypt=true' }), livePolicy),
    ).toThrow(/trustServerCertificate=true is required/);
  });

  it('never puts the password or the URL in a refusal', () => {
    const candidates = [
      url({ host: 'localhost' }),
      url({ port: 14330 }),
      url({ database: 'MinhajPlatform' }),
      url({ user: 'minhaj_app' }),
      url({ tls: 'encrypt=false' }),
    ];
    for (const candidate of candidates) {
      let thrown: unknown;
      try {
        assertApprovedStagingTarget(candidate, livePolicy);
      } catch (error) {
        thrown = error;
      }
      const rendered = `${String(thrown)}\n${(thrown as Error).stack ?? ''}`;
      expect(rendered).not.toContain(MARKER);
      expect(rendered).not.toContain(candidate);
    }
  });
});

describe('staging server and database fingerprints', () => {
  it('accepts the staging container by machine name', async () => {
    await expect(assertStagingServer(fakeMaster({}))).resolves.toMatchObject({
      machineName: STAGING_SQL_MACHINE_NAME,
      fullTextInstalled: true,
    });
  });

  it.each([
    ['a different machine', 'prod-sql-01'],
    ['the local container', 'minhaj-sqlserver-2022'],
    ['a case-shifted name', 'MINHAJ-STAGING-SQL'],
    ['no machine name', null],
  ])('refuses %s', async (_label, machineName) => {
    await expect(assertStagingServer(fakeMaster({ machineName }))).rejects.toThrow(
      StagingTargetError,
    );
  });

  it('accepts a database carrying this environment fingerprint', async () => {
    await expect(
      assertStagingFingerprint(fakeMaster({}), STAGING_DATABASE, ENVIRONMENT_ID),
    ).resolves.toMatchObject({ exists: true, environmentId: ENVIRONMENT_ID });
  });

  it.each([
    ['no properties at all (a production-like or foreign database)', []],
    ['only the environment kind', [{ name: 'minhaj.environment', value: 'staging' }]],
    [
      'a production marker',
      [
        { name: 'minhaj.environment', value: 'production' },
        { name: 'minhaj.environment_id', value: ENVIRONMENT_ID },
      ],
    ],
    [
      'another staging instance',
      [
        { name: 'minhaj.environment', value: 'staging' },
        { name: 'minhaj.environment_id', value: '11111111-2222-4333-8444-555555555555' },
      ],
    ],
  ])('refuses %s', async (_label, properties) => {
    await expect(
      assertStagingFingerprint(
        fakeMaster({ properties }),
        STAGING_DATABASE,
        ENVIRONMENT_ID,
      ),
    ).rejects.toThrow(/fingerprint/);
  });

  it('refuses an absent database, and an unanswered existence probe', async () => {
    await expect(
      assertStagingFingerprint(
        fakeMaster({ present: 0 }),
        STAGING_DATABASE,
        ENVIRONMENT_ID,
      ),
    ).rejects.toThrow(/does not exist/);
    await expect(
      assertStagingFingerprint(
        fakeMaster({ present: null }),
        STAGING_DATABASE,
        ENVIRONMENT_ID,
      ),
    ).rejects.toThrow(/state is unknown/);
  });

  it('never reads the fingerprint of a database outside the staging policies', async () => {
    const master = fakeMaster({});
    await expect(
      assertStagingFingerprint(master, 'MinhajPlatform', ENVIRONMENT_ID),
    ).rejects.toThrow(/local engineering database/);
    expect(master.statements).toEqual([]);
  });

  it('describes the refusal without echoing a foreign database’s values', () => {
    const refusal = fingerprintRefusal(
      { exists: true, environment: 'staging', environmentId: 'foreign-secret-ish-value' },
      ENVIRONMENT_ID,
    );
    expect(refusal).toMatch(/different staging environment instance/);
    expect(refusal).not.toContain('foreign-secret-ish-value');
  });
});

describe('the staging guard actually gates the mutation', () => {
  it('never invokes the mutation for a refused target', async () => {
    const mutate = vi.fn(async () => 'MUTATED');
    const cases: [Record<string, string | undefined>, ReturnType<typeof fakeMaster>][] = [
      [values({ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'production' }), fakeMaster({})],
      [values({ MINHAJ_STAGING_ENVIRONMENT_ID: 'nope' }), fakeMaster({})],
      [values({ DATABASE_MIGRATION_URL: url({ host: 'localhost' }) }), fakeMaster({})],
      [
        values({ DATABASE_MIGRATION_URL: url({ database: 'MinhajPlatform' }) }),
        fakeMaster({}),
      ],
      [values({ DATABASE_MIGRATION_URL: url({ user: 'minhaj_app' }) }), fakeMaster({})],
      [values(), fakeMaster({ machineName: 'prod-sql-01' })],
      [values(), fakeMaster({ properties: [] })],
      [values(), fakeMaster({ present: 0 })],
    ];

    for (const [record, master] of cases) {
      await expect(
        withVerifiedStagingTarget(record, async () => master, mutate),
      ).rejects.toThrow();
    }
    expect(mutate).not.toHaveBeenCalled();
  });

  it('opens master only after the configuration half holds', async () => {
    const open = vi.fn(async () => fakeMaster({}));
    await expect(
      withVerifiedStagingTarget(
        values({ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'Staging' }),
        open,
        vi.fn(),
      ),
    ).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it('invokes the mutation once, on master, for the verified target', async () => {
    const mutate = vi.fn(async () => 'MUTATED');
    const open = vi.fn(async () => fakeMaster({}));

    await expect(withVerifiedStagingTarget(values(), open, mutate)).resolves.toBe(
      'MUTATED',
    );
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toMatchObject({
      server: 'sqlserver',
      database: 'master',
    });
  });
});
