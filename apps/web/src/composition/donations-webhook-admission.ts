import 'server-only';

import type { RateLimitRule } from '@minhaj/contracts/platform';
import { createRateLimiter, rateLimitKey } from '@minhaj/database';

import { serverEnv } from '@/config/server-env';

import { failureLabel } from './failure-label';
import { appLogger } from './logging';
import { clientAddressFrom } from './request-address';

/**
 * Admission of the payment provider's webhook — the volume protection in
 * front of signature verification (DELIVERY_PLAN.md Phase 27;
 * SECURITY_BASELINE.md §7.2, §14).
 *
 * BEFORE VERIFICATION, ON PURPOSE. Verifying a signature costs an HMAC over
 * up to 64 KiB, and the event that follows costs a provider round trip; an
 * unauthenticated sender must not be able to spend either without limit. The
 * budget is generous — the provider retries and bursts — and is per client
 * address, so one noisy sender cannot exhaust another's.
 *
 * THE EXISTING RATE LIMITER, NOT A SECOND ONE (ARCHITECTURE.md §4.5): atomic
 * consumption in the database under the purpose `donation-webhook`, keyed by a
 * KEYED DIGEST of the address, so no raw address is ever stored.
 *
 * WHAT A FAULT MEANS. If the limiter cannot answer, the event is not admitted
 * and the provider is told to retry later — an unanswerable limiter almost
 * always means an unreachable database, where the event could not have been
 * recorded anyway. Logged by operation name and failure label only.
 */

const DONATION_WEBHOOK_RATE_RULE: RateLimitRule = { window: 60, max: 600 };

export type DonationWebhookAdmission = 'admitted' | 'limited' | 'unavailable';

let limiter: ReturnType<typeof createRateLimiter> | null = null;

export async function admitDonationWebhook(
  source: Headers,
): Promise<DonationWebhookAdmission> {
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  limiter ??= createRateLimiter(configuration);

  try {
    const decision = await limiter.consume(
      rateLimitKey({
        purpose: 'donation-webhook',
        subject: clientAddressFrom(source, environment.TRUST_PROXY_HEADERS),
        configuration,
      }),
      DONATION_WEBHOOK_RATE_RULE,
    );
    return decision.allowed ? 'admitted' : 'limited';
  } catch (error) {
    appLogger().error(
      { operation: 'donations.webhook.admission', error: failureLabel(error) },
      'Donation webhook admission could not be decided; the event is refused.',
    );
    return 'unavailable';
  }
}
