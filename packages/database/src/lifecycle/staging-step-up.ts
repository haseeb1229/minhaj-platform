import 'server-only';

import { STEP_UP_PURPOSES, type StepUpPurpose } from '@minhaj/contracts/identity';

import type { SqlSession } from './sql-connection.ts';

/**
 * The OWNER-SIDE checks of the staging host-issued step-up
 * (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP; SECURITY_BASELINE.md §8.1),
 * made BEFORE any connection opens.
 *
 * The command (`scripts/staging-step-up.ts`) then runs the whole staging
 * guard and starts Identity's own tool as the RUNTIME principal, which checks
 * the deployment, the purpose and the lifetime again inside Identity's
 * service — so nothing here is the only refusal.
 */

/** The decision every host-issued grant names. */
export const HOST_STEP_UP_DECISION = 'OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP';

/** Identity's own cap and default (`HOST_STEP_UP_*_MINUTES`); a test holds them equal. */
export const HOST_STEP_UP_DEFAULT_MINUTES = 5;
export const HOST_STEP_UP_MAX_MINUTES = 15;

const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/u;

export const HOST_STEP_UP_USAGE =
  'staging-step-up grant --account <accountId> --purpose <purpose> [--minutes <1-15>]';

/** A refusal whose message names no value — safe to print as the command's error. */
export class HostStepUpCommandRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostStepUpCommandRefusal';
  }
}

/**
 * Refuses, with `refuse`, unless the process declares EXACTLY the staging
 * deployment and an explicitly non-indexable build — the posture every
 * staging-only operator command (the demo data, the host-issued step-up, the
 * host review) demands. Absence is a refusal, never a default.
 */
export function assertDeclaredStagingPosture(
  values: Record<string, string | undefined>,
  subject: string,
  refuse: (message: string) => Error,
): void {
  if (values['MINHAJ_DEPLOYMENT_ENVIRONMENT'] !== 'staging')
    throw refuse(
      `${subject} is staging-only: the process does not declare exactly the staging deployment.`,
    );
  if (values['PUBLIC_INDEXING_ENABLED'] !== 'false')
    throw refuse(
      `${subject} needs an explicitly non-indexable deployment (PUBLIC_INDEXING_ENABLED=false).`,
    );
}

/** The host-issued step-up's posture: exactly staging, explicitly non-indexable. */
export function assertHostStepUpPosture(
  values: Record<string, string | undefined>,
): void {
  assertDeclaredStagingPosture(
    values,
    'A host-issued step-up',
    (message) => new HostStepUpCommandRefusal(message),
  );
}

export interface HostStepUpArguments {
  readonly accountId: string;
  readonly purpose: string;
  readonly minutes: number;
}

/**
 * Reads `grant --account <id> --purpose <purpose> [--minutes <n>]`, strictly:
 * an unknown flag, a repeated flag, a malformed identifier, an unknown purpose
 * or a lifetime outside 1–15 minutes is a refusal.
 */
export function parseHostStepUpArguments(argv: readonly string[]): HostStepUpArguments {
  const [mode, ...rest] = argv;
  if (mode !== 'grant')
    throw new HostStepUpCommandRefusal(`usage: ${HOST_STEP_UP_USAGE}`);

  const seen = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index] ?? '';
    const value = rest[index + 1];
    if (!['--account', '--purpose', '--minutes'].includes(flag) || seen.has(flag))
      throw new HostStepUpCommandRefusal(`usage: ${HOST_STEP_UP_USAGE}`);
    if (value === undefined || value.startsWith('--'))
      throw new HostStepUpCommandRefusal(`usage: ${HOST_STEP_UP_USAGE}`);
    seen.set(flag, value);
  }

  const accountId = seen.get('--account');
  if (accountId === undefined || !ACCOUNT_ID.test(accountId))
    throw new HostStepUpCommandRefusal(
      '--account must be an internal account identifier, not an email address.',
    );

  const purpose = seen.get('--purpose');
  if (purpose === undefined || !(STEP_UP_PURPOSES as readonly string[]).includes(purpose))
    throw new HostStepUpCommandRefusal(
      `--purpose must be one of: ${STEP_UP_PURPOSES.join(', ')}.`,
    );

  const minutesText = seen.get('--minutes') ?? String(HOST_STEP_UP_DEFAULT_MINUTES);
  const minutes = /^[0-9]{1,2}$/u.test(minutesText) ? Number(minutesText) : Number.NaN;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > HOST_STEP_UP_MAX_MINUTES)
    throw new HostStepUpCommandRefusal(
      `--minutes must be a whole number from 1 to ${String(HOST_STEP_UP_MAX_MINUTES)}.`,
    );

  return { accountId, purpose, minutes };
}

/** The runtime tool's arguments: always explicit, the lifetime included. */
export function hostStepUpToolArguments(args: HostStepUpArguments): readonly string[] {
  return [
    'grant',
    '--account',
    args.accountId,
    '--purpose',
    args.purpose,
    '--minutes',
    String(args.minutes),
  ];
}

/**
 * The sessions of `operator` that hold an UNEXPIRED step-up grant for
 * `purpose` on a LIVE session — the grant a person earned in the browser or
 * `step-up.sh grant` issued. A READ: nothing is created here, and the runtime
 * tool that acts under the grant re-verifies the permission, the posture and
 * the grant through Identity's gate before anything is written. The operator
 * commands that act under a grant (the demo seed, the Quran reference import,
 * the host review's publication) each name the ONE session this finds.
 */
export async function liveStepUpSessionIds(
  sql: SqlSession,
  operator: string,
  purpose: StepUpPurpose,
): Promise<readonly string[]> {
  if (!ACCOUNT_ID.test(operator))
    throw new HostStepUpCommandRefusal('The operator must be an account identifier.');
  if (!(STEP_UP_PURPOSES as readonly string[]).includes(purpose))
    throw new HostStepUpCommandRefusal('Not a step-up purpose.');
  const literal = (value: string) => `N'${value.replaceAll("'", "''")}'`;
  const rows = await sql.query<{ sessionId: string }>(`
    SELECT DISTINCT g.[sessionId]
    FROM [dbo].[StepUpGrant] g
    JOIN [dbo].[Session] s ON s.[id] = g.[sessionId] AND s.[userId] = g.[userId]
      AND s.[expiresAt] > SYSUTCDATETIME()
    WHERE g.[userId] = ${literal(operator)} AND g.[purpose] = ${literal(purpose)}
      AND g.[expiresAt] > SYSUTCDATETIME();
  `);
  return rows.map((row) => row.sessionId);
}
