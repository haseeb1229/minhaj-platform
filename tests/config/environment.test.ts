import { describe, expect, it, vi } from 'vitest';

import {
  clientEnvKeys,
  clientEnvSchema,
  parseClientEnv,
  secretNameFragments,
} from '../../packages/contracts/src/env/client.ts';
import {
  parseServerEnv,
  serverEnvKeys,
  serverEnvSchema,
} from '../../packages/contracts/src/env/server.ts';

/**
 * Environment validation (SECURITY_BASELINE.md §18.1, §9.1).
 *
 * Configuration is validated at startup with Zod so the process fails fast, and
 * the server/client split is explicit so a secret cannot be shipped to a
 * browser by accident.
 */

/**
 * The values the schema supplies when nothing is set.
 *
 * Written out rather than derived from the schema, deliberately: a test that
 * asked the schema what its defaults are would agree with any defaults at all,
 * including a secret that lost its `development-only` marker. These are the
 * documented ones, and `.env.example` copied verbatim must produce exactly
 * this (SECURITY_BASELINE.md §18.1).
 */
const SERVER_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: 3000,
  LOG_LEVEL: 'info',

  AUTH_BASE_URL: 'http://localhost:3000',
  AUTH_SECRETS: '1:development-only-auth-secret-not-for-deployment',

  EMAIL_FROM_ADDRESS: 'no-reply@localhost.invalid',
  EMAIL_FROM_NAME: 'Minhaj',

  RATE_LIMIT_DIGEST_KEY: 'development-only-rate-limit-digest-key',
  RATE_LIMIT_DIGEST_KEY_VERSION: 1,
  EMAIL_DIGEST_KEY: 'development-only-email-digest-key',
  EMAIL_DIGEST_KEY_VERSION: 1,

  // Off unless a deployment declares a proxy in front of it. The per-client
  // rate-limit budget is keyed on a header only a proxy can be trusted to set.
  TRUST_PROXY_HEADERS: false,
} as const;

/**
 * Secrets a PRODUCTION environment must supply itself.
 *
 * Synthetic sentinels — never a real credential, and recognisably not one.
 */
const PRODUCTION_SECRETS = {
  AUTH_SECRETS: '1:synthetic-production-sentinel-value-0001',
  RATE_LIMIT_DIGEST_KEY: 'synthetic-rate-limit-sentinel-0001',
  EMAIL_DIGEST_KEY: 'synthetic-email-digest-sentinel-0001',
} as const;

describe('server environment', () => {
  it('accepts a valid configuration', () => {
    const env = parseServerEnv({
      NODE_ENV: 'production',
      PORT: '3000',
      LOG_LEVEL: 'warn',
      ...PRODUCTION_SECRETS,
    });

    expect(env).toEqual({
      ...SERVER_DEFAULTS,
      ...PRODUCTION_SECRETS,
      NODE_ENV: 'production',
      PORT: 3000,
      LOG_LEVEL: 'warn',
    });
  });

  it('applies the documented defaults when nothing is supplied', () => {
    expect(parseServerEnv({})).toEqual(SERVER_DEFAULTS);
  });

  it('fails clearly on an invalid value', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'staging' })).toThrow(
      /Invalid server environment configuration/,
    );
  });

  it('treats an empty value as unset, so the valueless .env.example works', () => {
    // `.env.example` is valueless (SECURITY_BASELINE.md §18.1), so copying it
    // verbatim produces `PORT=` rather than an absent PORT. Following the
    // documented setup must not produce a validation failure.
    expect(parseServerEnv({ NODE_ENV: '', PORT: '', LOG_LEVEL: '' })).toEqual(
      SERVER_DEFAULTS,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseServerEnv({ PORT: '0' })).toThrow(/PORT/);
    expect(() => parseServerEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unsupported log level', () => {
    expect(() => parseServerEnv({ LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });

  it('names the offending variable without printing its value', () => {
    const secret = 'super-secret-value-that-must-not-appear';

    try {
      parseServerEnv({ LOG_LEVEL: secret });
      expect.unreachable('expected validation to fail');
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toContain('LOG_LEVEL');
      expect(message).not.toContain(secret);
    }
  });

  it('declares no NEXT_PUBLIC_ variable', () => {
    for (const key of serverEnvKeys) {
      expect(key.startsWith('NEXT_PUBLIC_')).toBe(false);
    }
  });
});

describe('client environment', () => {
  it('accepts a valid configuration', () => {
    const env = parseClientEnv({ NEXT_PUBLIC_SITE_URL: 'https://minhaj.org' });

    expect(env.NEXT_PUBLIC_SITE_URL).toBe('https://minhaj.org');
  });

  it('rejects a malformed site URL', () => {
    expect(() => parseClientEnv({ NEXT_PUBLIC_SITE_URL: 'not-a-url' })).toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it('rejects a non-http protocol', () => {
    expect(() => parseClientEnv({ NEXT_PUBLIC_SITE_URL: 'javascript:alert(1)' })).toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it('prefixes every client variable with NEXT_PUBLIC_', () => {
    expect(clientEnvKeys.length).toBeGreaterThan(0);

    for (const key of clientEnvKeys) {
      expect(key.startsWith('NEXT_PUBLIC_'), `${key} must be NEXT_PUBLIC_`).toBe(true);
    }
  });

  it('names nothing secret-shaped', () => {
    for (const key of clientEnvKeys) {
      for (const fragment of secretNameFragments) {
        expect(
          key.toUpperCase().includes(fragment),
          `${key} must not contain ${fragment}`,
        ).toBe(false);
      }
    }
  });
});

describe('the final route locale is not configurable', () => {
  /**
   * ROUTE_MAP.md §1.1 fixes the last step of locale resolution at `en`.
   *
   * Phase 0B carried `DEFAULT_LOCALE` and `NEXT_PUBLIC_DEFAULT_LOCALE`, which
   * existed only to choose the single locale a routing-less skeleton rendered.
   * Once real locale routing arrived they became a way to contradict the
   * accepted contract from a deployment file — set `DEFAULT_LOCALE=ur` and
   * every visitor with no preference lands somewhere §1.1 says they must not.
   *
   * They are retired. These assertions are what stops them coming back as a
   * convenience: environment validation is where such a variable would have to
   * be declared to mean anything at all.
   */
  it('declares no default-locale variable on either schema', () => {
    const declared = [
      ...Object.keys(serverEnvSchema.shape),
      ...Object.keys(clientEnvSchema.shape),
    ];

    expect(declared).not.toContain('DEFAULT_LOCALE');
    expect(declared).not.toContain('NEXT_PUBLIC_DEFAULT_LOCALE');
  });

  it('accepts a supplied default-locale variable only by ignoring it', () => {
    // A stale deployment file may still set it. It must have NO effect —
    // neither a validation failure that blocks a deploy, nor any influence on
    // the parsed configuration.
    expect(parseServerEnv({ DEFAULT_LOCALE: 'ur' })).toEqual(SERVER_DEFAULTS);

    expect(parseClientEnv({ NEXT_PUBLIC_DEFAULT_LOCALE: 'ur' })).toEqual({
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    });
  });
});

describe('the server and client schemas stay disjoint', () => {
  it('shares no variable between them', () => {
    expect(serverEnvKeys.filter((key) => clientEnvKeys.includes(key))).toEqual([]);
  });

  it('keeps both schemas minimal for this phase', () => {
    const forbidden = [
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'SMTP_URL',
      'REDIS_URL',
      'STORAGE_BUCKET',
      'STRIPE_SECRET_KEY',
    ];

    const declared = [
      ...Object.keys(serverEnvSchema.shape),
      ...Object.keys(clientEnvSchema.shape),
    ];

    for (const name of forbidden) {
      expect(declared).not.toContain(name);
    }
  });
});

describe('B7 — invalid configuration prevents startup', () => {
  /**
   * Loads the app's REAL server-env module against a substituted `process.env`.
   *
   * This is the production initialisation path — the same module that
   * `instrumentation.ts` and the root layout call. The module caches after a
   * successful parse, so the registry is reset between cases to force a fresh
   * evaluation.
   */
  async function initialiseWith(
    environment: Record<string, string | undefined>,
  ): Promise<{ ok: boolean; message: string }> {
    const original = process.env;
    process.env = { ...environment } as NodeJS.ProcessEnv;
    vi.resetModules();

    try {
      const module = (await import('../../apps/web/src/config/server-env.ts')) as {
        assertServerEnv: () => void;
      };

      module.assertServerEnv();
      return { ok: true, message: '' };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    } finally {
      process.env = original;
      vi.resetModules();
    }
  }

  it('initialises successfully with a valid environment', async () => {
    const result = await initialiseWith({
      NODE_ENV: 'production',
      PORT: '3000',
      LOG_LEVEL: 'info',
      ...PRODUCTION_SECRETS,
    });

    expect(result.ok).toBe(true);
  });

  it('FAILS initialisation when a required variable is invalid', async () => {
    const result = await initialiseWith({ LOG_LEVEL: 'chatty' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('LOG_LEVEL');
    expect(result.message).toContain('Invalid server environment configuration');
  });

  it('FAILS initialisation on an invalid port', async () => {
    const result = await initialiseWith({ PORT: 'not-a-number' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('PORT');
  });

  it('never prints the offending value during startup failure', async () => {
    // Driven through PORT because `DEFAULT_LOCALE` no longer exists: Phase 3A
    // fixed the final no-preference locale at `en` (ROUTE_MAP.md §1.1) and
    // retired the variable that could contradict it. The property is
    // unchanged — the VARIABLE is named, its VALUE never is — and it is now
    // asserted against a variable the schema still rejects values for, which
    // is what keeps this a real test rather than one that cannot fail.
    const secret = 'STARTUP-SECRET-MUST-NOT-LEAK';
    const result = await initialiseWith({ PORT: secret });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('PORT');
    expect(result.message).not.toContain(secret);
  });
});

describe('B7 — the contracts root stays browser-safe', () => {
  it('does not re-export server environment parsing', async () => {
    const root = await import('../../packages/contracts/src/index.ts');

    // Reaching server env must require naming the guarded subpath explicitly.
    expect(root).not.toHaveProperty('parseServerEnv');
    expect(root).not.toHaveProperty('serverEnvSchema');
    expect(root).not.toHaveProperty('serverEnvKeys');
  });

  it('still exports the client and shared contracts', async () => {
    const root = await import('../../packages/contracts/src/index.ts');

    expect(root).toHaveProperty('parseClientEnv');
    expect(root).toHaveProperty('clientEnvSchema');
    expect(root).toHaveProperty('localeSchema');
  });

  it('guards the server subpath with a browser export condition', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const manifest = require('../../packages/contracts/package.json') as {
      exports: Record<string, unknown>;
    };

    const serverExport = manifest.exports['./env/server'] as Record<string, string>;

    expect(serverExport['browser']).toBe('./src/env/server-in-client-error.ts');
    expect(serverExport['node']).toBe('./src/env/server.ts');
  });

  it('throws if the server env browser entry is evaluated', async () => {
    await expect(
      import('../../packages/contracts/src/env/server-in-client-error.ts'),
    ).rejects.toThrow(/server-only/);
  });
});
