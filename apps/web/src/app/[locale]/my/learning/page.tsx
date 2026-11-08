import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LEARNING_PAGE } from '@minhaj/contracts/learning';

import {
  LearningTitle,
  ProgressStatus,
  learningMessages,
} from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { lessonPercent } from '@/components/my/dashboard';
import { MyPage, MySection, OnwardLink, ProgressMeter } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs } from '@/components/my/sections';
import { shortDate } from '@/components/my/time';
import { PersonalTime } from '@/components/personal/parts';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { Alert, EmptyState, Pager, Panel, TextLink } from '@/components/ui';
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
  // The catalogue is this page's own action; it is not repeated at its foot.
  const related = {
    label: t('nav.label'),
    links: learningLinks(locale, t).filter(
      (link) => link.href !== localizedPath(locale, '/learn/courses'),
    ),
  };
  const offset = readPersonalOffset(await searchParams);
  const read = await learningRead('learning-my-learning', () =>
    learningPanels(session.account.id, offset),
  );
  const my = await getTranslations({ locale, namespace: 'my' });
  const tabs = {
    label: my('tabs.label.learning'),
    items: myTabs(locale, 'learning', 'courses', (key) => my(`tabs.${key}`)),
  };
  const browse = (
    <OnwardLink href={localizedPath(locale, '/learn/courses')}>
      {t('nav.catalogue')}
    </OnwardLink>
  );
  const description = <p>{t('description')}</p>;

  if (!read.ok)
    return (
      <MyPage
        related={related}
        title={t('title')}
        description={description}
        tabs={tabs}
        action={browse}
      >
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const { courses, paths, trials } = read.value;
  const timeZone = session.account.timezone;

  return (
    <MyPage
      related={related}
      title={t('title')}
      description={description}
      tabs={tabs}
      action={browse}
    >
      {/* ---- Courses ----------------------------------------------------- */}

      <MySection id="learning-courses" heading={t('courses.heading')}>
        {courses.items.length === 0 ? (
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
          <ol
            aria-label={t('courses.heading')}
            className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2"
          >
            {courses.items.map((entry) => (
              <li
                key={entry.course.id}
                className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel"
              >
                <h3 className="text-subheading font-semibold text-balance">
                  <a
                    href={localizedPath(
                      locale,
                      `/my/learning/courses/${encodeURIComponent(entry.course.slug)}`,
                    )}
                    className="text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action"
                  >
                    <LearningTitle
                      labels={entry.course.labels}
                      primaryLocale={entry.course.primaryLocale}
                      locale={locale}
                    />
                  </a>
                </h3>
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
                {entry.available ? null : (
                  <p className="text-sm">{t('courses.unavailable')}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        <Pager
          label={t('courses.heading')}
          previous={
            offset === 0
              ? null
              : personalOffsetHref(path, Math.max(0, offset - LEARNING_PAGE))
          }
          next={courses.hasMore ? personalOffsetHref(path, offset + LEARNING_PAGE) : null}
          previousLabel={t('list.previous')}
          nextLabel={t('list.next')}
        />
      </MySection>

      {/* ---- Learning paths, derived ------------------------------------- */}

      <MySection id="learning-paths" heading={t('paths.heading')} intro={t('paths.help')}>
        {paths.length === 0 ? (
          <EmptyState>{t('paths.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('paths.heading')} className="flex flex-col gap-3">
            {paths.map((entry) => (
              <Panel key={entry.path.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
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
                  <p className="text-sm">
                    {t('paths.enrolledCount', {
                      enrolled: String(
                        entry.courses.filter((course) => course.enrolled).length,
                      ),
                      total: String(entry.courses.length),
                    })}
                  </p>
                </div>
              </Panel>
            ))}
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
