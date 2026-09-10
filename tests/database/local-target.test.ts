import { describe, expect, it, vi } from 'vitest';

import { BACKUP_SOURCE_DATABASE } from '../../packages/database/src/lifecycle/backup.ts';
import {
  assertApprovedLocalTarget,
  DEFAULT_LOCAL_SQL_PORT,
  isApprovedLocalHost,
  LocalTargetError,
  localTargetPolicy,
  withApprovedLocalTarget,
  type LocalTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';

/**
 * F5 — positive proof that a destructive command's target is the approved local
 * SQL Server.
 *
 * ## What the previous guard permitted
 *
 * It checked `encrypt`, `trustServerCertificate` and that a user was named.
 * Every URL below satisfied all three, and `db:migrate:deploy`, `db:backup` and
 * `db:recovery:test` would have run real DDL, a real `BACKUP DATABASE` and a
 * real `RESTORE` against whatever answered.
 *
 * The replacement identifies POSITIVELY — loopback host, the configured local
 * port, a database this specific operation may touch, and the expected
 * principal — so a host nobody thought to blocklist is refused for the same
 * reason as one somebody did.
 *
 * Every credential here is synthetic and no test connects to anything.
 */

const MARKER = 'SYNTHETIC_TARGET_MARKER';
const TLS = 'encrypt=true;trustServerCertificate=true';

/** The approved local configuration, as `docker/.env` supplies it. */
const APPROVED_VALUES = {
  MINHAJ_SQLSERVER_PORT: String(DEFAULT_LOCAL_SQL_PORT),
  DATABASE_APP_LOGIN: 'minhaj_app',
};

const migrationPolicy = localTargetPolicy(APPROVED_VALUES, 'source', 'migration');

function url(options: {
  host?: string;
  port?: number | string;
  database?: string;
  user?: string;
  tls?: string;
}): string {
  const host = options.host ?? 'localhost';
  const port = options.port ?? DEFAULT_LOCAL_SQL_PORT;
  const database = options.database ?? BACKUP_SOURCE_DATABASE;
  const user = options.user ?? 'sa';
  const tls = options.tls ?? TLS;

  return `sqlserver://${host}:${port};database=${database};user=${user};password=${MARKER};${tls}`;
}

describe('F5 — the approved local host set', () => {
  it.each([
    ['localhost', 'localhost'],
    ['uppercase localhost', 'LOCALHOST'],
    ['the fully-qualified trailing-dot form', 'localhost.'],
    ['the published loopback address', '127.0.0.1'],
  ])('accepts %s', (_label, host) => {
    expect(isApprovedLocalHost(host)).toBe(true);
  });

  it.each([
    ['the review’s named non-local host', 'nonlocal.invalid'],
    ['a subdomain that merely starts with localhost', 'localhost.attacker.example'],
    ['a domain that merely ends with localhost', 'attacker.localhost'],
    ['a public hostname', 'example.com'],
    ['userinfo smuggling a real host', 'sa@localhost'],
    ['userinfo the other way round', 'localhost@evil.example'],
    ['a path suffix', 'localhost/../evil'],
    ['every interface', '0.0.0.0'],
    ['a private 10/8 address', '10.0.0.5'],
    ['a private 172.16/12 address', '172.16.0.5'],
    ['a private 192.168/16 address', '192.168.1.10'],
    ['a link-local address', '169.254.1.1'],
    ['a public address', '203.0.113.10'],
    ['IPv6 loopback, which this stack does not publish', '::1'],
    ['a bracketed IPv6 loopback', '[::1]'],
    ['a non-loopback IPv6 address', '2001:db8::1'],
    ['an octal-looking loopback encoding', '0177.0.0.1'],
    ['an unbound address in the loopback block', '127.0.0.2'],
    ['a shortened loopback address', '127.1'],
    ['a zero-padded loopback address', '127.000.000.001'],
    ['a hexadecimal loopback address', '0x7f000001'],
    ['a decimal loopback encoding', '2130706433'],
    ['a loopback with an out-of-range octet', '127.0.0.999'],
    ['a trimmed-looking host', ' localhost'],
    ['an empty host', ''],
  ])('refuses %s', (_label, host) => {
    expect(isApprovedLocalHost(host)).toBe(false);
  });
});

describe('F5 — a target must satisfy every approved property', () => {
  it('accepts the approved local configuration', () => {
    const connection = assertApprovedLocalTarget(url({}), migrationPolicy);

    expect(connection.server).toBe('localhost');
    expect(connection.port).toBe(DEFAULT_LOCAL_SQL_PORT);
    expect(connection.database).toBe(BACKUP_SOURCE_DATABASE);
    expect(connection.user).toBe('sa');
  });

  it('refuses nonlocal.invalid, which the old guard accepted', () => {
    expect(() =>
      assertApprovedLocalTarget(url({ host: 'nonlocal.invalid' }), migrationPolicy),
    ).toThrow(LocalTargetError);
  });

  it('refuses localhost.attacker.example', () => {
    expect(() =>
      assertApprovedLocalTarget(
        url({ host: 'localhost.attacker.example' }),
        migrationPolicy,
      ),
    ).toThrow(/not the loopback interface/);
  });

  it('refuses a private-network address', () => {
    expect(() =>
      assertApprovedLocalTarget(url({ host: '10.0.0.5' }), migrationPolicy),
    ).toThrow(/not the loopback interface/);
  });

  it('refuses the wrong port', () => {
    expect(() => assertApprovedLocalTarget(url({ port: 1433 }), migrationPolicy)).toThrow(
      /not the approved local SQL Server port/,
    );
  });

  it('refuses a port that merely starts with the approved digits', () => {
    // `Number.parseInt` stops at the first non-digit, so `14330x` would
    // otherwise compare equal to the approved port.
    expect(() =>
      assertApprovedLocalTarget(url({ port: '14330x' }), migrationPolicy),
    ).toThrow(/port is not a decimal number/);
  });

  it('honours a non-default configured port', () => {
    const policy = localTargetPolicy(
      { ...APPROVED_VALUES, MINHAJ_SQLSERVER_PORT: '14555' },
      'source',
      'migration',
    );

    expect(() => assertApprovedLocalTarget(url({ port: 14_555 }), policy)).not.toThrow();
    expect(() => assertApprovedLocalTarget(url({}), policy)).toThrow(/port/);
  });

  it('refuses the wrong database', () => {
    expect(() =>
      assertApprovedLocalTarget(url({ database: 'SomeOtherDatabase' }), migrationPolicy),
    ).toThrow(/Refusing to back up/);
  });

  it('refuses an unencrypted connection', () => {
    expect(() =>
      assertApprovedLocalTarget(url({ tls: 'encrypt=false' }), migrationPolicy),
    ).toThrow(/not encrypted/);
  });

  it('refuses a URL missing the local certificate accommodation', () => {
    // This exact shape is what produced P1011 across sessions.
    expect(() =>
      assertApprovedLocalTarget(url({ tls: 'encrypt=true' }), migrationPolicy),
    ).toThrow(/P1011/);
  });

  it('refuses a malformed connection URL', () => {
    expect(() => assertApprovedLocalTarget('not-a-url', migrationPolicy)).toThrow(
      /Invalid SQL Server connection URL/,
    );
  });

  it('never puts the password in a rejection', () => {
    for (const candidate of [
      url({ host: 'nonlocal.invalid' }),
      url({ port: 1433 }),
      url({ database: 'Wrong' }),
      url({ tls: 'encrypt=false' }),
    ]) {
      let thrown: unknown;
      try {
        assertApprovedLocalTarget(candidate, migrationPolicy);
      } catch (error) {
        thrown = error;
      }

      const rendered = `${String(thrown)}\n${(thrown as Error).stack ?? ''}`;
      expect(rendered).not.toContain(MARKER);
      expect(rendered).not.toContain(candidate);
    }
  });
});

describe('F5 — the principal must be the expected one', () => {
  it('refuses a migration connection using the runtime login', () => {
    // SECURITY_BASELINE.md §18.2: the runtime account must not hold migration
    // authority, which is only true while the two are different accounts.
    expect(() =>
      assertApprovedLocalTarget(url({ user: 'minhaj_app' }), migrationPolicy),
    ).toThrow(/must be held separately/);
  });

  it('refuses a connection naming no principal', () => {
    expect(() =>
      assertApprovedLocalTarget(
        `sqlserver://localhost:${DEFAULT_LOCAL_SQL_PORT};database=${BACKUP_SOURCE_DATABASE};user=;password=${MARKER};${TLS}`,
        migrationPolicy,
      ),
    ).toThrow(/Invalid SQL Server connection URL/);
  });

  it('requires the runtime path to be the configured least-privilege login', () => {
    const runtimePolicy = localTargetPolicy(APPROVED_VALUES, 'source', 'runtime');

    expect(() =>
      assertApprovedLocalTarget(url({ user: 'minhaj_app' }), runtimePolicy),
    ).not.toThrow();

    // Positively identified, so `sa` fails for naming the wrong account rather
    // than for being on a list of accounts somebody remembered to name.
    expect(() => assertApprovedLocalTarget(url({ user: 'sa' }), runtimePolicy)).toThrow(
      /not the configured least-privilege principal/,
    );
  });

  it('refuses the runtime path when no runtime login is configured', () => {
    const policy = localTargetPolicy(
      { MINHAJ_SQLSERVER_PORT: String(DEFAULT_LOCAL_SQL_PORT) },
      'source',
      'runtime',
    );

    expect(() => assertApprovedLocalTarget(url({ user: 'minhaj_app' }), policy)).toThrow(
      /cannot be positively identified/,
    );
  });

  it('refuses migration when runtime-login separation cannot be proven', () => {
    const policy = localTargetPolicy(
      { MINHAJ_SQLSERVER_PORT: String(DEFAULT_LOCAL_SQL_PORT) },
      'source',
      'migration',
    );

    expect(() => assertApprovedLocalTarget(url({ user: 'sa' }), policy)).toThrow(
      /separation between the migration and runtime principals cannot be proven/,
    );
  });
});

describe('F5 — database policies stay per-operation', () => {
  const disposable = `MinhajPhase1Test_${'a'.repeat(32)}`;
  const restore = `MinhajPhase1Restore_${'a'.repeat(32)}`;

  function policy(database: LocalTargetPolicy['database']): LocalTargetPolicy {
    return localTargetPolicy(APPROVED_VALUES, database, 'migration');
  }

  it('never lets the source database be a disposable-drop target', () => {
    // The failure mode this exists to prevent: one broad "is it a Minhaj
    // database" rule would make MinhajPlatform legal for every destructive
    // helper, and a restore or a DROP aimed at it destroys the data the
    // rehearsal claims to be proving recoverable.
    expect(() =>
      assertApprovedLocalTarget(
        url({ database: BACKUP_SOURCE_DATABASE }),
        policy('disposable'),
      ),
    ).toThrow(/may only touch a disposable MinhajPhase1Test_/);

    expect(() =>
      assertApprovedLocalTarget(
        url({ database: BACKUP_SOURCE_DATABASE }),
        policy('restore'),
      ),
    ).toThrow(/may only touch a disposable MinhajPhase1Restore_/);
  });

  it('never lets a restore target be the backup source', () => {
    expect(() =>
      assertApprovedLocalTarget(url({ database: restore }), policy('source')),
    ).toThrow(/Refusing to back up/);
  });

  it('keeps the two disposable classes distinct', () => {
    expect(() =>
      assertApprovedLocalTarget(url({ database: restore }), policy('disposable')),
    ).toThrow();
    expect(() =>
      assertApprovedLocalTarget(url({ database: disposable }), policy('restore')),
    ).toThrow();
  });

  it('allows migrations against the source or a disposable database only', () => {
    expect(() =>
      assertApprovedLocalTarget(
        url({ database: BACKUP_SOURCE_DATABASE }),
        policy('migration-target'),
      ),
    ).not.toThrow();
    expect(() =>
      assertApprovedLocalTarget(
        url({ database: disposable }),
        policy('migration-target'),
      ),
    ).not.toThrow();

    expect(() =>
      assertApprovedLocalTarget(url({ database: restore }), policy('migration-target')),
    ).toThrow();
    expect(() =>
      assertApprovedLocalTarget(url({ database: 'master' }), policy('migration-target')),
    ).toThrow();
  });
});

describe('F5 — the guard actually gates the mutation', () => {
  /**
   * The distinction that matters. A warning printed immediately before a
   * destructive call is not a guard; the only way to tell the difference is to
   * observe that the destructive call did not happen.
   */
  it('never invokes the mutation for a rejected target', async () => {
    const mutate = vi.fn(async () => 'MUTATED');

    for (const rejected of [
      url({ host: 'nonlocal.invalid' }),
      url({ host: 'localhost.attacker.example' }),
      url({ host: '10.0.0.5' }),
      url({ port: 1433 }),
      url({ database: 'SomeOtherDatabase' }),
      url({ user: 'minhaj_app' }),
      url({ tls: 'encrypt=false' }),
      'not-a-url',
    ]) {
      await expect(
        withApprovedLocalTarget(rejected, migrationPolicy, mutate),
      ).rejects.toThrow();
    }

    expect(mutate).not.toHaveBeenCalled();
  });

  it('invokes the mutation once for the approved target', async () => {
    const mutate = vi.fn(async () => 'MUTATED');

    await expect(withApprovedLocalTarget(url({}), migrationPolicy, mutate)).resolves.toBe(
      'MUTATED',
    );

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      server: 'localhost',
      port: DEFAULT_LOCAL_SQL_PORT,
      database: BACKUP_SOURCE_DATABASE,
    });
  });
});

describe('F5 — the policy comes from resolved configuration', () => {
  it('defaults to the compose file’s published port', () => {
    expect(localTargetPolicy({}, 'source', 'migration').port).toBe(
      DEFAULT_LOCAL_SQL_PORT,
    );
  });

  it('refuses a configured port that is not a TCP port', () => {
    for (const port of ['0', '70000', 'not-a-number', '-1', '14330x', ' 14330']) {
      expect(() =>
        localTargetPolicy({ MINHAJ_SQLSERVER_PORT: port }, 'source', 'migration'),
      ).toThrow(/not a valid TCP port number/);
    }
  });
});
