import 'server-only';

import { Resend } from 'resend';

/**
 * Inbound Resend webhook verification — protocol class B.
 *
 * A machine callback holds no browser session and sends no Origin this
 * application controls, so browser CSRF and `SameSite` mean nothing here. The
 * equivalent guarantee is cryptographic, and **a callback that skips signature
 * verification is an unauthenticated endpoint** (SECURITY_BASELINE.md §7.2).
 *
 * The provider's OWN verifier is used rather than a hand-written
 * implementation of the Standard Webhooks scheme. Signature parsing has real
 * subtleties — multiple signatures during a secret rotation, the exact signed
 * payload construction, constant-time comparison — and re-deriving them from a
 * specification is how a verifier ends up subtly permissive.
 */

export interface WebhookConfiguration {
  /**
   * The signing secret.
   *
   * Absent where the real webhook integration is not enabled. Its absence must
   * not fail a build or an unrelated test — but it must never cause an
   * unsigned event to be accepted, so the verifier below refuses outright
   * rather than skipping verification.
   */
  readonly signingSecret: string | null;
}

export type WebhookVerification =
  | { readonly verified: true; readonly eventId: string; readonly type: string }
  | { readonly verified: false; readonly reason: WebhookRejection };

/**
 * A non-secret placeholder for a client that only ever verifies.
 *
 * The SDK requires a key to construct; this code path never sends a request,
 * so no real key is needed and none is used. Asserted by test.
 */
const VERIFICATION_ONLY_PLACEHOLDER = 're_local_verification_only_no_api_call';

export type WebhookRejection =
  'not-configured' | 'missing-headers' | 'invalid-signature' | 'malformed-event';

/** The three Standard Webhooks headers Resend sends. */
export interface WebhookHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

interface WebhookEventShape {
  readonly type?: unknown;
  readonly data?: unknown;
}

/**
 * Verifies a provider event against the RAW request body.
 *
 * The raw bytes matter: a signature covers exactly what was transmitted, so
 * verifying a re-serialised object would verify something the provider never
 * signed — and any difference in key order, spacing or unicode escaping would
 * either break every valid event or, worse, be papered over by a lenient
 * comparison. Layer 4 therefore reads the body as text and hands that text
 * here BEFORE any JSON parsing.
 */
export function verifyResendWebhook(
  configuration: WebhookConfiguration,
  rawBody: string,
  headers: WebhookHeaders,
): WebhookVerification {
  if (configuration.signingSecret === null || configuration.signingSecret === '') {
    // FAIL CLOSED. An endpoint that accepted events because it had no secret
    // to check them with would be an open write path into delivery state.
    return { verified: false, reason: 'not-configured' };
  }

  if (headers.id === null || headers.timestamp === null || headers.signature === null) {
    return { verified: false, reason: 'missing-headers' };
  }

  let event: WebhookEventShape;

  try {
    // Signature, timestamp window and multi-signature handling are all the
    // verifier's; it throws on any of them.
    //
    // THE CONSTRUCTOR ARGUMENT IS NOT A CREDENTIAL. `webhooks.verify` is a
    // pure local computation — an HMAC over the raw body — and makes no API
    // call, but the SDK's constructor refuses to build a client with no key at
    // all and throws before verification is ever reached. Passing `undefined`
    // therefore turned every legitimate event into a rejection, which is a
    // fail-closed direction and still completely broken.
    //
    // The placeholder below is a fixed non-secret marker, chosen to be
    // obviously not a credential if it ever surfaces anywhere. The real
    // signing secret is the `webhookSecret` argument, and it is the only value
    // here that authenticates anything.
    event = new Resend(VERIFICATION_ONLY_PLACEHOLDER).webhooks.verify({
      payload: rawBody,
      headers: {
        id: headers.id,
        timestamp: headers.timestamp,
        signature: headers.signature,
      },
      webhookSecret: configuration.signingSecret,
    }) as WebhookEventShape;
  } catch {
    // One reason for every cryptographic failure. Telling a caller WHICH of
    // signature, secret or timestamp failed helps only a caller trying to
    // forge one.
    return { verified: false, reason: 'invalid-signature' };
  }

  const type = typeof event.type === 'string' ? event.type : null;
  if (type === null) return { verified: false, reason: 'malformed-event' };

  // The event identifier is the `svix-id` header — the value the provider
  // deduplicates on, and therefore the value replay protection must key on.
  return { verified: true, eventId: headers.id, type };
}

/**
 * Extracts the recipient from a delivery event, or `null`.
 *
 * Deliberately narrow: only the one field suppression needs. **No arbitrary
 * provider payload is stored**, and nothing else is read, so a change to an
 * unrelated part of the provider's schema cannot reach this platform's tables
 * (SECURITY_BASELINE.md §7.2).
 */
/**
 * The provider's id of the message an event is about (`data.email_id`), or
 * null. Used only to look up what kind of message it was; never stored here.
 */
export function messageIdFromEvent(rawBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const id = (parsed as { data?: { email_id?: unknown } }).data?.email_id;
    return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null;
  } catch {
    return null;
  }
}

export function recipientFromEvent(rawBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const data = (parsed as { data?: { to?: unknown } }).data;
    const to = data?.to;

    if (typeof to === 'string') return to;
    if (Array.isArray(to) && typeof to[0] === 'string') return to[0];
    return null;
  } catch {
    return null;
  }
}
