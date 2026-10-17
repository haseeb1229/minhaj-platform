import { messagingFailure } from '@minhaj/server-core/messaging';

import { answer } from '@/app/api/admin/media/upload-transport';
import { appLogger } from '@/composition/logging';
import { messagingRuntime } from '@/composition/messaging';
import { isSameOriginMutation } from '@/composition/same-origin';
import { MESSAGING_INTENT, failed, messagingActor } from '../../../transport';

/**
 * `POST /api/messaging/attachments/{attachmentId}/discard` — releases one of
 * the signed-in person's own UNSENT uploads (Phase 24), from the same uploader
 * script that made it.
 *
 * The same Class-A admission as the upload — POST only, configured origin,
 * Fetch Metadata and the intent header BEFORE the session is consulted — and
 * no body is read. Messaging decides the rest: only the uploader, and only
 * while the upload is not yet part of a message; anything else is the one
 * `not-found`. An attachment already sent is immutable with its message.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ readonly attachmentId: string }> },
): Promise<Response> {
  if (!isSameOriginMutation(request, MESSAGING_INTENT)) return failed('denied');

  const resolved = await messagingActor('messaging-attachment-discard');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('denied');

  const { attachmentId } = await params;

  try {
    await messagingRuntime().service.discardAttachment(resolved.actor, attachmentId);
    return answer(200, { status: 'success' });
  } catch (error) {
    const failure = messagingFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'messaging-attachment-discard' },
        'Messaging attachment discard failed.',
      );
    return failed(failure);
  }
}
