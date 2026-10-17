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
import { PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import { Alert, EmptyState, Panel, SectionHeading, TextLink } from '@/components/ui';
import { teacherProfilesFor } from '@/composition/learning-teachers';
import { messagingRuntime } from '@/composition/messaging';
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
 */
export const metadata = { robots: { index: false, follow: false } };

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
  const path = `/${locale}/my/messages`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'messages' });
  const cursor = readCursor(await searchParams);
  const actor = { accountId: session.account.id };
  const { service } = messagingRuntime();
  const back = <PersonalLinks label={t('nav.label')} links={messagingLinks(locale, t)} />;
  const description = <p>{t('description')}</p>;

  const read = await messagingRead('messaging-my-list', async () => {
    const [capabilities, page] = await Promise.all([
      service.capabilities(),
      service.conversations(actor, { surface: 'my', cursor }),
    ]);
    return { capabilities, page };
  });

  if (!read.ok)
    return (
      <PersonalFrame title={t('title')} description={description} back={back}>
        <Alert tone="error">
          {read.failure === 'invalid' ? t('list.stale') : t('failure.load')}
        </Alert>
        {read.failure === 'invalid' ? (
          <p>
            <TextLink href={path}>{t('list.first')}</TextLink>
          </p>
        ) : null}
      </PersonalFrame>
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

  return (
    <PersonalFrame title={t('title')} description={description} back={back}>
      {capabilities.fixture ? <Alert tone="warning">{t('fixture')}</Alert> : null}
      {anyActive ? null : <Alert tone="info">{t('notActivated')}</Alert>}

      <section className="flex flex-col gap-3" aria-labelledby="messages-list">
        <span id="messages-list">
          <SectionHeading>{t('list.heading')}</SectionHeading>
        </span>
        {page.conversations.length === 0 ? (
          <EmptyState>{cursor === null ? t('list.empty') : t('list.beyond')}</EmptyState>
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
          <nav aria-label={t('list.pages')} className="flex flex-wrap gap-x-6 gap-y-2">
            {cursor === null ? null : <TextLink href={path}>{t('list.first')}</TextLink>}
            {page.next === null ? null : (
              <TextLink href={withQuery(path, { cursor: page.next })}>
                {t('list.more')}
              </TextLink>
            )}
          </nav>
        )}
      </section>

      {capabilities.teacherStudent ? (
        <section className="flex flex-col gap-3" aria-labelledby="messages-start">
          <span id="messages-start">
            <SectionHeading>{t('start.heading')}</SectionHeading>
          </span>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('start.help')}
          </p>
          {startable?.ok === false ? (
            <Alert tone="error">{t('start.unavailable')}</Alert>
          ) : offered.length === 0 ? (
            <>
              <EmptyState>{t('start.empty')}</EmptyState>
              <p>
                <TextLink href={`/${locale}/my/teachers`}>{t('nav.teachers')}</TextLink>
              </p>
            </>
          ) : (
            <ul aria-label={t('start.heading')} className="flex flex-col gap-3">
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
                          <span className="text-[color:var(--color-foreground-muted)]">
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
        </section>
      ) : null}

      {capabilities.support ? (
        <Panel>
          <div className="flex flex-col gap-2">
            <SectionHeading>{t('supportName')}</SectionHeading>
            <p className="text-sm">{t('support.teaser')}</p>
            <p>
              <TextLink href={`${path}/support`}>{t('support.link')}</TextLink>
            </p>
          </div>
        </Panel>
      ) : null}
    </PersonalFrame>
  );
}
