import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { courseCompleted } from '@minhaj/contracts/learning';

import { LearningTitle, ProgressStatus } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { Alert, EmptyState, Panel, StatusBadge, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { lessonPercent } from '@/components/my/dashboard';
import { MyPage, OnwardLink, ProgressMeter } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTrail } from '@/components/my/sections';
import { MyFigures } from '@/components/my/summary-parts';
import { learningLinks } from '@/components/my-learning/nav';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../../../guard';

/**
 * One published learning path as the person stands on it (ROUTE_MAP.md §5.1;
 * Phase 22): its Courses in order, each with whether they are enrolled and how
 * far they are through it.
 *
 * DERIVED, NEVER STORED. There is no "path enrolment": standing on a path is
 * nothing more than the person's own Enrolments and Progress on its Courses,
 * so this page offers no path-level act. A Course they are not on links to its
 * public page, where enrolling is offered.
 *
 * MY MINHAJ PART 2: the trail; the path counted — its Courses, the ones the
 * person is on and the ones completed — from the one read the page already
 * makes (the whole path is on it); each Course's meter and the way into it;
 * and the next step named: the first Course in order not yet completed.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'path');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyLearningPathPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const session = await requireActiveSession(
    locale,
    localizedPath(locale, `/my/learning/paths/${encodeURIComponent(slug)}`),
  );
  const t = await getTranslations({ locale, namespace: 'myLearning' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const related = { label: t('nav.label'), links: learningLinks(locale, t) };
  const trail = (text: string) => ({
    label: my('trail.label'),
    crumbs: myTrail(locale, my('trail.home'), [
      { path: '/learning', text: my('trail.learning') },
      { text },
    ]),
  });

  const read = await learningRead('learning-my-path', () =>
    learningRuntime().learner.path({ accountId: session.account.id }, slug),
  );
  if (!read.ok)
    return (
      <MyPage
        related={related}
        title={t('path.fallbackTitle')}
        trail={trail(t('path.fallbackTitle'))}
      >
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );
  if (read.value === null) notFound();

  const { path, courses } = read.value;
  const label = pickLabel(path.labels, locale, path.primaryLocale);
  const finished = (entry: (typeof courses)[number]) =>
    entry.enrolled && courseCompleted(entry.completedLessons, entry.course.lessons);
  const enrolled = courses.filter((entry) => entry.enrolled).length;
  const completed = courses.filter(finished).length;
  const number = new Intl.NumberFormat(locale);
  // The next step: the first Course, in the path's order, not yet completed.
  const nextIndex = courses.findIndex((entry) => !finished(entry));

  return (
    <MyPage
      related={related}
      trail={trail(label?.title ?? t('path.fallbackTitle'))}
      title={
        <span lang={label?.locale} dir="auto" className="wrap-anywhere">
          {label?.title}
        </span>
      }
      description={
        <>
          {label === null || label.summary === '' ? null : (
            <p lang={label.locale} dir="auto" className="wrap-anywhere">
              {label.summary}
            </p>
          )}
          <p>
            {t('paths.enrolledCount', {
              enrolled: String(enrolled),
              total: String(courses.length),
            })}
          </p>
          <p>
            <TextLink
              href={localizedPath(
                locale,
                `/learn/paths/${encodeURIComponent(path.slug)}`,
              )}
            >
              {t('path.publicPage')}
            </TextLink>
          </p>
        </>
      }
    >
      {courses.length === 0 ? null : (
        <MyFigures
          label={my('pathPage.figures')}
          figures={[
            {
              key: 'courses',
              value: number.format(courses.length),
              label: my('pathPage.courses'),
            },
            {
              key: 'enrolled',
              value: number.format(enrolled),
              label: my('pathPage.enrolled'),
            },
            {
              key: 'completed',
              value: number.format(completed),
              label: my('pathPage.completed'),
            },
          ]}
        />
      )}

      {courses.length === 0 ? (
        <EmptyState>{t('path.empty')}</EmptyState>
      ) : completed === courses.length ? (
        <Alert tone="success">{my('pathPage.allDone')}</Alert>
      ) : null}

      {courses.length === 0 ? null : (
        <ol aria-label={t('path.courses')} className="flex flex-col gap-3">
          {courses.map((entry, index) => {
            const slugPart = encodeURIComponent(entry.course.slug);
            const mine = localizedPath(locale, `/my/learning/courses/${slugPart}`);
            const title = (
              <LearningTitle
                labels={entry.course.labels}
                primaryLocale={entry.course.primaryLocale}
                locale={locale}
              />
            );
            return (
              <Panel key={entry.course.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
                    {t('path.position', {
                      number: String(index + 1),
                      total: String(courses.length),
                    })}
                    {index === nextIndex ? (
                      <StatusBadge tone="caution">{my('pathPage.next')}</StatusBadge>
                    ) : null}
                  </p>
                  {entry.enrolled ? (
                    <>
                      <TextLink href={mine}>{title}</TextLink>
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
                      {finished(entry) ? null : (
                        <OnwardLink href={mine}>
                          {entry.completedLessons > 0
                            ? my('courses.continue')
                            : my('courses.start')}
                        </OnwardLink>
                      )}
                    </>
                  ) : (
                    <>
                      {entry.course.state === 'published' ? (
                        <TextLink
                          href={localizedPath(locale, `/learn/courses/${slugPart}`)}
                        >
                          {title}
                        </TextLink>
                      ) : (
                        title
                      )}
                      <p className="text-sm">{t('path.notEnrolled')}</p>
                    </>
                  )}
                </div>
              </Panel>
            );
          })}
        </ol>
      )}
    </MyPage>
  );
}
