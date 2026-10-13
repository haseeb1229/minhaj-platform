import 'server-only';

import {
  createFatwaPublicReader,
  createFatwaReadTally,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import { createFatwaReadCounter, createFatwaReadService } from '@/contexts/fatwa';
import { serverEnv } from '@/config/server-env';

/**
 * The read counter's composition root — what the public ruling page's
 * after-render POST reaches, and nothing else.
 *
 * Kept apart from `./fatwa-read.ts` because it needs the limiter's digest key,
 * which is server configuration a public content route's module graph must not
 * import (ARCHITECTURE.md §8.3.1.1). It is reached only from a Server Action.
 *
 * THE EXISTING RATE LIMITER, NOT A SECOND ONE (ARCHITECTURE.md §4.5): the
 * address and the ruling id are digested together with the platform's keyed
 * HMAC under the purpose `fatwa-read`, so the address is never stored and the
 * budget cannot be spent by any other flow.
 */

let runtime: ReturnType<typeof createFatwaReadCounter> | null = null;

export function fatwaReadCounter() {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  return (runtime = createFatwaReadCounter({
    reader: createFatwaReadService(createFatwaPublicReader()),
    tally: createFatwaReadTally(),
    limiter: createRateLimiter(configuration),
    key: (clientAddress, fatwaId) =>
      rateLimitKey({
        purpose: 'fatwa-read',
        subject: `${clientAddress}:${fatwaId}`,
        configuration,
      }),
  }));
}
