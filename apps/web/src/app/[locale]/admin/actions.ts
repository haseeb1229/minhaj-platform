'use server';

import { revalidatePath } from 'next/cache';

import {
  STEP_UP_PURPOSES,
  accountStatusSchema,
  localeSchema,
  passwordSchema,
} from '@minhaj/contracts/identity';
import type { AuthorizationDenial } from '@minhaj/server-core/authorization';
import { z } from 'zod';

import {
  requirePermittedAction,
  requirePrivilegedActor,
  requireOwnSession,
} from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import type { AuthorizationFailure } from '@/contexts/identity-access';
import {
  grantReasonSchema,
  permissionBundleSchema,
  roleDescriptionSchema,
  roleKeySchema,
  roleNameSchema,
} from '@/contexts/identity-access';

/**
 * THE administrative mutation surface.
 *
 * Every function here is a Class-A browser mutation (SECURITY_BASELINE.md
 * §7.1): a Server Action, carrying the framework's Origin and CSRF protections,
 * and unreachable by GET. There is no `/api/admin/*` route, because a route
 * would be a second path to these operations sitting outside these wrappers.
 *
 * EVERY ONE RE-CHECKS AUTHORISATION INDEPENDENTLY. The page that rendered the
 * form checked a permission to decide what to show; that decision is
 * navigational and is not reused here. `requirePrivilegedActor` resolves the
 * session again, reads the permission set live, re-checks the privileged
 * posture and re-checks the step-up grant — because the minutes between a
 * render and a submit are long enough for a role to be revoked (§3.4 rule 2).
 *
 * WHAT IS ABSENT, DELIBERATELY. No bootstrap action and no lockout-recovery
 * action. Both are host-only commands run by an operator against the database,
 * as a procedure the web process's database principal may not execute. A button
 * for either would be the open setup endpoint §8.3 forbids (§24).
 */

/** Every way an administrative action can refuse. */
export type AdminFailure =
  | AuthorizationDenial
  | AuthorizationFailure
  | 'no-session'
  | 'invalid-input'
  | 'invalid-transition'
  | 'not-retryable';

export interface AdminActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly failure?: AdminFailure;
}

function invalid(): AdminActionState {
  return { status: 'error', failure: 'invalid-input' };
}

function failed(failure: AdminFailure): AdminActionState {
  return { status: 'error', failure };
}

const OK: AdminActionState = { status: 'success' };

function localeFrom(form: FormData): string {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return parsed.success ? parsed.data : 'en';
}

/**
 * Re-renders the administrative tree after a change it displays.
 *
 * Scoped to `/admin`: nothing outside it shows a role, an assignment or a
 * delivery, and revalidating the whole application would throw away caches that
 * have nothing to do with this.
 */
function refresh(locale: string): void {
  revalidatePath(`/${locale}/admin`, 'layout');
}

/* ===========================================================================
 * Step-up
 * ========================================================================= */

export type StepUpFailure =
  | 'invalid-credentials'
  | 'invalid-code'
  | 'rate-limited'
  | 'invalid-input'
  | 'no-session'
  | 'unavailable';

export interface StepUpActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly failure?: StepUpFailure;
}

const stepUpSchema = z.object({
  purpose: z.enum(STEP_UP_PURPOSES),
  password: passwordSchema,
  code: z.string().trim().max(64).optional(),
});

/**
 * Earns a step-up grant for one purpose and this session.
 *
 * SELF-SERVICE, not privileged: proving who you are needs a session and your
 * credentials, never a permission. What it produces is scoped — a grant for
 * `privilege-administration` does not authorise an account-status change, so
 * re-proving yourself for one sensitive class never quietly authorises another
 * (SECURITY_BASELINE.md §8.1).
 */
export async function grantStepUpAction(
  _previous: StepUpActionState,
  form: FormData,
): Promise<StepUpActionState> {
  const locale = localeFrom(form);
  const parsed = stepUpSchema.safeParse({
    purpose: form.get('purpose'),
    password: form.get('password'),
    code: form.get('code') ?? undefined,
  });
  if (!parsed.success) return { status: 'error', failure: 'invalid-input' };

  const active = await requireOwnSession(locale);
  if (active === null) return { status: 'error', failure: 'no-session' };

  const { privilegedSecurity } = identityRuntime();
  const result = await privilegedSecurity.beginStepUp(active.context, active.session, {
    purpose: parsed.data.purpose,
    password: parsed.data.password,
    ...(parsed.data.code === undefined || parsed.data.code === ''
      ? {}
      : { code: parsed.data.code }),
  });

  if (!result.ok) {
    const failure: StepUpFailure =
      result.failure === 'invalid-credentials' ||
      result.failure === 'invalid-code' ||
      result.failure === 'rate-limited'
        ? result.failure
        : 'unavailable';
    return { status: 'error', failure };
  }

  refresh(locale);
  return { status: 'success' };
}

/* ===========================================================================
 * Account administration
 * ========================================================================= */

const statusSchema = z.object({
  accountId: z.string().trim().min(1).max(36),
  status: accountStatusSchema,
});

/**
 * Changes an account's status.
 *
 * HIGH CONSEQUENCE, so it costs a step-up grant and a complete privileged
 * posture. Disabling an account ends its access immediately, and the sessions
 * and step-up grants of the target are revoked with it — live authorisation
 * would refuse them anyway, and revoking means there is nothing left to refuse.
 */
export async function changeAccountStatusAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const parsed = statusSchema.safeParse({
    accountId: form.get('accountId'),
    status: form.get('status'),
  });
  if (!parsed.success) return invalid();

  const gate = await requirePrivilegedActor(
    locale,
    'users.administer',
    'account-administration',
  );
  if (gate.state === 'denied') return failed(gate.reason);

  const { identity } = identityRuntime();
  const result = await identity.setAccountStatus({
    accountId: parsed.data.accountId,
    status: parsed.data.status,
    actorId: gate.actor.accountId,
    actorType: 'user',
  });

  if (!result.ok) {
    return failed(
      result.failure === 'invalid-transition' || result.failure === 'final-administrator'
        ? result.failure
        : 'unavailable',
    );
  }

  refresh(locale);
  return OK;
}

/* ===========================================================================
 * Roles
 * ========================================================================= */

const createRoleSchema = z.object({
  key: roleKeySchema,
  name: roleNameSchema,
  description: roleDescriptionSchema,
  permissions: permissionBundleSchema,
});

export async function createRoleAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const parsed = createRoleSchema.safeParse({
    key: form.get('key'),
    name: form.get('name'),
    description: form.get('description'),
    permissions: form.getAll('permissions'),
  });
  if (!parsed.success) return invalid();

  const gate = await requirePrivilegedActor(
    locale,
    'roles.administer',
    'privilege-administration',
  );
  if (gate.state === 'denied') return failed(gate.reason);

  const { administration } = identityRuntime();
  const result = await administration.createCustomRole(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const renameRoleSchema = z.object({
  roleId: z.string().trim().min(1).max(36),
  name: roleNameSchema,
  description: roleDescriptionSchema,
});

export async function renameRoleAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const parsed = renameRoleSchema.safeParse({
    roleId: form.get('roleId'),
    name: form.get('name'),
    description: form.get('description'),
  });
  if (!parsed.success) return invalid();

  const gate = await requirePrivilegedActor(
    locale,
    'roles.administer',
    'privilege-administration',
  );
  if (gate.state === 'denied') return failed(gate.reason);

  const { administration } = identityRuntime();
  const result = await administration.renameCustomRole(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const bundleSchema = z.object({
  roleId: z.string().trim().min(1).max(36),
  permissions: permissionBundleSchema,
});

/**
 * Replaces a role's permission bundle.
 *
 * `permissions.grant`, NOT `roles.administer`: this is the authority
 * SECURITY_BASELINE.md §3.4 rule 6 names for changing what an account is
 * permitted to do, and renaming a role is not that. Splitting them means an
 * operator can be trusted to tidy role names without being trusted to widen
 * what a role permits.
 */
export async function setRolePermissionsAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const parsed = bundleSchema.safeParse({
    roleId: form.get('roleId'),
    permissions: form.getAll('permissions'),
  });
  if (!parsed.success) return invalid();

  const gate = await requirePrivilegedActor(
    locale,
    'permissions.grant',
    'privilege-administration',
  );
  if (gate.state === 'denied') return failed(gate.reason);

  const { administration } = identityRuntime();
  const result = await administration.setRolePermissions(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

export async function deactivateRoleAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const roleId = z.string().trim().min(1).max(36).safeParse(form.get('roleId'));
  if (!roleId.success) return invalid();

  const gate = await requirePrivilegedActor(
    locale,
    'roles.administer',
    'privilege-administration',
  );
  if (gate.state === 'denied') return failed(gate.reason);

  const { administration } = identityRuntime();
  const result = await administration.deactivateCustomRole(gate.actor, {
    roleId: roleId.data,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

/* ===========================================================================
 * Assignments
 * ========================================================================= */

const grantSchema = z.object({
  accountId: z.string().trim().min(1).max(36),
  roleId: z.string().trim().min(1).max(36),
  reason: grantReasonSchema.optional(),
});

/**
 * Grants a role.
 *
 * `permissions.grant` plus step-up plus a complete second-factor posture — the
 * three conditions §3.4 rule 6 and §8 name for changing what an account may do.
 * Self-elevation is refused by the context beneath, whatever the role.
 */
export async function grantAssignmentAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const raw = form.get('reason');
  const parsed = grantSchema.safeParse({
    accountId: form.get('accountId'),
    roleId: form.get('roleId'),
    reason: typeof raw === 'string' && raw.trim() !== '' ? raw : undefined,
  });
  if (!parsed.success) return invalid();

  const gate = await requirePrivilegedActor(
    locale,
    'permissions.grant',
    'privilege-administration',
  );
  if (gate.state === 'denied') return failed(gate.reason);

  const { administration } = identityRuntime();
  const result = await administration.grantRole(gate.actor, {
    accountId: parsed.data.accountId,
    roleId: parsed.data.roleId,
    reason: parsed.data.reason ?? null,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const revokeSchema = z.object({
  assignmentId: z.string().trim().min(1).max(36),
  reason: grantReasonSchema.optional(),
});

/**
 * Revokes an assignment.
 *
 * STEP-UP TOO. A revoke is as consequential as a grant — it is how somebody
 * removes another administrator — and the platform's own safety rule lives
 * below: the last live Platform Administrator cannot be revoked, because the
 * bootstrap self-closes and there would be no supported way back.
 */
export async function revokeAssignmentAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const raw = form.get('reason');
  const parsed = revokeSchema.safeParse({
    assignmentId: form.get('assignmentId'),
    reason: typeof raw === 'string' && raw.trim() !== '' ? raw : undefined,
  });
  if (!parsed.success) return invalid();

  const gate = await requirePrivilegedActor(
    locale,
    'permissions.grant',
    'privilege-administration',
  );
  if (gate.state === 'denied') return failed(gate.reason);

  const { administration } = identityRuntime();
  const result = await administration.revokeRole(gate.actor, {
    assignmentId: parsed.data.assignmentId,
    reason: parsed.data.reason ?? null,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

/* ===========================================================================
 * Delivery operation
 * ========================================================================= */

/**
 * Puts a stuck outbound message back on the schedule.
 *
 * PERMISSION ONLY, no step-up. It changes when a message is next attempted and
 * nothing about privilege, credentials or content, so requiring two proofs for
 * it would add friction without adding safety. It cannot resurrect a SENT
 * message and cannot overrule a SUPPRESSION — that is the provider telling this
 * platform not to write to an address again, and an operator does not overrule
 * it from a screen.
 */
export async function retryDeliveryAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const locale = localeFrom(form);
  const id = z.string().trim().min(1).max(36).safeParse(form.get('deliveryId'));
  if (!id.success) return invalid();

  const gate = await requirePermittedAction(locale, 'delivery.operate');
  if (gate.state === 'denied') return failed(gate.reason);

  const { deliveries } = identityRuntime();
  const rescheduled = await deliveries.rescheduleDelivery(id.data);
  if (!rescheduled) return failed('not-retryable');

  refresh(locale);
  return OK;
}
