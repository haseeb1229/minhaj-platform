import 'server-only';

import { OPERATOR_PROCEDURES } from '../src/lifecycle/operator-principal.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';
import { parseOperatorArguments } from './operator-arguments.ts';
import {
  operatorConnection,
  reportConfiguration,
  startLocalCommand,
} from './local-bootstrap.ts';

/**
 * `npm run identity:bootstrap -- --user <id> --ticket "<reason>"`
 *
 * THE one-time initial privileged operator bootstrap (SECURITY_BASELINE.md §8.3).
 *
 * WHY IT IS A COMMAND AND NOT A ROUTE. A system with no administrator cannot
 * grant the first permission, and each usual answer — a seeded superuser, a
 * hard-coded credential, an open setup endpoint — is a standing vulnerability.
 * This runs on the HOST, as a principal the web process does not have, against
 * a procedure the web process may not execute. There is no HTTP path to it and
 * the admin security surface shows its STATUS without offering to perform it.
 *
 * WHAT THIS FILE DOES NOT CONTAIN. The rules. Race safety, the "no existing
 * administrator" condition, the eligibility of the target and the audit record
 * are all inside the procedure, in one transaction, where a second caller
 * cannot interleave with them. A command that checked first and then inserted
 * would have a window between the two; this one has no window because it makes
 * one call.
 *
 * IT DOES NOT COMPLETE THE ADMINISTRATOR. The account it names holds the
 * protected role immediately and can exercise NO high-consequence capability
 * until it enrols a second factor and confirms its recovery codes through
 * `/my/settings/security` — which stays reachable precisely so this is not
 * circular (§8.2, §8.3).
 */

const USAGE =
  'Usage: npm run identity:bootstrap -- --user <accountId> --ticket "<reason>"';

const { targetUserId, ticket } = parseOperatorArguments(process.argv.slice(2), USAGE);

const command = startLocalCommand('source');
const operator = operatorConnection(command);
const session = await openSession(operator.connection);

process.stdout.write(
  `Initial administrator bootstrap on ${operator.connection.database}\n`,
);
reportConfiguration(command);
process.stdout.write(`  ${'principal'.padEnd(20)} ${operator.connection.user}\n`);
process.stdout.write(`  ${'target account'.padEnd(20)} ${targetUserId}\n`);

try {
  await session.execute(OPERATOR_PROCEDURES[0], {
    targetUserId,
    ticket,
  });

  process.stdout.write(
    '\nThe initial Platform Administrator assignment was created, and the ' +
      'bootstrap is now closed.\n' +
      'That account must complete privileged second-factor enrolment and ' +
      'recovery-code setup before it can exercise any protected capability.\n',
  );
} catch (error) {
  // The procedure THROWs with a specific message for each refusal — already
  // bootstrapped, missing role, ineligible target, existing assignment. It is
  // reported as-is: none of them carries a credential or an address.
  process.stderr.write(`\nBootstrap refused: ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await session.close();
}
