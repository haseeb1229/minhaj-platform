import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { packageRoot } from './migrations.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * Applies `sql/permissions/grant-application-principal.sql`.
 *
 * The script is the reviewed artifact; this module only substitutes its two
 * sqlcmd variables, because the `mssql` driver does not process them. The SQL
 * is not duplicated here — a second copy of a permission grant is a second
 * thing to keep in step, and the one that drifts is always the one nobody
 * reads.
 */

const permissionsScriptPath = path.join(
  packageRoot,
  'sql',
  'permissions',
  'grant-application-principal.sql',
);

/** Rejects anything that is not a plain SQL Server identifier. */
function assertSafeIdentifier(login: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(login)) {
    throw new Error(
      `Invalid application login name '${login}': expected a plain identifier.`,
    );
  }
}

export async function provisionApplicationPrincipal(
  session: SqlSession,
  login: string,
  password: string,
): Promise<void> {
  assertSafeIdentifier(login);
  if (password.length === 0) {
    // Names the input, never its value.
    throw new Error('Application principal password is empty.');
  }

  const script = await readFile(permissionsScriptPath, 'utf8');

  // The password lands inside QUOTENAME(..., '''') in the script, so doubling
  // the quotes here is what makes that literal safe.
  const prepared = script
    .replaceAll('$(app_login)', login)
    .replaceAll('$(app_password)', password.replaceAll("'", "''"));

  await session.runScript(prepared);
}
