import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { AvailabilityRecord, ClassSessionView } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { Badge, Icon } from '@/components/ui';
import { classControls, classStage, type ClassStage } from './class-stage';
import type { TeacherTranslator } from './parts';
import { zoneName } from './presentation';
import type { WeekDay } from './week';

/**
 * HOW THE TEACHER AREA SHOWS A SCHEDULE (R2): an agenda row for a list of
 * classes, and a week of days for the calendar and availability pages.
 *
 * TIMES ARE THE TEACHER'S OWN. Every row and block is written in the
 * teacher's zone; a class scheduled in another zone also says its own time,
 * so nobody converts in their head.
 *
 * NEVER THE MEETING ADDRESS. A row knows only whether a link is held
 * (`hasMeetingUrl`); the address is read on the class's own page alone.
 *
 * CONTROLS FOLLOW THE CLASS'S STAGE (`classControls`). "Take attendance" is
 * offered only once a class has begun — the service refuses earlier marks, and
 * a page never offers what the service would refuse.
 *
 * LOGICAL PROPERTIES ONLY, and the week's days in chronological DOM order: the
 * grid flows inline-start to inline-end, so Urdu and Arabic read it from the
 * right without the data being reversed.
 */

const classHref = (locale: Locale, id: string) =>
  localizedPath(locale, `/teacher/classes/today/${encodeURIComponent(id)}`);

/** Start and end in one zone, as clock times only ("18:00–19:00"). */
export function clockRange(from: Date, to: Date, zone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeStyle: 'short',
    timeZone: zone,
  }).formatRange(from, to);
}

/** A class's stage, in words — every stage is a word, never a colour alone. */
export function StageBadge({
  stage,
  t,
}: {
  readonly stage: ClassStage;
  readonly t: TeacherTranslator;
}) {
  switch (stage) {
    case 'upcoming':
      return (
        <Badge kind="status" tone="positive">
          {t('state.scheduled')}
        </Badge>
      );
    case 'live':
      return (
        <Badge kind="status" tone="action">
          {t('stage.live')}
        </Badge>
      );
    case 'ended':
      return (
        <Badge kind="status" tone="caution">
          {t('stage.ended')}
        </Badge>
      );
    case 'completed':
      return <Badge kind="status">{t('state.completed')}</Badge>;
    case 'cancelled':
      return (
        <Badge kind="status" tone="caution">
          {t('state.cancelled')}
        </Badge>
      );
  }
}

/** Whether a scheduled class holds a meeting link, in words with an icon. */
function MeetingState({
  view,
  t,
}: {
  readonly view: ClassSessionView;
  readonly t: TeacherTranslator;
}) {
  if (view.session.state !== 'scheduled') return null;
  return view.session.hasMeetingUrl ? (
    <span className="inline-flex items-center gap-1.5 text-foreground-muted">
      <Icon name="video" size={16} />
      {t('meetingState.set')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-medium text-warning">
      <Icon name="info" size={16} />
      {t('meetingState.missing')}
    </span>
  );
}

/**
 * One class in an agenda: its time in the teacher's zone at the inline start,
 * the Course (the link into the class), its kind, stage and meeting state, and
 * — once it has begun — the way to take attendance.
 */
export function SessionRow({
  view,
  locale,
  zone,
  now,
  showDate = false,
  t,
}: {
  readonly view: ClassSessionView;
  readonly locale: Locale;
  readonly zone: string;
  readonly now: Date;
  /** Show the day as well as the time — for a list that spans several days. */
  readonly showDate?: boolean;
  readonly t: TeacherTranslator;
}) {
  const { session, course } = view;
  const stage = classStage(session, now);
  const controls = classControls(session, now);
  const own = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(
      session.startsAt,
    );
  const elsewhere = session.timeZone !== zone;
  const href = classHref(locale, session.id);

  return (
    <li className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] gap-x-4 gap-y-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] sm:items-start">
      <p className="flex flex-col">
        {showDate ? (
          <span className="text-caption font-semibold text-foreground-muted">
            {own({ weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        ) : null}
        <time
          dateTime={session.startsAt.toISOString()}
          className={`text-lg leading-tight font-semibold tabular-nums ${
            stage === 'cancelled' ? 'text-foreground-muted line-through' : ''
          }`}
        >
          {own({ timeStyle: 'short' })}
        </time>
        <span className="text-sm text-foreground-muted tabular-nums">
          {new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: zone }).format(
            session.endsAt,
          )}
        </span>
      </p>

      <div className="flex min-w-0 flex-col gap-1.5">
        <a
          href={href}
          className="text-base font-semibold text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-action"
        >
          <LearningTitle
            labels={course.labels}
            primaryLocale={course.primaryLocale}
            locale={locale}
          />
        </a>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <StageBadge stage={stage} t={t} />
          <span className="text-foreground-muted">{t(`kind.${session.kind}`)}</span>
          <MeetingState view={view} t={t} />
        </p>
        {elsewhere ? (
          <p className="text-caption text-foreground-muted">
            {t('agenda.classTime', {
              time: clockRange(
                session.startsAt,
                session.endsAt,
                session.timeZone,
                locale,
              ),
              zone: zoneName(session.timeZone, session.startsAt, locale),
            })}
          </p>
        ) : null}
      </div>

      {controls.attendance ? (
        <div className="col-start-2 sm:col-start-auto">
          <a
            href={localizedPath(
              locale,
              `/teacher/attendance/${encodeURIComponent(session.id)}`,
            )}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-3 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border"
          >
            <Icon name="check" size={16} />
            {t('agenda.attendance')}
            <span className="sr-only">
              {' — '}
              <LearningTitle
                labels={course.labels}
                primaryLocale={course.primaryLocale}
                locale={locale}
              />
              {', '}
              {own({ dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </a>
        </div>
      ) : null}
    </li>
  );
}

/** A list of agenda rows: a real list, named, so its length is announced. */
export function Agenda({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <ol
      aria-label={label}
      className="rounded-panel border border-border bg-surface-raised px-4 shadow-panel sm:px-5"
    >
      {children}
    </ol>
  );
}

/** A date string as its own instant at noon UTC, for formatting a calendar day. */
const noonOf = (day: string) => new Date(`${day}T12:00:00Z`);

/** The heading of a week: "9 – 15 November 2026", in the interface locale. */
export function weekTitle(days: readonly string[], locale: Locale): string {
  const first = days[0] ?? '';
  const last = days[days.length - 1] ?? first;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatRange(noonOf(first), noonOf(last));
}

/** The way between weeks: previous, this week, next — each a link, never a disabled one. */
export function WeekNav({
  label,
  previous,
  current,
  next,
  t,
}: {
  readonly label: string;
  readonly previous: string | null;
  /** The current week's address, when another week is shown. */
  readonly current: string | null;
  readonly next: string | null;
  readonly t: TeacherTranslator;
}) {
  const link =
    'inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border-strong bg-surface-raised px-3 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border';
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-2">
        {previous === null ? null : (
          <li>
            <a href={previous} className={link}>
              <Icon name="chevron-start" size={16} />
              {t('week.previous')}
            </a>
          </li>
        )}
        {current === null ? null : (
          <li>
            <a href={current} className={link}>
              {t('week.current')}
            </a>
          </li>
        )}
        {next === null ? null : (
          <li>
            <a href={next} className={link}>
              {t('week.next')}
              <Icon name="chevron-end" size={16} />
            </a>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** What the two kinds of block mean, said once above the grid. */
export function WeekLegend({
  windows,
  t,
}: {
  readonly windows: boolean;
  readonly t: TeacherTranslator;
}) {
  return (
    <ul
      aria-label={t('week.legend')}
      className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground-muted"
    >
      <li className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="size-3.5 rounded-sm bg-action" />
        {t('week.legendClass')}
      </li>
      {windows ? (
        <li className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3.5 rounded-sm border border-dashed border-border-strong"
          />
          {t('week.legendWindow')}
        </li>
      ) : null}
    </ul>
  );
}

const BLOCK = 'flex min-w-0 flex-col gap-0.5 rounded-control px-2.5 py-2 text-sm';

/** One class as a block on a day: solid while it is ahead, quiet once it is past. */
function SessionBlock({
  view,
  locale,
  zone,
  now,
  t,
}: {
  readonly view: ClassSessionView;
  readonly locale: Locale;
  readonly zone: string;
  readonly now: Date;
  readonly t: TeacherTranslator;
}) {
  const { session, course } = view;
  const stage = classStage(session, now);
  const ahead = stage === 'upcoming' || stage === 'live';
  const tone = ahead
    ? 'bg-action text-action-foreground hover:bg-action-hover'
    : stage === 'cancelled'
      ? 'border border-border bg-surface-sunken text-foreground-muted hover:border-border-strong'
      : 'border border-border-strong bg-surface-raised text-foreground hover:bg-surface-sunken';
  return (
    <li>
      <a
        href={classHref(locale, session.id)}
        className={`${BLOCK} no-underline transition-colors duration-[var(--duration-fast)] ${tone}`}
      >
        <span className="text-caption font-semibold tabular-nums">
          <time dateTime={session.startsAt.toISOString()}>
            {clockRange(session.startsAt, session.endsAt, zone, locale)}
          </time>
        </span>
        <span
          className={`line-clamp-3 font-semibold wrap-anywhere ${
            stage === 'cancelled' ? 'line-through' : ''
          }`}
        >
          <LearningTitle
            labels={course.labels}
            primaryLocale={course.primaryLocale}
            locale={locale}
          />
        </span>
        <span
          className={`text-caption ${ahead ? 'opacity-90' : 'text-foreground-muted'}`}
        >
          {stage === 'upcoming'
            ? t(`kind.${session.kind}`)
            : stage === 'live'
              ? t('stage.live')
              : stage === 'ended'
                ? t('stage.ended')
                : t(`state.${stage}`)}
        </span>
        {ahead && !session.hasMeetingUrl ? (
          <span className="inline-flex items-center gap-1 text-caption font-semibold">
            <Icon name="info" size={16} />
            {t('meetingState.missing')}
          </span>
        ) : null}
      </a>
    </li>
  );
}

/** An open availability window: dashed, never mistaken for a class. */
function WindowBlock({
  window,
  locale,
  zone,
  t,
}: {
  readonly window: AvailabilityRecord;
  readonly locale: Locale;
  readonly zone: string;
  readonly t: TeacherTranslator;
}) {
  return (
    <li
      className={`${BLOCK} border border-dashed border-border-strong text-foreground-muted`}
    >
      <span className="text-caption font-semibold tabular-nums">
        <time dateTime={window.startsAt.toISOString()}>
          {clockRange(window.startsAt, window.endsAt, zone, locale)}
        </time>
      </span>
      <span>{t('week.window')}</span>
    </li>
  );
}

/**
 * A week: seven days, a column each from a laptop up and a list of days below
 * it. Today carries the word "Today" and the accent rule; a past day is
 * quieter. A day with nothing on it says so in one short line.
 */
export function WeekGrid({
  days,
  locale,
  zone,
  now,
  t,
}: {
  readonly days: readonly WeekDay<ClassSessionView, AvailabilityRecord>[];
  readonly locale: Locale;
  readonly zone: string;
  readonly now: Date;
  readonly t: TeacherTranslator;
}) {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const longDay = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
  const dayNumber = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' });
  return (
    <ol className="grid grid-cols-1 overflow-hidden rounded-panel border border-border shadow-panel lg:grid-cols-7 [&>li+li]:border-t [&>li+li]:border-border lg:[&>li+li]:border-t-0 lg:[&>li+li]:border-s">
      {days.map((day) => {
        // One chronological column: classes and windows interleaved by start.
        const entries = [
          ...day.sessions.map((view) => ({
            at: view.session.startsAt.getTime(),
            node: (
              <SessionBlock
                key={view.session.id}
                view={view}
                locale={locale}
                zone={zone}
                now={now}
                t={t}
              />
            ),
          })),
          ...day.windows.map((window) => ({
            at: window.startsAt.getTime(),
            node: (
              <WindowBlock
                key={window.id}
                window={window}
                locale={locale}
                zone={zone}
                t={t}
              />
            ),
          })),
        ].sort((a, b) => a.at - b.at);
        return (
          <li
            key={day.date}
            {...(day.today ? { 'aria-current': 'date' as const } : {})}
            className={`flex min-w-0 flex-col gap-2 p-3 lg:min-h-56 ${
              day.past ? 'bg-surface' : 'bg-surface-raised'
            }`}
          >
            <h3
              className={`flex items-baseline gap-2 border-b-2 pb-1.5 ${
                day.today ? 'border-accent' : 'border-transparent'
              }`}
            >
              <span className="sr-only">{longDay.format(noonOf(day.date))}</span>
              <span
                aria-hidden="true"
                className={`text-caption font-semibold uppercase ${
                  day.today ? 'text-accent' : 'text-foreground-muted'
                }`}
              >
                {weekday.format(noonOf(day.date))}
              </span>
              <span
                aria-hidden="true"
                className={`font-serif text-xl leading-none font-semibold tabular-nums ${
                  day.past ? 'text-foreground-muted' : ''
                }`}
              >
                {dayNumber.format(noonOf(day.date))}
              </span>
              {day.today ? (
                <span className="ms-auto text-caption font-semibold text-accent">
                  {t('week.today')}
                </span>
              ) : null}
            </h3>
            {entries.length === 0 ? (
              <p className="text-caption text-foreground-muted">{t('week.dayEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {entries.map((entry) => entry.node)}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
