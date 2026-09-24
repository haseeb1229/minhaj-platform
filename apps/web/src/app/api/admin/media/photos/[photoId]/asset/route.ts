import { PHOTO_UPLOAD_MAX_BYTES } from '@minhaj/contracts/media';

import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { consumePhotoUpload, mediaRuntime } from '@/composition/media';
import { isSameOriginMutation } from '@/composition/same-origin';
import { mediaFailure } from '@/contexts/media';
import { answer, chunks, decodedHeader, failed } from '../../../upload-transport';

/**
 * `POST /api/admin/media/photos/{photoId}/asset` — uploads a Photo's image and
 * attaches it (Phase 12), on the pattern Phase 11 established for audio.
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION, because a photograph is larger than the
 * framework's Server Action body cap and that cap is GLOBAL — it also bounds the
 * anonymous correspondence action — and is NOT raised (SECURITY_BASELINE.md
 * §10.1).
 *
 * A CLASS-A BROWSER MUTATION, every rule of SECURITY_BASELINE.md §7.1 explicit:
 *
 *   1. POST only;
 *   2. same configured origin, Fetch Metadata and a custom intent header,
 *      checked BEFORE the session is even looked at;
 *   3. a signed-in session holding `media.administer` NOW — re-read live again
 *      by the Media service before a byte is accepted;
 *   4. a declared length, required and bounded BEFORE the body is read, and
 *      bounded again by Storage on every byte that ARRIVES while it streams;
 *   5. a per-account photograph budget, spent before a byte is stored.
 *
 * STREAMED, NEVER BUFFERED. The body goes straight to Storage under an image
 * policy: the JPEG or PNG structure is validated and its hidden metadata
 * removed as it passes, the key is generated, the bytes are hashed, sniffed,
 * quarantined and scanned. Nothing is written into `public/`, the repository
 * or `.next`, and the browser's declared type and filename can only refuse or
 * display, never admit.
 *
 * ANSWERS ARE JSON WITH A FIXED VOCABULARY and `no-store`; anything
 * unrecognised is logged by operation name only.
 */
export const dynamic = 'force-dynamic';

/** The custom header the photograph uploader sends. No HTML form can set it. */
const INTENT = { header: 'x-minhaj-intent', value: 'media-photo-upload' } as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ readonly photoId: string }> },
): Promise<Response> {
  if (!isSameOriginMutation(request, INTENT)) return failed('denied');
  if (request.headers.get('content-type') !== 'application/octet-stream')
    return failed('unsupported');

  const permitted = await requirePermittedAction('en', 'media.administer');
  if (permitted.state === 'denied') return failed('denied');

  const declared = request.headers.get('content-length');
  const length = declared === null ? Number.NaN : Number(declared);
  if (!Number.isSafeInteger(length) || length <= 0) return failed('invalid');
  if (length > PHOTO_UPLOAD_MAX_BYTES) return failed('too-large');

  // A missing header reads as 0, which no record's version can be.
  const version = Number(request.headers.get('x-expected-version'));
  if (!Number.isSafeInteger(version) || version < 1 || request.body === null)
    return failed('invalid');

  const accountId = permitted.session.account.id;
  if (!(await consumePhotoUpload(accountId))) return failed('rate-limited');

  const { photoId } = await params;

  try {
    const saved = await mediaRuntime().photoUpload.uploadPhoto(
      { accountId },
      photoId,
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
      appLogger().error({ operation: 'media-upload-photo' }, 'Photo upload failed.');
    return failed(failure);
  }
}
