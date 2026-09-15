import { describe, expect, it } from 'vitest';

import {
  classifyProviderStatus,
  createResendProvider,
  providerFailureCode,
} from '../../packages/database/src/adapters/email/provider.ts';

/**
 * THE provider adapter's own policy, tested directly.
 *
 * The communication suite proves what the RETRY does with each class; this
 * proves the classification itself, which is where the decision is actually
 * made. Both matter, and neither substitutes for the other: a correct retry
 * policy fed the wrong class retries a dead address until the budget is spent,
 * or abandons a message that would have gone through a second later.
 *
 * No database and no network. Nothing here contacts a provider, and no
 * credential exists in this file or is needed by it.
 */

describe('failure classification', () => {
  it('treats every 5xx as TRANSIENT', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(classifyProviderStatus(status), String(status)).toBe('transient');
    }
  });

  it('treats 429 as transient, alone among the 4xx', () => {
    // The one that has to be stated explicitly: it is a 4xx, and every other
    // 4xx is the provider saying "never", but this one means "not yet".
    expect(classifyProviderStatus(429)).toBe('transient');

    for (const status of [400, 401, 403, 404, 409, 413, 422]) {
      expect(classifyProviderStatus(status), String(status)).toBe('permanent');
    }
  });

  it('normalises a failure to a CODE, never to provider prose', () => {
    // Provider prose can echo the recipient or the content that was rejected,
    // and this value reaches an operator surface (SECURITY_BASELINE.md §19.2).
    expect(providerFailureCode(503, 'anything')).toBe('http_503');
    expect(providerFailureCode(null, 'AbortError')).toBe('timeout');
    expect(providerFailureCode(null, 'TypeError')).toBe('network_error');
  });
});

describe('an unconfigured provider', () => {
  const provider = createResendProvider({
    apiKey: null,
    senderAddress: 'no-reply@proof.invalid',
    senderName: 'Minhaj',
    timeoutMs: 1_000,
  });

  it('reports itself unavailable rather than pretending', () => {
    expect(provider.available).toBe(false);
    expect(provider.providerName).toBe('resend');
  });

  it('REFUSES to send, and says so as a permanent failure', async () => {
    // FAIL CLOSED and honestly. A keyless provider returning "accepted" would
    // mark a verification email sent that nobody will ever receive — and the
    // delivery row would say `sent`, so nothing would ever notice.
    const outcome = await provider.send({
      to: 'someone@proof.invalid',
      subject: 'Proof',
      html: '<p>Proof</p>',
      text: 'Proof',
      idempotencyKey: 'proof-key-0001',
    });

    expect(outcome.outcome).toBe('rejected');
    if (outcome.outcome === 'rejected') {
      expect(outcome.failureClass).toBe('permanent');
      expect(outcome.failureCode).toBe('provider_not_configured');
    }
  });

  it('treats an empty key exactly as an absent one', async () => {
    const empty = createResendProvider({
      apiKey: '',
      senderAddress: 'no-reply@proof.invalid',
      senderName: 'Minhaj',
      timeoutMs: 1_000,
    });

    expect(empty.available).toBe(false);
  });
});

describe('the send is BOUNDED', () => {
  it('imposes a ceiling rather than waiting on the provider indefinitely', async () => {
    // The SDK's send options carry no `AbortSignal`, so the ceiling is a race
    // against a timer. That bounds the DISPATCHER, which is what the ceiling is
    // for: one hung provider request must not hold a worker for as long as the
    // provider chooses to take.
    //
    // Asserted against the real adapter with a real (unroutable) endpoint and a
    // very short ceiling, so what is measured is the adapter's own bound rather
    // than a stub's.
    const previous = process.env['RESEND_BASE_URL'];

    // 203.0.113.0/24 is TEST-NET-3 (RFC 5737): reserved for documentation and
    // routable nowhere, so the connection hangs rather than being refused.
    process.env['RESEND_BASE_URL'] = 'http://203.0.113.1:9';

    try {
      const provider = createResendProvider({
        apiKey: 're_synthetic_sentinel_not_a_real_key',
        senderAddress: 'no-reply@proof.invalid',
        senderName: 'Minhaj',
        timeoutMs: 750,
      });

      const started = Date.now();
      const outcome = await provider.send({
        to: 'someone@proof.invalid',
        subject: 'Proof',
        html: '<p>Proof</p>',
        text: 'Proof',
        idempotencyKey: 'timeout-proof-0001',
      });
      const elapsed = Date.now() - started;

      // Well inside any default socket timeout, which is the whole point.
      expect(elapsed).toBeLessThan(10_000);

      expect(outcome.outcome).toBe('rejected');
      if (outcome.outcome === 'rejected') {
        // TRANSIENT, not permanent: "we stopped waiting" is not "it did not
        // arrive". The retry carries the same idempotency key, so a request
        // that did land cannot produce a second message.
        expect(outcome.failureClass).toBe('transient');
        expect(['timeout', 'network_error']).toContain(outcome.failureCode);
      }
    } finally {
      if (previous === undefined) delete process.env['RESEND_BASE_URL'];
      else process.env['RESEND_BASE_URL'] = previous;
    }
  }, 30_000);
});
