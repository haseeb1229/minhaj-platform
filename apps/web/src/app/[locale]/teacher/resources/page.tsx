import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NoScope, NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { Alert, Icon } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Resources (ROUTE_MAP.md §6): a TRUTHFUL INDEX — every Course the teacher
 * currently teaches, each opening its materials. There is no upload, no
 * shared drive and no file store behind this page, and it says so plainly
 * rather than presenting an empty shelf as a feature.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'resources');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function ResourcesPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, localizedPath(locale, '/teacher/resources'));
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await learningRead('teaching-resources', () =>
    learningRuntime().teaching.courses(gate.actor),
  );

  return (
    <TeacherFrame
      title={t('resources.title')}
      description={<p>{t('resources.description')}</p>}
    >
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.length === 0 ? (
        <NoScope locale={locale} t={t} />
      ) : (
        <ul
          className="rounded-panel border border-border bg-surface-raised px-4 shadow-panel sm:px-5"
          aria-label={t('resources.title')}
        >
          {read.value.map(({ course, scope }) => (
            <li
              key={scope.id}
              className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Icon name="book" size={24} className="mt-0.5 shrink-0 text-accent" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="font-semibold">
                    <LearningTitle
                      labels={course.labels}
                      primaryLocale={course.primaryLocale}
                      locale={locale}
                    />
                  </h2>
                  <p className="text-sm text-foreground-muted">
                    {t('courses.syllabusSize', {
                      modules: String(course.modules),
                      lessons: String(course.lessons),
                    })}
                  </p>
                </div>
              </div>
              <a
                href={localizedPath(
                  locale,
                  `/teacher/courses/${encodeURIComponent(course.id)}/materials`,
                )}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
              >
                {t('resources.open', {
                  title:
                    pickLabel(course.labels, locale, course.primaryLocale)?.title ??
                    course.slug,
                })}
                <Icon name="arrow-end" size={16} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </TeacherFrame>
  );
}
