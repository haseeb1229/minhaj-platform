import 'server-only';

import { identityRuntime } from '@/composition/identity';
import { appLogger } from '@/composition/logging';
import { serverEnv } from '@/config/server-env';
import { recipientFromEvent, verifyResendWebhook } from '@minhaj/database';

/**
 * The Resend delivery-event callback — PROTOCOL CLASS B
 * (SECURITY_BASELINE.md §7.2).
 *
 * A machine callback carries no browser session and sends no Origin this
 * application controls, so `SameSite`, framework CSRF and Origin checks mean
 * nothing here and applying them would break the integration while protecting
 * nobody. The equivalent guarantee is cryptographic: **an unverified callback
 * is an unauthenticated write path**, and this one refuses rather than
 * degrades.
 *
 * WHY THIS IS THE ONLY ROUTE HANDLER IN THE PHASE. Every browser mutation goes
 * through a Server Action, which is why there is no `/api/auth/*` catch-all
 * (see `(identity)/actions.ts`). A provider callback cannot be a Server Action
 * — it is not a browser and holds no action id — so it is a Route Handler, and
 * the ONE narrowly required one.
 *
 * IT IS NOT REACHABLE BY GET. Only `POST` is exported, so a browser, a
 * prefetch or a crawler following the URL receives 405 and changes nothing.
 */

/** Node, not Edge: verification and the delivery store both need it. */
export const runtime = 'nodejs';

/** Never cached, never statically evaluated. Each call is a distinct event. */
export const dynamic = 'force-dynamic';

/** The three Standard Webhooks headers Resend sends. */
function webhookHeaders(request: Request) {
  return {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  };
}

/**
 * Provider events this platform acts on.
 *
 * A deliberately short list. Every other event Resend can send is accepted,
 * de-duplicated and ignored — recording an event is not the same as having a
 * use for it, and reacting to events nobody chose to handle is how a webhook
 * grows behaviour nobody reviewed.
 */
const SUPPRESSING_EVENTS: Readonly<Record<string, 'bounce' | 'complaint'>> = {
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
};

export async function POST(request: Request): Promise<Response> {
  const environment = serverEnv();

  // THE RAW BYTES, read before any parsing. A signature covers exactly what was
  // transmitted, so verifying a re-serialised object verifies something the
  // provider never signed — and any difference in key order, spacing or unicode
  // escaping would either reject every valid event or be papered over by a
  // lenient comparison.
  const rawBody = await request.text();

  const verification = verifyResendWebhook(
    { signingSecret: environment.RESEND_WEBHOOK_SECRET ?? null },
    rawBody,
    webhookHeaders(request),
  );

  if (!verification.verified) {
    // FAIL CLOSED, including when no secret is configured. An endpoint that
    // accepted events because it had nothing to check them with would be an
    // open write path into delivery and suppression state.
    //
    // The response says only that it was rejected. Telling a caller WHICH of
    // signature, secret or timestamp failed helps only a caller trying to forge
    // one, and the reason is logged where an operator can see it instead.
    appLogger().warn(
      { provider: 'resend', reason: verification.reason },
      'Rejected an unverified provider webhook.',
    );

    return new Response(null, { status: 401 });
  }

  const { providerEvents } = identityRuntime();

  // EXACTLY ONCE, and "once" means once COMPLETED — not once seen.
  //
  // The de-duplication key is enforced by a unique constraint rather than a
  // check-then-act, because two concurrent deliveries of one event would both
  // pass a check. But the constraint only establishes that the event ARRIVED,
  // and this handler used to read that as "already dealt with": an event
  // recorded by an attempt that then died was answered 204 forever after, and
  // the suppression it carried never happened. A bounce that never suppresses
  // is mail that keeps going to an address the provider has already rejected,
  // which is how a sending reputation is lost quietly.
  //
  // So admission distinguishes the two, and an unfinished event is handed back
  // for another go (§7.2).
  const admission = await providerEvents.admit({
    provider: 'resend',
    eventId: verification.eventId,
    type: verification.type,
  });

  if (admission === 'already-processed') return new Response(null, { status: 204 });

  const reason = SUPPRESSING_EVENTS[verification.type];
  const recipient = reason === undefined ? null : recipientFromEvent(rawBody);

  // ONE ATOMIC STEP: the effect and the completion that records it.
  //
  // Scoped to `transactional`, which is the scope this platform sends in. The
  // type keeps a future marketing unsubscribe structurally unable to suppress
  // verification, reset or account-security mail (ARCHITECTURE.md §4.6.1).
  //
  // An event with no effect — every type not in the short list above, and a
  // suppressing one whose payload names no recipient — completes with `null`.
  // It is genuinely finished: there was nothing to do and nothing was left.
  await providerEvents.complete({
    provider: 'resend',
    eventId: verification.eventId,
    effect:
      reason === undefined || recipient === null
        ? null
        : { recipient, reason, scope: 'transactional' },
  });

  // 204: accepted, nothing to say. A body here would only be read by a
  // provider that does not read bodies.
  return new Response(null, { status: 204 });
}
