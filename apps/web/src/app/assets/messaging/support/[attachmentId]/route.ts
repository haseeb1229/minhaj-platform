import { messagingRuntime } from '@/composition/messaging';
import { serveMessagingAttachment } from '../../serve';

/**
 * `/assets/messaging/support/{attachmentId}` — a support conversation's
 * attachment for SUPPORT STAFF (Phase 24).
 *
 * A SEPARATE ADDRESS FOR A SEPARATE AUTHORITY. Staff are not ordinary
 * participants: their access is Identity's live `messaging.support`, re-read
 * by Messaging on this request, and only to attachments of support
 * conversations, never withheld ones. Each opening is a sensitive access that
 * Messaging audits (identifiers only) before a byte is sent. Every refusal is
 * the same 404.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ readonly attachmentId: string }> },
): Promise<Response> {
  const { attachmentId } = await params;
  return serveMessagingAttachment('messaging-support-attachment-read', (actor) =>
    messagingRuntime().service.openSupportAttachment(actor, attachmentId),
  );
}
