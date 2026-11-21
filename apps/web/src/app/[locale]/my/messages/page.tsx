import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { TeacherName } from '@/components/live-learning/parts';
import {
  ConversationList,
  messagingLinks,
  messagingMessages,
} from '@/components/messaging/parts';
import { readCursor, withQuery } from '@/components/messaging/presentation';
import {
  courseListings,
  messagingRead,
  participantNames,
} from '@/components/messaging/read';
import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { Alert, EmptyState, Panel, TextLink } from '@/components/ui';
import { teacherProfilesFor } from '@/composition/learning-teachers';
import { messagingRuntime } from '@/composition/messaging';
import { MyPage, MySection, OnwardLink } from '@/components/my/frame';
import { MyListStatus } from '@/components/my/list-parts';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { MyFigures, MySteps } from '@/components/my/summary-parts';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { requireActiveSession } from '../guard';
import { startTeachingAction } from './actions';

/**
 * My Messages — the person's own conversations (ROUTE_MAP.md §5.1;
 * DELIVERY_PLAN.md Phase 24): with the teachers of Courses they are on, and
 * with Minhaj Support.
 *
 * NOT A DIRECTORY. The only people offered here are the person's CURRENT
 * teachers — a teacher currently teaching a Course the person is enrolled on,
 * as Learning answers it now. Nobody can be searched for or written to
 * outside that relationship, and student-to-student messaging stays off
 * (OPEN_DECISIONS.md §2.5).
 *
 * HONEST WHILE SWITCHED OFF. Each kind of conversation exists only once the
 * organisation has activated it; until then the page says so in words rather
 * than listing an empty inbox.
 *
 * MY MINHAJ PART 2: Conversations and Support as tabs, the trail, and the
 * figures ONLY WHEN THEY ARE TRUE. Messaging re-decides every conversation on
 * the request (a relationship that has ended is not listed), so no stored
 * count is the inbox's size: the list keeps Messaging's keyset pages (newest
 * activity first, "Older conversations"), and the conversations, the unread
 * ones and the unread messages are counted only when the whole inbox is on
 * this one page. Otherwise the page says which conversations it shows. No
 * Messaging read is added.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'messages');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyMessagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/messages');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'messages' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const cursor = readCursor(await searchParams);
  const actor = { accountId: session.account.id };
  const { service } = messagingRuntime();
  const frame = {
    related: { label: t('nav.label'), links: messagingLinks(locale, t) },
    title: t('title'),
    description: <p>{t('description')}</p>,
    tabs: {
      label: my('tabs.label.messages'),
      items: myTabs(locale, 'messages', 'conversations', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: my('trail.messages') }]),
    },
  };

  const read = await messagingRead('messaging-my-list', async () => {
    const [capabilities, page] = await Promise.all([
      service.capabilities(),
      service.conversations(actor, { surface: 'my', cursor }),
    ]);
    return { capabilities, page };
  });

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">
          {read.failure === 'invalid' ? t('list.stale') : t('failure.load')}
        </Alert>
        {read.failure === 'invalid' ? (
          <p>
            <TextLink href={path}>{t('list.first')}</TextLink>
          </p>
        ) : null}
      </MyPage>
    );

  const { capabilities, page } = read.value;
  const anyActive = capabilities.teacherStudent || capabilities.support;

  // Offered teachers are a SEPARATE read: an outage there never hides the inbox.
  const startable = capabilities.teacherStudent
    ? await messagingRead('messaging-startable', () => service.startable(actor))
    : null;
  const offered = startable?.ok === true ? startable.value : [];

  const [names, courses, profiles] = await Promise.all([
    participantNames(page.conversations.map((entry) => entry.counterpartAccountId)),
    courseListings('my', session.account.id),
    // A teacher with no published profile — or a People outage — is "Teacher".
    teacherProfilesFor(
      offered.map((entry) => entry.counterpartAccountId),
      locale,
    ).catch(() => new Map<string, never>()),
  ]);

  const number = new Intl.NumberFormat(locale);
  const shown = page.conversations.length;
  // The whole inbox is here only on the newest page with nothing after it.
  const whole = cursor === null && page.next === null;
  const live = page.conversations.filter((entry) => entry.access === 'available');
  const unreadConversations = live.filter((entry) => entry.unread > 0).length;
  const unreadMessages = live.reduce((total, entry) => total + entry.unread, 0);
  const firstRun = whole && shown === 0;

  return (
    <MyPage
      {...frame}
      announce={{
        value: `${String(shown)}:${String(unreadMessages)}`,
        message: my('live.messages', { count: unreadMessages }),
      }}
    >
      {capabilities.fixture ? <Alert tone="warning">{t('fixture')}</Alert> : null}
      {anyActive ? null : <Alert tone="info">{t('notActivated')}</Alert>}

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

      <MySection id="messages-list" heading={t('list.heading')}>
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
                {...(anyActive ? { title: my('messagesPage.emptyTitle') } : {})}
              >
                {t('list.empty')}
              </EmptyState>
              {anyActive && firstRun ? (
                <MySteps
                  label={my('messagesPage.stepsLabel')}
                  steps={(['enrol', 'write', 'support'] as const).map((key) => ({
                    key,
                    title: my(`messagesPage.steps.${key}.title`),
                    body: my(`messagesPage.steps.${key}.body`),
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
            surface="my"
            names={names}
            courses={courses}
            locale={locale}
            timeZone={session.account.timezone}
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
      </MySection>

      {capabilities.teacherStudent ? (
        <MySection
          id="messages-start"
          heading={t('start.heading')}
          intro={t('start.help')}
        >
          {startable?.ok === false ? (
            <Alert tone="error">{t('start.unavailable')}</Alert>
          ) : offered.length === 0 ? (
            <EmptyState
              action={{
                href: localizedPath(locale, '/my/teachers'),
                text: t('nav.teachers'),
              }}
            >
              {t('start.empty')}
            </EmptyState>
          ) : (
            <ul
              aria-label={t('start.heading')}
              className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]"
            >
              {offered.map((entry) => {
                const profile = profiles.get(entry.counterpartAccountId);
                const course = courses.get(entry.courseId);
                const teacher = profile?.name ?? t('unnamed.teacher');
                const title =
                  course === undefined
                    ? t('start.someCourse')
                    : (pickLabel(course.labels, locale, course.primaryLocale)?.title ??
                      t('start.someCourse'));
                return (
                  <Panel key={`${entry.counterpartAccountId}:${entry.courseId}`} as="li">
                    <div className="flex min-w-0 flex-col gap-2 wrap-anywhere">
                      <p className="font-semibold">
                        <TeacherName
                          profile={profile}
                          locale={locale}
                          fallback={t('unnamed.teacher')}
                        />
                      </p>
                      {course === undefined ? null : (
                        <p className="flex min-w-0 flex-wrap gap-x-2 text-sm">
                          <span className="text-foreground-muted">
                            {t('list.course')}
                          </span>
                          <LearningTitle
                            labels={course.labels}
                            primaryLocale={course.primaryLocale}
                            locale={locale}
                          />
                        </p>
                      )}
                      <ActionForm
                        action={startTeachingAction}
                        submitLabel={t('start.submit', { name: teacher, course: title })}
                        pendingLabel={t('common.working')}
                        tone="secondary"
                        messages={messagingMessages(t)}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input
                          type="hidden"
                          name="counterpartAccountId"
                          value={entry.counterpartAccountId}
                        />
                        <input type="hidden" name="courseId" value={entry.courseId} />
                      </ActionForm>
                    </div>
                  </Panel>
                );
              })}
            </ul>
          )}
        </MySection>
      ) : null}

      {capabilities.support ? (
        <Panel>
          <div className="flex flex-col gap-2">
            <h2 className="text-subheading font-semibold">{t('supportName')}</h2>
            <p className="text-sm">{t('support.teaser')}</p>
            <OnwardLink href={`${path}/support`}>{t('support.link')}</OnwardLink>
          </div>
        </Panel>
      ) : null}
    </MyPage>
  );
}
