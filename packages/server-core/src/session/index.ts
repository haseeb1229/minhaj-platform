import 'server-only';

import type {
  RequestHeaders,
  SessionOutcome,
  SessionReaderPort,
} from '@minhaj/contracts/identity';

/**
 * THE session service — Identity & Access's, hosted here.
 *
 * OWNERSHIP. `packages/server-core` is a server-only HOST, not a layer and not
 * an owner. The rules below are Identity's, and only Identity may change them;
 * placing the implementation here changes where it is exported from, nothing
 * else (ARCHITECTURE.md §3.1).
 *
 * WHY IT IS HERE NOW, before `apps/realtime` exists. §3.1.3 admits a service
 * ahead of its second process when the approved architecture already names a
 * concrete scheduled consumer, and §3.2 and §3.3 require the realtime
 * transport to verify sessions through *the same code* the web process uses.
 * Introducing this inside `apps/web` first would mean extracting and
 * rewriting a security-critical path later — the churn early admission exists
 * to avoid.
 *
 * WHAT IT HOLDS. A narrow injected reader and a policy. No Prisma, no
 * `packages/database`, no `apps/web` implementation, no provider SDK, no
 * business rules of its own. Layer 4 wires the concrete adapter in; the
 * realtime transport will wire the same one.
 */

export interface SessionService {
  /**
   * THE chokepoint. Every authenticated surface resolves its session here.
   *
   * Having exactly one of these is what makes account status enforceable: a
   * second way to read a session is a second place the status check can be
   * forgotten.
   */
  resolve(headers: RequestHeaders): Promise<SessionOutcome>;
}

export interface SessionServiceDependencies {
  readonly sessions: SessionReaderPort;
}

export function createSessionService({
  sessions,
}: SessionServiceDependencies): SessionService {
  return {
    async resolve(headers: RequestHeaders): Promise<SessionOutcome> {
      const session = await sessions.resolveSession(headers);
      if (session === null) return { state: 'denied', reason: 'no-session' };

      const { status } = session.account;

      // ACCOUNT STATUS IS ENFORCED ON EVERY AUTHENTICATED REQUEST, not only at
      // sign-in (DOMAIN_MODEL.md §4.6). A session issued while an account was
      // active must stop working the moment the account is disabled — checking
      // only at sign-in would leave a suspended account usable for as long as
      // its session lived, which for this platform is days.
      if (status !== 'active') {
        // The session is destroyed rather than merely refused. Leaving a live
        // row behind means the next request repeats this work, and it leaves a
        // credential that would start working again if the status were ever
        // restored by accident.
        await sessions.revokeAllSessionsForAccount(session.account.id);

        if (status === 'disabled') return { state: 'denied', reason: 'account-disabled' };
        if (status === 'suspended') {
          return { state: 'denied', reason: 'account-suspended' };
        }
        return { state: 'denied', reason: 'account-closed' };
      }

      return { state: 'active', session };
    },
  };
}
