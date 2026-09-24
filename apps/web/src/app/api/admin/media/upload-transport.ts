import 'server-only';

/**
 * The transport both Media upload routes share — the audio file (Phase 11) and
 * the photograph (Phase 12): how a failure is answered, how the browser's
 * display text is read, and how the request body reaches Storage.
 *
 * ONE IMPLEMENTATION, so the two routes cannot drift apart on what a refusal
 * looks like or on whether a body is ever buffered. The Class-A checks, the
 * permission, the size bound and the budget stay in each route, in the order
 * its architecture test asserts.
 */

/** A JSON answer with a fixed vocabulary, never cached and never indexed. */
export function answer(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** Each refusal's HTTP status; the body always carries the reason. */
const STATUS: Readonly<Record<string, number>> = {
  denied: 403,
  invalid: 400,
  'not-found': 404,
  conflict: 409,
  'too-large': 413,
  dimensions: 413,
  unsupported: 415,
  'not-cleared': 422,
  'rate-limited': 429,
};

/** A refusal, in words the operator's screen has — never a stack or a key. */
export function failed(failure: string): Response {
  return answer(STATUS[failure] ?? 500, { status: 'error', failure });
}

/** A header value decoded from the browser's percent-encoding, or `null`. */
export function decodedHeader(value: string | null, max: number): string | null {
  if (value === null || value === '' || value.length > max * 3) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > max ? decoded.slice(0, max) : decoded;
  } catch {
    // Undecodable display text is simply not shown; it can refuse nothing.
    return null;
  }
}

/** The request body as chunks, straight from the socket — never gathered. */
export async function* chunks(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
