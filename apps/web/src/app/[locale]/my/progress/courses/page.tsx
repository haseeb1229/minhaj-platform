import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LEARNING_PAGE } from '@minhaj/contracts/learning';

import { LearningTitle, ProgressStatus } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { MyPage, ProgressMeter } from '@/components/my/frame';
import { lessonPercent } from '@/components/my/dashboard';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs } from '@/components/my/sections';
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
  TextLink,
} from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
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
  const offset = readPersonalOffset(await searchParams);
  const read = await learningRead('learning-course-progress', () =>
    learningRuntime().learner.courses({ accountId: session.account.id }, offset),
  );
  const my = await getTranslations({ locale, namespace: 'my' });
  const tabs = {
    label: my('tabs.label.learning'),
    items: myTabs(locale, 'learning', 'progress', (key) => my(`tabs.${key}`)),
  };
  const description = <p>{t('progressPage.description')}</p>;

  if (!read.ok)
    return (
      <MyPage title={t('progressPage.title')} description={description} tabs={tabs}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const page = read.value;

  return (
    <MyPage title={t('progressPage.title')} description={description} tabs={tabs}>
      {page.items.length === 0 ? (
        offset === 0 ? (
          <EmptyState
            icon="book"
            action={{
              href: localizedPath(locale, '/learn/courses'),
              text: t('courses.browse'),
            }}
          >
            {t('courses.empty')}
          </EmptyState>
        ) : (
          <EmptyState>{t('list.beyond')}</EmptyState>
        )
      ) : (
        <DataTable
          caption={t('progressPage.caption')}
          columns={[t('progressPage.course'), t('progressPage.progress')]}
        >
          {page.items.map((entry) => (
            <DataRow key={entry.course.id}>
              <DataCell wrap>
                <span className="flex min-w-0 flex-col gap-1">
                  <TextLink
                    href={localizedPath(
                      locale,
                      `/my/learning/courses/${encodeURIComponent(entry.course.slug)}`,
                    )}
                  >
                    <LearningTitle
                      labels={entry.course.labels}
                      primaryLocale={entry.course.primaryLocale}
                      locale={locale}
                    />
                  </TextLink>
                  {entry.available ? null : (
                    <span className="text-xs">{t('courses.unavailable')}</span>
                  )}
                </span>
              </DataCell>
              <DataCell wrap>
                <ProgressMeter
                  percent={lessonPercent(entry.completedLessons, entry.course.lessons)}
                >
                  <ProgressStatus
                    completed={entry.completedLessons}
                    lessons={entry.course.lessons}
                    t={t}
                  />
                </ProgressMeter>
              </DataCell>
            </DataRow>
          ))}
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
