import { RECITATION_UPLOAD_MAX_BYTES } from '@minhaj/contracts/quran';

import { answer, chunks, decodedHeader } from '@/app/api/admin/media/upload-transport';
import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { consumeRecitationUpload, quranRuntime } from '@/composition/quran';
import { isSameOriginMutation } from '@/composition/same-origin';
import { quranFailure } from '@/contexts/quran';

/**
 * `POST /api/admin/quran/recitations/{recitationId}/segments/{segmentId}/asset`
 * — uploads one recitation segment's audio and records it (Phase 18).
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION. A Server Action body is capped by
 * the framework at 1 MB, and that cap is GLOBAL — it also bounds the anonymous
 * correspondence action. It is NOT raised for recitation audio
 * (SECURITY_BASELINE.md §10.1).
 *
 * A CLASS-A BROWSER MUTATION, with every rule of SECURITY_BASELINE.md §7.1 made
 * explicit because a Route Handler inherits none of a Server Action's:
 *
 *   1. POST only — there is no GET, so nothing here changes on a link;
 *   2. same origin, Fetch Metadata and a custom intent header, checked BEFORE
 *      the session is even looked at (`isSameOriginMutation`);
 *   3. a signed-in session holding `quran.administer` NOW, and the Quran upload
 *      re-reads that permission live before it accepts a byte;
 *   4. a declared length, required and bounded BEFORE the body is read — the
 *      stream is bounded again by Storage while it is written, so a lying
 *      `Content-Length` cannot exceed the ceiling either;
 *   5. a per-account upload budget of its own, spent before a byte is stored.
 *
 * STREAMED, NEVER BUFFERED, through the platform's one upload transport: the
 * request body goes straight to `StorageServicePort.store`, which writes it
 * under a server-generated key outside the web root, hashes it, sniffs it,
 * quarantines it and scans it. The transport carries bytes and fixed-vocabulary
 * answers only; it knows nothing of Media or of Quran.
 *
 * THE BROWSER'S CLAIMS GRANT NOTHING. The declared type can only REFUSE a
 * mismatch against the sniffed type; the filename is display text Storage
 * sanitises and never uses for a path; the Recitation, segment and version come
 * from the path and a header and are checked against current state.
 *
 * ANSWERS ARE JSON WITH QURAN'S FIXED VOCABULARY and `private, no-store`. A
 * failure is named in words the operator's screen has — never a stack, a
 * constraint name, a storage key or a scanner signature — and anything
 * unrecognised is logged by operation name only.
 */
export const dynamic = 'force-dynamic';

/** The custom header the admin uploader sends. No HTML form can set it. */
const INTENT = { header: 'x-minhaj-intent', value: 'quran-recitation-upload' } as const;

/** Each refusal's HTTP status; the body always carries the reason. */
const STATUS: Readonly<Record<string, number>> = {
  denied: 403,
  invalid: 400,
  'not-found': 404,
  conflict: 409,
  'too-large': 413,
  'type-not-allowed': 415,
  'not-cleared': 422,
  infected: 422,
  'rate-limited': 429,
};

function refused(failure: string): Response {
  return answer(STATUS[failure] ?? 500, { status: 'error', failure });
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ readonly recitationId: string; readonly segmentId: string }>;
  },
): Promise<Response> {
  if (!isSameOriginMutation(request, INTENT)) return refused('denied');
  if (request.headers.get('content-type') !== 'application/octet-stream')
    return refused('type-not-allowed');

  const permitted = await requirePermittedAction('en', 'quran.administer');
  if (permitted.state === 'denied') return refused('denied');

  const declared = request.headers.get('content-length');
  const length = declared === null ? Number.NaN : Number(declared);
  if (!Number.isSafeInteger(length) || length <= 0) return refused('invalid');
  if (length > RECITATION_UPLOAD_MAX_BYTES) return refused('too-large');

  // A missing header reads as 0, which no record's version can be.
  const version = Number(request.headers.get('x-expected-version'));
  if (!Number.isSafeInteger(version) || version < 1 || request.body === null)
    return refused('invalid');

  const accountId = permitted.session.account.id;
  if (!(await consumeRecitationUpload(accountId))) return refused('rate-limited');

  const { recitationId, segmentId } = await params;

  try {
    const saved = await quranRuntime().upload.uploadSegmentAudio(
      { accountId },
      recitationId,
      segmentId,
      version,
      chunks(request.body),
      {
        declaredMediaType: request.headers.get('x-file-type') || null,
        displayName: decodedHeader(request.headers.get('x-file-name'), 200),
      },
    );
    return answer(200, { status: 'success', version: saved.version });
  } catch (error) {
    const failure = quranFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'quran-upload-recitation-audio' },
        'Recitation audio upload failed.',
      );
    return refused(failure);
  }
}
