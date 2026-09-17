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
 * `npm run identity:recover -- --user <id> --ticket "<reason>"`
 *
 * THE operational lockout recovery for a privileged administrator who has lost
 * their second factor (SECURITY_BASELINE.md §8.2, §8.3).
 *
 * WHAT IT IS NOT:
 *
 *   - not a public endpoint, and not reachable from the web process at all;
 *   - not a way to GRANT a role. It targets an account that ALREADY holds the
 *     live Platform Administrator assignment and refuses otherwise;
 *   - not a revoke-and-regrant. The existing assignment is left exactly as it
 *     is, because it is the authoritative record of when this person became an
 *     administrator, and rewriting it to "recover" a factor would destroy that;
 *   - not a bypass. The account comes back with NO second factor and a durable
 *     re-enrolment demand, so every protected capability stays denied until it
 *     enrols again and confirms fresh recovery codes. Nothing here restores
 *     privileged access; it restores the ability to earn it back.
 *
 * WHAT IT DOES. Inside one transaction: revokes the account's sessions and
 * step-up grants, destroys the TOTP secret and the recovery codes, sets the
 * re-enrolment demand, and writes an audit record naming the real DB login
 * (`ORIGINAL_LOGIN()`) and the ticket.
 */

const USAGE = 'Usage: npm run identity:recover -- --user <accountId> --ticket "<reason>"';

const { targetUserId, ticket } = parseOperatorArguments(process.argv.slice(2), USAGE);

const command = startLocalCommand('source');
const operator = operatorConnection(command);
const session = await openSession(operator.connection);

process.stdout.write(
  `Privileged second-factor recovery on ${operator.connection.database}\n`,
);
reportConfiguration(command);
process.stdout.write(`  ${'principal'.padEnd(20)} ${operator.connection.user}\n`);
process.stdout.write(`  ${'target account'.padEnd(20)} ${targetUserId}\n`);

try {
  await session.execute(OPERATOR_PROCEDURES[1], {
    targetUserId,
    ticket,
  });

  process.stdout.write(
    '\nSessions and step-up grants revoked, second-factor and recovery material ' +
      'destroyed, re-enrolment required.\n' +
      'The account can sign in with its password and reach Account & Security to ' +
      'enrol again; every protected capability stays denied until it does.\n',
  );
} catch (error) {
  process.stderr.write(`\nRecovery refused: ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await session.close();
}
