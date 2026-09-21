import { correspondenceRetentionDaysSchema } from '../editorial/values.ts';
/**
 * Server environment SCHEMA and PARSER — implementation, not public API.
 *
 * TWO INDEPENDENT DEFENCES, and it needs both.
 *
 * 1. THE MARKER. `import 'server-only'` resolves to a module that throws under
 *    any resolver not applying the `react-server` condition — which is every
 *    client bundler. The marker travels with the FILE, so it holds however the
 *    module is reached: package subpath, relative source path, or tsconfig
 *    alias. No `exports` map can offer that, because a source path never
 *    consults one.
 *
 * 2. NO PUBLIC SPECIFIER. The `exports` map of `@minhaj/contracts` does not
 *    name this file, so nothing outside the package can import it by package
 *    specifier at all. The one supported route is
 *    `@minhaj/contracts/env/server`.
 *
 * Review #3 defeated the previous arrangement because this module was BOTH
 * publicly exported (as `@minhaj/contracts/env/schema`) AND marker-free. A
 * Client Component imported it and the production build succeeded, shipping
 * `process.env` parsing to the browser.
 *
 * WHY THE MARKER IS SAFE HERE NOW
 * -------------------------------
 * The marker was originally omitted so that `apps/web/scripts/start.mjs` could
 * validate configuration in PLAIN NODE, before Next exists in the process.
 * That constraint is real, but omitting the marker was the wrong way to meet
 * it: it traded a build-enforced boundary for a convention.
 *
 * The wrapper now runs itself under `--conditions=react-server`, the same
 * condition Next applies to the Server Component graph. `server-only` then
 * resolves to its empty module and the wrapper imports the ordinary, marked,
 * PUBLIC entry point. One schema, one marker, no unguarded module.
 *
 * `scripts/architecture/client-graph.mjs` additionally prohibits this path from
 * any client graph by resolved SOURCE PATH, so the architecture gate reports it
 * even where a bundler would not.
 */

import 'server-only';

import { z } from 'zod';

import {
  applicationOriginSchema,
  publicIndexingEnabledSchema,
} from './prerender-build.ts';
import { logLevelSchema, nodeEnvSchema, parseEnvironment } from './shared.ts';

/**
 * Server environment schema for the capabilities delivered so far.
 *
 * Deliberately minimal. Database, authentication, OAuth, email, storage and
 * payment configuration belong to the phases that introduce them
 * (DELIVERY_PLAN.md); inventing their variables now would produce configuration
 * for systems that do not exist and credentials nobody has issued.
 *
 * Secret-bearing variables live only here, never in the client schema. Synthetic
 * development defaults are rejected in production below.
 */
export const serverEnvSchema = z.object({
  CORRESPONDENCE_RETENTION_DAYS: correspondenceRetentionDaysSchema,
  NODE_ENV: nodeEnvSchema.default('development'),

  /** Port the web process listens on. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Pino level (TECH_STACK.md §12). */
  LOG_LEVEL: logLevelSchema.default('info'),

  // -------------------------------------------------------------------------
  // Phase 2 — Identity & Access
  // -------------------------------------------------------------------------

  /**
   * Canonical application origin, used to build emailed links and to bound
   * what the authentication library will redirect to.
   */
  AUTH_BASE_URL: applicationOriginSchema,

  /**
   * Versioned signing and encryption secrets, newest first.
   *
   * `<version>:<value>,<version>:<value>` — the head encrypts, the tail
   * decrypts material written before a rotation. This is Better Auth 1.7.4's
   * own supported rotation mechanism; no application-owned keyring is built
   * on top of it.
   *
   * A development default exists so a fresh checkout runs. It is a SYNTHETIC
   * sentinel and is rejected outright in production below, because a shared
   * default secret in a deployed environment is not a secret.
   */
  AUTH_SECRETS: z
    .string()
    .min(1)
    .default('1:development-only-auth-secret-not-for-deployment'),

  /**
   * The restricted Resend sending credential.
   *
   * CAPABILITY-CONDITIONAL, and deliberately so. Real sending is enabled only
   * where this exists; a build, a test run or CI must not require a live
   * credential to be considered configured. What its absence must never do is
   * silently turn a real send into a pretend one — the provider adapter
   * reports itself unavailable and refuses rather than returning success.
   */
  RESEND_API_KEY: z.string().min(1).optional(),

  /** Sender identity for transactional mail. Non-secret. */
  EMAIL_FROM_ADDRESS: z.string().email().default('no-reply@localhost.invalid'),
  EMAIL_FROM_NAME: z.string().min(1).default('Minhaj'),

  /**
   * Resend webhook signing secret.
   *
   * CAPABILITY-CONDITIONAL like the API key. Its absence does not fail a build
   * and does not reopen the sending gate — but a webhook request arriving
   * while it is absent is REFUSED, never accepted unverified
   * (SECURITY_BASELINE.md §7.2).
   */
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),

  /**
   * HMAC key for rate-limit subjects.
   *
   * Subjects are addresses and client IPs. Keying them keeps personal data out
   * of an infrastructure table that exists only to count requests, and a
   * KEYED digest — rather than a bare hash — is what stops the table being
   * reversed by dictionary (SECURITY_BASELINE.md §19.2).
   */
  RATE_LIMIT_DIGEST_KEY: z
    .string()
    .min(16)
    .default('development-only-rate-limit-digest-key'),
  RATE_LIMIT_DIGEST_KEY_VERSION: z.coerce.number().int().min(1).default(1),

  /** HMAC key for recipient digests in delivery and suppression state. */
  EMAIL_DIGEST_KEY: z.string().min(16).default('development-only-email-digest-key'),
  EMAIL_DIGEST_KEY_VERSION: z.coerce.number().int().min(1).default(1),

  // -------------------------------------------------------------------------
  // Phase 4 — Public shell
  // -------------------------------------------------------------------------

  /**
   * Whether this deployment may be indexed by search engines at all.
   *
   * FAIL CLOSED, and deliberately so. While the platform runs on a
   * developer-controlled pre-adoption origin it must not compete with or
   * impersonate the official organisation site, so the entire site is
   * `noindex`, the crawler is disallowed, no sitemap is advertised and no
   * canonical URL points at an official origin (ROUTE_MAP.md §9.5,
   * PRODUCT_SCOPE.md, *Product status and acceptance*). Defaulting to `false`
   * means a deployment that forgets to configure anything is non-indexable,
   * which is the safe direction: the failure of an indexing switch must be
   * invisibility, never accidental publication.
   *
   * AN ENVIRONMENT AND LAUNCH-STATE CONTROL, NOT A PRODUCT MODE. It changes no
   * route, no capability and no rendering. The application is not reduced in
   * any way by being non-indexable, and there is no `DemoMode` anywhere in this
   * codebase.
   *
   * SERVER-ONLY. It is not `NEXT_PUBLIC_`, because indexing posture is decided
   * where robots and metadata are emitted and nothing in the browser has an
   * opinion about it.
   *
   * ONE VARIABLE, NOT A FEATURE-FLAG PLATFORM. It answers one question that has
   * a documented owner and a documented launch transition (DELIVERY_PLAN.md,
   * Phase 35); it is not a general runtime toggling facility, and nothing else
   * is switched through it.
   */
  PUBLIC_INDEXING_ENABLED: publicIndexingEnabledSchema,

  /**
   * Whether a reverse proxy in front of this process sets the forwarding
   * headers.
   *
   * `X-Forwarded-For` is CLIENT-SUPPLIED unless something trustworthy
   * overwrites it, and the per-client rate-limit budget is keyed on it — so a
   * process that reads it unconditionally has a budget any caller can reset by
   * changing a header. Off by default, and turned on only where the
   * deployment genuinely terminates at NGINX (ARCHITECTURE.md §10).
   *
   * The per-ACCOUNT budget never depends on this and is unaffected either way.
   */
  TRUST_PROXY_HEADERS: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates the server environment, throwing a redacted error on failure.
 *
 * Accepts the source record so tests can validate without mutating the real
 * process environment.
 */
export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const parsed = parseEnvironment(serverEnvSchema, source, 'server');

  // A development default is a convenience in development and a vulnerability
  // anywhere else. Every secret-bearing value with a default is rejected in
  // production rather than quietly shipping the value this repository
  // publishes (SECURITY_BASELINE.md §18.1).
  if (parsed.NODE_ENV === 'production') {
    const defaulted = DEVELOPMENT_DEFAULTS.filter(
      (name) => String(parsed[name]) === developmentDefaultOf(name),
    );

    if (defaulted.length > 0) {
      throw new Error(
        [
          'Invalid server environment configuration.',
          ...defaulted.map((name) => `  - ${name}: must be set in production`),
          '',
          'Values are never printed, only variable names.',
        ].join('\n'),
      );
    }
  }

  return parsed;
}

/**
 * Variables whose development default must never reach production.
 *
 * Asserted by test against the schema, so a future secret that acquires a
 * default cannot skip this check by being forgotten here.
 */
const DEVELOPMENT_DEFAULTS = [
  'AUTH_SECRETS',
  'RATE_LIMIT_DIGEST_KEY',
  'EMAIL_DIGEST_KEY',
] as const satisfies readonly (keyof ServerEnv)[];

/**
 * The default the SCHEMA declares, read back off the schema itself.
 *
 * The comparison was previously a `startsWith('development-only')` prefix test,
 * which silently exempted the one variable whose default cannot begin with that
 * marker: `AUTH_SECRETS` is `<version>:<value>`, so its default starts with
 * `1:` and the production guard passed it. Asking the schema what its own
 * default is removes the class of mistake rather than the instance — a future
 * default in any shape at all is still recognised.
 *
 * Returns `null` for a field with no default, which can never equal a parsed
 * string and therefore never triggers the rejection.
 */
function developmentDefaultOf(
  name: (typeof DEVELOPMENT_DEFAULTS)[number],
): string | null {
  const field: unknown = serverEnvSchema.shape[name];
  const value = (field as { def?: { defaultValue?: unknown } }).def?.defaultValue;

  return typeof value === 'string' ? value : null;
}

export { DEVELOPMENT_DEFAULTS, developmentDefaultOf };

/**
 * Names that must never appear on the server schema, because a `NEXT_PUBLIC_`
 * variable is shipped to the browser and therefore is not a place for a secret
 * (SECURITY_BASELINE.md §18.1).
 *
 * Asserted by test rather than left as a comment.
 */
export const serverEnvKeys = Object.freeze(Object.keys(serverEnvSchema.shape));
