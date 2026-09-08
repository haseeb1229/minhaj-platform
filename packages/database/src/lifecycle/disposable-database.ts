import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  openSession,
  withDatabase,
  type SqlServerConnection,
  type SqlSession,
} from './sql-connection.ts';

/**
 * Creation and DROP of the throwaway databases the Phase 1 lifecycle tests run
 * against.
 *
 * The whole risk of this file is dropping something that is not ours. The host
 * runs an unrelated SQL Server Express instance and this container holds the
 * system databases, so the guard is a positive identification, not a blocklist:
 * a name is droppable only when it matches the disposable pattern exactly.
 * Anything else — `master`, `MinhajPlatform`, a typo, an empty string, an
 * injected batch separator — fails closed.
 */

/** `MinhajPhase1Test_<32 hex>`; nothing else is ever dropped. */
const DISPOSABLE_NAME = /^MinhajPhase1Test_[0-9a-f]{32}$/;

export const DISPOSABLE_PREFIX = 'MinhajPhase1Test_';

export function isDisposableDatabaseName(name: string): boolean {
  return DISPOSABLE_NAME.test(name);
}

export function newDisposableDatabaseName(): string {
  return `${DISPOSABLE_PREFIX}${randomUUID().replaceAll('-', '')}`;
}

/**
 * Throws unless `name` is positively identified as a disposable Phase 1 test
 * database. Every destructive path calls this first.
 */
export function assertDisposableDatabaseName(name: string): void {
  if (!isDisposableDatabaseName(name)) {
    throw new Error(
      `Refusing to operate destructively on '${name}': not a disposable Phase 1 ` +
        `test database. Expected ${DISPOSABLE_PREFIX}<32 hex characters>.`,
    );
  }
}

/** Opens an administrative session against `master` on the same server. */
export async function openMasterSession(
  connection: SqlServerConnection,
): Promise<SqlSession> {
  return openSession(withDatabase(connection, 'master'));
}

export async function createDisposableDatabase(
  master: SqlSession,
  name: string,
): Promise<void> {
  assertDisposableDatabaseName(name);
  await master.query(`CREATE DATABASE [${name}];`);
}

export async function dropDisposableDatabase(
  master: SqlSession,
  name: string,
): Promise<void> {
  assertDisposableDatabaseName(name);

  // Only ever drops a database this run created and just verified by name.
  // SINGLE_USER rolls back stray sessions so cleanup cannot hang the suite and
  // leave the database behind.
  await master.query(`
    IF DB_ID(N'${name}') IS NOT NULL
    BEGIN
      ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${name}];
    END;
  `);
}
