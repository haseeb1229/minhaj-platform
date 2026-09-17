import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { packageRoot } from './migrations.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * Applies `sql/permissions/grant-operator-principal.sql`.
 *
 * The script is the reviewed artifact; this module only substitutes its two
 * sqlcmd variables, because the `mssql` driver does not process them — exactly
 * as `./application-principal.ts` does for the runtime login. The SQL is not
 * duplicated here: a second copy of a permission grant is a second thing to
 * keep in step, and the one that drifts is always the one nobody reads.
 */

const permissionsScriptPath = path.join(
  packageRoot,
  'sql',
  'permissions',
  'grant-operator-principal.sql',
);

/** Rejects anything that is not a plain SQL Server identifier. */
function assertSafeIdentifier(login: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(login)) {
    throw new Error(
      `Invalid operator login name '${login}': expected a plain identifier.`,
    );
  }
}

export async function provisionOperatorPrincipal(
  session: SqlSession,
  login: string,
  password: string,
): Promise<void> {
  assertSafeIdentifier(login);
  if (password.length === 0) {
    // Names the input, never its value.
    throw new Error('Operator principal password is empty.');
  }

  const script = await readFile(permissionsScriptPath, 'utf8');

  // The password lands inside QUOTENAME(..., '''') in the script, so doubling
  // the quotes here is what makes that literal safe.
  const prepared = script
    .replaceAll('$(operator_login)', login)
    .replaceAll('$(operator_password)', password.replaceAll("'", "''"));

  await session.runScript(prepared);
}

/**
 * The two procedures an operator may execute, and the ONLY two.
 *
 * Named here so the provisioning script, the permission proof and the operator
 * commands all refer to one list rather than three that can disagree. A third
 * host-only capability would have to be added deliberately, in a migration
 * that grants it and in this list.
 */
export const OPERATOR_PROCEDURES = Object.freeze([
  'IdentityBootstrapPlatformAdministrator',
  'IdentityRecoverPrivilegedSecondFactor',
] as const);

export const OPERATOR_ROLE = 'minhaj_operator';
