// PACKAGE-INTERNAL, and a type. The audit record is a Layer-0 shape that
// Identity's own follow-up transaction has to carry, and restating it here
// would create a second definition free to drift from the one the audit writer
// actually accepts.
import type { AuditEvent } from '../platform/ports.ts';

import type {
  AccountIdentity,
  AccountStatus,
  SessionSummary,
  TokenPurpose,
} from './values.ts';

/**
 * The ports between the Identity & Access context and its private adapters.
 *
 * WHY THEY LIVE HERE. The context lives under `apps/web/src/contexts/`, its
 * adapter is physically implemented inside `packages/database`, and
 * `packages/config/eslint/contexts.js` prohibits a context from importing
 * `@minhaj/database`. Putting the interface in Layer 0 lets both sides depend
 * on the same contract without either depending on the other
 * (ARCHITECTURE.md §3.1.1, §4.1).
 *
 * WHAT MAY CROSS. Narrow, named operations and domain values. Never a Prisma
 * client, delegate, transaction handle or raw-query facility; never Better
 * Auth's `auth`, `auth.api`, `auth.$context`, its internal adapter, its generic
 * `DBAdapter`, or its endpoint collection (ARCHITECTURE.md §3.1.2).
 *
 * WHAT THESE PORTS ARE NOT. They are MECHANICS. They create a credential, they
 * check a password, they resolve a session record, they mint and consume a
 * token. They decide nothing: whether an account may sign in, whether a
 * message should be sent, what it should say, whether a rate limit applies and
 * whether an operation is authorised are all Identity's, and they stay in the
 * context. An adapter that answered any of those questions would have become
 * the application layer.
 */

/** Request headers, as the framework hands them over. */
export type RequestHeaders = Headers;

/**
 * `Set-Cookie` values an operation produced.
 *
 * The adapter returns them; LAYER 4 applies them through the framework's own
 * cookie API. This is why no Next.js import appears anywhere beneath Layer 4:
 * the cookie is data until the composition layer writes it.
 */
export type SetCookieHeaders = readonly string[];

/**
 * Outcomes are stated CONCRETELY rather than as one generic envelope.
 *
 * A generic `Result<T>` on an encapsulation boundary is a hole the analyser
 * cannot see through: `T` may be instantiated with anything, including a
 * client, a delegate or a transaction handle, so a surface built on it cannot
 * be SHOWN to be narrow (ARCHITECTURE.md §6.3 rule 13). Two small concrete
 * shapes prove what one generic one only asserts.
 */
export interface AuthenticationOutcome {
  readonly account: AccountIdentity;
  readonly setCookies: SetCookieHeaders;
}

export interface SignOutOutcome {
  readonly setCookies: SetCookieHeaders;
}

/**
 * An operation that ROTATED the caller's own session.
 *
 * Better Auth replaces the acting session when a credential changes — it
 * deletes every session for the account, including this one, and issues a
 * fresh token. That is the right security behaviour, and it means the new
 * cookie MUST reach the browser: an operation that rotated the session and
 * dropped the replacement would sign the person out silently, one request
 * after telling them their password was changed successfully.
 */
export interface SessionRotation {
  readonly setCookies: SetCookieHeaders;
}

/** The only vendor-owned mutations that need crash reconciliation in Chunk 1. */
export type IdentitySecurityOperationKind =
  'password-reset' | 'password-change' | 'email-change';

/** Opaque durable marker identity; it carries no password, token or address. */
export interface PreparedIdentitySecurityOperation {
  readonly id: string;
  readonly accountId: string;
}

/** A session record together with the account it belongs to. */
export interface ResolvedSession {
  readonly sessionId: string;
  readonly sessionCreatedAt: Date;
  readonly sessionExpiresAt: Date;
  readonly account: AccountIdentity;
}

/**
 * Token purposes addressed by ONE address.
 *
 * Email change is excluded because it is keyed on a pair of addresses; it has
 * its own operations below rather than a wider version of these.
 */
export type AddressTokenPurpose = Exclude<TokenPurpose, 'email-change'>;

/**
 * Material an outstanding token delivery needs.
 *
 * The token is present ONLY in memory, ONLY for the delivery about to be
 * attempted. It is never returned to anything but the approved orchestration
 * that renders the message, and it is never written to any durable store other
 * than Better Auth's own `Verification` record (ARCHITECTURE.md §4.6.1).
 */
export interface TokenDeliveryMaterial {
  readonly purpose: TokenPurpose;
  readonly email: string;
  readonly token: string;
}

/**
 * A token this platform has just issued, announced to its owner.
 *
 * An injected capability, narrow and named: it tells Identity that a token now
 * exists so Identity can decide what communication it warrants. The adapter
 * makes no such decision itself.
 */
export type TokenIssuedListener = (issued: {
  readonly purpose: TokenPurpose;
  readonly email: string;
  readonly expiresAt: Date;
}) => Promise<void>;

/**
 * AUTHENTICATION MECHANICS — implemented by the private adapter that holds the
 * Better Auth instance and the Prisma client, and by nothing else.
 */
export interface AuthMechanicsPort {
  createCredentialAccount(input: {
    readonly email: string;
    readonly password: string;
    readonly name: string;
    readonly locale: string;
  }): Promise<AccountIdentity>;

  authenticateWithPassword(input: {
    readonly email: string;
    readonly password: string;
    readonly headers: RequestHeaders;
  }): Promise<AuthenticationOutcome>;

  /** Proves the holder of this session knows the account password (step-up). */
  verifyPassword(input: {
    readonly headers: RequestHeaders;
    readonly password: string;
  }): Promise<boolean>;

  resolveSession(headers: RequestHeaders): Promise<ResolvedSession | null>;

  listSessions(headers: RequestHeaders): Promise<readonly SessionSummary[]>;

  revokeOtherSessions(headers: RequestHeaders): Promise<void>;

  /** Every session for one account, regardless of who is asking. */
  revokeAllSessionsForAccount(accountId: string): Promise<number>;

  signOut(headers: RequestHeaders): Promise<SignOutOutcome>;

  changePassword(input: {
    readonly headers: RequestHeaders;
    readonly currentPassword: string;
    readonly newPassword: string;
    readonly securityOperation: PreparedIdentitySecurityOperation;
  }): Promise<SessionRotation>;

  // ---- Tokens -----------------------------------------------------------
  //
  // Better Auth's `Verification` record is the sole durable home for auth
  // bearer material. These operations mint, inspect and consume it; none of
  // them hands out a way to enumerate or store it elsewhere.

  /** Mints a fresh token, invalidating any outstanding one for that purpose. */
  issueToken(input: {
    readonly purpose: AddressTokenPurpose;
    readonly email: string;
  }): Promise<void>;

  /**
   * Re-materialises the SAME outstanding token for one delivery identity.
   *
   * This is what makes a failed DELIVERY retryable without minting a second
   * token, extending an expiry or copying bearer material into another store.
   * It is scoped to one `(purpose, email)` pair, returns `null` when no live
   * token exists, and cannot enumerate.
   */
  materialiseOutstandingToken(input: {
    readonly purpose: AddressTokenPurpose;
    readonly email: string;
  }): Promise<TokenDeliveryMaterial | null>;

  /** Reads token state WITHOUT consuming it — for the GET render only. */
  inspectToken(input: {
    readonly purpose: AddressTokenPurpose;
    readonly email: string;
    readonly token: string;
  }): Promise<'valid' | 'invalid' | 'expired'>;

  /** Consumes the token and marks the address verified. */
  confirmEmailVerification(input: {
    readonly email: string;
    readonly token: string;
  }): Promise<void>;

  /** Consumes the token and sets the new password. */
  consumePasswordReset(input: {
    readonly email: string;
    readonly token: string;
    readonly newPassword: string;
    readonly securityOperation?: PreparedIdentitySecurityOperation;
  }): Promise<void>;

  // ---- Email change -----------------------------------------------------
  //
  // A SEPARATE SHAPE, because the operation genuinely has one. A change is
  // keyed on a PAIR of addresses — the token belongs to "this account moving
  // to that address", not to an address — and both ends require a session, so
  // it cannot be issued or confirmed by anyone holding only a link.
  //
  // It was previously squeezed into the single-address operations above. That
  // fit the type and nothing else: the mint call reached a session-guarded
  // endpoint with no session, and the retry and confirm paths addressed a
  // record keyed on one address that is in fact keyed on two.

  /**
   * Mints a change token and asks the NEW address to prove itself.
   *
   * Requires the caller's session: it is the account's current address that is
   * moving, and only the account may move it.
   */
  requestEmailChange(input: {
    readonly headers: RequestHeaders;
    readonly newEmail: string;
  }): Promise<void>;

  /** Re-materialises the SAME change token, for a delivery retry. */
  materialiseEmailChangeToken(input: {
    readonly currentEmail: string;
    readonly newEmail: string;
  }): Promise<TokenDeliveryMaterial | null>;

  /**
   * Reads change-token state WITHOUT consuming it.
   *
   * `expired` is not distinguishable here: the underlying read reports an
   * expired record and an absent one identically, and inventing a distinction
   * would mean keeping a second copy of the expiry outside the record that
   * owns it.
   */
  inspectEmailChangeToken(input: {
    readonly currentEmail: string;
    readonly newEmail: string;
    readonly token: string;
  }): Promise<'valid' | 'invalid'>;

  /** Consumes the change token and moves the account to the new address. */
  confirmEmailChange(input: {
    readonly headers: RequestHeaders;
    readonly newEmail: string;
    readonly token: string;
    readonly securityOperation: PreparedIdentitySecurityOperation;
  }): Promise<SessionRotation>;

  /**
   * Revokes one of the caller's OWN sessions, named by its id.
   *
   * BY ID, DELIBERATELY. Revoking takes the session's TOKEN, and a token is a
   * bearer credential: rendering every session's token into a form so the
   * browser can post one back would put a live credential for each of a
   * person's devices into the page. The id is an opaque handle, the token is
   * resolved inside the adapter, and the caller's own session list is the
   * only place it is looked for — so one account cannot name another's.
   */
  revokeSessionById(input: {
    readonly headers: RequestHeaders;
    readonly sessionId: string;
  }): Promise<boolean>;
}

/**
 * IDENTITY PERSISTENCE — the context's own state, which Better Auth neither
 * owns nor knows about.
 */
export interface IdentityPersistencePort {
  findAccountByEmail(email: string): Promise<AccountIdentity | null>;

  findAccountById(id: string): Promise<AccountIdentity | null>;

  updateAccountProfile(input: {
    readonly accountId: string;
    readonly name?: string;
    readonly locale?: string;
    readonly timezone?: string | null;
  }): Promise<AccountIdentity>;

  setAccountStatus(input: {
    readonly accountId: string;
    readonly status: AccountStatus;
  }): Promise<void>;

  completeAccountSetup(accountId: string): Promise<AccountIdentity>;

  /** Does this account still hold a usable way to sign in? */
  countAuthenticationMethods(accountId: string): Promise<number>;

  /**
   * Closure, in ONE transaction owned entirely by Identity.
   *
   * Retains the row for historical attribution, pseudonymises the profile,
   * replaces the address with a deterministic non-routable tombstone so the
   * original becomes available again, and disposes credentials, sessions and
   * outstanding tokens. Commits the supplied notification intent alongside,
   * because a closure the person is never told about is a closure they cannot
   * question (DOMAIN_MODEL.md §4.6).
   */
  closeAccount(input: {
    readonly accountId: string;
    readonly intent: CommunicationIntentInput;
    readonly audit: AuditEvent;
  }): Promise<void>;

  /** Prepares token/password/address-free evidence before a vendor mutation. */
  prepareSecurityOperation(input: {
    readonly kind: IdentitySecurityOperationKind;
    readonly accountId: string;
    readonly initiatingSessionId?: string;
  }): Promise<PreparedIdentitySecurityOperation>;

  /** Fences a vendor mutation that returned before its target write committed. */
  cancelSecurityOperation(operationId: string): Promise<void>;

  /** Finalizes one committed mutation's audit plus communication, once. */
  reconcileSecurityOperation(operationId: string): Promise<boolean>;

  /** Restart-safe bounded sweep for committed and abandoned operations. */
  reconcileSecurityOperations(limit: number): Promise<number>;

  /**
   * Commits a token-free notification intent INSIDE the transaction that makes
   * the change it describes.
   *
   * There is no cross-owner transaction anywhere in this: the intent is
   * Identity's own row in Identity's own transaction, and Layer 4 relays it to
   * the Layer-0 email concern only after that transaction has committed
   * (ARCHITECTURE.md §3.1.2.1).
   */
  commitCommunicationIntent(intent: CommunicationIntentInput): Promise<void>;

  /**
   * Commits a security change's AUDIT RECORD and its notification intent
   * TOGETHER, in one Identity-owned transaction.
   *
   * WHY THEY MAY NOT BE TWO WRITES. Both are the required follow-up to an
   * authoritative security change, and they answer different questions about
   * the same event: the audit row is what an investigation reads, the intent
   * is what tells the person it happened. Written separately, a crash between
   * them produces a change that was recorded but never disclosed, or disclosed
   * but never recorded — and the first of those is indistinguishable from a
   * change nobody was told about on purpose.
   *
   * This does NOT make AuditLog a relational owner and is not a general
   * transaction service: it is one named Identity operation writing its own
   * follow-up (ARCHITECTURE.md §3.1.2.1, and the audit rules it keeps).
   */
  recordSecurityFollowUp(input: {
    readonly audit: AuditEvent;
    readonly intent: CommunicationIntentInput;
  }): Promise<void>;

  claimPendingIntents(limit: number): Promise<readonly PendingIntent[]>;

  /**
   * Marks an intent relayed, and DISCARDS any recipient it was carrying.
   *
   * The clearing is part of this operation rather than a separate tidy-up
   * because that is what bounds the retention of `recipientOverride` to the
   * gap between the owning transaction and the relay.
   */
  markIntentRelayed(intentId: string): Promise<void>;
}

/** A required, TOKEN-FREE message Identity owes someone. */
export interface CommunicationIntentInput {
  readonly purpose: IdentityNotificationPurpose;
  readonly accountId: string;
  readonly locale: string;
  /** Deterministic per event, so a relay retry cannot produce a second message. */
  readonly idempotencyKey: string;
  /**
   * Where to send it, when the account's own address will no longer say.
   *
   * Set ONLY by account closure, which replaces the address with a tombstone
   * in the same transaction that commits this intent. Every other notification
   * resolves its recipient from the account at relay time, which is what makes
   * a notification follow an address change rather than chase a stale copy.
   *
   * Discarded when the intent is relayed.
   */
  readonly recipientOverride?: string;
}

export interface PendingIntent extends CommunicationIntentInput {
  readonly id: string;
  /** The account's address now, or the override where closure captured one. */
  readonly email: string;
}

/**
 * Notifications Identity owes after a security-relevant change.
 *
 * None of them carries token authority, which is why they may use the durable
 * intent mechanism freely (ARCHITECTURE.md §4.6.1).
 */
export type IdentityNotificationPurpose =
  | 'identity.password-changed'
  | 'identity.password-reset'
  | 'identity.email-changed'
  | 'identity.account-closed'
  | 'identity.sessions-revoked';

/**
 * The NARROW reader the reusable session service receives.
 *
 * Deliberately two operations. The session service hosted in
 * `packages/server-core` must be usable by the future realtime transport
 * without that process acquiring anything else, so it is given exactly what
 * resolving and revoking a session requires — not the whole auth-mechanics
 * port (ARCHITECTURE.md §3.1.2, §3.1.3).
 */
export interface SessionReaderPort {
  resolveSession(headers: RequestHeaders): Promise<ResolvedSession | null>;
  revokeAllSessionsForAccount(accountId: string): Promise<number>;
}

/**
 * Why a request has no usable session.
 *
 * Distinguished so a surface can say something true and non-enumerating:
 * "signed out" and "this account is suspended" call for different words, and
 * neither may reveal anything about another account.
 */
export type SessionDenial =
  'no-session' | 'account-disabled' | 'account-suspended' | 'account-closed';

export type SessionOutcome =
  | { readonly state: 'active'; readonly session: ResolvedSession }
  | { readonly state: 'denied'; readonly reason: SessionDenial };
