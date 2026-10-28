import 'server-only';

/**
 * Argument parsing for the two HOST-ONLY privileged commands.
 *
 * Shared because both take the same pair and both must refuse the same things.
 * Duplicating it would mean one copy eventually accepting a blank ticket, and
 * the ticket is the only record of WHY a privileged operation happened
 * (SECURITY_BASELINE.md §8.3).
 *
 * VALIDATED, not merely read. These values reach a stored procedure as bound
 * parameters, so injection is not the risk; a mistyped account id that silently
 * did nothing, or an empty ticket that produced an unexplained audit row, is.
 */

/**
 * An internal account identifier, as `User.id` holds it (`NVarChar(36)`): Better
 * Auth's own identifiers and UUIDs both fit; an email address never does. Every
 * operator command that names an account uses this one shape.
 */
export const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/;

export interface OperatorArguments {
  readonly targetUserId: string;
  readonly ticket: string;
}

/**
 * Reads `--user <id> --ticket <text>`.
 *
 * The account is named by its INTERNAL IDENTIFIER, deliberately, and never by
 * email address. `User.id` is authoritative: an address can be released by
 * closure and re-registered by somebody else, so an operator command keyed on
 * one could provision the wrong person entirely (DOMAIN_MODEL.md §4.6,
 * CLAUDE.md §11).
 */
export function parseOperatorArguments(
  argv: readonly string[],
  usage: string,
): OperatorArguments {
  let targetUserId: string | undefined;
  let ticket: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === '--user') {
      targetUserId = value;
      index += 1;
    } else if (flag === '--ticket') {
      ticket = value;
      index += 1;
    } else {
      throw new Error(`Unrecognised argument '${flag ?? ''}'.\n${usage}`);
    }
  }

  if (targetUserId === undefined || !ACCOUNT_ID.test(targetUserId)) {
    throw new Error(
      `--user must be an internal account identifier, not an email address.\n${usage}`,
    );
  }

  if (ticket === undefined || ticket.trim() === '' || ticket.length > 200) {
    throw new Error(
      `--ticket must carry the reason or change reference for this operation, ` +
        `up to 200 characters.\n${usage}`,
    );
  }

  return { targetUserId, ticket: ticket.trim() };
}
