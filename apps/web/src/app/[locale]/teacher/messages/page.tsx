import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { ConversationList } from '@/components/messaging/parts';
import { readCursor, withQuery } from '@/components/messaging/presentation';
import {
  courseListings,
  messagingRead,
  participantNames,
} from '@/components/messaging/read';
import { MyListStatus } from '@/components/my/list-parts';
import { MyFigures, MySteps } from '@/components/my/summary-parts';
import {
  NotActivated,
  TeacherFrame,
  TeacherSection,
  teacherTrail,
} from '@/components/teacher/parts';
import { Alert, EmptyState, TextLink } from '@/components/ui';
import { teacherPageMetadata } from '@/components/teacher/metadata';
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
 *
 * COUNTED ONLY WHEN TRUE (Teacher area, R2), as My Minhaj's inbox is.
 * Messaging re-decides every conversation on the request, so no stored count
 * is the inbox's size: the list keeps Messaging's keyset pages, and the
 * conversations, those with unread messages and the unread messages are
 * counted only when the whole inbox is on this one page — otherwise a line
 * says which conversations are shown. A first visit learns how a
 * conversation begins, in three steps. No Messaging read is added.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'messages');
}

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
  const path = localizedPath(locale, '/teacher/messages');
  const gate = await requireTeacher(locale, path);
  const teacher = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={teacher} />;
  const t = await getTranslations({ locale, namespace: 'messages' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const cursor = readCursor(await searchParams);
  const { service } = messagingRuntime();

  const read = await messagingRead('messaging-teacher-list', async () => {
    const [capabilities, page] = await Promise.all([
      service.capabilities(),
      service.conversations(gate.actor, { surface: 'teacher', cursor }),
    ]);
    return { capabilities, page };
  });

  const frame = {
    title: t('title'),
    description: <p>{t('teacher.description')}</p>,
    trail: teacherTrail(locale, teacher, [{ text: teacher('nav.messages') }]),
  };

  if (!read.ok)
    return (
      <TeacherFrame {...frame}>
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

  const number = new Intl.NumberFormat(locale);
  const shown = page.conversations.length;
  // The whole inbox is here only on the newest page with nothing after it.
  const whole = cursor === null && page.next === null;
  const live = page.conversations.filter((entry) => entry.access === 'available');
  const unreadConversations = live.filter((entry) => entry.unread > 0).length;
  const unreadMessages = live.reduce((total, entry) => total + entry.unread, 0);

  return (
    <TeacherFrame
      {...frame}
      announce={{
        value: `${String(shown)}:${String(unreadMessages)}`,
        message: my('live.messages', { count: unreadMessages }),
      }}
    >
      {capabilities.fixture ? <Alert tone="warning">{t('fixture')}</Alert> : null}
      {capabilities.teacherStudent ? null : (
        <Alert tone="info">{t('teacher.notActivated')}</Alert>
      )}

      {whole && shown > 0 ? (
        <MyFigures
          label={my('messagesPage.figures')}
          figures={[
            {
              key: 'conversations',
              value: number.format(shown),
              label: my('messagesPage.conversations'),
            },
            {
              key: 'unreadConversations',
              value: number.format(unreadConversations),
              label: my('messagesPage.unreadConversations'),
            },
            {
              key: 'unreadMessages',
              value: number.format(unreadMessages),
              label: my('messagesPage.unreadMessages'),
            },
          ]}
        />
      ) : null}

      <TeacherSection id="teacher-messages-list" heading={t('list.heading')}>
        {shown === 0 ? null : (
          <MyListStatus>
            {whole
              ? my('messagesPage.all', { count: shown })
              : cursor === null
                ? my('messagesPage.newest', { count: shown })
                : my('messagesPage.older', { count: shown })}
          </MyListStatus>
        )}
        {shown === 0 ? (
          cursor === null ? (
            <div className="flex flex-col gap-4">
              <EmptyState
                icon="message"
                {...(capabilities.teacherStudent
                  ? { title: my('messagesPage.emptyTitle') }
                  : {})}
              >
                {t('teacher.empty')}
              </EmptyState>
              {capabilities.teacherStudent ? (
                <MySteps
                  label={teacher('messagesPage.stepsLabel')}
                  steps={(['student', 'write', 'reply'] as const).map((key) => ({
                    key,
                    title: teacher(`messagesPage.steps.${key}.title`),
                    body: teacher(`messagesPage.steps.${key}.body`),
                  }))}
                />
              ) : null}
            </div>
          ) : (
            <EmptyState icon="list" action={{ href: path, text: t('list.first') }}>
              {t('list.beyond')}
            </EmptyState>
          )
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
          <nav
            aria-label={t('list.pages')}
            className="flex flex-wrap justify-between gap-x-6 gap-y-2"
          >
            {cursor === null ? (
              <span />
            ) : (
              <TextLink href={path}>{t('list.first')}</TextLink>
            )}
            {page.next === null ? null : (
              <TextLink href={withQuery(path, { cursor: page.next })}>
                {t('list.more')}
              </TextLink>
            )}
          </nav>
        )}
      </TeacherSection>
      {capabilities.teacherStudent ? (
        <p className="text-sm">
          {t('teacher.startHelp')}{' '}
          <TextLink href={localizedPath(locale, '/teacher/students')}>
            {t('nav.students')}
          </TextLink>
        </p>
      ) : null}
    </TeacherFrame>
  );
}
