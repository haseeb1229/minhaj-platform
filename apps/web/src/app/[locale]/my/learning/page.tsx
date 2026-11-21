import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  LEARNER_OFFSET_MAX,
  LEARNING_PAGE,
  courseCompleted,
} from '@minhaj/contracts/learning';

import {
  LearningTitle,
  ProgressStatus,
  learningMessages,
} from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { lessonPercent } from '@/components/my/dashboard';
import { MyPage, MySection, OnwardLink, ProgressMeter } from '@/components/my/frame';
import {
  MyListBeyond,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
  type MyListSpec,
} from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { MyFigures, MySteps } from '@/components/my/summary-parts';
import { shortDate } from '@/components/my/time';
import { PersonalTime } from '@/components/personal/parts';
import { Alert, EmptyState, Panel, StatusBadge, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { learningLinks } from '@/components/my-learning/nav';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { requireActiveSession } from '../guard';
import { withdrawTrialAction } from './actions';

/**
 * My Learning — the person's own Enrolments, the learning paths those put them
 * on, and their trial-class requests (ROUTE_MAP.md §5.1; DELIVERY_PLAN.md
 * Phase 22). Learning owns every row here; `/my` only places it.
 *
 * A COURSE THAT LEFT THE CATALOGUE IS SHOWN HONESTLY. Returned to draft or
 * archived, it stays on the list as "not currently available", with the
 * person's progress kept — never silently dropped, never shown as open.
 *
 * A TRIAL REQUEST IS NEVER A CLASS. Each is listed as a request that has not
 * been scheduled, with a way to withdraw it; nothing here offers a time, a
 * teacher or a confirmation.
 *
 * MY MINHAJ PART 2: one address per view (`?page=`, Learning's page of 24;
 * the legacy `?offset=` and other spellings are one redirect after the
 * session is resolved), "Showing n–m of N" from Learning's own total, numbered
 * pages, the courses counted by state only when the whole list is on the page,
 * each course's state and the way into it, the first-run steps, and
 * withdrawing a trial request asks first and is said aloud.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'courses');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

type CourseState = 'completed' | 'started' | 'new';

async function learningPanels(accountId: string, offset: number) {
  const actor = { accountId };
  const { learner } = learningRuntime();
  const [courses, paths, trials] = await Promise.all([
    learner.courses(actor, offset),
    learner.paths(actor),
    learner.trials(actor),
  ]);
  return { courses, paths, trials };
}

export default async function MyLearningPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/learning');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myLearning' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const spec: MyListSpec<never> = {
    path,
    size: LEARNING_PAGE,
    offsetMax: LEARNER_OFFSET_MAX,
  };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);

  const catalogue = localizedPath(locale, '/learn/courses');
  const frame = {
    // The catalogue is this page's own action; it is not repeated at its foot.
    related: {
      label: t('nav.label'),
      links: learningLinks(locale, t).filter((link) => link.href !== catalogue),
    },
    title: t('title'),
    description: <p>{t('description')}</p>,
    tabs: {
      label: my('tabs.label.learning'),
      items: myTabs(locale, 'learning', 'courses', (key) => my(`tabs.${key}`)),
    },
    action: <OnwardLink href={catalogue}>{t('nav.catalogue')}</OnwardLink>,
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: my('trail.learning') }]),
    },
  };

  if (asked.outcome === 'refused')
    return (
      <MyPage {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </MyPage>
    );

  const view = asked.view;
  const read = await learningRead('learning-my-learning', () =>
    learningPanels(session.account.id, myListOffset(view.page, spec)),
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const { courses, paths, trials } = read.value;
  const timeZone = session.account.timezone;
  const number = new Intl.NumberFormat(locale);
  const range = myListRange(view.page, courses.items.length, spec);
  const stateOf = (completed: number, lessons: number): CourseState =>
    courseCompleted(completed, lessons) ? 'completed' : completed > 0 ? 'started' : 'new';
  const states = courses.items.map((entry) =>
    stateOf(entry.completedLessons, entry.course.lessons),
  );
  // Counted by state only when every Course is on this one page.
  const whole = view.page === 1 && courses.items.length === courses.total;
  const tally = (state: CourseState) => states.filter((entry) => entry === state).length;

  return (
    <MyPage
      {...frame}
      announce={{
        value: `${String(courses.total)}:${String(trials.length)}`,
        message: my('live.trials', { count: trials.length }),
      }}
    >
      {/* ---- Courses ----------------------------------------------------- */}

      <MySection id="learning-courses" heading={t('courses.heading')}>
        {whole && courses.total > 0 ? (
          <MyFigures
            label={my('learningPage.figures')}
            figures={(
              [
                ['all', courses.total],
                ['completed', tally('completed')],
                ['started', tally('started')],
                ['new', tally('new')],
              ] as const
            ).map(([key, value]) => ({
              key,
              value: number.format(value),
              label: my(`courses.state.${key}`),
            }))}
          />
        ) : null}
        {range === null ? null : (
          <MyListStatus>
            {my('count.courses', { ...range, total: courses.total })}
          </MyListStatus>
        )}

        {courses.items.length === 0 ? (
          courses.total === 0 ? (
            <div className="flex flex-col gap-4">
              <EmptyState
                icon="book"
                title={my('courses.emptyTitle')}
                action={{ href: catalogue, text: t('courses.browse') }}
              >
                {t('courses.empty')}
              </EmptyState>
              <MySteps
                label={my('learningPage.stepsLabel')}
                steps={(['find', 'enrol', 'progress'] as const).map((key) => ({
                  key,
                  title: my(`learningPage.steps.${key}.title`),
                  body: my(`learningPage.steps.${key}.body`),
                }))}
              />
            </div>
          ) : (
            <MyListBeyond
              text={my('list.beyond')}
              first={myListHref(spec, { page: 1, filter: null })}
              firstText={my('list.first')}
            />
          )
        ) : (
          <ol
            aria-label={t('courses.heading')}
            className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))]"
          >
            {courses.items.map((entry, index) => {
              const state = states[index] ?? 'new';
              const href = localizedPath(
                locale,
                `/my/learning/courses/${encodeURIComponent(entry.course.slug)}`,
              );
              return (
                <li
                  key={entry.course.id}
                  className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel"
                >
                  <h3 className="text-subheading font-semibold text-balance">
                    <a
                      href={href}
                      className="text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action"
                    >
                      <LearningTitle
                        labels={entry.course.labels}
                        primaryLocale={entry.course.primaryLocale}
                        locale={locale}
                      />
                    </a>
                  </h3>
                  {state === 'completed' ? null : (
                    <span>
                      <StatusBadge tone={state === 'started' ? 'caution' : 'neutral'}>
                        {my(`courses.state.${state}`)}
                      </StatusBadge>
                    </span>
                  )}
                  <ProgressMeter
                    percent={lessonPercent(entry.completedLessons, entry.course.lessons)}
                  >
                    <ProgressStatus
                      completed={entry.completedLessons}
                      lessons={entry.course.lessons}
                      t={t}
                    />
                  </ProgressMeter>
                  <p className="mt-auto text-caption text-foreground-muted">
                    {my('learning.enrolled', {
                      date: shortDate(entry.enrolledAt, locale, timeZone),
                    })}
                  </p>
                  {entry.available ? (
                    state === 'completed' ? null : (
                      <OnwardLink href={href}>
                        {state === 'new' ? my('courses.start') : my('courses.continue')}
                      </OnwardLink>
                    )
                  ) : (
                    <p className="text-sm">{t('courses.unavailable')}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <MyListPager
          label={t('courses.heading')}
          spec={spec}
          view={view}
          total={courses.total}
          locale={locale}
          words={{
            previous: t('list.previous'),
            next: t('list.next'),
            page: (page) => my('list.page', { page }),
          }}
        />
      </MySection>

      {/* ---- Learning paths, derived ------------------------------------- */}

      <MySection id="learning-paths" heading={t('paths.heading')} intro={t('paths.help')}>
        {paths.length === 0 ? (
          <EmptyState>{t('paths.empty')}</EmptyState>
        ) : (
          <ul
            aria-label={t('paths.heading')}
            className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]"
          >
            {paths.map((entry) => {
              const enrolled = entry.courses.filter((course) => course.enrolled).length;
              const completed = entry.courses.filter(
                (course) =>
                  course.enrolled &&
                  courseCompleted(course.completedLessons, course.course.lessons),
              ).length;
              const total = entry.courses.length;
              return (
                <Panel key={entry.path.id} as="li">
                  <div className="flex min-w-0 flex-col gap-3">
                    <TextLink
                      href={localizedPath(
                        locale,
                        `/my/learning/paths/${encodeURIComponent(entry.path.slug)}`,
                      )}
                    >
                      <LearningTitle
                        labels={entry.path.labels}
                        primaryLocale={entry.path.primaryLocale}
                        locale={locale}
                      />
                    </TextLink>
                    <ProgressMeter percent={total === 0 ? 0 : (completed / total) * 100}>
                      {my('learningPage.pathCompleted', {
                        completed: number.format(completed),
                        total: number.format(total),
                      })}
                    </ProgressMeter>
                    <p className="text-sm">
                      {t('paths.enrolledCount', {
                        enrolled: String(enrolled),
                        total: String(total),
                      })}
                    </p>
                  </div>
                </Panel>
              );
            })}
          </ul>
        )}
      </MySection>

      {/* ---- Trial-class requests ---------------------------------------- */}

      <MySection
        id="learning-trials"
        heading={t('trials.heading')}
        intro={t('trials.help')}
      >
        {trials.length === 0 ? (
          <EmptyState>{t('trials.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('trials.heading')} className="flex flex-col gap-3">
            {trials.map((request) => {
              const title = (
                <LearningTitle
                  labels={request.course.labels}
                  primaryLocale={request.course.primaryLocale}
                  locale={locale}
                />
              );
              return (
                <Panel key={request.id} as="li">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-2">
                      {request.course.state === 'published' ? (
                        <TextLink
                          href={localizedPath(
                            locale,
                            `/learn/courses/${encodeURIComponent(request.course.slug)}`,
                          )}
                        >
                          {title}
                        </TextLink>
                      ) : (
                        title
                      )}
                      <p className="text-sm font-medium">
                        {request.booking === null
                          ? t('trials.status')
                          : request.booking.state === 'confirmed'
                            ? t('trials.bookedConfirmed')
                            : request.booking.state === 'completed'
                              ? t('trials.bookedCompleted')
                              : t('trials.bookedCancelled')}
                      </p>
                      {request.booking === null ? null : (
                        <TextLink
                          href={localizedPath(
                            locale,
                            `/my/classes/${request.booking.sessionId}`,
                          )}
                        >
                          {t('trials.openClass')}
                        </TextLink>
                      )}
                      <p className="text-sm text-foreground-muted">
                        {t('trials.requestedAt')}{' '}
                        <PersonalTime
                          value={request.requestedAt.toISOString()}
                          locale={locale}
                          timeZone={timeZone}
                        />
                      </p>
                    </div>
                    {request.booking !== null ? null : (
                      <ActionForm
                        action={withdrawTrialAction}
                        submitLabel={t('trials.withdraw', {
                          title:
                            pickLabel(
                              request.course.labels,
                              locale,
                              request.course.primaryLocale,
                            )?.title ?? '',
                        })}
                        pendingLabel={t('common.working')}
                        tone="secondary"
                        messages={learningMessages(t, { success: t('trials.withdrawn') })}
                        confirm={{
                          title: my('confirm.trial.title'),
                          body: my('confirm.trial.body'),
                          confirmLabel: my('confirm.trial.confirm'),
                          cancelLabel: my('confirm.cancel'),
                        }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="courseId" value={request.course.id} />
                      </ActionForm>
                    )}
                  </div>
                </Panel>
              );
            })}
          </ul>
        )}
      </MySection>
    </MyPage>
  );
}
