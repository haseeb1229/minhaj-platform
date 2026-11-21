import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { TeacherName } from '@/components/live-learning/parts';
import { messagingMessages } from '@/components/messaging/parts';
import { messagingRead } from '@/components/messaging/read';
import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { PersonalTime } from '@/components/personal/parts';
import { Alert, EmptyState, Panel } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { teacherProfilesFor } from '@/composition/learning-teachers';
import { messagingRuntime } from '@/composition/messaging';
import { MyPage } from '@/components/my/frame';
import { MyListStatus } from '@/components/my/list-parts';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { MySteps } from '@/components/my/summary-parts';
import { classLinks } from '@/components/my-classes/parts';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { requireActiveSession } from '../guard';
import { startTeachingAction } from '../messages/actions';

/**
 * My Teachers — the teachers the person has a GENUINE relationship with
 * (ROUTE_MAP.md §5.1; DELIVERY_PLAN.md Phase 23): those currently teaching a
 * Course the person is enrolled on, or whose class the person has attended or
 * is booked on. Learning answers that by account; People's PUBLIC reader
 * answers the name and the profile address, and a teacher with no published
 * profile is "Teacher", in words, with no link.
 *
 * MESSAGING A TEACHER (Phase 24). Beside each Course a teacher teaches the
 * person NOW, a "Message" button opens — or returns to — that relationship's
 * conversation. Which pairs qualify is Messaging's own answer
 * (`startable`), read separately: a past teacher, a Course the person has
 * left, or messaging that is not switched on shows no button, and an outage
 * there never hides this list. Nothing here rates or otherwise contacts a
 * teacher.
 *
 * MY MINHAJ PART 2: Classes and Teachers as tabs, the trail, how many
 * teachers there are (Learning's read is the whole bounded list), and a
 * first-run page that says how a teacher comes to be listed here.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'teachers');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyTeachersPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/teachers');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myClasses' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const frame = {
    related: { label: t('nav.label'), links: classLinks(locale, t) },
    title: t('teachers.title'),
    description: <p>{t('teachers.description')}</p>,
    tabs: {
      label: my('tabs.label.classes'),
      items: myTabs(locale, 'classes', 'teachers', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: my('trail.teachers') }]),
    },
  };

  const read = await learningRead('learning-my-teachers', async () => {
    const teachers = await learningRuntime().myClasses.teachers({
      accountId: session.account.id,
    });
    const profiles = await teacherProfilesFor(
      teachers.map((teacher) => teacher.teacherAccountId),
      locale,
    );
    return { teachers, profiles };
  });

  const startable = await messagingRead('messaging-startable', () =>
    messagingRuntime().service.startable({ accountId: session.account.id }),
  );
  const current = new Set(
    startable.ok
      ? startable.value.map((entry) => `${entry.counterpartAccountId}:${entry.courseId}`)
      : [],
  );
  const m = await getTranslations({ locale, namespace: 'messages' });

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const { teachers, profiles } = read.value;
  const timeZone = session.account.timezone;

  return (
    <MyPage {...frame}>
      {startable.ok || startable.failure !== 'unavailable' ? null : (
        <Alert tone="error">{m('start.unavailable')}</Alert>
      )}
      {teachers.length === 0 ? (
        <div className="flex flex-col gap-4">
          <EmptyState
            icon="user"
            title={my('teachersPage.emptyTitle')}
            action={{
              href: localizedPath(locale, '/learn/teachers'),
              text: t('teachers.find'),
            }}
          >
            {t('teachers.empty')}
          </EmptyState>
          <MySteps
            label={my('teachersPage.stepsLabel')}
            steps={(['enrol', 'class', 'message'] as const).map((key) => ({
              key,
              title: my(`teachersPage.steps.${key}.title`),
              body: my(`teachersPage.steps.${key}.body`),
            }))}
          />
        </div>
      ) : (
        <>
          <MyListStatus>
            {my('teachersPage.count', { count: teachers.length })}
          </MyListStatus>
          <ul
            aria-label={t('teachers.title')}
            className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]"
          >
            {teachers.map((teacher) => (
              <Panel key={teacher.teacherAccountId} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-lg font-semibold">
                    <TeacherName
                      profile={profiles.get(teacher.teacherAccountId)}
                      locale={locale}
                      fallback={t('teachers.unnamed')}
                    />
                  </p>
                  {teacher.courses.length === 0 ? null : (
                    <div className="flex flex-col gap-1 text-sm">
                      <span className="text-foreground-muted">
                        {t('teachers.courses')}
                      </span>
                      <ul className="flex flex-col gap-1 ps-4">
                        {teacher.courses.map((course) => (
                          <li key={course.id} className="list-disc">
                            <div className="flex min-w-0 flex-col gap-2 wrap-anywhere">
                              <LearningTitle
                                labels={course.labels}
                                primaryLocale={course.primaryLocale}
                                locale={locale}
                              />
                              {current.has(`${teacher.teacherAccountId}:${course.id}`) ? (
                                <ActionForm
                                  action={startTeachingAction}
                                  submitLabel={m('start.submit', {
                                    name:
                                      profiles.get(teacher.teacherAccountId)?.name ??
                                      t('teachers.unnamed'),
                                    course:
                                      pickLabel(
                                        course.labels,
                                        locale,
                                        course.primaryLocale,
                                      )?.title ?? m('start.someCourse'),
                                  })}
                                  pendingLabel={m('common.working')}
                                  tone="secondary"
                                  messages={messagingMessages(m)}
                                >
                                  <input type="hidden" name="locale" value={locale} />
                                  <input
                                    type="hidden"
                                    name="counterpartAccountId"
                                    value={teacher.teacherAccountId}
                                  />
                                  <input
                                    type="hidden"
                                    name="courseId"
                                    value={course.id}
                                  />
                                </ActionForm>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-sm">
                    {t('teachers.upcoming', { count: teacher.upcoming })}
                  </p>
                  <p className="text-sm text-foreground-muted">
                    {teacher.lastClassAt === null ? (
                      t('teachers.noLast')
                    ) : (
                      <>
                        {t('teachers.last')}{' '}
                        <PersonalTime
                          value={teacher.lastClassAt.toISOString()}
                          locale={locale}
                          timeZone={timeZone}
                        />
                      </>
                    )}
                  </p>
                </div>
              </Panel>
            ))}
          </ul>
        </>
      )}
    </MyPage>
  );
}
