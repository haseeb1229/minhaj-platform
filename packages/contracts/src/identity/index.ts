/**
 * `@minhaj/contracts/identity` — the Identity & Access contract surface.
 *
 * Layer 0, and browser-safe: types, Zod schemas and one pure function. It
 * reaches no infrastructure and holds no policy, so a client bundle that pulls
 * a form schema from here gets a form schema and nothing else.
 *
 * The PORTS it declares are implemented by private adapters inside
 * `packages/database` and consumed by the Identity context inside
 * `apps/web/src/contexts/identity-access`. Neither imports the other; both
 * import this (ARCHITECTURE.md §3.1.1).
 */

export {
  ACTIVE_ACCOUNT_STATUSES,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  accountStatusSchema,
  canonicaliseEmail,
  displayNameSchema,
  emailSchema,
  localeSchema,
  passwordSchema,
  timezoneSchema,
  tokenPurposeSchema,
} from './values.ts';

export type {
  AccountIdentity,
  AccountStatus,
  SessionSummary,
  TokenPurpose,
} from './values.ts';

export {
  PERMISSION_CATALOGUE,
  PERMISSION_GRANT,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
  PLATFORM_ADMINISTRATOR_ROLE,
  STEP_UP_LIFETIME_SECONDS,
  STEP_UP_PURPOSES,
  isPermissionKey,
} from './permissions.ts';

export type {
  PermissionDefinition,
  PermissionKey,
  StepUpPurpose,
} from './permissions.ts';

export type {
  AccountPage,
  AccountSummary,
  AssignmentPage,
  AuditPage,
  AuditRecordView,
  AuthorizationPersistencePort,
  AuthorizationReaderPort,
  BootstrapStatus,
  CreateCustomRoleInput,
  PrivilegeInvalidation,
  PrivilegedActor,
  PrivilegedPosture,
  RoleAssignmentRecord,
  RoleSummary,
  StepUpGrantSummary,
} from './authorization.ts';

export type {
  AddressTokenPurpose,
  AuthMechanicsPort,
  AuthenticationOutcome,
  CommunicationIntentInput,
  IdentityNotificationPurpose,
  IdentityPersistencePort,
  IdentitySecurityOperationKind,
  PendingIntent,
  PreparedIdentitySecurityOperation,
  RequestHeaders,
  ResolvedSession,
  SessionDenial,
  SessionRotation,
  SessionOutcome,
  SessionReaderPort,
  SetCookieHeaders,
  SignOutOutcome,
  TokenDeliveryMaterial,
  TokenIssuedListener,
} from './ports.ts';
