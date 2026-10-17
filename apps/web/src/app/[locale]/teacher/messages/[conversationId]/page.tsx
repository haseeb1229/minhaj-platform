import { getTranslations } from 'next-intl/server';

import { ConversationScreen } from '@/components/messaging/conversation';
import { readBefore } from '@/components/messaging/presentation';
import { NotActivated } from '@/components/teacher/parts';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../guard';
import {
  blockTeacherAction,
  markTeacherReadAction,
  reportTeacherAction,
  sendTeacherMessageAction,
  unblockTeacherAction,
} from '../actions';

/**
 * One of the teacher's conversations with a learner (ROUTE_MAP.md §6;
 * DELIVERY_PLAN.md Phase 24).
 *
 * The Teacher area's guard admits a current teacher; the Messaging service
 * then decides, on this request, whether THIS conversation's teaching
 * relationship still holds. A learner who has left the Course, or a scope that
 * has ended, turns the page into the ended statement — nothing of the
 * conversation is shown.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function TeacherConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly conversationId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { conversationId } = await params;
  const gate = await requireTeacher(
    locale,
    `/${locale}/teacher/messages/${encodeURIComponent(conversationId)}`,
  );
  if (!gate.activated) {
    const t = await getTranslations({ locale, namespace: 'teacher' });
    return <NotActivated t={t} />;
  }

  return (
    <ConversationScreen
      surface="teacher"
      locale={locale}
      accountId={gate.actor.accountId}
      timeZone={gate.session.account.timezone}
      conversationId={conversationId}
      before={readBefore(await searchParams)}
      actions={{
        send: sendTeacherMessageAction,
        markRead: markTeacherReadAction,
        block: blockTeacherAction,
        unblock: unblockTeacherAction,
        report: reportTeacherAction,
      }}
    />
  );
}
