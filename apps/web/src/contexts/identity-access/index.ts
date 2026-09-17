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
 * WHERE THE AUTHORISATION CHECK IS. Not here. `can()` and
 * `requirePermission()` are hosted in `packages/server-core/authorization`,
 * because ARCHITECTURE.md §3.2 requires the realtime transport to make
 * authorisation decisions through the same code the web process uses, and a
 * context may not depend on that host. This file exports what CHANGES
 * privilege; the host exports what CHECKS it, and the split is what keeps one
 * enforcement path reachable from both processes (§3.1.3).
 */

export { createIdentityService } from './application/identity-service.ts';

export type {
  IdentityError,
  IdentityFailure,
  IdentityResult,
  IdentityService,
  IdentityServiceDependencies,
  RequestContext,
  SignInOutcome,
} from './application/identity-service.ts';

export { createAuthorizationService } from './application/authorization-service.ts';

export type {
  AuthorizationAdminService,
  AuthorizationError,
  AuthorizationFailure,
  AuthorizationResult,
  AuthorizationServiceDependencies,
} from './application/authorization-service.ts';

export { createPrivilegedSecurityService } from './application/privileged-security-service.ts';

export type {
  PrivilegedSecurityError,
  PrivilegedSecurityFailure,
  PrivilegedSecurityResult,
  PrivilegedSecurityService,
  PrivilegedSecurityServiceDependencies,
  PrivilegedSecurityState,
} from './application/privileged-security-service.ts';

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

export {
  PROTECTED_ROLE_KEYS,
  grantReasonSchema,
  isProtectedRoleKey,
  isSelfElevation,
  permissionBundleSchema,
  roleDescriptionSchema,
  roleKeySchema,
  roleNameSchema,
  wouldRemoveFinalAdministrator,
} from './domain/authorization.ts';

export { IDENTITY_RATE_LIMITS } from './domain/rate-limits.ts';
export type { IdentityFlow, IdentityRateLimit } from './domain/rate-limits.ts';
