// Marks this module server-only for the Next.js bundler. Every independently
// importable module under `packages/server-core/src/` carries this marker, so
// the boundary does not depend on the fragile assumption that only `index.ts`
// can be reached (ARCHITECTURE.md §6.3 rule 9).
import 'server-only';

/**
 * Logger-boundary sanitisation.
 *
 * SECURITY_BASELINE.md §19.2: "Redaction is configured at the logger level, not
 * left to call sites — a call-site convention will eventually be forgotten, and
 * one omission is a credential leak."
 *
 * Pino's own `redact` takes literal paths, so it only protects shapes
 * enumerated in advance. That is not enough: a secret nested one level deeper
 * than anticipated walks straight through. This module therefore performs a
 * recursive walk of every logged value and redacts by KEY NAME wherever it
 * appears, at any depth, inside arrays as well as objects.
 *
 * Properties this holds, all asserted by test:
 *   - never mutates the caller's value
 *   - terminates on cyclic structures
 *   - bounded in depth and breadth, and NEVER falls back to the raw subtree
 *     when a bound is reached
 *   - preserves non-sensitive fields, so logs stay useful
 */

/**
 * Sensitive field-name families.
 *
 * Matching is on a NORMALISED key — lowercased with separators removed — so
 * `authToken`, `auth_token`, `auth-token` and `AUTH_TOKEN` are one rule rather
 * than four. Each entry is written in whichever form reads most clearly;
 * normalisation makes the spelling irrelevant.
 */
export const redactedFieldNames = Object.freeze([
  // --- Credentials -------------------------------------------------------
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'passwordConfirmation',
  'passphrase',
  'credential',
  'credentials',
  'secret',
  'secrets',
  'clientSecret',
  'privateKey',
  'apiKey',
  'connectionString',
  'databaseUrl',

  // --- This repository's OWN secret environment names ---------------------
  // The family patterns below already cover all three. They are named here as
  // well so Pino's `redact.paths` — the second layer, which takes literal paths
  // and cannot pattern-match — covers the exact variables this repository
  // handles today (`docker/.env`, `.env.example`, the CI credential step).
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'DATABASE_APP_PASSWORD',
  'MSSQL_SA_PASSWORD',
  // Phase 27 — the Donations payment provider's two secrets.
  'DONATIONS_STRIPE_SECRET_KEY',
  'DONATIONS_STRIPE_WEBHOOK_SECRET',

  // --- Tokens ------------------------------------------------------------
  'token',
  'authToken',
  'accessToken',
  'refreshToken',
  'idToken',
  'sessionToken',
  'resetToken',
  'verificationToken',
  'bearerToken',
  'csrf',
  'csrfToken',
  'xsrf',
  'xsrfToken',

  // --- Session and transport ---------------------------------------------
  'authorization',
  'authorisation',
  'cookie',
  'cookies',
  'setCookie',
  'session',
  'sessionId',

  // --- Domain-sensitive (SECURITY_BASELINE.md §19.1, §19.2) --------------
  'questionContent', // Fatwa question content
  'messageContent', // Private message content
  'meetingUrl', // Google Meet / live-class URLs
  'meetingLink',
  'classUrl',
  'classLink',
  'joinUrl',
  'inviteUrl',
  'email',
  'emailAddress',

  // --- Payments (Phase 27; SECURITY_BASELINE.md §14, §19.2) --------------
  // Webhook signatures (the `Stripe-Signature` header normalises to
  // `stripesignature`), the anonymous donation status token, the hosted
  // checkout URL, and every card or bank detail a provider payload or a
  // mistaken call site could carry. The platform never collects card data;
  // these names exist so that a payload it never asked for still cannot reach
  // a log.
  'stripeSignature',
  'signature',
  'statusToken',
  'checkoutUrl',
  'card',
  'cardNumber',
  'pan',
  'cvc',
  'cvv',
  'expiry',
  'iban',
  'billing',

  // --- Whole payloads never logged indiscriminately ----------------------
  'body',
  'requestBody',
  'headers',
]);

/**
 * Parent containers whose named child is sensitive BECAUSE of the parent.
 *
 * `content` alone is far too broad to redact globally — it would gut ordinary
 * logging. But `message.content` is a private message and `question.content` a
 * Fatwa question, both explicitly prohibited by §19.2. Likewise `meeting.url`
 * is a Google Meet link: the approved live-class architecture is unchanged, the
 * URL simply must not reach a log.
 *
 * Parent names match in SINGULAR AND PLURAL. An array of messages is the
 * ordinary shape — `{ messages: [{ content }] }` — and covering only the
 * singular left the common case wide open.
 */
export const sensitiveChildPaths = Object.freeze([
  { parent: 'message', child: 'content' },
  { parent: 'question', child: 'content' },
  { parent: 'fatwa', child: 'content' },
  { parent: 'fatwaQuestion', child: 'content' },
  { parent: 'conversation', child: 'content' },
  { parent: 'meeting', child: 'url' },
  { parent: 'meeting', child: 'link' },
  { parent: 'classSession', child: 'url' },
  { parent: 'classSession', child: 'link' },
  { parent: 'invite', child: 'url' },
]);

/**
 * Key FAMILIES, matched as substrings of the normalised key.
 *
 * The enumerated list above is an exact-match set, and an exact-match set only
 * ever covers the names someone thought of. This repository's own secrets are
 * the proof: `DATABASE_MIGRATION_URL`, `DATABASE_APP_PASSWORD` and
 * `MSSQL_SA_PASSWORD` all normalise to names the list never contained, so every
 * one of them walked through a redactor whose whole purpose was to stop them.
 *
 * These patterns close that class rather than those three names. A secret
 * introduced later — `MSSQL_APP_PASSWORD`, `REPORTING_DATABASE_URL` — is
 * covered on the day it is written, which is the property the exact list
 * cannot have.
 *
 * Each is deliberately narrow enough to name what it catches:
 *   - anything spelled `password` / `passwd` / `pwd` / `passphrase`
 *   - anything spelled `secret` or `credential`
 *   - key material: api/access/secret/private/signing/encryption keys
 *   - connection strings, however spelled
 *   - `Authorization` / `Authorisation` and cookies
 *   - bearer-style tokens, minus the analytics exception below
 *   - a database/engine name paired with url/uri/dsn/connection
 */
const sensitiveKeyPatterns: readonly RegExp[] = Object.freeze([
  /pass(?:word|wd|phrase)/,
  /pwd/,
  /secret/,
  /credential/,
  /(?:api|access|secret|private|signing|encryption|client)key/,
  /(?:connection|conn)(?:string|str)/,
  /authoris|authoriz/,
  /cookie/,
  /(?:database|db|mssql|sqlserver|postgres|postgresql|mysql|mongodb|redis|datasource)[a-z0-9]*(?:url|uri|dsn|connection)/,
  /(?:url|uri|dsn)[a-z0-9]*(?:database|password|secret|credential)/,
]);

/**
 * Key names containing `token` that are MEASUREMENTS, not secrets.
 *
 * `token` has to be a family match — `resetToken`, `magicLinkToken` and every
 * future variant depend on it — but redacting the family wholesale would gut
 * ordinary analytics: `tokenCount`, `inputTokens`, `maxTokens` carry no secret
 * and a log that hides them is worse, not safer.
 *
 * The exception is written to require a QUALIFIER. Bare `token` and bare
 * `tokens` match nothing here, so they stay sensitive; only a name that is
 * explicitly a count, a limit or a tokeniser is let through.
 */
const tokenMeasurementPatterns: readonly RegExp[] = Object.freeze([
  /^(?:max|min|total|input|output|prompt|completion|cached|num|number|avg|average|estimated|remaining|used)tokens?$/,
  /^tokens?(?:count|used|usage|limit|budget|size|length|total|remaining|estimate|estimated|persecond|perminute)$/,
  /^token(?:izer|ize|ized|iser|ise|ised|isation|ization)$/,
]);

/** The placeholder written in place of a redacted value. */
export const redactionPlaceholder = '[redacted]';

/** Marker used when the walk hits its depth or breadth limit. */
export const truncationPlaceholder = '[truncated]';

/** Marker used when a cycle is detected. */
export const cyclePlaceholder = '[circular]';

/** Guard rails, so a hostile or merely huge value cannot stall logging. */
const MAX_DEPTH = 12;
const MAX_KEYS = 200;
const MAX_ARRAY = 200;

/** Normalises a key for comparison: lowercase, separators stripped. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s.]/g, '');
}

/**
 * Singular and plural forms of a normalised name.
 *
 * Deliberately simple: an `s`/`es` suffix and `y` → `ies`. That covers the
 * domain containers which actually occur — `messages`, `questions`,
 * `classSessions`, `meetings` — without pulling in an inflection library for
 * six words.
 */
function nameForms(normalised: string): string[] {
  const forms = new Set([normalised]);

  forms.add(`${normalised}s`);
  forms.add(`${normalised}es`);
  if (normalised.endsWith('y')) forms.add(`${normalised.slice(0, -1)}ies`);
  if (normalised.endsWith('s')) forms.add(normalised.slice(0, -1));
  if (normalised.endsWith('ies')) forms.add(`${normalised.slice(0, -3)}y`);

  return [...forms];
}

const normalisedRedactedNames = new Set(
  redactedFieldNames.flatMap((name) => nameForms(normaliseKey(name))),
);

const normalisedChildPaths = sensitiveChildPaths.map(({ parent, child }) => ({
  parents: new Set(nameForms(normaliseKey(parent))),
  child: normaliseKey(child),
}));

/** Is this key name sensitive on its own, wherever it appears? */
export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);

  if (normalisedRedactedNames.has(normalised)) return true;

  // A measurement named after tokens is not a token. Checked BEFORE the family
  // patterns, so the exception is visibly narrower than the rule it qualifies.
  if (tokenMeasurementPatterns.some((pattern) => pattern.test(normalised))) {
    return false;
  }

  if (normalised.includes('token')) return true;

  return sensitiveKeyPatterns.some((pattern) => pattern.test(normalised));
}

/** Is this key sensitive because of the container it sits in? */
export function isSensitiveChild(parentKey: string | null, key: string): boolean {
  if (parentKey === null) return false;

  const parent = normaliseKey(parentKey);
  const child = normaliseKey(key);

  return normalisedChildPaths.some(
    (pair) => pair.parents.has(parent) && pair.child === child,
  );
}

/* ===========================================================================
 * VALUE-level sanitisation.
 *
 * Key-name redaction protects a secret that arrives under a name someone
 * recognised. It does nothing for the other half of the problem: a secret
 * carried inside an ordinary-looking STRING.
 *
 *   { dsn: 'sqlserver://localhost:14330;user=sa;password=REAL' }
 *   { link: 'https://minhaj.example/reset-password?token=REAL' }
 *   'connect ECONNREFUSED for sqlserver://sa:REAL@db/MinhajPlatform'
 *
 * None of those keys is sensitive; every one of those values is. So strings are
 * sanitised SEMANTICALLY — the credential is removed, and the host, database
 * and route that make the line worth logging are kept.
 *
 * The rule everywhere below is: recognise the secret-bearing shape, remove the
 * secret, keep the diagnostic remainder — and where the shape cannot be parsed
 * confidently, redact the whole thing rather than guess.
 * ========================================================================= */

/** Query/connection parameter names whose VALUE is a credential. */
const sensitiveParameterPattern =
  /pass(?:word|wd|phrase)|^pwd$|secret|credential|token|^code$|^key$|apikey|accesskey|^sig$|signature|^auth$|^jwt$|^otp$|^nonce$|^state$/;

/**
 * Route segments after which the NEXT segment is token material.
 *
 * `/reset-password/<token>` and `/verify-email/<token>` are the emailed-link
 * shapes SECURITY_BASELINE.md §7 classes as protocol-secured — the token IS the
 * authentication, so it must never reach a log, while the route itself is
 * exactly the diagnostic a reader needs.
 */
const tokenBearingRouteSegments = new Set([
  'reset',
  'resetpassword',
  'passwordreset',
  'verify',
  'verifyemail',
  'emailverification',
  'confirm',
  'confirmation',
  'activate',
  'activation',
  'invite',
  'invitation',
  'magic',
  'magiclink',
  'callback',
  'unsubscribe',
  // Phase 27: `/{locale}/donate/status/<token>` carries the anonymous donation
  // status token, a bearer credential; `/c/pay/<session>` is a hosted
  // checkout session.
  'status',
  'pay',
]);

/**
 * Does this look like opaque secret material rather than readable content?
 *
 * Used for path segments and unnamed parameter values, where no name says
 * "secret" and the shape is the only evidence there is.
 *
 * Long hex is treated as opaque outright. Otherwise the test is CHARACTER-CLASS
 * MIXING: a slug is lowercase words and digits, while a generated token mixes
 * upper, lower and digits with no word structure. Requiring all three classes
 * keeps `understanding-the-quran-chapter-1` readable and removes
 * `Kf3xQ9mZ2pLr7TvB1nWs8dYh`.
 */
function looksOpaque(value: string): boolean {
  if (value.length < 24) return false;
  if (/^[0-9a-f]{32,}$/i.test(value)) return true;
  if (!/^[A-Za-z0-9_.~-]+$/.test(value)) return false;

  const classes =
    Number(/[a-z]/.test(value)) +
    Number(/[A-Z]/.test(value)) +
    Number(/[0-9]/.test(value));

  return classes === 3;
}

/** Redacts the values of credential-named parameters in a `URLSearchParams`. */
function sanitiseSearchParams(params: URLSearchParams): void {
  for (const [name, value] of [...params.entries()]) {
    if (sensitiveParameterPattern.test(normaliseKey(name)) || looksOpaque(value)) {
      params.set(name, redactionPlaceholder);
    }
  }
}

/** Redacts token material carried in the PATH rather than the query. */
function sanitisePathname(pathname: string): string {
  const segments = pathname.split('/');

  return segments
    .map((segment, index) => {
      if (segment === '') return segment;

      const previous =
        index > 0 ? normaliseKey(decodeSafely(segments[index - 1] ?? '')) : '';
      if (tokenBearingRouteSegments.has(previous)) return redactionPlaceholder;

      return looksOpaque(decodeSafely(segment)) ? redactionPlaceholder : segment;
    })
    .join('/');
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A `scheme://` value carrying connection PARAMETERS rather than a URL path.
 *
 * This is the shape this repository actually uses:
 *
 *   sqlserver://localhost:14330;database=MinhajPlatform;user=sa;password=X
 *
 * `new URL()` cannot parse it — `14330;database=…` is not a port — so it is
 * handled directly. The host, port and database name are kept because they are
 * what makes a connection failure diagnosable; the password is removed.
 */
function sanitiseSemicolonConnectionUrl(scheme: string, rest: string): string {
  const [authority = '', ...parameters] = rest.split(';');

  const sanitisedParameters = parameters.map((parameter) => {
    const separator = parameter.indexOf('=');
    if (separator === -1) return parameter;

    const name = parameter.slice(0, separator);
    return sensitiveParameterPattern.test(normaliseKey(name))
      ? `${name}=${redactionPlaceholder}`
      : parameter;
  });

  return [`${scheme}://${sanitiseAuthority(authority)}`, ...sanitisedParameters].join(
    ';',
  );
}

/** Removes the password from `user:password@host`, keeping the rest. */
function sanitiseAuthority(authority: string): string {
  const at = authority.lastIndexOf('@');
  if (at === -1) return authority;

  const userinfo = authority.slice(0, at);
  const host = authority.slice(at + 1);
  const colon = userinfo.indexOf(':');

  return colon === -1
    ? `${userinfo}@${host}`
    : `${userinfo.slice(0, colon)}:${redactionPlaceholder}@${host}`;
}

/**
 * Sanitises one `scheme://…` run.
 *
 * FAILS CLOSED: a value that announces itself as a URL and then cannot be
 * parsed is redacted entirely. Passing an unparseable secret-shaped string
 * through unchanged is the one outcome this must never produce.
 */
function sanitiseUrlLike(raw: string): string {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([\s\S]*)$/.exec(raw);
  if (match === null) return redactionPlaceholder;

  const [, scheme = '', rest = ''] = match;

  // ADO/JDBC-style parameters. Detected before URL parsing because these values
  // are not URLs and must not be judged as if they were. The semicolon must be
  // in the authority-shaped prefix: ordinary URLs may legally carry matrix
  // parameters in a path, and treating those as connection strings would skip
  // their query and fragment sanitisation.
  const semicolonAt = rest.indexOf(';');
  const urlSyntaxAt = rest.search(/[/?#]/);
  if (
    semicolonAt !== -1 &&
    (urlSyntaxAt === -1 || semicolonAt < urlSyntaxAt) &&
    /;[^;]*=/.test(rest)
  ) {
    return sanitiseSemicolonConnectionUrl(scheme, rest);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return redactionPlaceholder;
  }

  if (url.password !== '') url.password = redactionPlaceholder;

  sanitiseSearchParams(url.searchParams);
  url.pathname = sanitisePathname(url.pathname);

  if (url.hash.length > 1) {
    const fragment = url.hash.slice(1);

    if (fragment.includes('=')) {
      const params = new URLSearchParams(fragment);
      sanitiseSearchParams(params);
      url.hash = `#${params.toString()}`;
    } else if (looksOpaque(decodeSafely(fragment))) {
      url.hash = `#${redactionPlaceholder}`;
    }
  }

  // `URL` percent-encodes the placeholder's brackets on the way out. Restoring
  // them keeps the marker recognisable to a human reading the log.
  return url.toString().replaceAll('%5Bredacted%5D', redactionPlaceholder);
}

/** `scheme://` runs embedded anywhere in a larger string. */
const embeddedUrlPattern = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>`\\]+/g;

/**
 * `name=value` / `name: value` secrets in otherwise free-form text.
 *
 * The everyday shape of a leaked credential outside a URL — a connection string
 * fragment, a CLI invocation echoed into a message, a serialised config line.
 */
const inlineSecretPattern = new RegExp(
  String.raw`((?:^|[\s,;{(\[])(?:[A-Za-z0-9_.-]*[_.-])?` +
    String.raw`(?:password|passwd|pwd|passphrase|secret|token|apikey|api[_-]?key|access[_-]?key|authorization|authorisation|credential)` +
    // The qualified-name prefix above is what catches this repository's real
    // variables: `MSSQL_SA_PASSWORD=…` and `DATABASE_APP_PASSWORD=…` do not
    // BEGIN with a sensitive word, and an unqualified alternation matched
    // neither of them.
    String.raw`\s*[=:]\s*)(["']?)(?!\[redacted\])([^\s,;)}\]"']+)\2`,
  'gi',
);

/**
 * Payment-provider credentials recognisable by SHAPE alone: Stripe secret and
 * restricted keys (`sk_…`/`rk_…`, and the CLI sandbox's `rkcs_…`; live, test
 * or the simulator's fixture prefix) and webhook signing secrets (`whsec_…`). They need no name beside
 * them to be a secret, so they are removed wherever they occur in a string.
 */
const providerCredentialPattern =
  /\b(?:(?:sk|rk|rkcs)_(?:live|test|fixture)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_+/=]+)/g;

/** `name=value` pairs of a query string, sanitised WITHOUT re-encoding. */
const queryParameterPattern = /([^=&#?]+)=([^&#]*)/g;

function sanitiseQueryString(query: string): string {
  return query.replace(queryParameterPattern, (whole, name: string, value: string) =>
    sensitiveParameterPattern.test(normaliseKey(decodeSafely(name))) ||
    looksOpaque(decodeSafely(value))
      ? `${name}=${redactionPlaceholder}`
      : whole,
  );
}

/**
 * A relative reference — `/en/verify-email/<token>?x=y#z`.
 *
 * Routes reach the logger far more often as relative paths than as absolute
 * URLs: `route` is allowlisted child-logger context, and Next.js reports the
 * matched path, not the origin. A token in `/en/reset-password/<token>` is
 * exactly as exposed as one in the absolute form, and the scheme-anchored URL
 * handling above cannot see it.
 *
 * Rewritten by parts rather than through `URL`, which would percent-encode a
 * route pattern like `/en/quran/[surah]` and change a value that carries no
 * secret at all.
 */
function sanitiseRelativeReference(value: string): string {
  const hashAt = value.indexOf('#');
  const beforeHash = hashAt === -1 ? value : value.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : value.slice(hashAt + 1);

  const queryAt = beforeHash.indexOf('?');
  const pathname = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  const safeHash = hash.includes('=')
    ? sanitiseQueryString(hash)
    : looksOpaque(decodeSafely(hash))
      ? redactionPlaceholder
      : hash;

  return (
    sanitisePathname(pathname) +
    (queryAt === -1 ? '' : `?${sanitiseQueryString(query)}`) +
    (hashAt === -1 ? '' : `#${safeHash}`)
  );
}

/** A whole-value relative reference: `/…`, with no embedded whitespace. */
const relativeReferencePattern = /^\/[^\s]*$/;

/**
 * Returns a log-safe version of a string value.
 *
 * Ordinary strings come back UNCHANGED. Nothing here redacts on suspicion
 * alone: a value is only rewritten when it carries a recognised secret-bearing
 * shape, so route paths, identifiers, messages and slugs survive intact and the
 * log stays worth reading.
 */
export function sanitiseString(value: string): string {
  const withoutCredentials = value.replace(
    providerCredentialPattern,
    redactionPlaceholder,
  );
  if (relativeReferencePattern.test(withoutCredentials)) {
    return sanitiseRelativeReference(withoutCredentials);
  }

  const withSafeUrls = withoutCredentials.replace(embeddedUrlPattern, (url) =>
    sanitiseUrlLike(url),
  );

  return withSafeUrls.replace(
    inlineSecretPattern,
    (_whole, prefix: string, quote: string) =>
      `${prefix}${quote}${redactionPlaceholder}${quote}`,
  );
}

/**
 * A safe representation of an Error.
 *
 * Errors need explicit handling: `message` and `stack` are non-enumerable, so a
 * generic object walk misses them entirely, and both routinely carry the very
 * value that must not be logged — `new Error(\`bad token ${token}\`)` is an
 * everyday shape.
 *
 * Name and code are preserved because they are what makes an error log useful;
 * message and stack are redacted because they cannot be trusted not to contain
 * a secret. The original Error is never mutated.
 */
function safeError(
  error: Error,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const code = (error as { code?: unknown }).code;
  const cause = (error as { cause?: unknown }).cause;

  return {
    name: error.name,
    // Redacted rather than omitted, so a reader can see that detail was
    // withheld instead of wondering whether the error carried none.
    //
    // WHOLLY redacted, not sanitised. An Error message is arbitrary prose from
    // any library in the tree, and the secret in it need not take a shape
    // anything can recognise — `Login failed for user 'sa' (Hunter2)` has no
    // URL and no `key=value`. Every other value in this module keeps its
    // diagnostic remainder because its shape is known; here it is not, so this
    // one fails all the way closed and `name`, `code` and the cause chain carry
    // the diagnosis instead.
    message: redactionPlaceholder,
    stack: redactionPlaceholder,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    // `cause` is where a driver puts the underlying failure, and it is
    // non-enumerable-adjacent enough that a plain walk misses it. Recursing
    // through `walk` keeps the chain visible while every link is sanitised by
    // the same rules — including the depth and cycle guards, so a self-
    // referencing cause cannot loop.
    ...(cause === undefined
      ? {}
      : {
          cause:
            typeof cause === 'string'
              ? redactionPlaceholder
              : walk(cause, 'cause', depth + 1, seen),
        }),
  };
}

/**
 * Errors frequently cross process/JSON boundaries as plain objects. They are
 * no longer `instanceof Error`, but `message` and `stack` remain arbitrary
 * prose with the same leakage risk, so recognise the conventional shape.
 */
function isErrorShaped(
  value: Record<string, unknown>,
  parentKey: string | null,
): boolean {
  const parent = parentKey === null ? '' : normaliseKey(parentKey);
  const name = value['name'];
  const hasErrorDetail =
    typeof value['message'] === 'string' || typeof value['stack'] === 'string';

  return (
    hasErrorDetail &&
    (parent === 'err' ||
      parent === 'error' ||
      parent === 'cause' ||
      typeof value['stack'] === 'string' ||
      (typeof name === 'string' && /error$/i.test(name)))
  );
}

/**
 * Returns a redacted DEEP COPY of `value`.
 *
 * The original is never touched — a logger that mutated its caller's data would
 * be a worse bug than the one it prevents.
 */
export function sanitiseForLog(value: unknown): unknown {
  return walk(value, null, 0, new WeakSet<object>());
}

function walk(
  value: unknown,
  parentKey: string | null,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  // A secret inside a string is judged by its SHAPE, wherever the string sits:
  // top level, nested, inside an array, or under a key nobody classified.
  if (typeof value === 'string') return sanitiseString(value);

  if (value === null || typeof value !== 'object') return value;

  // Fail SAFE: at the limit, emit the marker. Returning the original subtree
  // here would turn a depth guard into a redaction bypass.
  if (depth >= MAX_DEPTH) return truncationPlaceholder;

  if (seen.has(value as object)) return cyclePlaceholder;
  seen.add(value as object);

  try {
    if (value instanceof Error) return safeError(value, depth, seen);
    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_ARRAY);
      const output: unknown[] = [];

      for (let index = 0; index < limit; index += 1) {
        // An element inherits the ARRAY's key, so `messages[0].content` is
        // judged exactly as `message.content` would be. Losing the parent here
        // is how every plural container leaked.
        output.push(walk(value[index], parentKey, depth + 1, seen));
      }

      if (value.length > limit) output.push(truncationPlaceholder);
      return output;
    }

    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const errorShaped = isErrorShaped(source, parentKey);
    let count = 0;

    for (const key of Object.keys(source)) {
      if (count >= MAX_KEYS) {
        output['...'] = truncationPlaceholder;
        break;
      }
      count += 1;

      const normalisedKey = normaliseKey(key);
      if (errorShaped && (normalisedKey === 'message' || normalisedKey === 'stack')) {
        output[key] = redactionPlaceholder;
        continue;
      }

      if (errorShaped && normalisedKey === 'cause' && typeof source[key] === 'string') {
        output[key] = redactionPlaceholder;
        continue;
      }

      if (isSensitiveKey(key) || isSensitiveChild(parentKey, key)) {
        output[key] = redactionPlaceholder;
        continue;
      }

      output[key] = walk(source[key], key, depth + 1, seen);
    }

    return output;
  } finally {
    // Leaving this node: it is no longer on the current path, so a sibling
    // referencing the same object renders rather than being called a cycle.
    seen.delete(value as object);
  }
}

/**
 * Contextual metadata a child logger may carry.
 *
 * An ALLOWLIST, deliberately. `withContext` bindings are attached to every
 * subsequent line, so a sensitive value smuggled in under a bland key name
 * would leak repeatedly rather than once. Only fields useful for correlation
 * and carrying no personal or secret data are permitted; anything else is
 * redacted.
 */
export const safeContextFields = Object.freeze([
  'requestId',
  'traceId',
  'spanId',
  'correlationId',
  'route',
  'method',
  'statusCode',
  'durationMs',
  'component',
  'operation',
  'attempt',
  'locale',
  'env',
]);

const normalisedSafeContextFields = new Set(safeContextFields.map(normaliseKey));

/** Is this key permitted as child-logger correlation context? */
export function isSafeContextField(key: string): boolean {
  return normalisedSafeContextFields.has(normaliseKey(key));
}

/**
 * Pino `redact.paths`, retained as a SECOND layer beneath the recursive
 * sanitiser. Belt and braces: if a call site ever reaches Pino without passing
 * through `sanitiseForLog`, the common shapes are still covered.
 */
export function buildRedactionPaths(): string[] {
  const roots = ['', 'req.', 'request.', 'res.', 'response.', 'user.', 'context.', '*.'];
  const paths = new Set<string>();

  for (const root of roots) {
    for (const field of redactedFieldNames) {
      paths.add(`${root}${field}`);
    }
  }

  paths.add('req.body');
  paths.add('req.headers');
  paths.add('request.body');
  paths.add('request.headers');
  paths.add('body');
  paths.add('headers');

  return [...paths];
}
