import 'server-only';

import { createRateLimiter, rateLimitKey } from '@minhaj/database';
import { SEARCH_RATE_RULE } from '@minhaj/search';

import { serverEnv } from '@/config/server-env';

import { failureLabel } from './failure-label';
import { appLogger } from './logging';
import { clientAddressFrom } from './request-address';

/**
 * Public search admission — the expensive-query protection at the request
 * boundary (DELIVERY_PLAN.md Phase 17; SECURITY_BASELINE.md §1 — "denial of
 * service through search parameters").
 *
 * WHY HERE AND NOT IN THE PAGE. The results page is a public CONTENT route, and
 * a content route's module graph may reach neither request headers nor the
 * secret-bearing server configuration (ARCHITECTURE.md §8.1, §8.3.1.1). The
 * request proxy already sees every request's own headers and already performs
 * owner reads before rendering, so it is where "may this client run another
 * query now" is answered — once, before the page renders.
 *
 * THE EXISTING RATE LIMITER, NOT A SECOND ONE (ARCHITECTURE.md §4.5): atomic
 * consumption in the database, keyed by a KEYED DIGEST of the client address,
 * so no raw address is ever stored. No Redis.
 *
 * WHAT A FAULT MEANS. If the limiter cannot answer, the query is NOT admitted
 * and the fault is logged — fail closed, like every other limiter on the
 * platform. An unanswerable limiter almost always means an unreachable
 * database, so the query could not have run anyway; admitting it would only
 * hand an attacker an unmetered path during exactly the fault they may be
 * provoking. The page the visitor is sent to says to wait, which is true in
 * both cases.
 */
let limiter: ReturnType<typeof createRateLimiter> | null = null;

export async function admitPublicSearch(source: Headers): Promise<boolean> {
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  limiter ??= createRateLimiter(configuration);

  try {
    const decision = await limiter.consume(
      rateLimitKey({
        purpose: 'search',
        subject: clientAddressFrom(source, environment.TRUST_PROXY_HEADERS),
        configuration,
      }),
      SEARCH_RATE_RULE,
    );
    return decision.allowed;
  } catch (error) {
    appLogger().error(
      { operation: 'search.admission', error: failureLabel(error) },
      'Search admission could not be decided; the query is refused.',
    );
    return false;
  }
}
