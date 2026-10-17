import { messagingRuntime } from '@/composition/messaging';
import { serveMessagingAttachment } from '../../../serve';

/**
 * `/assets/messaging/evidence/{reportId}/{attachmentId}` — an attachment inside
 * ONE report's evidence, for a MODERATOR (Phase 24).
 *
 * THE REPORT IS THE AUTHORITY, not the conversation. Messaging re-reads the
 * moderator's live `messaging.moderate` and serves the attachment only when its
 * message lies inside the bounded window that report authorises — a withheld
 * message included, because withholding keeps it as evidence. An attachment of
 * the same conversation outside that window, or of another report, is the same
 * 404 as a missing one. Each opening is audited (identifiers only) before a
 * byte is sent.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ readonly reportId: string; readonly attachmentId: string }> },
): Promise<Response> {
  const { reportId, attachmentId } = await params;
  return serveMessagingAttachment('messaging-evidence-attachment-read', (actor) =>
    messagingRuntime().service.openEvidenceAttachment(actor, reportId, attachmentId),
  );
}
