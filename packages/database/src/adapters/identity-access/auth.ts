import 'server-only';

import { randomBytes } from 'node:crypto';

import type { TokenIssuedListener, TokenPurpose } from '@minhaj/contracts/identity';
import type { RateLimiterPort } from '@minhaj/contracts/platform';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { twoFactor } from 'better-auth/plugins/two-factor';

import { getDatabaseClient } from '../../client.ts';
import { createReconciledAuthClient } from './reconciled-auth-client.ts';

/**
 * THE private Better Auth instance.
 *
 * WHY IT IS HERE. `prismaAdapter` takes a `PrismaClient`, and a bounded context
 * may never hold one (ARCHITECTURE.md §3.1.2). Constructing the instance beside
 * the private client is the only arrangement in which neither the client nor
 * Better Auth's generic `DBAdapter` crosses a boundary. Physical placement
 * transfers no ownership: Identity & Access owns this adapter, and only that
 * context may change what it means (§4.1, §6.3 rule 14).
 *
 * WHAT IT IS NOT. It is not the Identity application layer. Every value below
 * is either a vendor mechanism or a POLICY VALUE INJECTED BY THE CONTEXT.
 * Nothing here decides who may sign in, what a message says, whether an
 * operation is authorised, or whether a rate limit applies to a person —
 * Identity decides all of that and hands the results in.
 *
 * NOTHING ESCAPES. `auth`, `auth.api`, `auth.$context`, the internal adapter
 * and the endpoint collection are module-private. The public entry
 * (`./index.ts`) exports narrow named operations and domain values only.
 */

/** Policy the Identity context owns and this adapter merely applies. */
export interface AuthMechanicsConfiguration {
  /** Canonical application origin, e.g. `https://minhajulquran.example`. */
  readonly baseUrl: string;
  /** Origins Better Auth will accept a callback or redirect target from. */
  readonly trustedOrigins: readonly string[];
  /**
   * Versioned signing/encryption secrets, newest first.
   *
   * Better Auth 1.7.4 supports non-destructive rotation natively through an
   * envelope format carrying the key version, so no custom keyring is invented
   * here. The first entry encrypts; the rest decrypt only.
   */
  readonly secrets: readonly { readonly version: number; readonly value: string }[];
  /** `Secure` cookies. Forced on everywhere except local plain-HTTP dev. */
  readonly useSecureCookies: boolean;
  readonly passwordLength: { readonly min: number; readonly max: number };
  readonly session: {
    /** Idle expiry, seconds. The record slides while it is used. */
    readonly expiresInSeconds: number;
    /** How often a live session's expiry is rewritten, seconds. */
    readonly updateAgeSeconds: number;
  };
  /** Lifetime of every issued token, seconds. */
  readonly tokenExpiresInSeconds: number;
  /** Wrong-token submissions permitted before an identifier locks out. */
  readonly tokenAllowedAttempts: number;
  /** The shared limiter. Better Auth consumes the SAME store the app does. */
  readonly rateLimiter: RateLimiterPort;
  /**
   * PRIVILEGED SECOND-FACTOR policy, owned by the Identity context.
   *
   * Every number here is a security decision about this platform — how many
   * recovery codes a person is given, how long a TOTP step lasts, how many
   * failed second factors lock an account during sign-in. The library counts
   * and compares; it does not decide any of them.
   */
  readonly secondFactor: {
    readonly recoveryCodeCount: number;
    /** 6 or 8 — the only lengths the TOTP implementation accepts. */
    readonly totpDigits: 6 | 8;
    readonly totpPeriodSeconds: number;
    /** SIGN-IN lockout only. The signed-in path has none; see below. */
    readonly signInLockout: {
      readonly maxFailedAttempts: number;
      readonly durationSeconds: number;
    };
  };
  /** Told that a token now exists, so Identity can decide what to send. */
  readonly onTokenIssued: TokenIssuedListener;
}

/**
 * Token generation.
 *
 * The Email-OTP lifecycle is used for its DATABASE-BACKED, single-use,
 * attempt-bounded token record — not for six-digit codes. The delivered
 * product is an emailed LINK, so the value must be high-entropy and URL-safe:
 * 32 random bytes as base64url, 43 characters, no percent-encoding.
 *
 * The library's default generator would emit a 6-digit numeric code, which is
 * appropriate for a code a person retypes and wholly inappropriate for a value
 * that travels in a URL and is never retyped.
 */
export function generateLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Maps a platform token purpose onto the library's OTP type.
 *
 * The library also defines `"sign-in"`, which this platform deliberately never
 * uses: passwordless sign-in is not a Phase-2 capability, and a purpose the
 * mapping cannot produce is a purpose no call site can reach by accident.
 */
export type OtpType = 'email-verification' | 'forget-password' | 'change-email';

const OTP_TYPE: Record<TokenPurpose, OtpType> = {
  'email-verification': 'email-verification',
  'password-reset': 'forget-password',
  'email-change': 'change-email',
};

export function otpTypeFor(purpose: TokenPurpose): OtpType {
  return OTP_TYPE[purpose];
}

/**
 * The subject a change token is recorded against.
 *
 * Better Auth stores an email-change token under the identifier
 * `change-email-otp-<current>-<new>` — keyed on the PAIR, because a change is
 * a move between two addresses and neither alone identifies it. This function
 * is the one place that shape is written down, so the mint, the retry and the
 * confirm cannot disagree about where the record lives.
 */
export function changeIdentitySubject(currentEmail: string, newEmail: string): string {
  return `${currentEmail.toLowerCase()}-${newEmail.toLowerCase()}`;
}

export type AuthInstance = ReturnType<typeof createAuthInstance>;

/**
 * Builds the instance. Called once by the adapter entry point and never
 * exported beyond this package.
 */
export function createAuthInstance(configuration: AuthMechanicsConfiguration) {
  const {
    baseUrl,
    trustedOrigins,
    secrets,
    useSecureCookies,
    passwordLength,
    session,
    tokenExpiresInSeconds,
    tokenAllowedAttempts,
    rateLimiter,
    secondFactor,
    onTokenIssued,
  } = configuration;

  const current = secrets[0];
  if (current === undefined) {
    throw new Error('At least one versioned auth secret is required.');
  }

  // The options literal is passed INLINE, deliberately.
  //
  // Routing it through a helper that returns it widens `plugins` to
  // `BetterAuthPlugin[]`, and `auth.api` is built by mapping over that array's
  // ELEMENT type — so every plugin endpoint disappears from the instance type
  // and every call to one becomes a type error. The schema proof reads the
  // real options back off the constructed instance (`auth.$context.options`)
  // rather than from a second copy assembled to look like them.
  return betterAuth({
    appName: 'One Minhaj',
    baseURL: baseUrl,
    trustedOrigins: [...trustedOrigins],

    // Newest first: the head encrypts, the tail decrypts previously encrypted
    // material so a rotation does not invalidate live tokens or stored
    // second-factor secrets.
    secret: current.value,
    secrets: secrets.map((entry) => ({ version: entry.version, value: entry.value })),

    // No outbound call is made from a platform for a religious organisation
    // without a decision to make one. The default is already `false`; it is
    // stated so a future default change cannot enable it silently.
    telemetry: { enabled: false },

    database: prismaAdapter(createReconciledAuthClient(getDatabaseClient()), {
      provider: 'sqlserver',

      // Sign-up creates a `user` and an `account` row. Without a transaction a
      // crash between them leaves an account that can never sign in.
      transaction: true,
    }),

    emailVerification: {
      // THE LIBRARY DOES NOT MINT ON SIGN-UP. Identity does, explicitly.
      //
      // Better Auth auto-sends a verification email when `sendOnSignUp` is
      // unset and `requireEmailVerification` is on (`sign-up.mjs`, the
      // `?? requireEmailVerification` fallback). That produced two defects at
      // once. It minted a token INSIDE `signUpEmail`, before Identity had
      // committed anything durable to say a message was owed for it — exactly
      // the crash window the ordering in `issueAndEnqueue` exists to remove,
      // reopened one call earlier. And because Identity then issues its own
      // token for the same address, every sign-up minted TWICE, the second
      // rotating the first away seconds after it was written.
      //
      // Turning it off leaves ONE mint in the sign-up path, and it is the one
      // that happens after the delivery is durable. It also restores what this
      // adapter says of itself everywhere else: it performs mechanics, and
      // Identity decides whether and what to send.
      sendOnSignUp: false,
    },

    emailAndPassword: {
      enabled: true,

      // Also what makes sign-up non-enumerating: the library returns a generic
      // success for an address that already exists rather than disclosing it
      // (SECURITY_BASELINE.md §15.2).
      requireEmailVerification: true,
      autoSignIn: false,

      minPasswordLength: passwordLength.min,
      maxPasswordLength: passwordLength.max,

      // A completed reset invalidates every outstanding session, because the
      // credential that authorised them has changed (§2.3).
      revokeSessionsOnPasswordReset: true,
    },

    session: {
      expiresIn: session.expiresInSeconds,
      updateAge: session.updateAgeSeconds,

      // Better Auth's "freshness" is age since session CREATION, so a session
      // created yesterday counts as fresh. That is weaker than this platform's
      // step-up requirement and would be a second, softer notion of recency
      // sitting beside it. It is disabled, and sensitive operations instead
      // require an explicit step-up grant (SECURITY_BASELINE.md §8.1).
      //
      // This is safe ONLY because no Better Auth endpoint is reachable over
      // HTTP (see `./index.ts`), so there is no path to a sensitive operation
      // that bypasses the context's own wrapper. A test asserts that.
      freshAge: 0,

      // A cached session cannot be revoked on another device until the cache
      // expires, which would make "revoke this session" a promise the product
      // could not keep.
      cookieCache: { enabled: false },
    },

    advanced: {
      useSecureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
      database: {
        // `generateId` is deliberately ABSENT rather than set. Better Auth's
        // default generates 32-character alphanumeric ids, which the
        // NVARCHAR(36) key columns are sized for. `"uuid"` would emit `uuid()`
        // for mssql — a function SQL Server does not have.

        // Reads the Prisma datamodel at init and fails auth requests when the
        // schema does not match. Default `true` since 1.7.3; stated so it
        // cannot be lost to a default change. It is defence in depth behind
        // the explicit parity proof in the test suite.
        validateSchema: true,
      },
    },

    rateLimit: {
      // The library disables rate limiting outside production by default,
      // which would leave a security control untested everywhere it is
      // developed. It is on in every environment.
      enabled: true,

      // `customStorage` overrides `storage` entirely, so Better Auth's own
      // `rateLimit` table is never created and there is exactly one limiter
      // (ARCHITECTURE.md §4.5).
      customStorage: {
        consume: async (key, rule) => rateLimiter.consume(`better-auth:${key}`, rule),
      },
    },

    user: {
      // Every One Minhaj-owned column is `input: false`, so none of them can be
      // set from a sign-up body. They change only through Identity's services
      // — this is the mass-assignment defence at the library boundary
      // (SECURITY_BASELINE.md §9.1).
      additionalFields: {
        // `twoFactorEnabled` is NOT declared here. The two-factor plugin adds
        // it to the user model itself, with `input: false`; declaring it twice
        // would be two definitions of one column.
        locale: { type: 'string', required: true, input: false, defaultValue: 'en' },
        timezone: { type: 'string', required: false, input: false },
        status: { type: 'string', required: true, input: false, defaultValue: 'active' },
        accountSetupCompletedAt: { type: 'date', required: false, input: false },
        closedAt: { type: 'date', required: false, input: false },
        pseudonymisedAt: { type: 'date', required: false, input: false },
      },
    },

    plugins: [
      emailOTP({
        // Replaces the DEFAULT email-verification flow, whose token is a
        // stateless signed JWT that no server-side record can invalidate and
        // whose GET endpoint performs the mutation. Under this plugin the
        // token is a database row: single-use, attempt-bounded, revocable, and
        // consumed only by an explicit POST (SECURITY_BASELINE.md §7.4).
        overrideDefaultEmailVerification: true,

        // `verifyCurrentEmail` is deliberately OFF, and the current address is
        // proved a different way.
        //
        // The library's version of that check mints its proof under the
        // `email-verification` identifier — the SAME record an account's own
        // address verification uses. Turning it on therefore makes one token
        // reachable for two purposes: requesting a change would rotate away an
        // outstanding account-verification token, and a token minted to verify
        // an account would satisfy a change request. Single-purpose tokens are
        // not a preference here, they are the property that makes a token
        // safe to email (SECURITY_BASELINE.md §7.4).
        //
        // What replaces it is stronger. Identity requires the account PASSWORD
        // at the request step, through the platform's own step-up wrapper: a
        // code mailed to an address proves that mailbox is readable, which is
        // exactly what an attacker who is reading the mailbox already has,
        // whereas the password proves account control. DOMAIN_MODEL.md §4.6
        // requires proving ownership of the NEW address, which the token below
        // does; how the current side is proved is this phase's to decide.
        changeEmail: { enabled: true, verifyCurrentEmail: false },

        // Recoverable storage. This is what lets a failed DELIVERY be retried
        // with the SAME token instead of minting a second one — the whole of
        // P-4 rests on it. `"hashed"` would be unrecoverable and would force
        // either a second token or a lost message.
        storeOTP: 'encrypted',

        // Always mint a new token on an explicit user resend, and invalidate
        // the previous one. `"reuse"` is the alternative and it EXTENDS the
        // existing expiry (`updateVerificationByIdentifier`), which would let
        // repeated resends keep a token alive indefinitely.
        resendStrategy: 'rotate',

        expiresIn: tokenExpiresInSeconds,
        allowedAttempts: tokenAllowedAttempts,

        // A token is never a way to create an account.
        disableSignUp: true,

        generateOTP: () => generateLinkToken(),

        // The adapter does not decide whether or what to send. It reports that
        // a token now exists; Identity decides the rest.
        sendVerificationOTP: async ({ email, type }) => {
          const purpose = (Object.keys(OTP_TYPE) as TokenPurpose[]).find(
            (candidate) => OTP_TYPE[candidate] === type,
          );
          if (purpose === undefined) return;

          await onTokenIssued({
            purpose,
            email,
            expiresAt: new Date(Date.now() + tokenExpiresInSeconds * 1000),
          });
        },
      }),

      twoFactor({
        // Shown in the authenticator app beside the account. The platform's
        // name, not a configurable one: an issuer a deployment could change
        // would let two installations produce indistinguishable entries.
        issuer: 'One Minhaj',

        totpOptions: {
          digits: secondFactor.totpDigits,
          period: secondFactor.totpPeriodSeconds,
        },

        backupCodeOptions: {
          amount: secondFactor.recoveryCodeCount,
          length: 10,
          // ENCRYPTED, not hashed. Consumption is a compare-and-set over the
          // whole set, which needs the set to be readable by the library; the
          // encryption key is the same versioned secret configuration
          // everything else uses, so a rotation does not invalidate a person's
          // codes. They are never returned by any operation this adapter
          // exposes, and never written anywhere but this row
          // (SECURITY_BASELINE.md §8.2).
          storeBackupCodes: 'encrypted',
        },

        // `otpOptions` is DELIBERATELY ABSENT. Without `sendOTP` the library
        // refuses `method: 'otp'` outright, so an emailed second factor cannot
        // be enabled — a code sent to the mailbox proves the mailbox is
        // readable, which is what an attacker reading the mailbox already has.
        // TOTP plus single-use recovery codes is the accepted V1 mechanism
        // (SECURITY_BASELINE.md §8.2), and SMS is not introduced.

        // Enrolment is NOT complete until a code from the authenticator is
        // verified. Skipping that would mark an account protected by a secret
        // nobody has yet proved they can read.
        skipVerificationOnEnable: false,

        // A credential account always exists in Phase 2, so the library's
        // passwordless allowance would never apply; stated so a future
        // provider cannot quietly enable a factor without a password.
        allowPasswordless: false,

        // ACCOUNT-LEVEL LOCKOUT, and it covers the SIGN-IN path only. The
        // library applies no attempt budget at all to a SIGNED-IN verification
        // — `verifyTwoFactor` returns a no-op `beginAttempt` when a session
        // exists, and neither the lockout nor the per-challenge counter runs.
        // Every application-controlled privileged proof therefore spends the
        // SQL rate limiter before reaching the library (CLAUDE.md §16, §38).
        accountLockout: {
          enabled: true,
          maxFailedAttempts: secondFactor.signInLockout.maxFailedAttempts,
          durationSeconds: secondFactor.signInLockout.durationSeconds,
        },
      }),
    ],
  });
}
