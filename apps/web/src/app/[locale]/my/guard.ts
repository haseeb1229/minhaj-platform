import 'server-only';

import { redirect } from 'next/navigation';

import { identityRuntime } from '@/composition/identity';
import { requestContext } from '@/composition/request';
import type { ResolvedSession } from '@minhaj/contracts/identity';

/**
 * THE guard every `/my` surface runs first.
 *
 * It resolves through the session chokepoint, so account status is enforced on
 * EVERY authenticated request rather than only at sign-in: a session issued
 * while an account was active stops working the moment it is disabled,
 * suspended or closed (DOMAIN_MODEL.md §4.6).
 *
 * Route protection is navigational convenience, not a security boundary — every
 * mutation re-checks independently in its own Server Action
 * (SECURITY_BASELINE.md §3.4 rule 2). This exists so a signed-out visitor sees
 * a sign-in page rather than an error.
 *
 * A denied account is sent to sign in WITHOUT being told which of disabled,
 * suspended or closed applies, because that distinction is about somebody
 * else's account as often as their own.
 */
export async function requireActiveSession(
  locale: string,
  returnPath: string,
): Promise<ResolvedSession> {
  const { session } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await session.resolve(context.headers);

  if (outcome.state !== 'active') {
    redirect(`/${locale}/signin?returnTo=${encodeURIComponent(returnPath)}`);
  }

  return outcome.session;
}
