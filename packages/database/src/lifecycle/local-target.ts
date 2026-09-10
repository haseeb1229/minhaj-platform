import 'server-only';

import {
  assertBackupSourceDatabase,
  BACKUP_SOURCE_DATABASE,
  isRestoreDatabaseName,
  RESTORE_PREFIX,
} from './backup.ts';
import { DISPOSABLE_PREFIX, isDisposableDatabaseName } from './disposable-database.ts';
import { parseSqlServerUrl, type SqlServerConnection } from './sql-connection.ts';

/**
 * POSITIVE identification of the approved local database target, run before any
 * destructive or mutating local operation.
 *
 * ## What was wrong before
 *
 * The previous guard proved TLS properties and that a user was named. Those are
 * necessary and nowhere near sufficient: every one of
 *
 *   sqlserver://nonlocal.invalid:14330;database=MinhajPlatform;user=sa;...
 *   sqlserver://localhost.attacker.example:14330;database=MinhajPlatform;...
 *   sqlserver://10.0.0.5:1433;database=MinhajPlatform;user=sa;...
 *
 * satisfied it completely, and `db:migrate:deploy`, `db:backup` and
 * `db:recovery:test` would then have run real DDL, a real BACKUP and a real
 * RESTORE against whatever was on the other end.
 *
 * ## Why this is an allowlist and not a blocklist
 *
 * A blocklist ("reject production.example.com") fails open on every host nobody
 * thought to name, which is every host. This proves the properties the
 * repository actually controls, and refuses everything else — the same
 * discipline the disposable-name guards already use.
 *
 * ## Where the approved set comes from
 *
 * `docker/compose.yaml` is the authority, not this file's opinion:
 *
 *   - the SQL container publishes `127.0.0.1:${MINHAJ_SQLSERVER_PORT:-14330}:1433`,
 *     so the approved host is that exact loopback address (plus `localhost`)
 *     and the approved port is the configured
 *     local port (14330 by default);
 *   - the Phase 1 source database is `MinhajPlatform`
 *     (`BACKUP_SOURCE_DATABASE`), and the only other legitimate targets are the
 *     disposable `MinhajPhase1Test_<hex>` and restore `MinhajPhase1Restore_<hex>`
 *     names this repository generates;
 *   - the runtime principal is `DATABASE_APP_LOGIN`, which by
 *     SECURITY_BASELINE.md §18.2 must be a DIFFERENT account from the one that
 *     performs migrations.
 *
 * The binding is IPv4 loopback only, so `::1` is deliberately NOT approved:
 * nothing in this stack listens there, and accepting an address the container
 * does not publish would widen the set beyond what the compose file grants.
 */

/** The default published port from `docker/compose.yaml`. */
export const DEFAULT_LOCAL_SQL_PORT = 14330;

/**
 * Which database names a given operation may legitimately touch.
 *
 * Deliberately per-operation. One broad "is this a Minhaj database" assertion
 * would make `MinhajPlatform` a legal target for the disposable-drop helper,
 * which is precisely the mistake that ends with the source database dropped.
 */
export type LocalDatabasePolicy =
  /** Only `MinhajPlatform` — backup source, persistent migrate target. */
  | 'source'
  /** Only `MinhajPhase1Test_<32 hex>`. */
  | 'disposable'
  /** Only `MinhajPhase1Restore_<32 hex>`. */
  | 'restore'
  /** `MinhajPlatform` or a disposable test database; never a restore target. */
  | 'migration-target';

/** Which account the connection is expected to be, positively. */
export type LocalPrincipalPolicy = 'migration' | 'runtime';

export interface LocalTargetPolicy {
  database: LocalDatabasePolicy;
  /** The approved local port, from `MINHAJ_SQLSERVER_PORT`. */
  port: number;
  principal: LocalPrincipalPolicy;
  /** `DATABASE_APP_LOGIN` — the runtime account, for the distinctness proof. */
  runtimeLogin: string | undefined;
}

/** Raised when a target cannot be positively identified as the approved local one. */
export class LocalTargetError extends Error {
  readonly property: string;

  constructor(property: string, reason: string) {
    super(`Refusing to run against this target: ${reason} (${property}).`);
    this.name = 'LocalTargetError';
    this.property = property;
  }
}

/**
 * Whether a host string names the loopback interface this repository publishes on.
 *
 * Works on the PARSED host component, and rejects rather than normalises
 * anything ambiguous:
 *
 *   - `localhost.attacker.example` is not `localhost` — a prefix or `startsWith`
 *     test would accept it;
 *   - `sa@localhost` and `localhost/x` carry userinfo or a path and are refused
 *     outright rather than having a host extracted from them;
 *   - `0177.0.0.1` and `2130706433` are alternative encodings of a loopback
 *     address; they are refused because accepting one encoding of an address
 *     means accepting the argument that some other encoding is fine too;
 *   - `0.0.0.0` is every interface, not the loopback one.
 */
export function isApprovedLocalHost(host: string): boolean {
  if (host === '' || host !== host.trim()) return false;
  // Userinfo, path, IPv6 zone and bracket forms never reach a host comparison.
  if (/[@/\\%[\]:]/.test(host)) return false;

  // One trailing dot is the fully-qualified form of the same name.
  const normalised = (host.endsWith('.') ? host.slice(0, -1) : host).toLowerCase();

  if (normalised === 'localhost') return true;

  // Compose binds this address exactly. Other 127/8 spellings may be loopback
  // to the OS, but the repository did not publish or approve them.
  return normalised === '127.0.0.1';
}

function assertApprovedDatabase(database: string, policy: LocalDatabasePolicy): void {
  switch (policy) {
    case 'source':
      // Throws with the existing Phase 1 wording, so one rule governs the
      // backup source wherever it is checked.
      assertBackupSourceDatabase(database);
      return;

    case 'disposable':
      if (!isDisposableDatabaseName(database)) {
        throw new LocalTargetError(
          'database',
          `this operation may only touch a disposable ${DISPOSABLE_PREFIX}<32 hex> ` +
            `database, and '${database}' is not one`,
        );
      }
      return;

    case 'restore':
      if (!isRestoreDatabaseName(database)) {
        throw new LocalTargetError(
          'database',
          `this operation may only touch a disposable ${RESTORE_PREFIX}<32 hex> ` +
            `database, and '${database}' is not one`,
        );
      }
      return;

    case 'migration-target':
      if (database !== BACKUP_SOURCE_DATABASE && !isDisposableDatabaseName(database)) {
        throw new LocalTargetError(
          'database',
          `migrations may only be applied to ${BACKUP_SOURCE_DATABASE} or to a ` +
            `disposable ${DISPOSABLE_PREFIX}<32 hex> database, and '${database}' ` +
            `is neither`,
        );
      }
      return;
  }
}

function assertApprovedPrincipal(
  user: string,
  policy: LocalPrincipalPolicy,
  runtimeLogin: string | undefined,
): void {
  if (user === '') {
    throw new LocalTargetError('user', 'the configuration names no principal');
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(user)) {
    throw new LocalTargetError('user', `'${user}' is not a plain SQL Server identifier`);
  }

  if (policy === 'migration') {
    // SECURITY_BASELINE.md §18.2: the runtime account must not be able to
    // change schema, which is only true while the two accounts are distinct.
    if (runtimeLogin === undefined || runtimeLogin === '') {
      throw new LocalTargetError(
        'user',
        'DATABASE_APP_LOGIN is not configured, so separation between the ' +
          'migration and runtime principals cannot be proven',
      );
    }
    if (user === runtimeLogin) {
      throw new LocalTargetError(
        'user',
        `the migration principal is the same account as the runtime principal ` +
          `('${user}'); migration authority must be held separately`,
      );
    }
    return;
  }

  // The runtime path must be the least-privilege account, positively — not
  // merely "some account that is not sa".
  if (runtimeLogin === undefined || runtimeLogin === '') {
    throw new LocalTargetError(
      'user',
      'DATABASE_APP_LOGIN is not configured, so the runtime principal cannot be ' +
        'positively identified',
    );
  }
  if (user !== runtimeLogin) {
    throw new LocalTargetError(
      'user',
      `the runtime connection is '${user}', not the configured least-privilege ` +
        `principal '${runtimeLogin}'`,
    );
  }
}

/**
 * Proves a URL names the approved local target, and returns the parsed
 * connection.
 *
 * Every check is positive, and the whole set must hold: loopback host, the
 * configured local port, a database this operation is allowed to touch, the
 * expected principal, and the encrypted local TLS posture.
 *
 * Throws `LocalTargetError` or `SqlConnectionUrlError`; neither ever carries
 * the URL or the password (SECURITY_BASELINE.md §18.1).
 */
export function assertApprovedLocalTarget(
  url: string,
  policy: LocalTargetPolicy,
): SqlServerConnection {
  const connection = parseSqlServerUrl(url);

  if (!isApprovedLocalHost(connection.server)) {
    throw new LocalTargetError(
      'host',
      `'${connection.server}' is not the loopback interface the local SQL Server ` +
        `container publishes on. Approved: localhost or 127.0.0.1`,
    );
  }

  if (!Number.isInteger(connection.port) || connection.port !== policy.port) {
    throw new LocalTargetError(
      'port',
      `port ${connection.port} is not the approved local SQL Server port ` +
        `${policy.port} (MINHAJ_SQLSERVER_PORT, default ${DEFAULT_LOCAL_SQL_PORT})`,
    );
  }

  assertApprovedDatabase(connection.database, policy.database);
  assertApprovedPrincipal(connection.user, policy.principal, policy.runtimeLogin);

  if (!connection.encrypt) {
    throw new LocalTargetError(
      'encrypt',
      'the connection is not encrypted; encrypt=true is required',
    );
  }
  if (!connection.trustServerCertificate) {
    // The local Developer container serves a self-signed certificate, so Prisma
    // fails with P1011 without this. Caught here rather than as an opaque CLI
    // error several steps later.
    throw new LocalTargetError(
      'trustServerCertificate',
      'trustServerCertificate=true is required for the self-signed local SQL ' +
        'Server 2022 Developer container; without it the Prisma CLI fails with P1011',
    );
  }

  return connection;
}

/**
 * Builds a policy from RESOLVED local configuration.
 *
 * The port and the runtime login come from the same record every other part of
 * the command uses, so the guard cannot be validating one configuration while
 * the command runs against another.
 */
export function localTargetPolicy(
  values: Record<string, string | undefined>,
  database: LocalDatabasePolicy,
  principal: LocalPrincipalPolicy,
): LocalTargetPolicy {
  const configured = values['MINHAJ_SQLSERVER_PORT'];
  if (configured !== undefined && configured !== '' && !/^\d{1,5}$/.test(configured)) {
    throw new LocalTargetError(
      'port',
      'MINHAJ_SQLSERVER_PORT is not a valid TCP port number',
    );
  }
  const port =
    configured === undefined || configured === ''
      ? DEFAULT_LOCAL_SQL_PORT
      : Number(configured);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new LocalTargetError(
      'port',
      'MINHAJ_SQLSERVER_PORT is not a valid TCP port number',
    );
  }

  const runtimeLogin = values['DATABASE_APP_LOGIN'];

  return {
    database,
    port,
    principal,
    runtimeLogin: runtimeLogin === '' ? undefined : runtimeLogin,
  };
}

/**
 * Runs `mutate` ONLY after the target has been positively identified.
 *
 * This is the seam the "the guard actually gates the mutation" tests use: they
 * pass a spy and prove it was never called for a rejected target. A check whose
 * result is printed and then ignored is not a guard, and the only way to show
 * the difference is to observe that the destructive call did not happen.
 */
export async function withApprovedLocalTarget<T>(
  url: string,
  policy: LocalTargetPolicy,
  mutate: (connection: SqlServerConnection) => Promise<T>,
): Promise<T> {
  const connection = assertApprovedLocalTarget(url, policy);
  return mutate(connection);
}
