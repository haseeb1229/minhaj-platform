import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AVAILABILITY_VIEWS, type AvailabilityView } from '@minhaj/contracts/learning';
import { supportedTimeZones } from '@minhaj/contracts/platform';

import {
  MyListBeyond,
  MyListFilters,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
} from '@/components/my/list-view';
import { MyFigures, MySteps } from '@/components/my/summary-parts';
import { learningRead } from '@/components/my-learning/read';
import {
  readWeekView,
  teacherList,
  TEACHER_PAGING,
} from '@/components/teacher/list-view';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import {
  ClassTime,
  NotActivated,
  pagerWords,
  TeacherFrame,
  TeacherSection,
  teacherMessages,
  teacherTrail,
} from '@/components/teacher/parts';
import { ownZone, zoneName } from '@/components/teacher/presentation';
import { collectPages } from '@/components/teacher/read';
import { ScheduleForm } from '@/components/teacher/schedule-form';
import { WeekGrid, WeekLegend, WeekNav, weekTitle } from '@/components/teacher/schedule';
import {
  addDays,
  adjacentWeeks,
  buildWeek,
  dateIn,
  weekHref,
  weekSpan,
  weekStartOf,
} from '@/components/teacher/week';
import { Alert, EmptyState, Panel, StatusBadge } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { openAvailabilityAction, withdrawAvailabilityAction } from '../actions';
import { requireTeacher } from '../guard';

/**
 * Availability (ROUTE_MAP.md §6; R2): the windows the teacher offers for trial
 * classes — a week at a time beside their classes, so a free evening is plain
 * to see — the list of every window, and the form to offer another.
 *
 * A BOOKED WINDOW IS A CLASS NOW. It says "Booked" in words and offers no
 * withdraw control, because withdrawing it would strand a confirmed learner;
 * its class is cancelled from the class page instead. Only an open, unbooked
 * window carries a withdraw button — there is no control here that the
 * service would refuse by construction. In the week, a booked window is not
 * drawn: its class is.
 *
 * THE LIST, COUNTED (Teacher area, R2). The windows are counted by what each
 * has become — open, booked, withdrawn — as figures and as tabs
 * (`?show=open|booked|withdrawn`), with "Showing 1–24 of 30 windows" and
 * numbered pages (`?page=`). `?week=` moves the week and is kept by every link
 * of the list; each address has one spelling, Phase 23's `?offset=` included,
 * and an untidy one is one redirect after the session and the teacher's role.
 * An unknown view is refused in place.
 *
 * WITHDRAWING ASKS FIRST, AND IS SAID ALOUD. "Withdraw this window" opens the
 * shared confirmation over the unchanged Server Action; once the server's
 * answer re-renders the list, the new counts are announced and, if the
 * pressed control has gone, focus moves to the list's status line.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'availability');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const WEEK_PAGES = 4;
const WINDOW_PAGES = 4;

export default async function AvailabilityPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/teacher/availability');
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;
  const my = await getTranslations({ locale, namespace: 'my' });

  const query = await searchParams;
  const accountZone = gate.session.account.timezone;
  const zone = ownZone(accountZone);
  const now = new Date();
  const today = dateIn(now, zone);

  // One address per view: the week first, then the list's own parameters.
  const week = readWeekView(path, query, today);
  const spec = teacherList<AvailabilityView>(week.path, {
    param: 'show',
    values: AVAILABILITY_VIEWS,
  });
  const asked = readMyList(spec, query);
  if (week.outcome === 'redirect')
    redirect(
      asked.outcome === 'view'
        ? myListHref(spec, asked.view)
        : asked.outcome === 'redirect'
          ? asked.to
          : week.path,
    );
  if (asked.outcome === 'redirect') redirect(asked.to);

  const span = weekSpan(week.weekStart, zone);
  const { teaching } = learningRuntime();
  const view = asked.outcome === 'view' ? asked.view : null;
  const [read, counts, sessions, windows] = await Promise.all([
    view === null
      ? Promise.resolve(null)
      : learningRead('teaching-availability', () =>
          teaching.availability(
            gate.actor,
            myListOffset(view.page, TEACHER_PAGING),
            view.filter,
          ),
        ),
    learningRead('teaching-availability-counts', () =>
      teaching.availabilityCounts(gate.actor),
    ),
    learningRead('teaching-availability-week', () =>
      collectPages(
        (page) => teaching.calendar(gate.actor, span.from, page),
        WEEK_PAGES,
        (entry) => entry.session.startsAt.getTime() >= span.to.getTime(),
      ),
    ),
    learningRead('teaching-availability-week-windows', () =>
      collectPages(
        (page) => teaching.availability(gate.actor, page, 'open'),
        WINDOW_PAGES,
        (window) => window.startsAt.getTime() >= span.to.getTime(),
      ),
    ),
  ]);
  const tomorrow = addDays(today, 1);
  const adjacent = adjacentWeeks(week.weekStart, today);
  const days = buildWeek({
    span,
    zone,
    today,
    sessions: sessions.ok ? sessions.value.items : [],
    windows: windows.ok ? windows.value.items : [],
  });
  const number = new Intl.NumberFormat(locale);
  const all = counts.ok
    ? counts.value.open + counts.value.booked + counts.value.withdrawn
    : null;
  const firstRun = all === 0;
  const range =
    view !== null && read?.ok === true
      ? myListRange(view.page, read.value.items.length, TEACHER_PAGING)
      : null;
  const viewWords: Readonly<Record<AvailabilityView, string>> = {
    open: t('availability.open'),
    booked: t('availability.booked'),
    withdrawn: t('availability.withdrawn'),
  };

  return (
    <TeacherFrame
      title={t('availability.title')}
      description={<p>{t('availability.description')}</p>}
      trail={teacherTrail(locale, t, [{ text: t('nav.availability') }])}
      {...(counts.ok
        ? {
            announce: {
              value: `${String(counts.value.open)}:${String(counts.value.booked)}:${String(counts.value.withdrawn)}`,
              message: t('live.windows', {
                open: counts.value.open,
                booked: counts.value.booked,
              }),
            },
          }
        : {})}
    >
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}

      {counts.ok && !firstRun ? (
        <MyFigures
          label={t('availability.figures')}
          figures={AVAILABILITY_VIEWS.map((key) => ({
            key,
            value: number.format(counts.value[key]),
            label: viewWords[key],
            href: myListHref(spec, { page: 1, filter: key }),
          }))}
        />
      ) : null}
      {firstRun ? (
        <MySteps
          label={t('availability.stepsLabel')}
          steps={(['offer', 'confirm', 'teach'] as const).map((key) => ({
            key,
            title: t(`availability.steps.${key}.title`),
            body: t(`availability.steps.${key}.body`),
          }))}
        />
      ) : null}

      <TeacherSection
        id="availability-week"
        heading={weekTitle(span.days, locale)}
        intro={t('availability.weekHelp', { zone: zoneName(zone, span.from, locale) })}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <WeekLegend windows t={t} />
          <WeekNav
            label={t('week.navLabel')}
            previous={
              adjacent.previous === null ? null : weekHref(path, adjacent.previous, today)
            }
            current={week.weekStart === weekStartOf(today) ? null : path}
            next={adjacent.next === null ? null : weekHref(path, adjacent.next, today)}
            t={t}
          />
        </div>
        {sessions.ok && windows.ok ? (
          <WeekGrid days={days} locale={locale} zone={zone} now={now} t={t} />
        ) : (
          <Alert tone="error">{t('failure.load')}</Alert>
        )}
      </TeacherSection>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <TeacherSection id="availability-list" heading={t('availability.list')}>
          {counts.ok && view !== null ? (
            <MyListFilters
              label={t('availability.views')}
              spec={spec}
              current={view.filter}
              minimum={2}
              format={(count) => number.format(count)}
              items={[
                { value: null, text: t('availability.all'), count: all ?? 0 },
                ...AVAILABILITY_VIEWS.map((key) => ({
                  value: key,
                  text: viewWords[key],
                  count: counts.value[key],
                })),
              ]}
            />
          ) : null}
          {view === null ? (
            <MyListRefused
              title={my('list.refusedTitle')}
              text={my('list.refused')}
              all={week.path}
              allText={my('list.all')}
            />
          ) : read === null || !read.ok ? (
            <Alert tone="error">{t('failure.load')}</Alert>
          ) : read.value.items.length === 0 ? (
            read.value.total > 0 ? (
              <MyListBeyond
                text={my('list.beyond')}
                first={myListHref(spec, { page: 1, filter: view.filter })}
                firstText={my('list.first')}
              />
            ) : view.filter === null ? (
              <EmptyState icon="calendar" title={t('availability.emptyTitle')}>
                {t('availability.empty')}
              </EmptyState>
            ) : (
              <EmptyState
                icon="calendar"
                action={{ href: week.path, text: t('availability.all') }}
              >
                {t('availability.noneOfView', { view: viewWords[view.filter] })}
              </EmptyState>
            )
          ) : (
            <>
              {range === null ? null : (
                <MyListStatus>
                  {t('count.windows', {
                    from: number.format(range.from),
                    to: number.format(range.to),
                    total: read.value.total,
                  })}
                </MyListStatus>
              )}
              <ol
                className="rounded-panel border border-border bg-surface-raised px-4 shadow-panel sm:px-5"
                aria-label={t('availability.list')}
              >
                {read.value.items.map((window) => (
                  <li
                    key={window.id}
                    className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-4 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-col gap-2">
                      <p>
                        {window.state === 'withdrawn' ? (
                          <StatusBadge tone="neutral">
                            {t('availability.withdrawn')}
                          </StatusBadge>
                        ) : window.booked ? (
                          <StatusBadge tone="caution">
                            {t('availability.booked')}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="positive">
                            {t('availability.open')}
                          </StatusBadge>
                        )}
                      </p>
                      <ClassTime
                        session={window}
                        locale={locale}
                        accountZone={accountZone}
                        t={t}
                      />
                      {window.state === 'open' && window.booked ? (
                        <p className="text-sm">{t('availability.cannotWithdraw')}</p>
                      ) : null}
                    </div>
                    {window.state === 'open' && !window.booked ? (
                      <ActionForm
                        action={withdrawAvailabilityAction}
                        submitLabel={t('availability.withdraw')}
                        pendingLabel={t('common.working')}
                        tone="secondary"
                        messages={teacherMessages(t, {
                          success: t('availability.withdrew'),
                        })}
                        confirm={{
                          title: t('confirm.withdraw.title'),
                          body: t('confirm.withdraw.body'),
                          confirmLabel: t('confirm.withdraw.confirm'),
                          cancelLabel: t('confirm.keep'),
                        }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={window.id} />
                        <input
                          type="hidden"
                          name="version"
                          value={String(window.version)}
                        />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ol>
              <MyListPager
                label={t('availability.list')}
                spec={spec}
                view={view}
                total={read.value.total}
                locale={locale}
                words={pagerWords(t, my)}
              />
            </>
          )}
        </TeacherSection>

        <TeacherSection
          id="availability-open"
          heading={t('availability.openHeading')}
          intro={t('availability.openHelp')}
        >
          <Panel>
            <ScheduleForm
              action={openAvailabilityAction}
              hidden={{ locale }}
              zones={supportedTimeZones()}
              defaults={{
                timeZone: zone,
                startsLocal: `${tomorrow}T18:00`,
                endsLocal: `${tomorrow}T19:00`,
              }}
              words={{
                timeZone: t('availability.timeZone'),
                timeZoneHelp: t('availability.timeZoneHelp'),
                starts: t('availability.starts'),
                ends: t('availability.ends'),
                startFold: t('availability.startFold'),
                endFold: t('availability.endFold'),
                foldHelp: t('reschedule.foldHelp'),
                foldEarlier: t('reschedule.foldEarlier'),
                foldLater: t('reschedule.foldLater'),
              }}
              submitLabel={t('availability.submit')}
              pendingLabel={t('common.working')}
              messages={teacherMessages(t, { success: t('availability.opened') })}
            />
          </Panel>
        </TeacherSection>
      </div>
    </TeacherFrame>
  );
}
