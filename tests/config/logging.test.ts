import { describe, expect, it } from 'vitest';

import {
  buildRedactionPaths,
  cyclePlaceholder,
  isSafeContextField,
  isSensitiveKey,
  redactedFieldNames,
  redactionPlaceholder,
  safeContextFields,
  sanitiseForLog,
  truncationPlaceholder,
} from '../../packages/server-core/src/logging/redaction.ts';
import {
  loggerOptions,
  sanitiseLogArguments,
  withContext,
} from '../../packages/server-core/src/logging/logger.ts';

/**
 * Logging security (TECH_STACK.md §12, SECURITY_BASELINE.md §19.2).
 *
 * "Redaction is configured at the logger level, not left to call sites — a
 * call-site convention will eventually be forgotten, and one omission is a
 * credential leak."
 *
 * The decisive tests capture ACTUAL emitted Pino output and assert that a
 * unique marker appears nowhere in the serialized line. Asserting on the
 * sanitiser's return value alone would not prove what reaches the log stream.
 */

/** Builds a logger writing into an array, so emitted JSON is inspectable. */
async function captureLogger() {
  const lines: string[] = [];
  const { pino } = await import('pino');
  const logger = pino(loggerOptions('trace', 'test'), {
    write: (line: string) => lines.push(line),
  });

  return { logger, lines };
}

/**
 * Every leak reproduced by the second independent review, in the exact shape
 * reported. Each pairs a realistic structure with a unique marker.
 *
 * Note the SINGULAR and PLURAL containers are separate cases: a previous test
 * named "messages" while passing a singular `message` object, so the plural
 * form — the ordinary shape in real code — was never actually exercised.
 */
const LEAK_CASES: readonly (readonly [string, unknown, string])[] = [
  // --- Plural domain containers ------------------------------------------
  [
    'messages[0].content',
    { messages: [{ content: 'LEAK_MESSAGES_ARRAY' }] },
    'LEAK_MESSAGES_ARRAY',
  ],
  [
    'message.content',
    { message: { content: 'LEAK_MESSAGE_SINGULAR' } },
    'LEAK_MESSAGE_SINGULAR',
  ],
  [
    'questions[0].content',
    { questions: [{ content: 'LEAK_QUESTIONS_ARRAY' }] },
    'LEAK_QUESTIONS_ARRAY',
  ],
  [
    'question.content',
    { question: { content: 'LEAK_QUESTION_SINGULAR' } },
    'LEAK_QUESTION_SINGULAR',
  ],
  [
    'classSessions[0].url',
    { classSessions: [{ url: 'https://meet.google.com/LEAK_CLASS_SESSIONS' }] },
    'LEAK_CLASS_SESSIONS',
  ],
  [
    'meetings[0].url',
    { meetings: [{ url: 'https://meet.google.com/LEAK_MEETINGS_ARRAY' }] },
    'LEAK_MEETINGS_ARRAY',
  ],
  [
    'meeting.url',
    { meeting: { url: 'https://meet.google.com/LEAK_MEETING_SINGULAR' } },
    'LEAK_MEETING_SINGULAR',
  ],
  [
    'fatwaQuestion.content',
    { fatwaQuestion: { content: 'LEAK_FATWA_QUESTION' } },
    'LEAK_FATWA_QUESTION',
  ],

  // --- Direct sensitive fields -------------------------------------------
  [
    'meetingUrl',
    { meetingUrl: 'https://meet.google.com/LEAK_MEETING_URL' },
    'LEAK_MEETING_URL',
  ],
  ['classUrl', { classUrl: 'https://meet.google.com/LEAK_CLASS_URL' }, 'LEAK_CLASS_URL'],
  ['authToken', { authToken: 'LEAK_AUTH_TOKEN' }, 'LEAK_AUTH_TOKEN'],
  ['accessToken', { accessToken: 'LEAK_ACCESS_TOKEN' }, 'LEAK_ACCESS_TOKEN'],
  ['refreshToken', { refreshToken: 'LEAK_REFRESH_TOKEN' }, 'LEAK_REFRESH_TOKEN'],
  ['idToken', { idToken: 'LEAK_ID_TOKEN' }, 'LEAK_ID_TOKEN'],
  ['csrf', { csrf: 'LEAK_CSRF' }, 'LEAK_CSRF'],
  ['csrfToken', { csrfToken: 'LEAK_CSRF_TOKEN' }, 'LEAK_CSRF_TOKEN'],
  ['csrf_token', { csrf_token: 'LEAK_CSRF_SNAKE' }, 'LEAK_CSRF_SNAKE'],

  // --- Nested request / credential structures ----------------------------
  [
    'request.headers.authorization',
    { request: { headers: { authorization: 'Bearer LEAK_AUTHORIZATION' } } },
    'LEAK_AUTHORIZATION',
  ],
  [
    'payload.credentials.password',
    { payload: { credentials: { password: 'LEAK_PASSWORD' } } },
    'LEAK_PASSWORD',
  ],
  [
    'cookies.session',
    { cookies: { session: 'LEAK_COOKIE_SESSION' } },
    'LEAK_COOKIE_SESSION',
  ],
  ['secrets', { secrets: { anything: 'LEAK_SECRETS' } }, 'LEAK_SECRETS'],
  ['session', { session: { id: 'LEAK_SESSION' } }, 'LEAK_SESSION'],

  // --- PII ----------------------------------------------------------------
  [
    'req.user.email',
    { req: { user: { email: 'LEAK_REQ_EMAIL@example.com' } } },
    'LEAK_REQ_EMAIL',
  ],
  [
    'actor.profile.email',
    { actor: { profile: { email: 'LEAK_ACTOR_EMAIL@example.com' } } },
    'LEAK_ACTOR_EMAIL',
  ],
];

describe('L1 — every leak reported by independent review is closed', () => {
  for (const [description, payload, marker] of LEAK_CASES) {
    it(`never emits ${description}`, async () => {
      const { logger, lines } = await captureLogger();

      logger.info(payload as Record<string, unknown>, 'adversarial payload');

      expect(lines).toHaveLength(1);
      expect(lines[0], `${marker} leaked into the emitted log line`).not.toContain(
        marker,
      );
    });
  }

  it('emits none of the markers when every case is logged at once', async () => {
    const { logger, lines } = await captureLogger();
    const combined = Object.assign({}, ...LEAK_CASES.map(([, payload]) => payload));

    logger.error(combined, 'everything at once');

    for (const [, , marker] of LEAK_CASES) {
      expect(lines[0], `${marker} leaked`).not.toContain(marker);
    }
  });
});

describe('L1 — Error objects cannot leak through message or stack', () => {
  it('never emits a secret contained in an Error message', async () => {
    const { logger, lines } = await captureLogger();

    logger.error(
      { err: new Error('failed with token LEAK_ERROR_MESSAGE') },
      'error logged',
    );

    expect(lines[0]).not.toContain('LEAK_ERROR_MESSAGE');
  });

  it('never emits a secret contained in an Error stack', async () => {
    const { logger, lines } = await captureLogger();
    const error = new Error('boom');
    error.stack = `Error: boom\n    at secretFn (LEAK_ERROR_STACK:1:1)`;

    logger.error({ err: error }, 'error logged');

    expect(lines[0]).not.toContain('LEAK_ERROR_STACK');
  });

  it('never emits data attached to an Error as a property', async () => {
    const { logger, lines } = await captureLogger();
    const error = Object.assign(new Error('boom'), { token: 'LEAK_ERROR_PROPERTY' });

    logger.error({ err: error }, 'error logged');

    expect(lines[0]).not.toContain('LEAK_ERROR_PROPERTY');
  });

  it('still preserves the error name and code, which make a log useful', () => {
    const error = Object.assign(new TypeError('boom'), { code: 'ERR_EXAMPLE' });

    const result = sanitiseForLog({ err: error }) as { err: Record<string, unknown> };

    expect(result.err['name']).toBe('TypeError');
    expect(result.err['code']).toBe('ERR_EXAMPLE');
    expect(result.err['message']).toBe(redactionPlaceholder);
  });

  it('does not mutate the original Error', () => {
    const error = new Error('original message');
    const originalStack = error.stack;

    sanitiseForLog({ err: error });

    expect(error.message).toBe('original message');
    expect(error.stack).toBe(originalStack);
  });
});

describe('L1 — withContext cannot carry a sensitive field', () => {
  it('redacts a sensitive key passed as correlation context', async () => {
    const { logger, lines } = await captureLogger();

    const child = withContext(logger, {
      requestId: 'r-1',
      authToken: 'LEAK_CONTEXT_AUTH_TOKEN',
    });

    child.info('with context');

    expect(lines[0]).toContain('r-1');
    expect(lines[0]).not.toContain('LEAK_CONTEXT_AUTH_TOKEN');
  });

  it('redacts an unrecognised field, not merely a known-sensitive one', async () => {
    // The allowlist is the defence: a caller cannot invent a bland key name and
    // have it pass through unexamined.
    const { logger, lines } = await captureLogger();

    const child = withContext(logger, { somethingNovel: 'LEAK_UNLISTED_CONTEXT' });
    child.info('with context');

    expect(lines[0]).not.toContain('LEAK_UNLISTED_CONTEXT');
  });

  it('permits genuine correlation metadata', async () => {
    const { logger, lines } = await captureLogger();

    const child = withContext(logger, {
      requestId: 'req-42',
      route: '/quran',
      method: 'GET',
      statusCode: 200,
      durationMs: 12,
    });

    child.info('served');

    for (const value of ['req-42', '/quran', 'GET', '200', '12']) {
      expect(lines[0]).toContain(value);
    }
  });

  it('names only safe correlation fields in the allowlist', () => {
    for (const field of safeContextFields) {
      expect(isSafeContextField(field)).toBe(true);
      // No allowlisted field may itself be sensitive.
      expect(isSensitiveKey(field), `${field} must not be sensitive`).toBe(false);
    }
  });
});

describe('L1 — key normalisation cannot be bypassed by spelling', () => {
  it('treats camelCase, snake_case, kebab-case and SCREAMING_CASE alike', () => {
    for (const family of [
      ['authToken', 'auth_token', 'auth-token', 'AUTH_TOKEN', 'authtoken'],
      ['apiKey', 'api_key', 'API-KEY', 'apikey'],
      ['csrfToken', 'csrf_token', 'CSRF-TOKEN'],
    ]) {
      for (const variant of family) {
        expect(isSensitiveKey(variant), `${variant} must be sensitive`).toBe(true);
      }
    }
  });

  it('covers every name SECURITY_BASELINE.md §19.2 prohibits', () => {
    for (const field of [
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'sessionToken',
      'apiKey',
      'connectionString',
      'authorization',
      'cookie',
      'questionContent',
      'messageContent',
      'meetingUrl',
      'email',
    ]) {
      expect(redactedFieldNames).toContain(field);
    }
  });

  it('leaves non-sensitive keys alone, so logs stay useful', () => {
    for (const key of [
      'userId',
      'requestId',
      'durationMs',
      'statusCode',
      'route',
      'method',
      'count',
      'locale',
    ]) {
      expect(isSensitiveKey(key), `${key} must not be redacted`).toBe(false);
    }
  });
});

describe('L1 — public request URLs stay useful', () => {
  it('does not redact an ordinary route or request URL', async () => {
    // Redacting every URL would gut request logging. Only URLs whose CONTEXT
    // marks them private — meeting, class session, invite — are removed.
    const { logger, lines } = await captureLogger();

    logger.info({ url: '/en/quran/1', route: '/en/quran/[surah]' }, 'request served');

    expect(lines[0]).toContain('/en/quran/1');
    expect(lines[0]).toContain('/en/quran/[surah]');
  });
});

describe('the sanitiser is safe to run on any value', () => {
  it('does not mutate the caller original', () => {
    const original = { password: 'keep-me', nested: { email: 'a@b.c' } };
    const snapshot = JSON.stringify(original);

    sanitiseForLog(original);

    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('terminates on a cyclic structure', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;

    expect(JSON.stringify(sanitiseForLog(cyclic))).toContain(cyclePlaceholder);
  });

  it('terminates on mutual cycles', () => {
    const a: Record<string, unknown> = { label: 'a' };
    const b: Record<string, unknown> = { label: 'b', a };
    a['b'] = b;

    expect(() => sanitiseForLog(a)).not.toThrow();
  });

  it('FAILS SAFE at the depth limit rather than returning the raw subtree', () => {
    // A depth guard that returned the original object would be a redaction
    // bypass: bury a secret deep enough and it would emerge intact.
    let deep: Record<string, unknown> = { password: 'LEAK_BEYOND_DEPTH' };
    for (let index = 0; index < 100; index += 1) deep = { deep };

    const result = JSON.stringify(sanitiseForLog(deep));

    expect(result).toContain(truncationPlaceholder);
    expect(result).not.toContain('LEAK_BEYOND_DEPTH');
  });

  it('FAILS SAFE at the breadth limit', () => {
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) wide[`field${index}`] = index;
    wide['password'] = 'LEAK_BEYOND_BREADTH';

    const result = JSON.stringify(sanitiseForLog(wide));

    expect(result).not.toContain('LEAK_BEYOND_BREADTH');
  });

  it('bounds a very large array', () => {
    const large = { items: Array.from({ length: 5000 }, (_, index) => index) };

    const result = sanitiseForLog(large) as { items: unknown[] };

    expect(result.items.length).toBeLessThanOrEqual(201);
  });

  it('preserves useful non-sensitive fields', async () => {
    const { logger, lines } = await captureLogger();

    logger.info(
      { userId: 'u-1', route: '/quran', durationMs: 12, password: 'LEAK' },
      'request served',
    );

    expect(lines[0]).toContain('u-1');
    expect(lines[0]).toContain('/quran');
    expect(lines[0]).toContain('12');
    expect(lines[0]).not.toContain('LEAK');
  });
});

describe('the logging hook and second redaction layer', () => {
  it('sanitises every object argument of a log call', () => {
    const [first, second] = sanitiseLogArguments([
      { password: 'LEAK' },
      'a plain message',
    ]) as [Record<string, unknown>, string];

    expect(first['password']).toBe(redactionPlaceholder);
    expect(second).toBe('a plain message');
  });

  it('keeps Pino path redaction configured as a second layer', () => {
    const paths = (loggerOptions('info', 'test').redact as { paths: string[] }).paths;

    expect(paths).toContain('password');
    expect(paths).toContain('req.body');
    expect(paths).toContain('req.headers');
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('emits level names rather than numbers', () => {
    expect(loggerOptions('info', 'test').formatters?.level?.('warn', 40)).toEqual({
      level: 'warn',
    });
  });

  it('produces no duplicate redaction paths, which Pino rejects', () => {
    const paths = buildRedactionPaths();

    expect(new Set(paths).size).toBe(paths.length);
  });
});
