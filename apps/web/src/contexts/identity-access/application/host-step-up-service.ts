import type {
  AuthorizationPersistencePort,
  AuthorizationReaderPort,
  HostStepUpSessionPort,
  PermissionKey,
  StepUpGrantSummary,
  StepUpPurpose,
} from '@minhaj/contracts/identity';
import { STEP_UP_PURPOSES } from '@minhaj/contracts/identity';
import type { AuditPort } from '@minhaj/contracts/platform';

/**
 * Identity & Access — the STAGING HOST-ISSUED step-up
 * (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP; SECURITY_BASELINE.md §8.1).
 *
 * WHAT IT IS. The staging operator, as root on the proven staging host, may
 * issue the SAME short-lived, session- and purpose-bound grant the browser
 * step-up issues, for a named administrator and a named purpose — so the
 * existing operator commands, whose gates re-check the grant LIVE, can run
 * unattended. On that host root already holds the SQL Server administrator
 * credential and can change any row, so a browser re-authentication adds
 * little assurance there.
 *
 * WHAT IT IS NOT. A bypass of anything the gate checks. The grant stands in
 * for the moment of re-authentication ONLY:
 *
 *   - the account must exist and be ACTIVE;
 *   - it must hold, live, a permission the purpose's gate demands — a grant
 *     the gate would never honour is refused rather than written;
 *   - its privileged posture must be COMPLETE (a verified second factor,
 *     confirmed recovery codes, no re-enrolment demand), exactly what the gate
 *     requires; this never enrols, confirms or clears anything;
 *   - it binds to the account's most recent LIVE session, so the person signs
 *     in once in the ordinary way; a revoked or expired session is refused;
 *   - it lives at most fifteen minutes, and dies with its session.
 *
 * `second-factor` is never host-issued: it guards a person's own credentials.
 *
 * WHERE IT MAY RUN. Only where the process declares, exactly, the staging
 * deployment AND a non-indexable build — the declared-staging flags the demo
 * tooling uses. Anywhere else the service cannot even be constructed. The
 * operator command proves the staging host and database first; this is the
 * context's own, independent refusal.
 *
 * WHO MAY REACH IT. Only the staging operator composition root
 * (`apps/web/src/composition/staging-step-up-runner.ts`). No web request path
 * composes it, and an architecture test holds that.
 *
 * WHAT IS RECORDED. The SAME audit action as the browser step-up,
 * `identity.security.step-up-granted`, marked host-issued, by an `operator`
 * actor, with the decision reference as its authorising source. No secret, no
 * token.
 */

/** The owner decision every host-issued grant names. */
export const HOST_STEP_UP_DECISION = 'OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP';

/** The default and the cap of a host-issued grant's life, in minutes. */
export const HOST_STEP_UP_DEFAULT_MINUTES = 5;
export const HOST_STEP_UP_MAX_MINUTES = 15;

/**
 * The permissions each purpose's gate demands — any one of them suffices,
 * because that is how the gates are written (`privilege-administration`
 * guards both `roles.administer` and `permissions.grant` acts). `null` means
 * the purpose is never host-issued.
 */
export const HOST_STEP_UP_PERMISSIONS: Readonly<
  Record<StepUpPurpose, readonly PermissionKey[] | null>
> = Object.freeze({
  'privilege-administration': Object.freeze([
    'roles.administer',
    'permissions.grant',
  ] as const),
  'account-administration': Object.freeze(['users.administer'] as const),
  'second-factor': null,
  'quran-canonical-edit': Object.freeze(['quran.editCanonical'] as const),
  'hadith-canonical-edit': Object.freeze(['hadith.editCanonical'] as const),
  'fatwa-publication': Object.freeze(['fatwa.publish'] as const),
  'donation-refund': Object.freeze(['donations.refund'] as const),
  'migration-publication': Object.freeze(['migration.publish'] as const),
  'migration-personal-data': Object.freeze(['migration.clearPersonalData'] as const),
});

export type HostStepUpFailure =
  | 'unknown-purpose'
  | 'purpose-not-host-issuable'
  | 'invalid-lifetime'
  | 'unknown-account'
  | 'account-inactive'
  | 'no-permission'
  | 'second-factor-required'
  | 'no-live-session';

/** A refusal that names a reason code and no value — safe to print. */
export class HostStepUpRefusal extends Error {
  readonly reason: HostStepUpFailure | 'not-staging';

  constructor(reason: HostStepUpFailure | 'not-staging') {
    super(`host step-up refused: ${reason}`);
    this.name = 'HostStepUpRefusal';
    this.reason = reason;
  }
}

export interface HostStepUpGrant {
  readonly accountId: string;
  readonly sessionId: string;
  readonly grant: StepUpGrantSummary;
}

export interface HostStepUpServiceDependencies {
  /** The process's declared deployment — `MINHAJ_DEPLOYMENT_ENVIRONMENT`, `PUBLIC_INDEXING_ENABLED`. */
  readonly deployment: {
    readonly environment: string | undefined;
    readonly publicIndexing: string | undefined;
  };
  readonly authorization: Pick<
    AuthorizationPersistencePort,
    'findAccountSummary' | 'readPosture' | 'createStepUpGrant'
  >;
  readonly reader: Pick<AuthorizationReaderPort, 'effectivePermissions'>;
  readonly sessions: HostStepUpSessionPort;
  readonly audit: AuditPort;
}

function isStepUpPurpose(value: string): value is StepUpPurpose {
  return (STEP_UP_PURPOSES as readonly string[]).includes(value);
}

export function createHostStepUpService(dependencies: HostStepUpServiceDependencies) {
  const { deployment, authorization, reader, sessions, audit } = dependencies;

  // Refused at construction: outside the declared non-indexable staging
  // deployment the capability does not exist, whatever is asked of it later.
  if (deployment.environment !== 'staging' || deployment.publicIndexing !== 'false')
    throw new HostStepUpRefusal('not-staging');

  return {
    /**
     * Issues one grant for `accountId` and `purpose`, lasting `minutes`
     * (1–15). Every fact is read live; a refusal writes nothing.
     */
    async issue(input: {
      readonly accountId: string;
      readonly purpose: string;
      readonly minutes: number;
    }): Promise<HostStepUpGrant> {
      if (!isStepUpPurpose(input.purpose)) throw new HostStepUpRefusal('unknown-purpose');
      const purpose = input.purpose;
      const demanded = HOST_STEP_UP_PERMISSIONS[purpose];
      if (demanded === null) throw new HostStepUpRefusal('purpose-not-host-issuable');
      if (
        !Number.isInteger(input.minutes) ||
        input.minutes < 1 ||
        input.minutes > HOST_STEP_UP_MAX_MINUTES
      )
        throw new HostStepUpRefusal('invalid-lifetime');

      const account = await authorization.findAccountSummary(input.accountId);
      if (account === null) throw new HostStepUpRefusal('unknown-account');
      if (account.status !== 'active') throw new HostStepUpRefusal('account-inactive');

      const held = new Set(await reader.effectivePermissions(account.id));
      if (!demanded.some((permission) => held.has(permission)))
        throw new HostStepUpRefusal('no-permission');

      const posture = await authorization.readPosture(account.id);
      if (
        !posture.secondFactorEnrolled ||
        !posture.recoveryCodesConfirmed ||
        posture.reenrolmentRequired
      )
        throw new HostStepUpRefusal('second-factor-required');

      const session = await sessions.latestLiveSession(account.id);
      if (session === null || session.expiresAt.getTime() <= Date.now())
        throw new HostStepUpRefusal('no-live-session');

      const lifetimeSeconds = input.minutes * 60;
      const grant = await authorization.createStepUpGrant({
        accountId: account.id,
        sessionId: session.sessionId,
        purpose,
        lifetimeSeconds,
      });

      await audit.record({
        action: 'identity.security.step-up-granted',
        actorType: 'operator',
        actorId: null,
        targetType: 'user',
        targetId: account.id,
        after: {
          purpose,
          issuance: 'staging-host',
          lifetimeSeconds: String(lifetimeSeconds),
        },
        authorisingSource: HOST_STEP_UP_DECISION,
      });

      return { accountId: account.id, sessionId: session.sessionId, grant };
    },
  };
}

export type HostStepUpService = ReturnType<typeof createHostStepUpService>;
