/**
 * Identity & Access — THE public interface.
 *
 * This file is the only path into the context. Everything under
 * `application/` and `domain/` is internal, and a cross-context or Layer-4
 * import that reaches past this file fails the architecture gate
 * (ARCHITECTURE.md §6.3 rule 4).
 *
 * WHAT IS DELIBERATELY ABSENT. No Prisma, no Better Auth, no provider, no
 * persistence adapter, no transaction handle. The context depends on Layer-0
 * INTERFACES and is handed their implementations by Layer 4; it never names
 * one (DOMAIN_MODEL.md §3.1 — "Identity & Access: Layer 0 only").
 *
 * Authorisation — `can()`, roles, permissions, step-up — arrives with Chunk 2.
 * Nothing here pretends to offer it: an authorisation helper that always
 * answered "yes" would be worse than its absence.
 */

export { createIdentityService } from './application/identity-service.ts';

export type {
  IdentityError,
  IdentityFailure,
  IdentityResult,
  IdentityService,
  IdentityServiceDependencies,
  RequestContext,
} from './application/identity-service.ts';

export {
  MESSAGE_LOCALES,
  MESSAGE_PURPOSES,
  renderMessage,
} from './application/messages.ts';

export {
  accountSetupComplete,
  canTransition,
  mayHoldSession,
  notificationKey,
  wouldRemoveFinalAuthenticationMethod,
} from './domain/account.ts';

export { IDENTITY_RATE_LIMITS } from './domain/rate-limits.ts';
export type { IdentityFlow, IdentityRateLimit } from './domain/rate-limits.ts';
