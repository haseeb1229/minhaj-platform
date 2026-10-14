import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ProviderEventAdmission,
  ProviderEventEffect,
} from '../../packages/contracts/src/platform/index.ts';

/**
 * THE PROVIDER CALLBACK, as the route actually handles it.
 *
 * The adapter's state machine is proved against real SQL Server in
 * `communication.integration.test.ts`. What is proved HERE is the handler's own
 * decision — which admission it acts on, what it does with an event carrying no
 * effect, and above all what it answers a provider that retries.
 *
 * That last one is the defect. The handler previously read "this event id
 * exists" as "this event is finished", so an attempt that recorded the event
 * and then died was answered 204 for ever afterwards and its suppression never
 * happened. The provider's retry is the mechanism that repairs that, and the
 * handler was the thing turning it away.
 *
 * VERIFICATION IS NOT STUBBED. The real `verifyResendWebhook` runs against
 * really-signed payloads, because a suite that relaxed signature checking to
 * make its fixtures easier would be asserting nothing about the only
 * authentication this path has (SECURITY_BASELINE.md §7.2).
 */

const SECRET = 'whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0LTAwMDE=';

/* ===========================================================================
 * A provider-event store with the adapter's semantics, and a fault injector
 * ========================================================================= */

interface EventRow {
  type: string;
  processed: boolean;
}

const events = new Map<string, EventRow>();
const suppressed: ProviderEventEffect[] = [];

/** Set to throw once from `complete`, simulating a crash mid-effect. */
let failNextComplete = false;

const providerEvents = {
  async admit({
    provider,
    eventId,
    type,
  }: {
    provider: string;
    eventId: string;
    type: string;
  }): Promise<ProviderEventAdmission> {
    const key = `${provider}:${eventId}`;
    const existing = events.get(key);

    if (existing === undefined) {
      events.set(key, { type, processed: false });
      return 'process';
    }

    return existing.processed ? 'already-processed' : 'process';
  },

  async complete({
    provider,
    eventId,
    effect,
  }: {
    provider: string;
    eventId: string;
    effect: ProviderEventEffect | null;
  }): Promise<void> {
    if (failNextComplete) {
      failNextComplete = false;
      // ATOMIC: neither the effect nor the completion lands.
      throw new Error('synthetic failure during effect');
    }

    if (effect !== null) {
      const already = suppressed.some(
        (entry) => entry.recipient === effect.recipient && entry.scope === effect.scope,
      );
      if (!already) suppressed.push(effect);
    }

    const row = events.get(`${provider}:${eventId}`);
    if (row !== undefined) row.processed = true;
  },
};

/** What each provider message id was sent for — the delivery store's answer. */
const sentPurposes = new Map<string, string>();

const deliveries = {
  async purposeOfProviderMessage(providerMessageId: string): Promise<string | null> {
    return sentPurposes.get(providerMessageId) ?? null;
  },
};

vi.mock('@/composition/identity', () => ({
  identityRuntime: () => ({ providerEvents, deliveries }),
}));

vi.mock('@/composition/logging', () => ({
  appLogger: () => ({ warn: () => undefined, error: () => undefined }),
}));

vi.mock('@/config/server-env', () => ({
  serverEnv: () => ({ RESEND_WEBHOOK_SECRET: SECRET }),
}));

const { POST } = await import('../../apps/web/src/app/api/webhooks/resend/route.ts');

/* ===========================================================================
 * Signing, the way Standard Webhooks does it
 * ========================================================================= */

function sign(id: string, timestamp: number, payload: string, secret = SECRET): Headers {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');

  return new Headers({
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  });
}

function post(id: string, payload: string, headers = sign(id, now(), payload)): Request {
  return new Request('https://minhaj.test/api/webhooks/resend', {
    method: 'POST',
    headers,
    body: payload,
  });
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function bounce(recipient: string): string {
  return JSON.stringify({ type: 'email.bounced', data: { to: [recipient] } });
}

describe('Phase 2 Chunk 1 — the provider callback handler', () => {
  beforeEach(() => {
    events.clear();
    suppressed.length = 0;
    sentPurposes.clear();
    failNextComplete = false;
  });

  /* =======================================================================
   * Authentication — unchanged, and re-proved at the handler
   * ===================================================================== */

  describe('verification', () => {
    it('accepts a correctly signed event', async () => {
      const payload = bounce('signed@proof.invalid');
      const response = await POST(post('msg_ok', payload));

      expect(response.status).toBe(204);
      expect(suppressed).toHaveLength(1);
    });

    it('refuses an event signed with the WRONG secret', async () => {
      const payload = bounce('wrong-secret@proof.invalid');
      const headers = sign('msg_wrong', now(), payload, 'whsec_ZGlmZmVyZW50LXNlY3JldA==');

      const response = await POST(post('msg_wrong', payload, headers));

      expect(response.status).toBe(401);
      // FAIL CLOSED. Nothing was recorded and nothing was suppressed.
      expect(events.size).toBe(0);
      expect(suppressed).toHaveLength(0);
    });

    it('refuses a TAMPERED body', async () => {
      const payload = bounce('original@proof.invalid');
      const headers = sign('msg_tamper', now(), payload);

      // Signed one address, delivered another — the exact substitution the
      // signature exists to catch.
      const response = await POST(
        post('msg_tamper', bounce('attacker@proof.invalid'), headers),
      );

      expect(response.status).toBe(401);
      expect(suppressed).toHaveLength(0);
    });

    it('refuses a STALE timestamp', async () => {
      const payload = bounce('stale@proof.invalid');
      const headers = sign('msg_stale', now() - 86_400, payload);

      const response = await POST(post('msg_stale', payload, headers));

      expect(response.status).toBe(401);
      expect(suppressed).toHaveLength(0);
    });
  });

  /* =======================================================================
   * Replay — the blocker
   * ===================================================================== */

  describe('replay', () => {
    it('COMPLETES the effect on a retry after a mid-effect failure', async () => {
      const payload = bounce('interrupted@proof.invalid');

      // The first delivery records the event and then dies before its effect.
      failNextComplete = true;
      await expect(POST(post('msg_interrupted', payload))).rejects.toThrow();

      expect(events.get('resend:msg_interrupted')?.processed).toBe(false);
      expect(suppressed).toHaveLength(0);

      // THE ASSERTION. The provider retries the same event, and the handler
      // must do the work rather than report it already done.
      const retry = await POST(post('msg_interrupted', payload));

      expect(retry.status).toBe(204);
      expect(suppressed.map((entry) => entry.recipient)).toEqual([
        'interrupted@proof.invalid',
      ]);
      expect(events.get('resend:msg_interrupted')?.processed).toBe(true);
    });

    it('does NOT repeat the effect once the event is complete', async () => {
      const payload = bounce('complete@proof.invalid');

      expect((await POST(post('msg_complete', payload))).status).toBe(204);
      expect((await POST(post('msg_complete', payload))).status).toBe(204);
      expect((await POST(post('msg_complete', payload))).status).toBe(204);

      // One logical effect, however many times it is delivered.
      expect(suppressed).toHaveLength(1);
    });

    it('produces ONE effect for concurrent duplicates', async () => {
      const payload = bounce('concurrent@proof.invalid');

      const responses = await Promise.all(
        Array.from({ length: 5 }, async () => POST(post('msg_race', payload))),
      );

      for (const response of responses) expect(response.status).toBe(204);
      expect(suppressed).toHaveLength(1);
    });

    it('never answers success for an event whose effect did not land', async () => {
      const payload = bounce('unfinished@proof.invalid');

      failNextComplete = true;
      await expect(POST(post('msg_unfinished', payload))).rejects.toThrow();

      // A 2xx here would tell the provider to stop retrying the one event that
      // still needs it. The handler raises instead, so the delivery is retried.
      expect(events.get('resend:msg_unfinished')?.processed).toBe(false);
    });
  });

  /* =======================================================================
   * Events with nothing to do
   * ===================================================================== */

  describe('events this platform does not act on', () => {
    it('records and COMPLETES an unsupported type without any effect', async () => {
      const payload = JSON.stringify({
        type: 'email.delivered',
        data: { to: ['delivered@proof.invalid'] },
      });

      expect((await POST(post('msg_delivered', payload))).status).toBe(204);

      // Finished, deliberately: there was nothing to do, so nothing is
      // outstanding and a replay need not run anything again.
      expect(events.get('resend:msg_delivered')?.processed).toBe(true);
      expect(suppressed).toHaveLength(0);
    });

    it('completes a suppressing event whose payload names no recipient', async () => {
      const payload = JSON.stringify({ type: 'email.bounced', data: {} });

      expect((await POST(post('msg_no_recipient', payload))).status).toBe(204);

      expect(events.get('resend:msg_no_recipient')?.processed).toBe(true);
      expect(suppressed).toHaveLength(0);
    });

    it('suppresses in the TRANSACTIONAL scope, never a marketing one', async () => {
      await POST(post('msg_scope', bounce('scope@proof.invalid')));

      // The scope is what keeps a future marketing unsubscribe structurally
      // unable to silence verification or password-reset mail.
      expect(suppressed[0]?.scope).toBe('transactional');
      expect(suppressed[0]?.reason).toBe('bounce');
    });

    it('carries the COMPLAINT reason for a complaint event', async () => {
      const payload = JSON.stringify({
        type: 'email.complained',
        data: { to: ['complaint@proof.invalid'] },
      });

      await POST(post('msg_complaint', payload));

      expect(suppressed[0]?.reason).toBe('complaint');
    });

    /*
     * Phase 21. Anybody can submit somebody else's address to `/newsletter`;
     * if that person then marks the confirmation as spam, the complaint must
     * not stop their verification, reset or account-security mail.
     */
    function complaint(recipient: string, emailId: string): string {
      return JSON.stringify({
        type: 'email.complained',
        data: { to: [recipient], email_id: emailId },
      });
    }

    it('scopes a complaint about a NEWSLETTER message to marketing only', async () => {
      sentPurposes.set('re_newsletter_1', 'newsletter.confirmation');

      await POST(
        post(
          'msg_newsletter_complaint',
          complaint('victim@proof.invalid', 're_newsletter_1'),
        ),
      );

      expect(suppressed).toEqual([
        { recipient: 'victim@proof.invalid', reason: 'complaint', scope: 'marketing' },
      ]);
    });

    it('keeps a complaint about ACCOUNT mail transactional', async () => {
      sentPurposes.set('re_account_1', 'identity.password-changed');

      await POST(
        post('msg_account_complaint', complaint('account@proof.invalid', 're_account_1')),
      );

      expect(suppressed[0]?.scope).toBe('transactional');
    });

    it('keeps a complaint about an UNIDENTIFIED message transactional', async () => {
      await POST(
        post('msg_unknown_complaint', complaint('unknown@proof.invalid', 're_unknown')),
      );

      expect(suppressed[0]?.scope).toBe('transactional');
    });

    it('keeps a BOUNCE transactional whatever was sent', async () => {
      sentPurposes.set('re_newsletter_2', 'newsletter.confirmation');
      const payload = JSON.stringify({
        type: 'email.bounced',
        data: { to: ['bounced@proof.invalid'], email_id: 're_newsletter_2' },
      });

      await POST(post('msg_newsletter_bounce', payload));

      expect(suppressed[0]?.scope).toBe('transactional');
    });
  });
});
