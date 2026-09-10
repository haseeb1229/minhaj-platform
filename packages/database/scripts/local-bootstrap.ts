import 'server-only';

import { getDatabaseMigrationUrl } from '../src/config.ts';
import {
  describeConnection,
  formatConnectionMetadata,
  resolveLocalDatabaseEnvironment,
  type ResolvedLocalEnvironment,
} from '../src/lifecycle/local-environment.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
  type LocalDatabasePolicy,
} from '../src/lifecycle/local-target.ts';
import type { SqlServerConnection } from '../src/lifecycle/sql-connection.ts';

/**
 * The single entry every LOCAL database command starts from.
 *
 * One call resolves `docker/.env`, validates the migration URL out of that
 * resolved record, and proves the target is the approved local SQL Server —
 * before the command has opened a session, spawned a Prisma child or run a
 * statement.
 *
 * ## Why it is shared
 *
 * Each command used to open with its own four-line prologue: apply the local
 * environment as a side effect, dynamically import `config.ts` afterwards so
 * the import order made the side effect land first, then call a weak guard.
 * Two commands — `db:seed` and `db:provision` — never had the prologue at all,
 * so they took their target from ambient shell variables and validated nothing
 * about it before provisioning a login or writing rows.
 *
 * There is now one implementation, taking one explicit resolved record, and a
 * command that forgets to use it has no configuration to run on.
 */

export interface LocalCommand {
  environment: ResolvedLocalEnvironment;
  /** The validated migration URL, for the Prisma CLI and for sessions. */
  migrationUrl: string;
  connection: SqlServerConnection;
  /** One line of safe metadata: never the password, never the URL. */
  describe: () => string;
  /** Shell keys `docker/.env` displaced, if any. */
  overridden: string[];
}

/**
 * Resolves and validates local configuration for a destructive/connecting command.
 *
 * `docker/.env` is REQUIRED here. For a command that mutates a database, a
 * missing local file must not quietly promote the shell to the authority that
 * decides which database is touched.
 */
export function startLocalCommand(database: LocalDatabasePolicy): LocalCommand {
  const environment = resolveLocalDatabaseEnvironment({ requireLocalFile: true });

  // Validated out of the RESOLVED record, not out of `process.env`.
  const migrationUrl = getDatabaseMigrationUrl(environment.values);

  // Positive identification of the approved local target: loopback host, the
  // configured local port, a database this operation may touch, a migration
  // principal distinct from the runtime one, and the local TLS posture.
  const connection = assertApprovedLocalTarget(
    migrationUrl,
    localTargetPolicy(environment.values, database, 'migration'),
  );

  return {
    environment,
    migrationUrl,
    connection,
    describe: () =>
      formatConnectionMetadata(describeConnection(connection, 'docker/.env')),
    overridden: environment.overridden,
  };
}

/** Prints the configuration line, and any shell values the file displaced. */
export function reportConfiguration(command: LocalCommand, width = 20): void {
  process.stdout.write(`  ${'configuration'.padEnd(width)} ${command.describe()}\n`);

  if (command.overridden.length > 0) {
    process.stdout.write(
      `  ${'shell override'.padEnd(width)} ` +
        `docker/.env took precedence over ${command.overridden.join(', ')}\n`,
    );
  }
}

/**
 * Retargets the validated migration URL at a disposable database, and proves
 * the retargeted URL is itself an approved local target.
 *
 * The substitution is textual, so the result is re-validated rather than
 * assumed: a replacement that silently did nothing, or produced a URL naming a
 * database this operation may not touch, must fail here and not at the point
 * where `CREATE DATABASE` runs.
 */
export function retargetAtDisposable(
  command: LocalCommand,
  databaseName: string,
): { url: string; connection: SqlServerConnection } {
  const url = command.migrationUrl.replace(
    `database=${command.connection.database}`,
    `database=${databaseName}`,
  );

  if (url === command.migrationUrl) {
    throw new Error('Could not retarget the migration URL at the disposable database.');
  }

  const connection = assertApprovedLocalTarget(
    url,
    localTargetPolicy(command.environment.values, 'disposable', 'migration'),
  );

  return { url, connection };
}
