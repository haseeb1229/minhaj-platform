import { messagingRuntime } from '@/composition/messaging';
import { serveMessagingAttachment } from '../../serve';

/**
 * `/assets/messaging/attachments/{attachmentId}` — an attachment's bytes for a
 * PARTICIPANT of its conversation (Phase 24).
 *
 * Messaging decides on this request: the attachment is part of a message in a
 * conversation the signed-in account takes part in NOW, under a current
 * relationship (or its own read-only terminal history), and the message is not
 * withheld — or it is the account's own unsent upload in a conversation it may
 * still send in. Storage then applies clean custody. Every other case is the
 * same 404.
 *
 * Not locale-prefixed, for the reason Phase 7 gave: an asset is bytes and has
 * no interface locale. Only the identifier in the path is read — no query,
 * header or body influences the decision.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ readonly attachmentId: string }> },
): Promise<Response> {
  const { attachmentId } = await params;
  return serveMessagingAttachment('messaging-attachment-read', (actor) =>
    messagingRuntime().service.openAttachment(actor, attachmentId),
  );
}
