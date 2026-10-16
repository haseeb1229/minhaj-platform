import { getTranslations } from 'next-intl/server';

import { LEARNING_PAGE } from '@minhaj/contracts/learning';

import { Pagination } from '@/components/media/parts';
import { learningLinks } from '@/components/my-learning/nav';
import {
  LearningTitle,
  ProgressStatus,
  learningMessages,
} from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { PersonalFrame, PersonalLinks, PersonalTime } from '@/components/personal/parts';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { Alert, EmptyState, Panel, SectionHeading, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
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
export const metadata = { robots: { index: false, follow: false } };

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
  const path = `/${locale}/my/learning`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myLearning' });
  const offset = readPersonalOffset(await searchParams);
  const read = await learningRead('learning-my-learning', () =>
    learningPanels(session.account.id, offset),
  );
  const back = <PersonalLinks label={t('nav.label')} links={learningLinks(locale, t)} />;
  const description = <p>{t('description')}</p>;

  if (!read.ok)
    return (
      <PersonalFrame title={t('title')} description={description} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const { courses, paths, trials } = read.value;
  const timeZone = session.account.timezone;

  return (
    <PersonalFrame title={t('title')} description={description} back={back}>
      {/* ---- Courses ----------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="learning-courses">
        <span id="learning-courses">
          <SectionHeading>{t('courses.heading')}</SectionHeading>
        </span>
        {courses.items.length === 0 ? (
          <>
            <EmptyState>
              {offset === 0 ? t('courses.empty') : t('list.beyond')}
            </EmptyState>
            <p>
              <TextLink href={`/${locale}/learn/courses`}>{t('courses.browse')}</TextLink>
            </p>
          </>
        ) : (
          <ol aria-label={t('courses.heading')} className="flex flex-col gap-3">
            {courses.items.map((entry) => (
              <Panel key={entry.course.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <TextLink
                    href={`/${locale}/my/learning/courses/${encodeURIComponent(entry.course.slug)}`}
                  >
                    <LearningTitle
                      labels={entry.course.labels}
                      primaryLocale={entry.course.primaryLocale}
                      locale={locale}
                    />
                  </TextLink>
                  <p className="flex flex-wrap items-center gap-3">
                    <ProgressStatus
                      completed={entry.completedLessons}
                      lessons={entry.course.lessons}
                      t={t}
                    />
                    <span className="text-sm text-[color:var(--color-foreground-muted)]">
                      {t('courses.enrolledAt')}{' '}
                      <PersonalTime
                        value={entry.enrolledAt.toISOString()}
                        locale={locale}
                        timeZone={timeZone}
                      />
                    </span>
                  </p>
                  {entry.available ? null : (
                    <p className="text-sm">{t('courses.unavailable')}</p>
                  )}
                </div>
              </Panel>
            ))}
          </ol>
        )}
        <Pagination
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
      </section>

      {/* ---- Learning paths, derived ------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="learning-paths">
        <span id="learning-paths">
          <SectionHeading>{t('paths.heading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('paths.help')}
        </p>
        {paths.length === 0 ? (
          <EmptyState>{t('paths.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('paths.heading')} className="flex flex-col gap-3">
            {paths.map((entry) => (
              <Panel key={entry.path.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <TextLink
                    href={`/${locale}/my/learning/paths/${encodeURIComponent(entry.path.slug)}`}
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
      </section>

      {/* ---- Trial-class requests ---------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="learning-trials">
        <span id="learning-trials">
          <SectionHeading>{t('trials.heading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('trials.help')}
        </p>
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
                          href={`/${locale}/learn/courses/${encodeURIComponent(request.course.slug)}`}
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
                          href={`/${locale}/my/classes/${request.booking.sessionId}`}
                        >
                          {t('trials.openClass')}
                        </TextLink>
                      )}
                      <p className="text-sm text-[color:var(--color-foreground-muted)]">
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
      </section>
    </PersonalFrame>
  );
}
