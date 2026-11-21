import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { ReactNode } from 'react';
import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  AttendanceStatus,
  ClassSessionRecord,
  SessionState,
} from '@minhaj/contracts/learning';

import { MyPage, MySection } from '@/components/my/frame';
import { MySteps } from '@/components/my/summary-parts';
import { Alert, EmptyState, StatusBadge } from '@/components/ui';
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
 * ONE PRIVATE PRODUCT (Teacher area, R2). A Teacher-area page is built from
 * the same page frame as My Minhaj (`MyPage`): its trail (Teacher area /
 * section / the page), its one `h1`, its tabs where a page is one of several
 * views, and the fixed slot where a change is said aloud
 * (`change-announcer.tsx`). Sections are My Minhaj's unboxed sections.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in
 * English, Urdu and Arabic.
 */

export type TeacherTranslator = Awaited<ReturnType<typeof getTranslations<'teacher'>>>;

/** One step of a trail: a link, or — the last — the page itself. */
export interface TeacherCrumb {
  readonly href?: string;
  readonly text: string;
}

export interface TeacherTrail {
  readonly label: string;
  readonly crumbs: readonly TeacherCrumb[];
}

/** Where a page sits: "Teacher area / Students / a learner", the last crumb the page. */
export function teacherTrail(
  locale: Locale,
  t: TeacherTranslator,
  crumbs: readonly TeacherCrumb[],
): TeacherTrail {
  return {
    label: t('trail.label'),
    crumbs: [
      { href: localizedPath(locale, '/teacher'), text: t('trail.home') },
      ...crumbs,
    ],
  };
}

/**
 * A Teacher-area page: its trail, heading and introduction, an optional
 * primary action, optional tabs, the announcer's fixed slot, and its content —
 * the full width of the content column, since a teacher's calendar and
 * reports are tables.
 */
export function TeacherFrame({
  title,
  description,
  action,
  trail,
  tabs,
  announce,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** The page's one primary action, beside its heading. */
  readonly action?: ReactNode;
  readonly trail?: TeacherTrail;
  readonly tabs?: {
    readonly label: string;
    readonly items: readonly {
      readonly href: string;
      readonly text: string;
      readonly current: boolean;
    }[];
  };
  /** What a list or a class is now, as the server rendered it — said aloud when it changes. */
  readonly announce?: { readonly value: string; readonly message: string };
  readonly children: ReactNode;
}) {
  return (
    <MyPage
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(action === undefined ? {} : { action })}
      {...(trail === undefined ? {} : { trail })}
      {...(tabs === undefined ? {} : { tabs })}
      {...(announce === undefined ? {} : { announce })}
    >
      {children}
    </MyPage>
  );
}

/**
 * One section of a Teacher-area page: its `h2` (labelling the section), an
 * optional line of help, an optional link onward named by where it goes, and
 * its content.
 */
export function TeacherSection({
  id,
  heading,
  intro,
  action,
  children,
}: {
  readonly id: string;
  readonly heading: ReactNode;
  readonly intro?: ReactNode;
  readonly action?: { readonly href: string; readonly text: string };
  readonly children: ReactNode;
}) {
  return (
    <MySection
      id={id}
      heading={heading}
      {...(intro === undefined ? {} : { intro })}
      {...(action === undefined ? {} : { link: action })}
    >
      {children}
    </MySection>
  );
}

/**
 * What a teacher with no Course yet sees: not an empty dashboard, but what
 * happens next — Courses are assigned by the learning team, and the classes,
 * learners and materials follow from that, in three steps. Availability can be
 * offered now.
 */
export function NoScope({
  locale,
  t,
}: {
  readonly locale: Locale;
  readonly t: TeacherTranslator;
}) {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        icon="book"
        title={t('noScope.title')}
        action={{
          href: localizedPath(locale, '/teacher/availability'),
          text: t('noScope.action'),
        }}
      >
        {t('noScope.body')}
      </EmptyState>
      <MySteps
        label={t('noScope.stepsLabel')}
        steps={(['assigned', 'prepare', 'offer'] as const).map((key) => ({
          key,
          title: t(`noScope.steps.${key}.title`),
          body: t(`noScope.steps.${key}.body`),
        }))}
      />
    </div>
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
        <span className="text-foreground-muted">
          {t('time.classZone', {
            zone: zoneName(session.timeZone, session.startsAt, locale),
          })}
        </span>{' '}
        <time dateTime={session.startsAt.toISOString()}>
          {classRange(session, session.timeZone, locale)}
        </time>
      </p>
      {same ? (
        <p className="text-foreground-muted">{t('time.sameZone')}</p>
      ) : (
        <p>
          <span className="text-foreground-muted">
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
    'not-started': t('failure.notStarted'),
    booked: t('failure.booked'),
    ...overrides,
  };
}

export type MyTranslator = Awaited<ReturnType<typeof getTranslations<'my'>>>;

/** The words a Teacher-area list's pager speaks: the area's own, and My Minhaj's page label. */
export function pagerWords(
  t: TeacherTranslator,
  my: MyTranslator,
): {
  readonly previous: string;
  readonly next: string;
  readonly page: (page: number) => string;
} {
  return {
    previous: t('common.previous'),
    next: t('common.next'),
    page: (page) => my('list.page', { page }),
  };
}
