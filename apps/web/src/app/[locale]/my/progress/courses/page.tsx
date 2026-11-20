import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LEARNING_PAGE, courseCompleted } from '@minhaj/contracts/learning';

import { LearningTitle, ProgressStatus } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { MyPage, OnwardLink, ProgressMeter } from '@/components/my/frame';
import { lessonPercent } from '@/components/my/dashboard';
import { MyListStatus } from '@/components/my/list-parts';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Pager,
  Stat,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { learningLinks } from '@/components/my-learning/nav';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../../guard';

/**
 * Course progress — how far the person is through each Course they are
 * enrolled on (ROUTE_MAP.md §5.1; DELIVERY_PLAN.md Phase 22). LEARNING'S,
 * placed beside Personalisation's Quran reading position under `/my/progress`;
 * there is still no `/my/progress` landing, because the register names none.
 *
 * PROGRESS IS ONLY WHAT THE PERSON MARKED. A lesson counts as complete because
 * they said so on the lesson, never because a page was opened. A Course
 * counts as completed when every lesson it has now is complete — derived, not
 * stored, and no certificate, grade or streak is attached to it.
 *
 * MY MINHAJ PART 1: each Course's state in words (completed, in progress,
 * not started), its meter and the way back into it. FIGURES ONLY
 * WHEN THEY ARE TRUE: Learning's enrolment read pages by "has more" and gives
 * no total, so the counts by state are shown only when the whole list is on
 * this one page; otherwise the page says how many it shows and offers
 * Previous and Next (no new Learning read).
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'progress');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

type CourseState = 'completed' | 'started' | 'new';

export default async function CourseProgressPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/progress/courses');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myLearning' });
  const related = { label: t('nav.label'), links: learningLinks(locale, t) };
  const offset = readPersonalOffset(await searchParams);
  const read = await learningRead('learning-course-progress', () =>
    learningRuntime().learner.courses({ accountId: session.account.id }, offset),
  );
  const my = await getTranslations({ locale, namespace: 'my' });
  const frame = {
    related,
    title: t('progressPage.title'),
    description: <p>{t('progressPage.description')}</p>,
    tabs: {
      label: my('tabs.label.learning'),
      items: myTabs(locale, 'learning', 'progress', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [
        { path: '/learning', text: my('trail.learning') },
        { text: t('progressPage.title') },
      ]),
    },
  };

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const page = read.value;
  const stateOf = (completed: number, lessons: number): CourseState =>
    courseCompleted(completed, lessons) ? 'completed' : completed > 0 ? 'started' : 'new';
  const states = page.items.map((entry) =>
    stateOf(entry.completedLessons, entry.course.lessons),
  );
  // The whole list is here only on a first page with nothing after it.
  const whole = offset === 0 && !page.hasMore;
  const number = new Intl.NumberFormat(locale);
  const tally = (state: CourseState) => states.filter((entry) => entry === state).length;

  return (
    <MyPage {...frame}>
      {page.items.length === 0 ? null : whole ? (
        <ul
          aria-label={my('courses.figures')}
          className="grid grid-cols-2 gap-5 rounded-panel border border-border bg-surface-raised p-5 shadow-panel sm:grid-cols-4"
        >
          {(
            [
              ['all', page.items.length],
              ['completed', tally('completed')],
              ['started', tally('started')],
              ['new', tally('new')],
            ] as const
          ).map(([key, value]) => (
            <li key={key} className="min-w-0">
              <Stat value={number.format(value)} label={my(`courses.state.${key}`)} />
            </li>
          ))}
        </ul>
      ) : (
        <MyListStatus>
          {my('courses.shown', {
            from: offset + 1,
            to: offset + page.items.length,
          })}
        </MyListStatus>
      )}

      {page.items.length === 0 ? (
        offset === 0 ? (
          <EmptyState
            icon="book"
            title={my('courses.emptyTitle')}
            action={{
              href: localizedPath(locale, '/learn/courses'),
              text: t('courses.browse'),
            }}
          >
            {t('courses.empty')}
          </EmptyState>
        ) : (
          <EmptyState icon="list" action={{ href: path, text: my('list.first') }}>
            {t('list.beyond')}
          </EmptyState>
        )
      ) : (
        <DataTable
          caption={t('progressPage.caption')}
          columns={[t('progressPage.course'), t('progressPage.progress')]}
        >
          {page.items.map((entry, index) => {
            const state = states[index] ?? 'new';
            const href = localizedPath(
              locale,
              `/my/learning/courses/${encodeURIComponent(entry.course.slug)}`,
            );
            return (
              <DataRow key={entry.course.id}>
                <DataCell wrap>
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <TextLink href={href}>
                      <LearningTitle
                        labels={entry.course.labels}
                        primaryLocale={entry.course.primaryLocale}
                        locale={locale}
                      />
                    </TextLink>
                    {state === 'completed' ? null : (
                      <span>
                        <StatusBadge tone={state === 'started' ? 'caution' : 'neutral'}>
                          {my(`courses.state.${state}`)}
                        </StatusBadge>
                      </span>
                    )}
                    {entry.available ? null : (
                      <span className="text-xs">{t('courses.unavailable')}</span>
                    )}
                  </span>
                </DataCell>
                <DataCell wrap>
                  <span className="flex min-w-0 flex-col gap-2">
                    <ProgressMeter
                      percent={lessonPercent(
                        entry.completedLessons,
                        entry.course.lessons,
                      )}
                    >
                      <ProgressStatus
                        completed={entry.completedLessons}
                        lessons={entry.course.lessons}
                        t={t}
                      />
                    </ProgressMeter>
                    {entry.available && state !== 'completed' ? (
                      <OnwardLink href={href}>
                        {state === 'new' ? my('courses.start') : my('courses.continue')}
                      </OnwardLink>
                    ) : null}
                  </span>
                </DataCell>
              </DataRow>
            );
          })}
        </DataTable>
      )}
      <Pager
        label={t('progressPage.caption')}
        previous={
          offset === 0
            ? null
            : personalOffsetHref(path, Math.max(0, offset - LEARNING_PAGE))
        }
        next={page.hasMore ? personalOffsetHref(path, offset + LEARNING_PAGE) : null}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />
    </MyPage>
  );
}
