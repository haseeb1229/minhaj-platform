import 'server-only';

import type { AccountIdentity, AccountStatus } from '@minhaj/contracts/identity';

/**
 * Projections and failure classification for the Identity adapter.
 *
 * PRIVATE to the adapter. It sits beside the entry point rather than inside it
 * so the entry point exports only the port and the values that port names —
 * the analyser verifies an adapter's public surface is narrow, and a helper
 * reachable from an export is part of that surface even when it is not itself
 * exported.
 *
 * Every signature here is CONCRETE. `unknown` and `any` are excluded on
 * purpose: a broad type on this path can erase a client, a delegate or a
 * transaction handle, and a surface that cannot be shown narrow is not a
 * boundary (ARCHITECTURE.md §6.3 rule 13).
 */

/**
 * A user row as Better Auth hands it back, including the One Minhaj columns
 * declared to it as `additionalFields`.
 *
 * The library types those additions loosely because it cannot know them; they
 * are stated concretely here, at the one place they enter this codebase.
 */
export interface AuthUserRow {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
  readonly createdAt: Date | string;
  readonly locale?: string | null;
  readonly timezone?: string | null;
  readonly status?: string | null;
  readonly accountSetupCompletedAt?: Date | string | null;
}

/** Session fields the adapter reads back. */
export interface AuthSessionRow {
  readonly id: string;
  readonly createdAt: Date | string;
  readonly expiresAt: Date | string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export function asDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

const ACCOUNT_STATUSES: readonly string[] = ['active', 'disabled', 'suspended', 'closed'];

/**
 * Reads a stored status, failing closed.
 *
 * An unrecognised value becomes `disabled` rather than `active`: a status
 * column this code cannot interpret must not be read as permission to sign in.
 */
function toAccountStatus(value: string | null | undefined): AccountStatus {
  if (typeof value === 'string' && ACCOUNT_STATUSES.includes(value)) {
    return value as AccountStatus;
  }
  return 'disabled';
}

/**
 * Projects a user row into the application's view of an account.
 *
 * Deliberately lossy. The password hash, provider tokens and session material
 * present on the underlying rows have no representation in `AccountIdentity`,
 * so no caller can receive one by accident.
 */
export function toAccountIdentity(user: AuthUserRow): AccountIdentity {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    locale: typeof user.locale === 'string' ? user.locale : 'en',
    timezone: typeof user.timezone === 'string' ? user.timezone : null,
    status: toAccountStatus(user.status),
    accountSetupCompletedAt: asDate(user.accountSetupCompletedAt),
    createdAt: asDate(user.createdAt) ?? new Date(0),
  };
}

/** Collects `Set-Cookie` values for Layer 4 to apply through the framework. */
export function setCookiesFrom(headers: Headers | undefined): readonly string[] {
  if (headers === undefined) return [];
  return headers.getSetCookie();
}

/**
 * Failure classes this adapter reports.
 *
 * Deliberately coarse. A mechanics failure carries a CLASS, not a provider
 * message: a library error string reaching an interface is how an internal
 * detail leaks, and how a response starts distinguishing "no such user" from
 * "wrong password" (SECURITY_BASELINE.md §2.2).
 */
export type AuthMechanicsFailure =
  | 'invalid-credentials'
  | 'duplicate-email'
  | 'invalid-token'
  | 'expired-token'
  | 'too-many-attempts'
  | 'unknown';

export class AuthMechanicsError extends Error {
  readonly failure: AuthMechanicsFailure;

  constructor(failure: AuthMechanicsFailure) {
    super(`Authentication mechanics failed: ${failure}`);
    this.name = 'AuthMechanicsError';
    this.failure = failure;
  }
}

/** The shape of a `better-call` API error, as much of it as is read here. */
interface ApiErrorLike {
  readonly body?: { readonly code?: string } | null;
}

function errorCodeOf(error: ApiErrorLike | null): string {
  const code = error?.body?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * Maps a library error onto a failure class.
 *
 * An unrecognised error becomes `unknown`, which callers surface as a generic
 * failure. Guessing a more specific class from an unrecognised code is how a
 * non-enumerating response accidentally becomes an enumerating one.
 */
export function classifyAuthError(error: ApiErrorLike | null): AuthMechanicsError {
  const code = errorCodeOf(error);

  if (/INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD|CREDENTIAL/i.test(code)) {
    return new AuthMechanicsError('invalid-credentials');
  }
  if (/EXISTS|DUPLICATE/i.test(code)) return new AuthMechanicsError('duplicate-email');
  if (/EXPIRED/i.test(code)) return new AuthMechanicsError('expired-token');
  if (/TOO_MANY_ATTEMPTS/i.test(code)) {
    return new AuthMechanicsError('too-many-attempts');
  }
  if (/INVALID_OTP|INVALID_TOKEN|USER_NOT_FOUND/i.test(code)) {
    return new AuthMechanicsError('invalid-token');
  }
  return new AuthMechanicsError('unknown');
}
