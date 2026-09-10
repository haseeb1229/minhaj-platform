import { describe, expect, it } from 'vitest';

import {
  isSensitiveKey,
  redactionPlaceholder,
  sanitiseForLog,
  sanitiseString,
} from '../../packages/server-core/src/logging/redaction.ts';
import {
  loggerOptions,
  withContext,
} from '../../packages/server-core/src/logging/logger.ts';

/**
 * F6 — the secrets this repository ACTUALLY has.
 *
 * `tests/config/logging.test.ts` proves the redactor holds against the shapes
 * the first two reviews reported. It passed while every one of this
 * repository's own database secrets walked straight through it, because the
 * classification was an exact-match list and none of these three names was on
 * it:
 *
 *   DATABASE_MIGRATION_URL   DATABASE_APP_PASSWORD   MSSQL_SA_PASSWORD
 *
 * Those are not hypothetical names. They are written into `docker/.env`, read
 * by `prisma.config.ts`, and generated per run by the CI credential step. A
 * redactor that misses them misses the only credentials the platform currently
 * holds.
 *
 * Two further classes are covered here, both invisible to key-name matching:
 * a secret carried inside a STRING VALUE under an innocuous key, and a secret
 * inside an Error thrown by a driver.
 *
 * Every assertion below runs against ACTUAL EMITTED PINO OUTPUT wherever the
 * value can reach a logger. Asserting on a helper's return value proves the
 * helper works, not that the pipeline uses it.
 */

/** A logger writing into an array, so the emitted JSON line is inspectable. */
async function captureLogger() {
  const lines: string[] = [];
  const { pino } = await import('pino');
  const logger = pino(loggerOptions('trace', 'test'), {
    write: (line: string) => lines.push(line),
  });

  return { logger, lines };
}

/**
 * Sentinels.
 *
 * Unique, obviously synthetic, and structurally unlike anything the platform
 * legitimately logs, so a match in an emitted line can only mean a leak. They
 * authenticate nothing anywhere.
 */
const SENTINEL = {
  saPassword: 'SUPER_SECRET_SA_PASSWORD_7f3a91c4',
  appPassword: 'SUPER_SECRET_APP_PASSWORD_2b8e05d7',
  migrationPassword: 'SUPER_SECRET_MIGRATION_PASSWORD_9c4d17ab',
  resetToken: 'SUPER_SECRET_RESET_TOKEN_5e2f83b6',
  verificationToken: 'SUPER_SECRET_VERIFICATION_TOKEN_1a7c60fe',
  sessionToken: 'SUPER_SECRET_SESSION_TOKEN_4d9b23ac',
  apiKey: 'SUPER_SECRET_API_KEY_8c1f47de',
} as const;

const MIGRATION_URL =
  `sqlserver://localhost:14330;database=MinhajPlatform;user=sa;` +
  `password=${SENTINEL.migrationPassword};encrypt=true;trustServerCertificate=true`;

const USERINFO_URL = `sqlserver://minhaj_app:${SENTINEL.appPassword}@db.internal:1433/MinhajPlatform`;

const RESET_URL = `https://minhaj.example/en/reset-password?token=${SENTINEL.resetToken}&locale=en`;

const VERIFY_URL = `https://minhaj.example/en/verify-email/${SENTINEL.verificationToken}`;

/** Every sentinel, so one assertion can prove none of them survived. */
const ALL_SENTINELS = Object.values(SENTINEL);

function expectNoSentinel(line: string): void {
  for (const sentinel of ALL_SENTINELS) {
    expect(line, `${sentinel} leaked into the emitted log line`).not.toContain(sentinel);
  }
}

describe('F6.1 — the repository’s real secret environment names', () => {
  it.each([
    'DATABASE_MIGRATION_URL',
    'DATABASE_APP_PASSWORD',
    'MSSQL_SA_PASSWORD',
    'DATABASE_URL',
  ])('classifies %s as sensitive', (name) => {
    expect(isSensitiveKey(name)).toBe(true);
  });

  it.each([
    // The same three names in every casing and nesting spelling a structured
    // logger might receive them under.
    ['databaseMigrationUrl'],
    ['database_migration_url'],
    ['database-migration-url'],
    ['databaseAppPassword'],
    ['database_app_password'],
    ['mssqlSaPassword'],
    ['mssql_sa_password'],
    ['MSSQL-SA-PASSWORD'],
  ])('classifies the %s spelling as sensitive', (name) => {
    expect(isSensitiveKey(name)).toBe(true);
  });

  /**
   * The rule is a CATEGORY, not those three names.
   *
   * A secret added in a later phase must be covered on the day it is written,
   * without anyone remembering to extend a list — which is the failure mode
   * that produced this finding in the first place.
   */
  it.each([
    'MSSQL_APP_PASSWORD',
    'REPORTING_DATABASE_URL',
    'ANALYTICS_DB_CONNECTION',
    'BETTER_AUTH_SECRET',
    'SMTP_PASSWORD',
    'STORAGE_ACCESS_KEY',
    'WEBHOOK_SIGNING_KEY',
    'redisUrl',
    'servicePassphrase',
  ])('covers the future equivalent %s', (name) => {
    expect(isSensitiveKey(name)).toBe(true);
  });

  it('emits none of them, at any nesting, through the real logger', async () => {
    const { logger, lines } = await captureLogger();

    logger.error(
      {
        DATABASE_MIGRATION_URL: MIGRATION_URL,
        DATABASE_APP_PASSWORD: SENTINEL.appPassword,
        MSSQL_SA_PASSWORD: SENTINEL.saPassword,
        config: {
          docker: {
            env: {
              MSSQL_SA_PASSWORD: SENTINEL.saPassword,
              DATABASE_APP_PASSWORD: SENTINEL.appPassword,
            },
          },
        },
        candidates: [
          { databaseMigrationUrl: MIGRATION_URL },
          { mssql_sa_password: SENTINEL.saPassword },
        ],
      },
      'startup configuration',
    );

    expect(lines).toHaveLength(1);
    expectNoSentinel(lines[0] ?? '');
  });
});

describe('F6.2 — analytics fields named after tokens are not secrets', () => {
  /**
   * Redaction has a cost. A rule that removed every field whose name contains
   * "token" would take `tokenCount` with it, and a log that hides its own
   * measurements is a worse instrument, not a safer one.
   */
  it.each([
    'tokenCount',
    'tokensUsed',
    'inputTokens',
    'outputTokens',
    'maxTokens',
    'totalTokens',
    'tokenLimit',
    'tokenizer',
  ])('leaves the measurement %s alone', (name) => {
    expect(isSensitiveKey(name)).toBe(false);
  });

  /** The exception must not swallow the rule it qualifies. */
  it.each(['token', 'tokens', 'resetToken', 'sessionToken', 'refreshToken'])(
    'still redacts %s',
    (name) => {
      expect(isSensitiveKey(name)).toBe(true);
    },
  );

  it('emits the measurements while removing the token beside them', async () => {
    const { logger, lines } = await captureLogger();

    logger.info(
      { tokenCount: 4096, maxTokens: 8192, sessionToken: SENTINEL.sessionToken },
      'generation complete',
    );

    expect(lines[0]).toContain('4096');
    expect(lines[0]).toContain('8192');
    expect(lines[0]).not.toContain(SENTINEL.sessionToken);
  });
});

describe('F6.3 — a secret inside a STRING VALUE under an innocuous key', () => {
  /**
   * The other half of the problem. No key here is sensitive; every value is.
   * Key-name redaction, however complete, cannot see any of these.
   */
  it('removes the password from a semicolon connection URL', async () => {
    const { logger, lines } = await captureLogger();

    logger.error({ target: MIGRATION_URL }, 'migration target');

    expect(lines[0]).not.toContain(SENTINEL.migrationPassword);
  });

  it('keeps the host and database, which is what makes the line worth logging', () => {
    const sanitised = sanitiseString(MIGRATION_URL);

    expect(sanitised).toContain('localhost:14330');
    expect(sanitised).toContain('database=MinhajPlatform');
    expect(sanitised).toContain('encrypt=true');
    expect(sanitised).not.toContain(SENTINEL.migrationPassword);
  });

  it('removes URL userinfo credentials but keeps the login and host', () => {
    const sanitised = sanitiseString(USERINFO_URL);

    expect(sanitised).not.toContain(SENTINEL.appPassword);
    expect(sanitised).toContain('minhaj_app');
    expect(sanitised).toContain('db.internal:1433');
    expect(sanitised).toContain('MinhajPlatform');
  });

  it('removes the password from an ADO-style connection string', () => {
    const ado =
      `Server=tcp:db.internal,1433;Initial Catalog=MinhajPlatform;` +
      `User ID=minhaj_app;Password=${SENTINEL.appPassword};Encrypt=True`;

    const sanitised = sanitiseString(ado);

    expect(sanitised).not.toContain(SENTINEL.appPassword);
    expect(sanitised).toContain('Initial Catalog=MinhajPlatform');
  });

  it('still sanitises query tokens when a valid URL has a semicolon path parameter', async () => {
    const { logger, lines } = await captureLogger();
    const url =
      `https://minhaj.example/callback;mode=web?access_token=` + SENTINEL.sessionToken;

    logger.error({ target: url }, 'callback failed');

    expect(lines[0]).not.toContain(SENTINEL.sessionToken);
    expect(lines[0]).toContain('/callback;mode=web');
  });

  it('removes a bare `NAME=secret` assignment echoed into a message', () => {
    for (const line of [
      `MSSQL_SA_PASSWORD=${SENTINEL.saPassword}`,
      `DATABASE_APP_PASSWORD=${SENTINEL.appPassword}`,
      `api_key: ${SENTINEL.apiKey}`,
    ]) {
      expect(sanitiseString(line)).not.toContain(line.split(/[=:]/).slice(1).join('='));
    }
  });

  /**
   * The whole point of sanitising rather than redacting. If every string
   * carrying a URL became `[redacted]`, request logging would be worthless and
   * the next engineer would route around the redactor.
   */
  it.each([
    '/en/quran/1',
    '/en/quran/[surah]',
    'https://minhaj.example/en/quran/1?page=2',
    'https://minhaj.example/en/articles/understanding-the-quran-chapter-1',
    'a plain diagnostic message',
    'duration=12 route=/en/quran',
  ])('leaves the non-secret value %s untouched', (value) => {
    expect(sanitiseString(value)).toBe(value);
  });
});

describe('F6.4 — reset and verification URLs', () => {
  it('removes a reset token carried in the query string', async () => {
    const { logger, lines } = await captureLogger();

    logger.info({ link: RESET_URL }, 'password reset requested');

    expect(lines[0]).not.toContain(SENTINEL.resetToken);
  });

  it('removes a relative-URL token whose parameter name is percent-encoded', () => {
    // Lowercase-only material deliberately does not satisfy `looksOpaque`; the
    // semantic parameter name must be the reason it is removed.
    const token = 'lowercasecredentialmaterialonlyabc';
    const url = `/en/reset-password?%72%65%73%65%74%54%6f%6b%65%6e=${token}`;

    expect(sanitiseString(url)).not.toContain(token);
  });

  it('keeps the origin and route, which are the useful diagnostics', () => {
    const sanitised = sanitiseString(RESET_URL);

    expect(sanitised).toContain('https://minhaj.example');
    expect(sanitised).toContain('/en/reset-password');
    expect(sanitised).toContain('locale=en');
    expect(sanitised).not.toContain(SENTINEL.resetToken);
  });

  it('removes a verification token carried in the PATH', () => {
    const sanitised = sanitiseString(VERIFY_URL);

    expect(sanitised).toContain('/en/verify-email/');
    expect(sanitised).not.toContain(SENTINEL.verificationToken);
  });

  it('removes an opaque token in a path segment no route keyword announces', () => {
    // A generated token mixes character classes and carries no word structure.
    // A slug does neither, which is why the article path above survives.
    const opaque = 'Kf3xQ9mZ2pLr7TvB1nWs8dYh';

    expect(sanitiseString(`https://minhaj.example/x/${opaque}`)).not.toContain(opaque);
  });

  it('removes a token carried in the URL fragment', () => {
    const url = `https://minhaj.example/callback#access_token=${SENTINEL.sessionToken}`;

    expect(sanitiseString(url)).not.toContain(SENTINEL.sessionToken);
  });

  it('redacts a value that claims to be a URL and cannot be parsed', () => {
    // Fail CLOSED. A string that announces a scheme and then does not parse is
    // the one case where guessing would be worse than losing the diagnostic.
    expect(sanitiseString('https://[not a valid host]/x')).toContain(
      redactionPlaceholder,
    );
  });
});

describe('F6.5 — Errors cannot carry a secret-bearing URL out', () => {
  it('never emits a connection URL contained in an Error message', async () => {
    const { logger, lines } = await captureLogger();

    logger.error(
      { err: new Error(`Failed to connect: ${MIGRATION_URL}`) },
      'database unreachable',
    );

    expectNoSentinel(lines[0] ?? '');
  });

  it('never emits a secret carried by an Error CAUSE', async () => {
    const { logger, lines } = await captureLogger();

    const error = new Error('migration failed', {
      cause: new Error(`login failed for ${USERINFO_URL}`),
    });

    logger.error({ err: error }, 'migration failed');

    expectNoSentinel(lines[0] ?? '');
  });

  it('never emits arbitrary text used directly as an Error cause', async () => {
    const { logger, lines } = await captureLogger();
    const error = new Error('migration failed', { cause: SENTINEL.saPassword });

    logger.error({ err: error }, 'migration failed');

    expect(lines[0]).not.toContain(SENTINEL.saPassword);
  });

  it('never emits a secret carried in nested error metadata', async () => {
    const { logger, lines } = await captureLogger();

    const error = Object.assign(new Error('driver failure'), {
      code: 'ELOGIN',
      cause: Object.assign(new Error('inner'), {
        connectionString: MIGRATION_URL,
        details: { MSSQL_SA_PASSWORD: SENTINEL.saPassword },
      }),
    });

    logger.error({ err: error }, 'driver failure');

    expectNoSentinel(lines[0] ?? '');
  });

  it('keeps the cause CHAIN visible, so the diagnosis survives redaction', () => {
    const error = Object.assign(new Error('outer'), {
      code: 'ELOGIN',
      cause: new TypeError('inner'),
    });

    const result = sanitiseForLog({ err: error }) as {
      err: { name: string; code: string; cause: { name: string; message: string } };
    };

    expect(result.err.name).toBe('Error');
    expect(result.err.code).toBe('ELOGIN');
    expect(result.err.cause.name).toBe('TypeError');
    expect(result.err.cause.message).toBe(redactionPlaceholder);
  });

  /**
   * An error SERIALISED to a plain object — the shape that crosses a process
   * boundary — is not an `Error`, so the Error branch never sees it. Its
   * `message` is an ordinary string under an ordinary key, and only value-level
   * sanitisation reaches it.
   */
  it('never emits a secret URL in an error-shaped plain object', async () => {
    const { logger, lines } = await captureLogger();

    logger.error(
      {
        err: {
          name: 'PrismaClientInitializationError',
          message: `Can't reach database server at ${MIGRATION_URL}`,
        },
      },
      'serialised error',
    );

    expectNoSentinel(lines[0] ?? '');
    // The class of failure is still identifiable.
    expect(lines[0]).toContain('PrismaClientInitializationError');
  });

  it('redacts arbitrary message and stack text from an error-shaped plain object', async () => {
    const { logger, lines } = await captureLogger();

    logger.error(
      {
        err: {
          name: 'DriverError',
          message: `login failed for ${SENTINEL.saPassword}`,
          stack: `DriverError at ${SENTINEL.appPassword}`,
          code: 'ELOGIN',
        },
      },
      'serialised error',
    );

    expectNoSentinel(lines[0] ?? '');
    expect(lines[0]).toContain('DriverError');
    expect(lines[0]).toContain('ELOGIN');
  });

  it('does not mutate the original Error or its cause', () => {
    const cause = new Error('inner original');
    const error = new Error('outer original', { cause });

    sanitiseForLog({ err: error });

    expect(error.message).toBe('outer original');
    expect(cause.message).toBe('inner original');
  });
});

describe('F6.6 — no secret survives the whole pipeline', () => {
  /**
   * One line, every shape at once, through the REAL logger. This is the
   * assertion that would have failed before this change, in five places.
   */
  it('emits no sentinel anywhere in a payload combining every shape', async () => {
    const { logger, lines } = await captureLogger();

    logger.error(
      {
        DATABASE_MIGRATION_URL: MIGRATION_URL,
        MSSQL_SA_PASSWORD: SENTINEL.saPassword,
        connection: { target: USERINFO_URL },
        links: [RESET_URL, VERIFY_URL],
        headers: { authorization: `Bearer ${SENTINEL.sessionToken}` },
        integration: { apiKey: SENTINEL.apiKey },
        err: new Error(`connect ECONNREFUSED ${MIGRATION_URL}`, {
          cause: new Error(`retry against ${USERINFO_URL}`),
        }),
        note: `MSSQL_SA_PASSWORD=${SENTINEL.saPassword}`,
      },
      `startup failed against ${MIGRATION_URL}`,
    );

    expect(lines).toHaveLength(1);
    expectNoSentinel(lines[0] ?? '');
  });

  it('sanitises the log MESSAGE argument, which carries no key at all', async () => {
    const { logger, lines } = await captureLogger();

    logger.error(`cannot reach ${USERINFO_URL}`);

    expect(lines[0]).not.toContain(SENTINEL.appPassword);
    // Still diagnosable.
    expect(lines[0]).toContain('db.internal');
  });

  it('keeps ordinary structured context intact alongside the redactions', async () => {
    const { logger, lines } = await captureLogger();

    logger.info(
      {
        requestId: 'req-77',
        route: '/en/quran/[surah]',
        statusCode: 200,
        durationMs: 31,
        MSSQL_SA_PASSWORD: SENTINEL.saPassword,
      },
      'served',
    );

    for (const kept of ['req-77', '/en/quran/[surah]', '200', '31']) {
      expect(lines[0]).toContain(kept);
    }
    expect(lines[0]).not.toContain(SENTINEL.saPassword);
  });
});

describe('F6.7 — child-logger context is value-sanitised as well as allowlisted', () => {
  /**
   * `route` is allowlisted correlation metadata, and a reset route carries its
   * token IN THE PATH. Bindings attach to every subsequent line, so an
   * allowlist that trusted the value would repeat the token indefinitely.
   */
  it('removes a token carried inside an allowlisted route binding', async () => {
    const { logger, lines } = await captureLogger();

    const child = withContext(logger, {
      requestId: 'req-88',
      route: `/en/verify-email/${SENTINEL.verificationToken}`,
    });

    child.info('served');

    expect(lines[0]).toContain('req-88');
    expect(lines[0]).toContain('/en/verify-email/');
    expect(lines[0]).not.toContain(SENTINEL.verificationToken);
  });
});
