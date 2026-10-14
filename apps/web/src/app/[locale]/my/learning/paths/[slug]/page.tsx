import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { learningLinks } from '@/components/my-learning/nav';
import { LearningTitle, ProgressStatus } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import { Alert, EmptyState, Panel, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
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
 */
export const metadata = { robots: { index: false, follow: false } };

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
    `/${locale}/my/learning/paths/${encodeURIComponent(slug)}`,
  );
  const t = await getTranslations({ locale, namespace: 'myLearning' });
  const back = <PersonalLinks label={t('nav.label')} links={learningLinks(locale, t)} />;

  const read = await learningRead('learning-my-path', () =>
    learningRuntime().learner.path({ accountId: session.account.id }, slug),
  );
  if (!read.ok)
    return (
      <PersonalFrame title={t('path.fallbackTitle')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );
  if (read.value === null) notFound();

  const { path, courses } = read.value;
  const label = pickLabel(path.labels, locale, path.primaryLocale);
  const enrolled = courses.filter((entry) => entry.enrolled).length;

  return (
    <PersonalFrame
      title={
        <span lang={label?.locale} dir="auto">
          {label?.title}
        </span>
      }
      description={
        <>
          {label === null || label.summary === '' ? null : (
            <p lang={label.locale} dir="auto">
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
            <TextLink href={`/${locale}/learn/paths/${encodeURIComponent(path.slug)}`}>
              {t('path.publicPage')}
            </TextLink>
          </p>
        </>
      }
      back={back}
    >
      {courses.length === 0 ? (
        <EmptyState>{t('path.empty')}</EmptyState>
      ) : (
        <ol aria-label={t('path.courses')} className="flex flex-col gap-3">
          {courses.map((entry, index) => {
            const slugPart = encodeURIComponent(entry.course.slug);
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
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('path.position', {
                      number: String(index + 1),
                      total: String(courses.length),
                    })}
                  </p>
                  {entry.enrolled ? (
                    <>
                      <TextLink href={`/${locale}/my/learning/courses/${slugPart}`}>
                        {title}
                      </TextLink>
                      <p>
                        <ProgressStatus
                          completed={entry.completedLessons}
                          lessons={entry.course.lessons}
                          t={t}
                        />
                      </p>
                    </>
                  ) : (
                    <>
                      {entry.course.state === 'published' ? (
                        <TextLink href={`/${locale}/learn/courses/${slugPart}`}>
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
    </PersonalFrame>
  );
}
