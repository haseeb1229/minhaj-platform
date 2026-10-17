import { messageSequenceSchema, type MessageView } from '@minhaj/contracts/messaging';
import { messagingFailure } from '@minhaj/server-core/messaging';

import { answer } from '@/app/api/admin/media/upload-transport';
import { isPrivateRead } from '@/app/api/my/personal-transport';
import { appLogger } from '@/composition/logging';
import { messagingRuntime } from '@/composition/messaging';
import { failed, messagingActor } from '../../../transport';

/**
 * `GET /api/messaging/conversations/{conversationId}/messages?after={sequence}`
 * — durable catch-up (Phase 24): exactly the messages after a sequence the
 * reader already holds, oldest first, bounded.
 *
 * IT IS NOT A SUBSCRIPTION. The conversation page calls it when the person
 * asks to check for new messages; nothing here holds a connection open, polls
 * or pushes. Phase 25's realtime transport will reach the SAME service.
 *
 * READ-ONLY, so a GET; private, `no-store` and unindexed, and a cross-site
 * embed is refused by Fetch Metadata (the personal transport's
 * `isPrivateRead`). The query names a position, never an account: the actor is
 * the session's, and the service re-decides on THIS request whether that
 * account may still read the conversation at all.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The position the query names: exactly one `after`, a canonical integer, or `null`. */
function afterOf(query: URLSearchParams): number | null {
  const present = [...query.keys()];
  if (present.length !== 1 || present[0] !== 'after') return null;
  const raw = query.get('after') ?? '';
  if (!/^(?:0|[1-9]\d{0,9})$/u.test(raw)) return null;
  const parsed = messageSequenceSchema.safeParse(Number(raw));
  return parsed.success ? parsed.data : null;
}

/** The wire shape of one message: the view's fields and nothing more. */
function wire(message: MessageView) {
  return {
    id: message.id,
    sequence: message.sequence,
    own: message.own,
    withheld: message.withheld,
    body: message.body,
    sentAt: message.sentAt.toISOString(),
    senderAccountId: message.senderAccountId,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      mediaType: attachment.mediaType,
      byteSize: attachment.byteSize,
      displayName: attachment.displayName,
    })),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly conversationId: string }> },
): Promise<Response> {
  if (!isPrivateRead(request)) return failed('denied');

  const after = afterOf(new URL(request.url).searchParams);
  if (after === null) return failed('invalid');

  const resolved = await messagingActor('messaging-catch-up');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('denied');

  const { conversationId } = await params;

  try {
    const page = await messagingRuntime().service.catchUp(
      resolved.actor,
      conversationId,
      after,
    );
    return answer(200, {
      status: 'success',
      page: {
        messages: page.messages.map(wire),
        more: page.more,
        lastSequence: page.lastSequence,
      },
    });
  } catch (error) {
    const failure = messagingFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'messaging-catch-up' },
        'Messaging catch-up failed.',
      );
    return failed(failure);
  }
}
