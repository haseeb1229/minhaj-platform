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
  return normalisedRedactedNames.has(normaliseKey(key));
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
function safeError(error: Error): Record<string, unknown> {
  const code = (error as { code?: unknown }).code;

  return {
    name: error.name,
    // Redacted rather than omitted, so a reader can see that detail was
    // withheld instead of wondering whether the error carried none.
    message: redactionPlaceholder,
    stack: redactionPlaceholder,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
  };
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
  if (value === null || typeof value !== 'object') return value;

  // Fail SAFE: at the limit, emit the marker. Returning the original subtree
  // here would turn a depth guard into a redaction bypass.
  if (depth >= MAX_DEPTH) return truncationPlaceholder;

  if (seen.has(value as object)) return cyclePlaceholder;
  seen.add(value as object);

  try {
    if (value instanceof Error) return safeError(value);
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
    let count = 0;

    for (const key of Object.keys(source)) {
      if (count >= MAX_KEYS) {
        output['...'] = truncationPlaceholder;
        break;
      }
      count += 1;

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
