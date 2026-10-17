import { ConversationScreen } from '@/components/messaging/conversation';
import { readBefore } from '@/components/messaging/presentation';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../../guard';
import {
  blockAction,
  markReadAction,
  reportAction,
  sendMessageAction,
  unblockAction,
} from '../actions';

/**
 * One of the person's own conversations — with a teacher, or with Minhaj
 * Support (ROUTE_MAP.md §5.1; DELIVERY_PLAN.md Phase 24).
 *
 * The identifier in the address grants nothing: the Messaging service decides
 * on this request whether the session's account may read it, and a
 * conversation that is not theirs is the same 404 as one that does not exist.
 * A participant whose teaching relationship has ended is told exactly that,
 * and shown nothing of the conversation.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly conversationId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { conversationId } = await params;
  const session = await requireActiveSession(
    locale,
    `/${locale}/my/messages/${encodeURIComponent(conversationId)}`,
  );

  return (
    <ConversationScreen
      surface="my"
      locale={locale}
      accountId={session.account.id}
      timeZone={session.account.timezone}
      conversationId={conversationId}
      before={readBefore(await searchParams)}
      actions={{
        send: sendMessageAction,
        markRead: markReadAction,
        block: blockAction,
        unblock: unblockAction,
        report: reportAction,
      }}
    />
  );
}
