import { z } from 'zod';

import { localeSchema } from '../env/shared.ts';

/**
 * Identity & Access value types and the schemas that validate application-owned
 * input at a trust boundary (SECURITY_BASELINE.md §9.1).
 *
 * Layer 0 and browser-safe: types and schemas only. No provider, no
 * persistence, no policy decision. The Identity context owns what these mean;
 * this module only fixes their shape so the context and its adapter cannot
 * describe them differently.
 */

/**
 * THE canonical address rule, in one place.
 *
 * Trim, then lowercase. Nothing else.
 *
 * Better Auth 1.7.4 applies exactly `toLowerCase()` in `createUser`,
 * `updateUser` and `findUserByEmail`, so adopting the library's rule as the
 * platform rule leaves one rule rather than two that can disagree
 * (DOMAIN_MODEL.md §4.6).
 *
 * Provider-specific rewriting is deliberately NOT applied. Gmail-style
 * dot-stripping and plus-tag removal are one provider's behaviour, not an
 * internet-wide one, and applying either globally merges distinct people's
 * accounts (SECURITY_BASELINE.md §2.2).
 */
export function canonicaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Address input.
 *
 * Canonicalised during parsing, so a caller cannot hold an uncanonicalised
 * address and compare it against a canonical one. 320 characters is the
 * addressable RFC bound and matches the column.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .pipe(z.email())
  .transform(canonicaliseEmail);

/**
 * Password bounds.
 *
 * A length floor and a ceiling, and no complexity theatre: character-class
 * rules push people toward predictable substitutions without measurably
 * improving resistance, and the platform's defence is a memory-hard hash plus
 * rate limiting (SECURITY_BASELINE.md §15).
 *
 * The ceiling exists because an unbounded password is an unbounded hash input.
 * Better Auth's own defaults are 8 and 128; the floor is raised to 12 and the
 * bounds are stated here so the same numbers reach the library, the server
 * validation and the interface copy.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH);

/** Display name for an account. Not a public contributor profile (§5.2). */
export const displayNameSchema = z.string().trim().min(1).max(200);

/**
 * Account status (DOMAIN_MODEL.md §4.6).
 *
 * `closed` is terminal: the row is retained for historical attribution, the
 * address released to a tombstone, and a later signup with the original
 * address is a NEW account that inherits nothing.
 */
export const accountStatusSchema = z.enum(['active', 'disabled', 'suspended', 'closed']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

/** Statuses that may hold an authenticated session. */
export const ACTIVE_ACCOUNT_STATUSES: readonly AccountStatus[] = ['active'];

/**
 * IANA zone identifier. Validated against the runtime's own zone table rather
 * than a pattern, so an unknown zone fails here instead of at first use
 * (DOMAIN_MODEL.md §19.5).
 */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA time zone');

/**
 * The token purposes this platform issues.
 *
 * Each is single-purpose by construction: a token minted for one purpose can
 * never be presented for another, because the purpose is part of the record's
 * identity (SECURITY_BASELINE.md §7.4).
 */
export const tokenPurposeSchema = z.enum([
  'email-verification',
  'password-reset',
  'email-change',
]);
export type TokenPurpose = z.infer<typeof tokenPurposeSchema>;

/** The account's interface locale — distinct from content language (§19.1). */
export { localeSchema };

/**
 * An account as the application sees it.
 *
 * Deliberately NOT the database row: no password hash, no session token, no
 * provider material. A projection that cannot carry a credential cannot leak
 * one.
 */
export interface AccountIdentity {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
  readonly locale: string;
  readonly timezone: string | null;
  readonly status: AccountStatus;
  readonly accountSetupCompletedAt: Date | null;
  readonly createdAt: Date;
}

/** An active session, as shown on the Account & Security surface. */
export interface SessionSummary {
  readonly id: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly current: boolean;
}
