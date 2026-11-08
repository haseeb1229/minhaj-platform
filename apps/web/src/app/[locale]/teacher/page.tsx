import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { ClassSessionView } from '@minhaj/contracts/learning';

import {
  messagingRead,
  participantNames as messagingNames,
} from '@/components/messaging/read';
import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { participantNames } from '@/components/teacher/names';
import {
  NoScope,
  NotActivated,
  TeacherFrame,
  TeacherSection,
  type TeacherTranslator,
} from '@/components/teacher/parts';
import { dayBounds, needsMeeting, ownZone } from '@/components/teacher/presentation';
import { collectPages } from '@/components/teacher/read';
import { Agenda, SessionRow } from '@/components/teacher/schedule';
import { progressStage } from '@/components/teacher/student-progress';
import { dateIn, weekSpan, weekStartOf } from '@/components/teacher/week';
import {
  ActionLink,
  Alert,
  Badge,
  EmptyState,
  Icon,
  type IconName,
} from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { messagingRuntime } from '@/composition/messaging';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from './guard';

/**
 * The Teacher area's home (ROUTE_MAP.md §6; R2): what needs the teacher now,
 * today's classes, the rest of this week, unread messages and learners who
 * have not begun — each read live from the teacher's own current scopes.
 *
 * A TEACHER WITH NO COURSE SEES WHAT HAPPENS NEXT, not a wall of empty
 * panels: courses are assigned by the learning team, and everything here
 * follows from that.
 *
 * BOUNDED, AND SAYS SO. The calendar is walked a bounded number of pages and
 * the attendance report two; a count that hit its bound is written "24+",
 * never as an exact number it is not. Learners needing attention come from the
 * first page of the teacher's learners — the same audited listing the Students
 * page reads — and the section says it is a first look, not the whole roster.
 *
 * NEVER THE MEETING ADDRESS. A row here knows only whether a link is held; the
 * address is read on the class's own page.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'overview');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const CALENDAR_PAGES = 10;
const REPORT_PAGES = 2;
const ATTENTION_LEARNERS = 5;
const UNREAD_SHOWN = 4;

export default async function TeacherOverviewPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, localizedPath(locale, '/teacher'));
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const { teaching } = learningRuntime();
  const accountZone = gate.session.account.timezone;
  const zone = ownZone(accountZone);
  const now = new Date();
  const today = dateIn(now, zone);
  const title = t('home.title');
  const description = (
    <p>
      {new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: zone }).format(now)}
    </p>
  );

  const courses = await learningRead('teaching-overview-courses', () =>
    teaching.courses(gate.actor),
  );
  if (courses.ok && courses.value.length === 0)
    return (
      <TeacherFrame title={title} description={description}>
        <NoScope locale={locale} t={t} />
      </TeacherFrame>
    );

  const day = dayBounds(now, zone);
  const week = weekSpan(weekStartOf(today), zone);
  const [todayRead, ahead, report, learners, inbox] = await Promise.all([
    learningRead('teaching-overview-today', () =>
      teaching.today(gate.actor, day.from, day.to),
    ),
    learningRead('teaching-overview-calendar', () =>
      collectPages(
        (offset) => teaching.calendar(gate.actor, null, offset),
        CALENDAR_PAGES,
      ),
    ),
    learningRead('teaching-overview-attendance', () =>
      collectPages(
        (offset) => teaching.attendanceReport(gate.actor, offset),
        REPORT_PAGES,
      ),
    ),
    learningRead('teaching-overview-students', () =>
      teaching.students(gate.actor, null, 0),
    ),
    messagingRead('messaging-teacher-overview', async () => {
      const { service } = messagingRuntime();
      const [capabilities, page] = await Promise.all([
        service.capabilities(),
        service.conversations(gate.actor, { surface: 'teacher', cursor: null }),
      ]);
      return { capabilities, page };
    }),
  ]);

  const thisWeek = ahead.ok
    ? ahead.value.items.filter(
        (view) =>
          view.session.startsAt.getTime() >= day.to.getTime() &&
          view.session.startsAt.getTime() < week.to.getTime(),
      )
    : [];
  const next = ahead.ok
    ? ahead.value.items.find(
        (view) =>
          view.session.state === 'scheduled' &&
          view.session.startsAt.getTime() >= day.to.getTime(),
      )
    : undefined;

  /* ---- What needs the teacher ------------------------------------------ */

  const plus = (count: number, bounded: boolean) =>
    bounded ? `${String(count)}+` : String(count);
  const attention: {
    readonly key: string;
    readonly icon: IconName;
    readonly text: string;
    readonly href: string;
    readonly link: string;
  }[] = [];
  if (report.ok) {
    const unmarked = report.value.items.filter((row) => row.unmarked > 0);
    if (unmarked.length > 0)
      attention.push({
        key: 'attendance',
        icon: 'check',
        text: t('home.attention.attendance', {
          count: plus(unmarked.length, report.value.truncated),
        }),
        href: localizedPath(locale, '/teacher/attendance'),
        link: t('home.attention.attendanceLink'),
      });
    const unheld = report.value.items.filter(
      (row) =>
        row.session.state === 'scheduled' &&
        row.session.endsAt.getTime() <= now.getTime(),
    );
    const first = unheld[0];
    if (first !== undefined)
      attention.push({
        key: 'held',
        icon: 'calendar',
        text: t('home.attention.held', {
          count: plus(unheld.length, report.value.truncated),
        }),
        href: localizedPath(
          locale,
          `/teacher/classes/today/${encodeURIComponent(first.session.id)}`,
        ),
        link: t('home.attention.heldLink'),
      });
  }
  if (ahead.ok) {
    const pending = ahead.value.items.filter((view) => needsMeeting(view.session));
    const first = pending[0];
    if (first !== undefined)
      attention.push({
        key: 'meeting',
        icon: 'video',
        text: t('home.attention.meeting', {
          count: plus(pending.length, ahead.value.truncated),
        }),
        href: localizedPath(
          locale,
          `/teacher/classes/today/${encodeURIComponent(first.session.id)}`,
        ),
        link: t('home.attention.meetingLink'),
      });
  }
  const conversations =
    inbox.ok && inbox.value.capabilities.teacherStudent
      ? inbox.value.page.conversations.filter(
          (summary) => summary.access === 'available' && summary.unread > 0,
        )
      : [];
  const unread = conversations.reduce((total, summary) => total + summary.unread, 0);
  if (unread > 0)
    attention.push({
      key: 'messages',
      icon: 'message',
      text: t('home.attention.messages', {
        count: plus(unread, inbox.ok && inbox.value.page.next !== null),
      }),
      href: localizedPath(locale, '/teacher/messages'),
      link: t('home.attention.messagesLink'),
    });
  const failed = !report.ok || !ahead.ok || !inbox.ok;

  /* ---- Side reads ------------------------------------------------------- */

  const notStarted = learners.ok
    ? learners.value.items
        .flatMap((student) =>
          student.courses
            .filter(
              (entry) =>
                progressStage(entry.completedLessons, entry.course.lessons) ===
                'not-started',
            )
            .map((entry) => ({ accountId: student.accountId, course: entry.course })),
        )
        .slice(0, ATTENTION_LEARNERS)
    : [];
  const [learnerNames, counterpartNames] = await Promise.all([
    participantNames(notStarted.map((entry) => entry.accountId)),
    messagingNames(
      conversations.slice(0, UNREAD_SHOWN).map((summary) => summary.counterpartAccountId),
    ),
  ]);

  return (
    <TeacherFrame
      title={title}
      description={description}
      action={
        <ActionLink href={localizedPath(locale, '/teacher/calendar')} tone="secondary">
          {t('home.openCalendar')}
        </ActionLink>
      }
    >
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <TeacherSection id="overview-attention" heading={t('home.attention.heading')}>
            {failed ? <Alert tone="error">{t('home.unavailable')}</Alert> : null}
            {attention.length === 0 ? (
              failed ? null : (
                <p className="flex items-center gap-2 text-sm text-foreground-muted">
                  <Icon name="check" size={20} className="text-success" />
                  {t('home.attention.none')}
                </p>
              )
            ) : (
              <ul className="flex flex-col gap-2">
                {attention.map((item) => (
                  <li
                    key={item.key}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-panel border border-border bg-surface-raised px-4 py-3"
                  >
                    <Icon name={item.icon} size={20} className="shrink-0 text-accent" />
                    <span className="min-w-0 grow text-sm font-medium">{item.text}</span>
                    <a
                      href={item.href}
                      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
                    >
                      {item.link}
                      <Icon name="arrow-end" size={16} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </TeacherSection>

          <TeacherSection
            id="overview-today"
            heading={t('home.today')}
            action={{
              href: localizedPath(locale, '/teacher/classes/today'),
              text: t('home.todayLink'),
            }}
          >
            {!todayRead.ok ? (
              <Alert tone="error">{t('home.unavailable')}</Alert>
            ) : todayRead.value.items.length === 0 ? (
              <EmptyState>
                {t('home.todayNone')}{' '}
                <NextClass next={next} locale={locale} zone={zone} t={t} />
              </EmptyState>
            ) : (
              <Agenda label={t('home.today')}>
                {todayRead.value.items.map((view) => (
                  <SessionRow
                    key={view.session.id}
                    view={view}
                    locale={locale}
                    zone={zone}
                    now={now}
                    t={t}
                  />
                ))}
              </Agenda>
            )}
          </TeacherSection>

          <TeacherSection
            id="overview-week"
            heading={t('home.week')}
            action={{
              href: localizedPath(locale, '/teacher/calendar'),
              text: t('home.weekLink'),
            }}
          >
            {!ahead.ok ? (
              <Alert tone="error">{t('home.unavailable')}</Alert>
            ) : thisWeek.length === 0 ? (
              <EmptyState>{t('home.weekNone')}</EmptyState>
            ) : (
              <Agenda label={t('home.week')}>
                {thisWeek.map((view) => (
                  <SessionRow
                    key={view.session.id}
                    view={view}
                    locale={locale}
                    zone={zone}
                    now={now}
                    showDate
                    t={t}
                  />
                ))}
              </Agenda>
            )}
          </TeacherSection>
        </div>

        <aside aria-label={t('home.aside')} className="flex min-w-0 flex-col gap-8">
          {inbox.ok && inbox.value.capabilities.teacherStudent ? (
            <TeacherSection
              id="overview-messages"
              heading={t('home.messages')}
              action={{
                href: localizedPath(locale, '/teacher/messages'),
                text: t('home.messagesLink'),
              }}
            >
              {conversations.length === 0 ? (
                <p className="text-sm text-foreground-muted">{t('home.messagesNone')}</p>
              ) : (
                <ul className="flex flex-col">
                  {conversations.slice(0, UNREAD_SHOWN).map((summary) => (
                    <li
                      key={summary.id}
                      className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
                    >
                      <a
                        href={localizedPath(
                          locale,
                          `/teacher/messages/${encodeURIComponent(summary.id)}`,
                        )}
                        dir="auto"
                        className="inline-flex min-h-11 min-w-0 items-center font-medium wrap-anywhere text-action underline underline-offset-2"
                      >
                        {(summary.counterpartAccountId === null
                          ? undefined
                          : counterpartNames.get(summary.counterpartAccountId)) ??
                          t('common.learner')}
                      </a>
                      <Badge kind="status" tone="action">
                        {t('home.unread', { count: String(summary.unread) })}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </TeacherSection>
          ) : null}

          <TeacherSection
            id="overview-learners"
            heading={t('home.learners')}
            action={{
              href: localizedPath(locale, '/teacher/students'),
              text: t('home.learnersLink'),
            }}
          >
            {!learners.ok ? (
              <Alert tone="error">{t('home.unavailable')}</Alert>
            ) : notStarted.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('home.learnersNone')}</p>
            ) : (
              <>
                <p className="text-sm text-foreground-muted">{t('home.learnersHelp')}</p>
                <ul className="flex flex-col">
                  {notStarted.map((entry) => (
                    <li
                      key={`${entry.accountId}-${entry.course.id}`}
                      className="flex flex-col border-b border-border py-2 last:border-b-0"
                    >
                      <a
                        href={localizedPath(
                          locale,
                          `/teacher/students/${encodeURIComponent(entry.accountId)}`,
                        )}
                        dir="auto"
                        className="inline-flex min-h-11 items-center font-medium wrap-anywhere text-action underline underline-offset-2"
                      >
                        {learnerNames.get(entry.accountId) ?? t('common.learner')}
                      </a>
                      <span className="text-caption text-foreground-muted">
                        <LearningTitle
                          labels={entry.course.labels}
                          primaryLocale={entry.course.primaryLocale}
                          locale={locale}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TeacherSection>

          <Shortcuts locale={locale} t={t} />
        </aside>
      </div>
    </TeacherFrame>
  );
}

/** "Your next class: Thursday 12 November, 18:00 — {course}", or that there is none. */
function NextClass({
  next,
  locale,
  zone,
  t,
}: {
  readonly next: ClassSessionView | undefined;
  readonly locale: Locale;
  readonly zone: string;
  readonly t: TeacherTranslator;
}) {
  if (next === undefined) return <>{t('home.nextNone')}</>;
  return (
    <>
      {t('home.nextAt', {
        when: new Intl.DateTimeFormat(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: zone,
        }).format(next.session.startsAt),
      })}{' '}
      <a
        href={localizedPath(
          locale,
          `/teacher/classes/today/${encodeURIComponent(next.session.id)}`,
        )}
        className="font-medium text-action underline underline-offset-2"
      >
        <LearningTitle
          labels={next.course.labels}
          primaryLocale={next.course.primaryLocale}
          locale={locale}
        />
      </a>
    </>
  );
}

/** The few places a teacher goes to on purpose rather than from a task. */
function Shortcuts({
  locale,
  t,
}: {
  readonly locale: Locale;
  readonly t: TeacherTranslator;
}) {
  const links: {
    readonly href: string;
    readonly text: string;
    readonly icon: IconName;
  }[] = [
    {
      href: '/teacher/availability',
      text: t('home.shortcut.availability'),
      icon: 'plus',
    },
    {
      href: '/teacher/attendance/reports',
      text: t('home.shortcut.reports'),
      icon: 'list',
    },
    { href: '/teacher/resources', text: t('home.shortcut.resources'), icon: 'book' },
    { href: '/teacher/profile', text: t('home.shortcut.profile'), icon: 'user' },
  ];
  return (
    <TeacherSection id="overview-shortcuts" heading={t('home.shortcuts')}>
      <ul className="flex flex-col">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={localizedPath(locale, link.href)}
              className="flex min-h-11 items-center gap-3 rounded-control px-2 text-sm font-medium text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border"
            >
              <Icon name={link.icon} size={20} className="text-foreground-muted" />
              {link.text}
            </a>
          </li>
        ))}
      </ul>
    </TeacherSection>
  );
}
