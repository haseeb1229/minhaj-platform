import { AUDIO_UPLOAD_MAX_BYTES } from '@minhaj/contracts/media';

import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { consumeMediaUpload, mediaRuntime } from '@/composition/media';
import { isSameOriginMutation } from '@/composition/same-origin';
import { mediaFailure } from '@/contexts/media';

/**
 * `POST /api/admin/media/audio/{trackId}/asset` — uploads a track's audio file
 * and attaches it (Phase 11).
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION. A Server Action body is capped by
 * the framework at 1 MB, and that cap is GLOBAL — it also bounds the anonymous
 * correspondence action. It is NOT raised for audio (SECURITY_BASELINE.md
 * §10.1): this route carries the one large browser upload the platform has, and
 * nothing else changes size.
 *
 * A CLASS-A BROWSER MUTATION, with every rule of SECURITY_BASELINE.md §7.1 made
 * explicit because a Route Handler inherits none of a Server Action's:
 *
 *   1. POST only — there is no GET, so nothing here changes on a link;
 *   2. same origin, Fetch Metadata and a custom intent header, checked BEFORE
 *      the session is even looked at (`isSameOriginMutation`);
 *   3. a signed-in session holding `media.administer` NOW, and the Media service
 *      re-reads that permission live before it accepts a byte;
 *   4. a per-account upload budget, spent before a byte is stored;
 *   5. a declared length, required and bounded BEFORE the body is read — the
 *      stream is bounded again by Storage while it is written, so a lying
 *      `Content-Length` cannot exceed the ceiling either.
 *
 * STREAMED, NEVER BUFFERED. The request body goes straight to
 * `StorageServicePort.store`, which writes it under a server-generated key
 * outside the web root, hashes it as it passes, keeps only a bounded prefix for
 * content sniffing, quarantines it and scans it. The body is never materialised
 * in memory, and nothing is written into `public/`, the repository or `.next`.
 *
 * THE BROWSER'S CLAIMS GRANT NOTHING. The declared type can only REFUSE a
 * mismatch against the sniffed type; the filename is display text Storage
 * sanitises and never uses for a path; the track and version come from the
 * path and a header and are checked against current state.
 *
 * ANSWERS ARE JSON WITH A FIXED VOCABULARY and `no-store`. A failure is named in
 * words the operator's screen has — never a stack, a constraint name, a storage
 * key or a scanner verdict — and anything unrecognised is logged by operation
 * name only.
 */
export const dynamic = 'force-dynamic';

/** The custom header the admin uploader sends. No HTML form can set it. */
const INTENT = { header: 'x-minhaj-intent', value: 'media-audio-upload' } as const;

function answer(status: number, body: Record<string, unknown>): Response {
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
  unsupported: 415,
  'not-cleared': 422,
  'rate-limited': 429,
};

const failed = (failure: string) =>
  answer(STATUS[failure] ?? 500, { status: 'error', failure });

/** A header value decoded from the browser's percent-encoding, or `null`. */
function decodedHeader(value: string | null, max: number): string | null {
  if (value === null || value === '' || value.length > max * 3) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > max ? decoded.slice(0, max) : decoded;
  } catch {
    // Undecodable display text is simply not shown; it can refuse nothing.
    return null;
  }
}

/** The request body as chunks, straight from the socket. */
async function* chunks(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ readonly trackId: string }> },
): Promise<Response> {
  if (!isSameOriginMutation(request, INTENT)) return failed('denied');
  if (request.headers.get('content-type') !== 'application/octet-stream')
    return failed('unsupported');

  const permitted = await requirePermittedAction('en', 'media.administer');
  if (permitted.state === 'denied') return failed('denied');

  const declared = request.headers.get('content-length');
  const length = declared === null ? Number.NaN : Number(declared);
  if (!Number.isSafeInteger(length) || length <= 0) return failed('invalid');
  if (length > AUDIO_UPLOAD_MAX_BYTES) return failed('too-large');

  // A missing header reads as 0, which no record's version can be.
  const version = Number(request.headers.get('x-expected-version'));
  if (!Number.isSafeInteger(version) || version < 1 || request.body === null)
    return failed('invalid');

  const accountId = permitted.session.account.id;
  if (!(await consumeMediaUpload(accountId))) return failed('rate-limited');

  const { trackId } = await params;

  try {
    const saved = await mediaRuntime().audioUpload.uploadAudio(
      { accountId },
      trackId,
      version,
      chunks(request.body),
      {
        declaredMediaType: request.headers.get('x-file-type') || null,
        displayName: decodedHeader(request.headers.get('x-file-name'), 200),
      },
    );
    return answer(200, { status: 'success', version: saved.version });
  } catch (error) {
    const failure = mediaFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation: 'media-upload-audio' }, 'Audio upload failed.');
    return failed(failure);
  }
}
