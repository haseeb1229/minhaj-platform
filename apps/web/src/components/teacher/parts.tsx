import 'server-only';

import type { ReactNode } from 'react';
import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  AttendanceStatus,
  ClassSessionRecord,
  SessionState,
} from '@minhaj/contracts/learning';

import { Alert, StatusBadge } from '@/components/ui';
import { WorkspaceLinks, WorkspacePage } from '@/components/workspace/parts';
import { classRange, ownZone, zoneName } from './presentation';

/**
 * The parts every Teacher-area page shares (ROUTE_MAP.md §6; Phase 23).
 *
 * STATE IS WORDS FIRST. "Scheduled", "Cancelled", "Present", "Not marked" are
 * text; a badge's border tone is decoration, and no state is ever carried by
 * colour alone (SECURITY_BASELINE.md §16.1).
 *
 * A CLASS HAS TWO TIMES. The one it was scheduled in — the zone that is a fact
 * of the record — and the teacher's own, so a teacher in Lahore reading a
 * class scheduled in London sees both and is never left converting.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in
 * English, Urdu and Arabic.
 */

export type TeacherTranslator = Awaited<ReturnType<typeof getTranslations<'teacher'>>>;

/**
 * The heading and introduction of a Teacher-area page, inside the area's
 * workspace frame — the full width of the content column, since a teacher's
 * calendar and reports are tables.
 */
export function TeacherFrame({
  title,
  description,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <WorkspacePage title={title} {...(description === undefined ? {} : { description })}>
      {children}
    </WorkspacePage>
  );
}

/** The honest page every Teacher route shows while live learning is not activated. */
export function NotActivated({ t }: { readonly t: TeacherTranslator }) {
  return (
    <TeacherFrame title={t('notActivated.title')}>
      <Alert tone="info">{t('notActivated.body')}</Alert>
    </TeacherFrame>
  );
}

/** A class's own scheduled time, and the teacher's own reading of it when that differs. */
export function ClassTime({
  session,
  locale,
  accountZone,
  t,
}: {
  readonly session: Pick<ClassSessionRecord, 'startsAt' | 'endsAt' | 'timeZone'>;
  readonly locale: Locale;
  readonly accountZone: string | null;
  readonly t: TeacherTranslator;
}) {
  const own = ownZone(accountZone);
  const same = own === session.timeZone;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        <span className="text-[color:var(--color-foreground-muted)]">
          {t('time.classZone', {
            zone: zoneName(session.timeZone, session.startsAt, locale),
          })}
        </span>{' '}
        <time dateTime={session.startsAt.toISOString()}>
          {classRange(session, session.timeZone, locale)}
        </time>
      </p>
      {same ? (
        <p className="text-[color:var(--color-foreground-muted)]">{t('time.sameZone')}</p>
      ) : (
        <p>
          <span className="text-[color:var(--color-foreground-muted)]">
            {t('time.ownZone', { zone: zoneName(own, session.startsAt, locale) })}
          </span>{' '}
          <time dateTime={session.startsAt.toISOString()}>
            {classRange(session, own, locale)}
          </time>
        </p>
      )}
    </div>
  );
}

/** An instant in the teacher's own zone. */
export function OwnTime({
  value,
  locale,
  accountZone,
}: {
  readonly value: Date;
  readonly locale: Locale;
  readonly accountZone: string | null;
}) {
  return (
    <time dateTime={value.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: ownZone(accountZone),
      }).format(value)}
    </time>
  );
}

/** A class's state, in words. */
export function SessionStateBadge({
  state,
  t,
}: {
  readonly state: SessionState;
  readonly t: TeacherTranslator;
}) {
  const tone =
    state === 'scheduled' ? 'positive' : state === 'cancelled' ? 'caution' : 'neutral';
  return <StatusBadge tone={tone}>{t(`state.${state}`)}</StatusBadge>;
}

/** An attendance mark, in words — "Not marked" is a state too. */
export function AttendanceWord({
  status,
  t,
}: {
  readonly status: AttendanceStatus | null;
  readonly t: TeacherTranslator;
}) {
  if (status === null)
    return <StatusBadge tone="caution">{t('attendance.unmarked')}</StatusBadge>;
  return (
    <StatusBadge tone={status === 'present' ? 'positive' : 'neutral'}>
      {t(`attendance.${status}`)}
    </StatusBadge>
  );
}

/** A labelled group of links to neighbouring pages, each a 44-pixel target. */
export function TeacherLinks({
  label,
  links,
}: {
  readonly label: string;
  readonly links: readonly { readonly href: string; readonly text: string }[];
}) {
  return (
    <nav aria-label={label}>
      <WorkspaceLinks links={links} />
    </nav>
  );
}

/**
 * The words for every refusal a Teacher-area action can return — a category,
 * never content; `overrides` gives one form its own wording.
 */
export function teacherMessages(
  t: TeacherTranslator,
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    invalid: t('failure.invalid'),
    'not-found': t('failure.notFound'),
    conflict: t('failure.conflict'),
    'rate-limited': t('failure.rateLimited'),
    'confirm-required': t('failure.confirmRequired'),
    'no-session': t('failure.noSession'),
    denied: t('failure.denied'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
    'not-a-teacher': t('failure.notTeacher'),
    'not-activated': t('failure.notActivated'),
    overlap: t('failure.overlap'),
    'window-unavailable': t('failure.windowUnavailable'),
    terminal: t('failure.terminal'),
    past: t('failure.past'),
    'nonexistent-time': t('failure.nonexistentTime'),
    'ambiguous-time': t('failure.ambiguousTime'),
    'invalid-meeting': t('failure.invalidMeeting'),
    'not-participant': t('failure.notParticipant'),
    booked: t('failure.booked'),
    ...overrides,
  };
}
