import 'server-only';

import { donationsRuntime } from '@/composition/donations';
import { admitDonationWebhook } from '@/composition/donations-webhook-admission';
import { appLogger } from '@/composition/logging';

/**
 * The payment provider's event callback — PROTOCOL CLASS B
 * (SECURITY_BASELINE.md §7.2, §14). The Stripe adapter is a SANDBOX
 * ENGINEERING ADAPTER — NOT PRODUCTION PROVIDER SELECTION.
 *
 * A machine callback carries no browser session and no Origin this
 * application controls, so `SameSite`, framework CSRF and Origin checks mean
 * nothing here. The guarantee is cryptographic and lives in the ledger: the
 * provider adapter verifies the signature over the EXACT bytes received,
 * timing-safe and inside the provider's freshness window, BEFORE anything is
 * parsed — and an event is only ever a hint about which checkout or refund to
 * re-read server-to-server. Nothing in its body moves money or state.
 *
 * WHAT THIS HANDLER DOES, IN ORDER:
 *
 *   1. admits the sender against the shared rate limiter, before any work;
 *   2. refuses a declared body over 64 KiB with 413 before reading a byte, and
 *      stops reading at 64 KiB whatever was declared;
 *   3. hands the RAW bytes and the signature header to the ledger — never
 *      `request.json()`, never a re-serialised object;
 *   4. answers with the ledger's status and an EMPTY body. 2xx: done or a
 *      duplicate; 400/401: refused; 500: the provider could not be asked just
 *      now, so the event stays admitted-not-processed and the provider retries.
 *
 * IT IS NOT REACHABLE BY GET. Only `POST` is exported, so a browser, a
 * prefetch or a crawler following the URL receives 405 and changes nothing.
 * Nothing is logged but the provider, the status and a reason category —
 * never a header, a body, a signature or a reference.
 */

/** Node, not Edge: the ledger and its database need it. */
export const runtime = 'nodejs';

/** Never cached, never statically evaluated. Each call is a distinct event. */
export const dynamic = 'force-dynamic';

/** The largest event body accepted, in bytes. Provider events are far smaller. */
const BODY_MAX_BYTES = 64 * 1024;

function empty(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

function rejected(status: number, reason: string): Response {
  appLogger().warn({ provider: 'stripe', status, reason }, 'Rejected a payment webhook.');
  return empty(status);
}

/** The body, bounded before and while it is read; `null` when it is too large. */
async function boundedBody(request: Request): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

export async function POST(request: Request): Promise<Response> {
  const admission = await admitDonationWebhook(request.headers);
  if (admission === 'limited') return rejected(429, 'rate-limited');
  if (admission === 'unavailable') return rejected(503, 'unavailable');

  // DECLARED SIZE FIRST, so an oversized body is refused unread.
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) return rejected(400, 'malformed');
    if (length > BODY_MAX_BYTES) return rejected(413, 'too-large');
  }

  const rawBody = await boundedBody(request);
  if (rawBody === null) return rejected(413, 'too-large');

  let outcome: { readonly status: number; readonly reason: string };
  try {
    outcome = await donationsRuntime().ledger.receiveWebhook({
      rawBody,
      signature: request.headers.get('stripe-signature'),
    });
  } catch {
    // An outage: the event was not completed, so the provider retries it.
    return rejected(500, 'unavailable');
  }

  // The ledger's reason is a category (`invalid-signature`, `stale`,
  // `deferred` …), never content, so it is the one thing worth logging.
  return outcome.status < 400
    ? empty(outcome.status)
    : rejected(outcome.status, outcome.reason);
}
