import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '../../packages/contracts/src/env/server.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * `.env.example` is the file a developer copies to start work, and the only
 * environment file in version control (SECURITY_BASELINE.md §18.1). Two
 * properties matter, and both are asserted rather than assumed.
 */
describe('.env.example', () => {
  async function readExample(): Promise<Record<string, string>> {
    const content = await readFile(path.join(repoRoot, '.env.example'), 'utf8');
    const values: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;

      values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
    }

    return values;
  }

  it('is valueless, as the security baseline requires', async () => {
    const values = await readExample();

    expect(Object.keys(values).length).toBeGreaterThan(0);

    for (const [key, value] of Object.entries(values)) {
      expect(value, `${key} must be valueless in the tracked example`).toBe('');
    }
  });

  it('declares the Phase 1 database variables', async () => {
    const declared = Object.keys(await readExample());

    expect(declared).toContain('DATABASE_URL');
    expect(declared).toContain('DATABASE_MIGRATION_URL');
    expect(declared).toContain('MSSQL_SA_PASSWORD');
    expect(declared).toContain('MINHAJ_SQLSERVER_PORT');
  });

  it('declares the Phase 2 identity and email variables', async () => {
    const declared = Object.keys(await readExample());

    // The file a developer copies to start work. A Phase-2 variable missing
    // here is a variable nobody knows to set — and two of them are the keys
    // that keep addresses and client IPs out of the database in clear.
    for (const required of [
      'AUTH_BASE_URL',
      'AUTH_SECRETS',
      'RATE_LIMIT_DIGEST_KEY',
      'RATE_LIMIT_DIGEST_KEY_VERSION',
      'TRUST_PROXY_HEADERS',
      'EMAIL_FROM_ADDRESS',
      'EMAIL_FROM_NAME',
      'EMAIL_DIGEST_KEY',
      'EMAIL_DIGEST_KEY_VERSION',
      'NEWSLETTER_TOKEN_KEY',
      'NEWSLETTER_TOKEN_KEY_VERSION',
      'RESEND_API_KEY',
      'RESEND_WEBHOOK_SECRET',
    ]) {
      expect(declared).toContain(required);
    }
  });

  it('declares the Phase 27 Donations provider variables, valueless', async () => {
    const values = await readExample();

    // Payment configuration is CAPABILITY-CONDITIONAL: the names are declared
    // so an operator knows what to set, and the tracked file never carries a
    // value — every one of them empty, as the first test already requires.
    for (const required of [
      'DONATIONS_PROVIDER',
      'DONATIONS_PROVIDER_ENVIRONMENT',
      'DONATIONS_PROVIDER_ACCOUNT',
      'DONATIONS_STRIPE_SECRET_KEY',
      'DONATIONS_STRIPE_WEBHOOK_SECRET',
      'DONATIONS_FIXTURE_PROVIDER_ORIGIN',
    ]) {
      expect(values[required], required).toBe('');
    }
  });

  it('declares no variable belonging to a later phase', async () => {
    const declared = Object.keys(await readExample());

    // OAuth arrives in Phase 2G. `SMTP_URL` and `BETTER_AUTH_SECRET` are named
    // because they are the shapes this configuration is easily mistaken for:
    // mail goes through the Resend adapter, and the auth secret is VERSIONED
    // (`AUTH_SECRETS`) so rotation does not invalidate live tokens. A bare
    // `STRIPE_SECRET_KEY` stays absent: the provider credential is namespaced
    // under the Donations context (`DONATIONS_STRIPE_SECRET_KEY`) and only
    // means anything together with its declared environment.
    for (const forbidden of [
      'BETTER_AUTH_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'SMTP_URL',
      'REDIS_URL',
      'STORAGE_BUCKET',
      'STRIPE_SECRET_KEY',
    ]) {
      expect(declared).not.toContain(forbidden);
    }
  });

  it('carries no value that looks like a real provider credential', async () => {
    const values = await readExample();

    // Belt and braces beside the valueless assertion above: a Resend key is
    // `re_...`, a Stripe secret `sk_`/`rk_` and a webhook secret `whsec_`,
    // and this is the file most likely to receive one by accident.
    for (const [key, value] of Object.entries(values)) {
      for (const prefix of ['re_', 'sk_', 'rk_', 'whsec_']) {
        expect(value.startsWith(prefix), `${key} must not carry a provider key`).toBe(
          false,
        );
      }
    }
  });

  it('starts the application when copied verbatim', async () => {
    // The documented setup path must actually work.
    const values = await readExample();

    expect(() => parseServerEnv(values)).not.toThrow();
  });
});
