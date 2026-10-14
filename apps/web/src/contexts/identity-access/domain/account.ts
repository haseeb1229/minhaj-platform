import type { AccountIdentity, AccountStatus } from '@minhaj/contracts/identity';

/**
 * Account & Access domain rules.
 *
 * Pure, and deliberately so: every rule here is a decision the platform makes
 * about accounts, and a decision that needs a database to express is a
 * decision that cannot be read, reviewed or tested on its own.
 *
 * Layer 1. Identity & Access depends on Layer 0 only (DOMAIN_MODEL.md §3.1).
 */

/**
 * The permitted status transitions.
 *
 * Stated as data rather than as scattered `if`s, because the interesting
 * property is the shape of the whole table: `closed` reaches nothing, so
 * closure is terminal and no reactivation path can be added by accident.
 */
const TRANSITIONS: Readonly<Record<AccountStatus, readonly AccountStatus[]>> = {
  active: ['disabled', 'suspended', 'closed'],
  disabled: ['active', 'suspended', 'closed'],
  suspended: ['active', 'disabled', 'closed'],
  closed: [],
};

export function canTransition(from: AccountStatus, to: AccountStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * May this account hold an authenticated session?
 *
 * Only `active`. Disabled and suspended accounts keep their data and their
 * history; what they lose is the ability to act (DOMAIN_MODEL.md §4.6).
 */
export function mayHoldSession(status: AccountStatus): boolean {
  return status === 'active';
}

/**
 * Is account setup complete?
 *
 * Setup is the ACCOUNT's — a verified address, an interface locale, a
 * timezone. It is not personalisation onboarding, which is Phase 21's and
 * collects interests and goals at `/my/settings/interests`. Merging them would recreate the
 * dependency cycle that splitting the former Phase 3 removed
 * (DOMAIN_MODEL.md §4.2, §14.1).
 */
export function accountSetupComplete(account: AccountIdentity): boolean {
  return (
    account.emailVerified &&
    account.accountSetupCompletedAt !== null &&
    account.timezone !== null
  );
}

/**
 * Would removing one authentication method leave the account unreachable?
 *
 * The system refuses to remove the final usable method, which would otherwise
 * lock a person out of their own account irrecoverably (DOMAIN_MODEL.md §4.6).
 * Phase 2 has one method; Phase 2G adds a second through the same rule, which
 * is why the rule counts rather than naming providers.
 */
export function wouldRemoveFinalAuthenticationMethod(methodCount: number): boolean {
  return methodCount <= 1;
}

/**
 * A deterministic idempotency key for a security notification.
 *
 * Deterministic per (purpose, account, occasion) so a relay that retried after
 * committing cannot produce a second message. `occasion` is what distinguishes
 * two genuine password changes from one retried notification — a timestamp
 * would make every retry look like a new event.
 */
export function notificationKey(input: {
  readonly purpose: string;
  readonly accountId: string;
  readonly occasion: string;
}): string {
  return `${input.purpose}:${input.accountId}:${input.occasion}`;
}
