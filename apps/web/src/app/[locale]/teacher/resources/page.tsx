import { getTranslations } from 'next-intl/server';

import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { Alert, EmptyState, Panel, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Resources (ROUTE_MAP.md §6): a TRUTHFUL INDEX — every Course the teacher
 * currently teaches, each opening its materials. There is no upload, no
 * shared drive and no file store behind this page, and it says so plainly
 * rather than presenting an empty shelf as a feature.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function ResourcesPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, `/${locale}/teacher/resources`);
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
        <EmptyState>{t('resources.empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('resources.title')}>
          {read.value.map(({ course, scope }) => (
            <Panel key={scope.id} as="li">
              <div className="flex min-w-0 flex-col gap-2">
                <h2 className="font-semibold">
                  <LearningTitle
                    labels={course.labels}
                    primaryLocale={course.primaryLocale}
                    locale={locale}
                  />
                </h2>
                <p className="text-sm">
                  {t('courses.syllabusSize', {
                    modules: String(course.modules),
                    lessons: String(course.lessons),
                  })}
                </p>
                <p>
                  <TextLink
                    href={`/${locale}/teacher/courses/${encodeURIComponent(course.id)}/materials`}
                  >
                    {t('resources.open', {
                      title:
                        pickLabel(course.labels, locale, course.primaryLocale)?.title ??
                        course.slug,
                    })}
                  </TextLink>
                </p>
              </div>
            </Panel>
          ))}
        </ul>
      )}
    </TeacherFrame>
  );
}
