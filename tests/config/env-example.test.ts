import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseClientEnv } from '../../packages/contracts/src/env/client.ts';
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

  it('declares only Phase 0B variables', async () => {
    const declared = Object.keys(await readExample());

    // No database, auth, OAuth, email, storage, Redis or payment configuration.
    for (const forbidden of [
      'DATABASE_URL',
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

  it('starts the application when copied verbatim', async () => {
    // The documented setup path must actually work.
    const values = await readExample();

    expect(() => parseServerEnv(values)).not.toThrow();
    expect(() => parseClientEnv(values)).not.toThrow();
  });
});
