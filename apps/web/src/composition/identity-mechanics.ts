import 'server-only';

import type { AuthMechanicsConfiguration } from '@minhaj/database';
import type { ServerEnv } from '@minhaj/contracts/env/server';
import type { RateLimiterPort } from '@minhaj/contracts/platform';

/**
 * The authentication mechanics' configuration — ONE definition for both
 * processes (Phase 25).
 *
 * WHY IT IS ITS OWN MODULE. The web process and the realtime process must
 * verify a session cookie IDENTICALLY: the same secrets, the same cookie name
 * and `Secure` rule, the same expiry and refresh policy. Two copies of this
 * object would be two places for that to drift, and a drifted session check is
 * a security defect rather than a style one. So the web `identityRuntime` and
 * the realtime composition root both build their adapter from this function.
 *
 * NODE-RUNNABLE. Imported by the realtime process outside the Next bundler, so
 * it names packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** Parses `<version>:<value>,<version>:<value>`, newest first. */
export function parseAuthSecrets(raw: string): { version: number; value: string }[] {
  const secrets = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator === -1) return null;

      const version = Number.parseInt(entry.slice(0, separator), 10);
      const value = entry.slice(separator + 1);
      if (!Number.isInteger(version) || version < 1 || value === '') return null;

      return { version, value };
    })
    .filter((entry): entry is { version: number; value: string } => entry !== null);

  if (secrets.length === 0) {
    // Fail closed, and name the variable without printing it. An auth instance
    // with no secret would sign and encrypt with nothing.
    throw new Error('AUTH_SECRETS contains no usable `<version>:<value>` entry.');
  }

  return secrets;
}

/** The rate limiter's digest configuration, from the environment. */
export function limiterConfigurationOf(environment: ServerEnv): {
  readonly digestKey: string;
  readonly digestKeyVersion: number;
} {
  return {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
}

export function authMechanicsConfiguration(
  environment: ServerEnv,
  rateLimiter: RateLimiterPort,
): AuthMechanicsConfiguration {
  return {
    baseUrl: environment.AUTH_BASE_URL,
    trustedOrigins: [environment.AUTH_BASE_URL],
    secrets: parseAuthSecrets(environment.AUTH_SECRETS),

    // DERIVED FROM THE ORIGIN, not from `NODE_ENV`.
    //
    // `Secure` is a statement about the SCHEME a cookie may travel over, so
    // the scheme is what should decide it. Keying it on `NODE_ENV` was wrong
    // in both directions:
    //
    //   - a staging or preview deployment served over HTTPS with
    //     `NODE_ENV` unset would issue session cookies WITHOUT `Secure`, and a
    //     single plain-HTTP request to that host would carry the session in
    //     clear — a real weakness, and an invisible one;
    //   - a `NODE_ENV=production` process behind a plain-HTTP origin would
    //     issue `Secure` cookies the browser stores and then never sends back,
    //     so signing in appears to work and the next page load is signed out.
    //
    // The second is not hypothetical: it is exactly what the browser suite hit.
    // `AUTH_BASE_URL` is the canonical origin the deployment declares, and
    // reading the scheme off it makes the cookie's guarantee match the
    // transport that actually carries it (SECURITY_BASELINE.md §2.3).
    useSecureCookies: new URL(environment.AUTH_BASE_URL).protocol === 'https:',

    passwordLength: { min: 12, max: 128 },
    session: { expiresInSeconds: 604_800, updateAgeSeconds: 86_400 },
    tokenExpiresInSeconds: 3_600,
    tokenAllowedAttempts: 5,
    rateLimiter,

    // PRIVILEGED SECOND-FACTOR policy. Ten single-use recovery codes, the
    // standard six-digit thirty-second TOTP every authenticator app supports,
    // and a sign-in lockout after ten consecutive failures across challenges
    // and factors. The signed-in path has no library budget at all, which is
    // why Identity spends the SQL limiter on every privileged proof.
    secondFactor: {
      recoveryCodeCount: 10,
      totpDigits: 6,
      totpPeriodSeconds: 30,
      signInLockout: { maxFailedAttempts: 10, durationSeconds: 900 },
    },

    // The adapter reports that a token exists; it does not decide what to do
    // about it. Identity enqueues its own delivery when it issues the token,
    // so this hook stays empty rather than becoming a second path that could
    // enqueue a duplicate.
    onTokenIssued: async () => undefined,
  };
}
