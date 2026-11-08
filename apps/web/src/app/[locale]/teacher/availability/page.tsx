import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { supportedTimeZones } from '@minhaj/contracts/platform';

import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import {
  ClassTime,
  NotActivated,
  TeacherFrame,
  TeacherSection,
  teacherMessages,
} from '@/components/teacher/parts';
import {
  ownZone,
  pager,
  readOffset,
  single,
  zoneName,
} from '@/components/teacher/presentation';
import { collectPages } from '@/components/teacher/read';
import { ScheduleForm } from '@/components/teacher/schedule-form';
import { WeekGrid, WeekLegend, WeekNav, weekTitle } from '@/components/teacher/schedule';
import {
  addDays,
  adjacentWeeks,
  buildWeek,
  dateIn,
  readWeek,
  weekHref,
  weekSpan,
  weekStartOf,
} from '@/components/teacher/week';
import { Alert, EmptyState, Pager, Panel, StatusBadge } from '@/components/ui';
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
 * `?week=` moves the week; `?offset=` pages the list. The two are independent.
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

  const query = await searchParams;
  const offset = readOffset(query);
  const accountZone = gate.session.account.timezone;
  const zone = ownZone(accountZone);
  const now = new Date();
  const today = dateIn(now, zone);
  const weekStart = readWeek(single(query, 'week'), today);
  const span = weekSpan(weekStart, zone);
  const { teaching } = learningRuntime();
  const [read, sessions, windows] = await Promise.all([
    learningRead('teaching-availability', () =>
      teaching.availability(gate.actor, offset),
    ),
    learningRead('teaching-availability-week', () =>
      collectPages(
        (page) => teaching.calendar(gate.actor, span.from, page),
        WEEK_PAGES,
        (view) => view.session.startsAt.getTime() >= span.to.getTime(),
      ),
    ),
    learningRead('teaching-availability-week-windows', () =>
      collectPages(
        (page) => teaching.availability(gate.actor, page),
        WINDOW_PAGES,
        (window) =>
          window.state !== 'open' || window.startsAt.getTime() >= span.to.getTime(),
      ),
    ),
  ]);
  const tomorrow = addDays(today, 1);
  const page = read.ok ? pager(path, offset, read.value.hasMore) : null;
  const adjacent = adjacentWeeks(weekStart, today);
  const open = windows.ok
    ? windows.value.items.filter((window) => window.state === 'open' && !window.booked)
    : [];
  const days = buildWeek({
    span,
    zone,
    today,
    sessions: sessions.ok ? sessions.value.items : [],
    windows: open,
  });

  return (
    <TeacherFrame
      title={t('availability.title')}
      description={<p>{t('availability.description')}</p>}
    >
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}

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
            current={weekStart === weekStartOf(today) ? null : path}
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
          {!read.ok ? (
            <Alert tone="error">{t('failure.load')}</Alert>
          ) : read.value.items.length === 0 ? (
            <EmptyState>
              {offset === 0 ? t('availability.empty') : t('common.beyond')}
            </EmptyState>
          ) : (
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
          )}
          {page === null ? null : (
            <Pager
              label={t('availability.list')}
              previous={page.previous}
              next={page.next}
              previousLabel={t('common.previous')}
              nextLabel={t('common.next')}
            />
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
