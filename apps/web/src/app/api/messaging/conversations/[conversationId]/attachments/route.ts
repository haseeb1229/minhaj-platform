import { MESSAGING_LIMITS } from '@minhaj/contracts/messaging';
import { messagingFailure } from '@minhaj/server-core/messaging';

import { answer, chunks, decodedHeader } from '@/app/api/admin/media/upload-transport';
import { appLogger } from '@/composition/logging';
import { messagingRuntime } from '@/composition/messaging';
import { isSameOriginMutation } from '@/composition/same-origin';
import { MESSAGING_INTENT, failed, messagingActor } from '../../../transport';

/**
 * `POST /api/messaging/conversations/{conversationId}/attachments` — uploads
 * one file a person means to send in a conversation (Phase 24).
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION. A Server Action body is capped
 * by the framework at 1 MB, globally, and that cap is not raised
 * (SECURITY_BASELINE.md §10.1). An attachment may be up to
 * `MESSAGING_LIMITS.attachmentMaxBytes`, so its bytes arrive here; the message
 * that carries it is still sent by a Server Action, naming the attachment id
 * this answer returns.
 *
 * A CLASS-A BROWSER MUTATION, every rule of SECURITY_BASELINE.md §7.1 explicit
 * because a Route Handler inherits none of a Server Action's:
 *
 *   1. POST only — there is no GET, so nothing here changes on a link;
 *   2. same origin, Fetch Metadata and a custom intent header, checked BEFORE
 *      the session is even looked at (`isSameOriginMutation`);
 *   3. a signed-in session — the actor is its account and nothing else;
 *   4. a declared length, required and bounded BEFORE the body is read — and
 *      bounded again by Storage while it is written, so a lying
 *      `Content-Length` cannot exceed the ceiling either;
 *   5. Messaging's own decision, made by the service BEFORE it consumes a
 *      byte: the conversation is the actor's, its relationship is current, it
 *      is open and unblocked, the declared format is one a message may carry,
 *      and the per-account upload budget has room.
 *
 * STREAMED, NEVER BUFFERED. The request body goes straight to Storage, which
 * writes it under a server-generated key outside the web root, sniffs its
 * real type, strips image metadata, quarantines and scans it. Only a clean
 * JPEG, PNG or PDF becomes an attachment; anything else is released.
 *
 * THE BROWSER'S CLAIMS GRANT NOTHING. The declared type can only REFUSE; the
 * file name is display text, bounded, never a path and never logged.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ readonly conversationId: string }> },
): Promise<Response> {
  if (!isSameOriginMutation(request, MESSAGING_INTENT)) return failed('denied');
  if (request.headers.get('content-type') !== 'application/octet-stream')
    return failed('unsupported');

  const resolved = await messagingActor('messaging-attachment-upload');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('denied');

  const declared = request.headers.get('content-length');
  const length = declared === null ? Number.NaN : Number(declared);
  if (!Number.isSafeInteger(length) || length <= 0) return failed('invalid');
  if (length > MESSAGING_LIMITS.attachmentMaxBytes) return failed('too-large');
  if (request.body === null) return failed('invalid');

  const { conversationId } = await params;

  try {
    const attachment = await messagingRuntime().service.uploadAttachment(
      resolved.actor,
      conversationId,
      chunks(request.body),
      {
        mediaType: request.headers.get('x-file-type') || null,
        displayName: decodedHeader(request.headers.get('x-file-name'), 200),
      },
    );
    return answer(200, {
      status: 'success',
      attachment: {
        id: attachment.id,
        mediaType: attachment.mediaType,
        byteSize: attachment.byteSize,
        displayName: attachment.displayName,
      },
    });
  } catch (error) {
    const failure = messagingFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'messaging-attachment-upload' },
        'Messaging attachment upload failed.',
      );
    return failed(failure);
  }
}
