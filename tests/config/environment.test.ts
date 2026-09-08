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

describe('server environment', () => {
  it('accepts a valid configuration', () => {
    const env = parseServerEnv({
      NODE_ENV: 'production',
      PORT: '3000',
      LOG_LEVEL: 'warn',
      DEFAULT_LOCALE: 'ur',
    });

    expect(env).toEqual({
      NODE_ENV: 'production',
      PORT: 3000,
      LOG_LEVEL: 'warn',
      DEFAULT_LOCALE: 'ur',
    });
  });

  it('applies Phase 0B defaults when nothing is supplied', () => {
    expect(parseServerEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DEFAULT_LOCALE: 'en',
    });
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
    expect(
      parseServerEnv({ NODE_ENV: '', PORT: '', LOG_LEVEL: '', DEFAULT_LOCALE: '' }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DEFAULT_LOCALE: 'en',
    });
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseServerEnv({ PORT: '0' })).toThrow(/PORT/);
    expect(() => parseServerEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unsupported locale', () => {
    expect(() => parseServerEnv({ DEFAULT_LOCALE: 'fr' })).toThrow(/DEFAULT_LOCALE/);
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
    const env = parseClientEnv({
      NEXT_PUBLIC_SITE_URL: 'https://minhaj.org',
      NEXT_PUBLIC_DEFAULT_LOCALE: 'ar',
    });

    expect(env.NEXT_PUBLIC_SITE_URL).toBe('https://minhaj.org');
    expect(env.NEXT_PUBLIC_DEFAULT_LOCALE).toBe('ar');
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
      DEFAULT_LOCALE: 'en',
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
    const secret = 'STARTUP-SECRET-MUST-NOT-LEAK';
    const result = await initialiseWith({ DEFAULT_LOCALE: secret });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('DEFAULT_LOCALE');
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
