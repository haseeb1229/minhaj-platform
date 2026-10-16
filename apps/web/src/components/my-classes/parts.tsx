import 'server-only';

import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  AttendanceStatus,
  LearnerClassView,
  SessionState,
} from '@minhaj/contracts/learning';

import { ClassTime } from '@/components/live-learning/parts';
import { PersonalTime } from '@/components/personal/parts';
import { StatusBadge } from '@/components/ui';

/**
 * The parts every My Classes page shares (ROUTE_MAP.md §5.1; Phase 23).
 *
 * STATE IS WORDS. "Scheduled", "Cancelled", "Present" are text in a badge; no
 * tone carries meaning on its own (SECURITY_BASELINE.md §16.1).
 *
 * TWO CLOCKS, BOTH NAMED. A class is stated in the zone it was scheduled in
 * — that is the fact the teacher committed to — and again in the person's own
 * account zone, so a learner in Lahore and a teacher in London read one class
 * and never have to convert it in their head.
 *
 * ONE DOOR FOR THE MEETING ADDRESS. `JoinLink` renders the address the
 * disclosure read returned and nothing else ever prints it; it is an ordinary
 * described external link that opens in a new tab, never an embed.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`).
 */

export type ClassesTranslator = Awaited<ReturnType<typeof getTranslations<'myClasses'>>>;

interface Link {
  readonly href: string;
  readonly text: string;
}

/** The neighbouring pages each My Classes page links to. */
export function classLinks(locale: Locale, t: ClassesTranslator): readonly Link[] {
  return [
    { href: `/${locale}/my/classes`, text: t('nav.classes') },
    { href: `/${locale}/my/teachers`, text: t('nav.teachers') },
    { href: `/${locale}/my/learning`, text: t('nav.learning') },
    { href: `/${locale}/learn/live`, text: t('nav.schedule') },
    { href: `/${locale}/my`, text: t('nav.account') },
  ];
}

/**
 * The words for every refusal a My Classes action can return — a category,
 * never content; `overrides` gives one form its own wording.
 */
export function classMessages(
  t: ClassesTranslator,
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    invalid: t('failure.invalid'),
    'not-found': t('failure.notFound'),
    conflict: t('failure.conflict'),
    terminal: t('failure.terminal'),
    past: t('failure.past'),
    'not-activated': t('failure.notActivated'),
    'not-participant': t('failure.notFound'),
    // A learner's one act can meet none of these; each still has words.
    'not-enrolled': t('failure.notFound'),
    booked: t('failure.invalid'),
    'course-unavailable': t('failure.invalid'),
    'not-a-teacher': t('failure.invalid'),
    overlap: t('failure.invalid'),
    'window-unavailable': t('failure.invalid'),
    'nonexistent-time': t('failure.invalid'),
    'ambiguous-time': t('failure.invalid'),
    'invalid-meeting': t('failure.invalid'),
    'has-classes': t('failure.invalid'),
    'rate-limited': t('failure.rateLimited'),
    'confirm-required': t('failure.confirmRequired'),
    'no-session': t('failure.noSession'),
    denied: t('failure.noSession'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
    ...overrides,
  };
}

export function SessionStateBadge({
  state,
  t,
}: {
  readonly state: SessionState;
  readonly t: ClassesTranslator;
}) {
  return (
    <StatusBadge tone={state === 'scheduled' ? 'positive' : 'neutral'}>
      {t(`state.${state}`)}
    </StatusBadge>
  );
}

export function AttendanceBadge({
  status,
  t,
}: {
  readonly status: AttendanceStatus;
  readonly t: ClassesTranslator;
}) {
  return (
    <StatusBadge tone={status === 'present' ? 'positive' : 'caution'}>
      {t(`attendance.${status}`)}
    </StatusBadge>
  );
}

/** The kind of class and how the person is on it, in words. */
export function ParticipationBadge({
  entry,
  t,
}: {
  readonly entry: Pick<LearnerClassView, 'participation'>;
  readonly t: ClassesTranslator;
}) {
  return (
    <StatusBadge tone="neutral">{t(`participation.${entry.participation}`)}</StatusBadge>
  );
}

/** A class's start and end in its own zone, and again in the account's. */
export function ClassSchedule({
  session,
  locale,
  timeZone,
  t,
}: {
  readonly session: LearnerClassView['session'];
  readonly locale: Locale;
  /** The account's own zone, or `null` when none is set. */
  readonly timeZone: string | null;
  readonly t: ClassesTranslator;
}) {
  return (
    <dl className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-[color:var(--color-foreground-muted)]">{t('time.starts')}</dt>
        <dd>
          <ClassTime
            instant={session.startsAt}
            local={session.startsLocal}
            timeZone={session.timeZone}
            locale={locale}
          />
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-[color:var(--color-foreground-muted)]">{t('time.ends')}</dt>
        <dd>
          <ClassTime
            instant={session.endsAt}
            local={session.endsLocal}
            timeZone={session.timeZone}
            locale={locale}
            date={false}
          />
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-[color:var(--color-foreground-muted)]">
          {t('time.classZone')}
        </dt>
        <dd>{session.timeZone}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-[color:var(--color-foreground-muted)]">
          {t('time.yourZone')}
        </dt>
        <dd>
          <PersonalTime
            value={session.startsAt.toISOString()}
            locale={locale}
            timeZone={timeZone}
          />
        </dd>
      </div>
    </dl>
  );
}

/**
 * THE join link — the only element on the platform that carries a meeting
 * address. Rendered only when the disclosure read returned one.
 */
export function JoinLink({
  url,
  label,
}: {
  readonly url: string;
  readonly label: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[color:var(--color-action)] px-4 py-2 text-sm font-medium text-[color:var(--color-action-foreground)] hover:bg-[color:var(--color-action-hover)]"
    >
      {label}
    </a>
  );
}
