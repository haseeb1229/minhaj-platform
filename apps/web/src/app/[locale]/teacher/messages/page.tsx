import { getTranslations } from 'next-intl/server';

import { ConversationList } from '@/components/messaging/parts';
import { readCursor, withQuery } from '@/components/messaging/presentation';
import {
  courseListings,
  messagingRead,
  participantNames,
} from '@/components/messaging/read';
import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { Alert, EmptyState, TextLink } from '@/components/ui';
import { messagingRuntime } from '@/composition/messaging';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Messages (ROUTE_MAP.md §6; DELIVERY_PLAN.md Phase 24): the teacher's
 * conversations with learners on the Courses they currently teach.
 *
 * ONLY CURRENT RELATIONSHIPS ARE LISTED. Each conversation is shown while the
 * Messaging service — asking Learning, and through it Identity, live — finds
 * the teacher still teaching that Course and the learner still enrolled on
 * it. A conversation whose relationship has ended leaves the list; its page
 * says so. A conversation is started from a student's own page, never from a
 * directory of people.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function TeacherMessagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/teacher/messages`;
  const gate = await requireTeacher(locale, path);
  if (!gate.activated) {
    const teacher = await getTranslations({ locale, namespace: 'teacher' });
    return <NotActivated t={teacher} />;
  }
  const t = await getTranslations({ locale, namespace: 'messages' });
  const cursor = readCursor(await searchParams);
  const { service } = messagingRuntime();

  const read = await messagingRead('messaging-teacher-list', async () => {
    const [capabilities, page] = await Promise.all([
      service.capabilities(),
      service.conversations(gate.actor, { surface: 'teacher', cursor }),
    ]);
    return { capabilities, page };
  });

  const description = <p>{t('teacher.description')}</p>;

  if (!read.ok)
    return (
      <TeacherFrame title={t('title')} description={description}>
        <Alert tone="error">
          {read.failure === 'invalid' ? t('list.stale') : t('failure.load')}
        </Alert>
        {read.failure === 'invalid' ? (
          <p>
            <TextLink href={path}>{t('list.first')}</TextLink>
          </p>
        ) : null}
      </TeacherFrame>
    );

  const { capabilities, page } = read.value;
  const [names, courses] = await Promise.all([
    participantNames(page.conversations.map((entry) => entry.counterpartAccountId)),
    courseListings('teacher', gate.actor.accountId),
  ]);

  return (
    <TeacherFrame title={t('title')} description={description}>
      {capabilities.fixture ? <Alert tone="warning">{t('fixture')}</Alert> : null}
      {capabilities.teacherStudent ? null : (
        <Alert tone="info">{t('teacher.notActivated')}</Alert>
      )}
      {page.conversations.length === 0 ? (
        <EmptyState>{cursor === null ? t('teacher.empty') : t('list.beyond')}</EmptyState>
      ) : (
        <ConversationList
          conversations={page.conversations}
          surface="teacher"
          names={names}
          courses={courses}
          locale={locale}
          timeZone={gate.session.account.timezone}
          t={t}
        />
      )}
      {cursor === null && page.next === null ? null : (
        <nav aria-label={t('list.pages')} className="flex flex-wrap gap-x-6 gap-y-2">
          {cursor === null ? null : <TextLink href={path}>{t('list.first')}</TextLink>}
          {page.next === null ? null : (
            <TextLink href={withQuery(path, { cursor: page.next })}>
              {t('list.more')}
            </TextLink>
          )}
        </nav>
      )}
      {capabilities.teacherStudent ? (
        <p className="text-sm">
          {t('teacher.startHelp')}{' '}
          <TextLink href={`/${locale}/teacher/students`}>{t('nav.students')}</TextLink>
        </p>
      ) : null}
    </TeacherFrame>
  );
}
