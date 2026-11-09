import 'server-only';

import type { HostStepUpSessionPort } from '@minhaj/contracts/identity';

import { getDatabaseClient } from '../../client.ts';

/**
 * Identity's answer to "which session may a STAGING HOST-ISSUED step-up grant
 * be bound to?" (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP;
 * SECURITY_BASELINE.md §8.1).
 *
 * Semantic owner: `identity-access`. Composed only by the staging operator
 * root; no web request path wires it.
 *
 * The account's most recently CREATED session that has not expired. A revoked
 * session is a deleted row (sign-out, revocation, closure, a privilege
 * change), so it can never be chosen. Only the identifier and the expiry
 * leave this module — never the session token.
 */
export function createHostStepUpSessions(): HostStepUpSessionPort {
  const prisma = getDatabaseClient();

  return {
    async latestLiveSession(accountId) {
      const session = await prisma.session.findFirst({
        where: { userId: accountId, expiresAt: { gt: new Date() } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, expiresAt: true },
      });
      return session === null
        ? null
        : { sessionId: session.id, expiresAt: session.expiresAt };
    },
  };
}
