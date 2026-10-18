import 'server-only';

import { setTimeout as pause } from 'node:timers/promises';

import { STRIPE_API_VERSION, type StripeProviderConfig } from './config.ts';

/**
 * The adapter's ONE HTTP exchange with Stripe — native `fetch`, no SDK.
 *
 * BOUNDED IN EVERY DIRECTION. One `AbortController` deadline covers the
 * headers AND the body; the body is read through a streaming cap and abandoned
 * the moment it exceeds it; redirects are refused rather than followed.
 *
 * NOTHING ESCAPES. The secret key travels only in the `Authorization` header
 * of the request it authenticates. No header, body, URL with a reference in it
 * or provider message is returned in an error, thrown, or logged — the
 * results below carry a status and a parsed body, or a bare failure class.
 *
 * NO POST IS EVER RETRIED. A money-moving request whose answer was lost is
 * `unknown` to the caller, who reconciles it under the SAME idempotency key;
 * retrying here would be guessing. Only GETs — idempotent by definition — are
 * retried, once, after a short bounded pause.
 */

/** A response body larger than this is not a Stripe object this adapter reads. */
const STRIPE_RESPONSE_CAP_BYTES = 1024 * 1024;

/** The one pause before the single GET retry. */
const GET_RETRY_PAUSE_MS = 250;

export type StripeExchange =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown }
  | {
      readonly kind: 'failure';
      readonly failure: 'timeout' | 'network' | 'too-large' | 'unparseable';
    };

export interface StripeRequest {
  readonly method: 'GET' | 'POST';
  /** An absolute path built by this adapter from validated references. */
  readonly path: string;
  readonly query?: readonly (readonly [string, string])[];
  readonly form?: readonly (readonly [string, string])[];
  readonly idempotencyKey?: string;
}

function encodeForm(pairs: readonly (readonly [string, string])[]): string {
  const params = new URLSearchParams();
  for (const [name, value] of pairs) params.append(name, value);
  return params.toString();
}

async function readCapped(
  response: Response,
): Promise<{ readonly bytes: Uint8Array } | { readonly tooLarge: true }> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^[0-9]+$/u.test(declared)) {
    if (Number.parseInt(declared, 10) > STRIPE_RESPONSE_CAP_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
  }

  const body = response.body;
  if (body === null) return { bytes: new Uint8Array(0) };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > STRIPE_RESPONSE_CAP_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

async function exchangeOnce(
  config: StripeProviderConfig,
  request: StripeRequest,
): Promise<StripeExchange> {
  const url = new URL(request.path, config.apiOrigin);
  // The path is built by this adapter, but the origin is asserted anyway: a
  // reference that somehow carried `//host` must never move the credential.
  if (url.origin !== config.apiOrigin) return { kind: 'failure', failure: 'network' };
  for (const [name, value] of request.query ?? []) url.searchParams.append(name, value);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.secretKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (request.method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeForm(request.form ?? []);
    if (request.idempotencyKey !== undefined)
      headers['Idempotency-Key'] = request.idempotencyKey;
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), config.timeoutMs);
  const transport = config.fetch ?? fetch;

  try {
    const response = await transport(url, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'error',
      signal: controller.signal,
      cache: 'no-store',
    });

    const read = await readCapped(response);
    if ('tooLarge' in read) return { kind: 'failure', failure: 'too-large' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes));
    } catch {
      return { kind: 'failure', failure: 'unparseable' };
    }
    return { kind: 'response', status: response.status, body: parsed };
  } catch {
    return {
      kind: 'failure',
      failure: controller.signal.aborted ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(deadline);
  }
}

function transient(exchange: StripeExchange): boolean {
  if (exchange.kind === 'failure') {
    return exchange.failure === 'timeout' || exchange.failure === 'network';
  }
  return exchange.status === 429 || exchange.status >= 500;
}

/**
 * Performs one exchange. A GET that failed transiently is repeated ONCE after
 * a short pause; a POST never is.
 */
export async function stripeExchange(
  config: StripeProviderConfig,
  request: StripeRequest,
): Promise<StripeExchange> {
  const first = await exchangeOnce(config, request);
  if (request.method !== 'GET' || !transient(first)) return first;

  await pause(GET_RETRY_PAUSE_MS);
  return exchangeOnce(config, request);
}
