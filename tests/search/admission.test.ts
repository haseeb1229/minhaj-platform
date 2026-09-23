import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Public search admission, as the request proxy calls it.
 *
 * The limiter's own atomicity is proved against real SQL Server by the platform
 * rate-limiter suite, and the throttled redirect end to end by the browser
 * suite. What is proved HERE is the admission DECISION — above all that a
 * limiter which cannot answer refuses the query rather than waving it through,
 * and that the fault is logged without the client address it was keyed on.
 */

const CLIENT = '198.51.100.23';

let consume: () => Promise<{ allowed: boolean }> = async () => ({ allowed: true });
const keys: { purpose: string; subject: string }[] = [];
const logged: unknown[] = [];

vi.mock('@minhaj/database', () => ({
  createRateLimiter: () => ({ consume: () => consume() }),
  rateLimitKey: (input: { purpose: string; subject: string }) => {
    keys.push({ purpose: input.purpose, subject: input.subject });
    return 'keyed-digest';
  },
}));

vi.mock('@/config/server-env', () => ({
  serverEnv: () => ({
    RATE_LIMIT_DIGEST_KEY: 'synthetic-digest-key-for-tests-only-0001',
    RATE_LIMIT_DIGEST_KEY_VERSION: 1,
    TRUST_PROXY_HEADERS: true,
  }),
}));

vi.mock('@/composition/logging', () => ({
  appLogger: () => ({ error: (...entry: unknown[]) => logged.push(entry) }),
}));

const { admitPublicSearch } =
  await import('../../apps/web/src/composition/search-admission.ts');

function request(): Headers {
  return new Headers({ 'x-forwarded-for': `${CLIENT}, 10.0.0.1` });
}

describe('admitPublicSearch', () => {
  beforeEach(() => {
    keys.length = 0;
    logged.length = 0;
  });

  it('admits a query the limiter allows, keyed on the originating client', async () => {
    consume = async () => ({ allowed: true });
    expect(await admitPublicSearch(request())).toBe(true);
    expect(keys).toEqual([{ purpose: 'search', subject: CLIENT }]);
  });

  it('refuses a query the limiter denies', async () => {
    consume = async () => ({ allowed: false });
    expect(await admitPublicSearch(request())).toBe(false);
  });

  it('fails closed when the limiter cannot answer, and logs no address', async () => {
    consume = async () => {
      throw new Error('Unable to start a transaction in the given time.');
    };
    expect(await admitPublicSearch(request())).toBe(false);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(CLIENT);
  });
});
