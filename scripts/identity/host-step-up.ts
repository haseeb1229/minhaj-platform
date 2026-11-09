import { composeStagingStepUpRunner } from '../../apps/web/src/composition/staging-step-up-runner.ts';
import { approvedTarget, CommandError, required, runCommand } from '../migration/cli.ts';

/**
 * THE RUNTIME HALF of the staging host-issued step-up
 * (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP) — run ONLY as a child of
 * the owner-side command `staging-step-up` (`docker/staging/bin/step-up.sh`),
 * as the RUNTIME principal, whose `DATABASE_URL` is the only database setting
 * it holds.
 *
 *   grant --account <accountId> --purpose <purpose> --minutes <1-15>
 *
 * Identity's own service decides everything: the declared non-indexable
 * staging deployment, the purpose, the lifetime cap, the account's status, the
 * permission the purpose's gate demands, the complete second-factor posture
 * and the live session the grant binds to. This file only reads arguments.
 *
 * The final stdout line is one JSON object: identifiers, the purpose and the
 * expiry. Never a token.
 */

const USAGE = 'host-step-up grant --account <id> --purpose <purpose> --minutes <1-15>';

/** An internal account identifier (the operator commands' shape). */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/;

/** A Host step-up refusal as its reason code — a category, never a value. */
async function identity<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const candidate = error as { name?: unknown; reason?: unknown } | null;
    if (candidate?.name === 'HostStepUpRefusal' && typeof candidate.reason === 'string')
      throw new CommandError(`host step-up refused: ${candidate.reason}`);
    throw error;
  }
}

await runCommand('host-step-up', async () => {
  const [mode] = process.argv.slice(2);
  if (mode !== 'grant') throw new CommandError(`usage: ${USAGE}`);
  approvedTarget(process.env['DATABASE_URL']);

  const accountId = required('--account', USAGE);
  if (!ACCOUNT_ID.test(accountId))
    throw new CommandError('--account is not an internal account identifier');
  const purpose = required('--purpose', USAGE);
  const minutesText = required('--minutes', USAGE);
  if (!/^[0-9]{1,2}$/.test(minutesText))
    throw new CommandError('--minutes must be a whole number of minutes');

  const issued = await identity(
    (async () =>
      composeStagingStepUpRunner().issue({
        accountId,
        purpose,
        minutes: Number(minutesText),
      }))(),
  );
  return {
    mode,
    accountId: issued.accountId,
    sessionId: issued.sessionId,
    grantId: issued.grant.id,
    purpose: issued.grant.purpose,
    expiresAt: issued.grant.expiresAt.toISOString(),
  };
});
