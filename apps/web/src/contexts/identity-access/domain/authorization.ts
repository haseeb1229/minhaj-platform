import { PLATFORM_ADMINISTRATOR_ROLE, isPermissionKey } from '@minhaj/contracts/identity';
import { z } from 'zod';

/**
 * Authorisation domain rules.
 *
 * Pure, like `./account.ts`, and for the same reason: every rule here is a
 * decision the platform makes about privilege, and a decision that needs a
 * database to express is a decision that cannot be read, reviewed or tested on
 * its own.
 *
 * Layer 1. Identity & Access depends on Layer 0 only (DOMAIN_MODEL.md §3.1).
 */

/**
 * The protected system roles.
 *
 * ONE, and derived from the accepted documents rather than invented here.
 * SECURITY_BASELINE.md §8.3 names the initial privileged operator; nothing in
 * the accepted set names a second protected role. Narrower operator roles are
 * CUSTOM roles, which is what the custom-role lifecycle is for.
 */
export const PROTECTED_ROLE_KEYS: readonly string[] = Object.freeze([
  PLATFORM_ADMINISTRATOR_ROLE,
]);

export function isProtectedRoleKey(key: string): boolean {
  return PROTECTED_ROLE_KEYS.includes(key);
}

/**
 * A custom role's stable code.
 *
 * Lowercase and hyphenated, so a code is never two codes that differ by case
 * on a case-insensitive collation. It is NOT a display name and is never shown
 * where a name belongs.
 */
export const roleKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'Lowercase letters, digits and hyphens only')
  .refine(
    (key) => !isProtectedRoleKey(key),
    'That key belongs to a protected system role',
  );

export const roleNameSchema = z.string().trim().min(2).max(120);
export const roleDescriptionSchema = z.string().trim().min(2).max(400);

/** Why a privilege was granted or revoked. Optional, bounded, never a secret. */
export const grantReasonSchema = z.string().trim().min(1).max(200);

/**
 * A permission bundle submitted by a form.
 *
 * Validated against the COMPILED catalogue as well as the database: a key that
 * is not in the vocabulary this build knows about is refused before a
 * transaction is opened, and the database's foreign key refuses it again.
 */
export const permissionBundleSchema = z
  .array(z.string())
  .max(64)
  .transform((keys) => [...new Set(keys)].sort())
  .refine((keys) => keys.every(isPermissionKey), 'Unknown permission key');

/**
 * SELF-ELEVATION, in one function.
 *
 * SECURITY_BASELINE.md §3.4 rule 6: `permissions.grant` "is never
 * self-applicable". The rule is stated as identity rather than as a list of
 * roles, because the dangerous case is not a specific role — it is an
 * administrator adding to their own authority at all, which no audit trail can
 * meaningfully constrain afterwards.
 *
 * A second administrator grants it instead, or, for the very first one, the
 * host-only bootstrap does (§8.3).
 */
export function isSelfElevation(input: {
  readonly actorId: string;
  readonly targetAccountId: string;
}): boolean {
  return input.actorId === input.targetAccountId;
}

/**
 * Would revoking this assignment leave the platform with no administrator?
 *
 * Refused, and it is not paternalism: the bootstrap SELF-CLOSES after the first
 * success, so an accidental last revoke is not recoverable through any
 * supported path — it would need a database intervention, which is exactly the
 * kind of unaudited fix this design exists to make unnecessary.
 */
export function wouldRemoveFinalAdministrator(input: {
  readonly roleKey: string;
  readonly liveAssignments: number;
}): boolean {
  return input.roleKey === PLATFORM_ADMINISTRATOR_ROLE && input.liveAssignments <= 1;
}
