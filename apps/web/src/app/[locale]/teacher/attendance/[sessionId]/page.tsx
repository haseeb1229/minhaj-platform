import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { AttendanceMarks } from '@/components/teacher/attendance-marks';
import { classControls } from '@/components/teacher/class-stage';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { participantNames } from '@/components/teacher/names';
import {
  ClassTime,
  NotActivated,
  SessionStateBadge,
  TeacherFrame,
  teacherTrail,
} from '@/components/teacher/parts';
import { ownZone } from '@/components/teacher/presentation';
import { ActionLink, Alert } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { markAttendanceAction } from '../../actions';
import { requireTeacher } from '../../guard';

/**
 * Marking one class's attendance (ROUTE_MAP.md §6): the participants and
 * their marks, nothing else — no meeting link is read here, because marking
 * who came needs none. The class detail page holds the rest.
 *
 * ONLY ONCE THE CLASS HAS BEGUN (audit F38). Before its start the page lists
 * who is on the class and says when marking opens; it offers no mark the
 * service would refuse.
 *
 * WHERE IT SITS, AND WHAT CHANGED (Teacher area, R2). The trail is Teacher
 * area / Attendance / the Course; after each mark the class's counts —
 * present, absent, not marked — are said aloud, and focus stays on the
 * pressed control or returns to the page heading.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'markAttendance');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MarkAttendancePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly sessionId: string }>;
}) {
  const locale = await requireLocale(params);
  const { sessionId } = await params;
  const path = localizedPath(
    locale,
    `/teacher/attendance/${encodeURIComponent(sessionId)}`,
  );
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const { teaching } = learningRuntime();
  const read = await learningRead('teaching-attendance-session', () =>
    teaching.session(gate.actor, sessionId),
  );
  const attendanceCrumb = {
    href: localizedPath(locale, '/teacher/attendance'),
    text: t('nav.attendance'),
  };
  if (!read.ok)
    return (
      <TeacherFrame
        title={t('attendancePage.markTitle')}
        trail={teacherTrail(locale, t, [
          attendanceCrumb,
          { text: t('attendancePage.markTitle') },
        ])}
      >
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );
  if (read.value === null) notFound();

  const { session, course } = read.value;
  const accountZone = gate.session.account.timezone;
  const controls = classControls(session, new Date());
  const participants = await learningRead('teaching-attendance-participants', () =>
    teaching.participants(gate.actor, session.id),
  );
  const names = participants.ok
    ? await participantNames(participants.value.map((entry) => entry.accountId))
    : new Map<string, string>();
  const marks = participants.ok ? participants.value : [];
  const present = marks.filter((entry) => entry.attendance === 'present').length;
  const absent = marks.filter((entry) => entry.attendance === 'absent').length;
  const unmarked = marks.length - present - absent;

  return (
    <TeacherFrame
      title={t('attendancePage.markTitle')}
      trail={teacherTrail(locale, t, [
        attendanceCrumb,
        {
          text:
            pickLabel(course.labels, locale, course.primaryLocale)?.title ?? course.slug,
        },
      ])}
      announce={{
        value: `${String(present)}:${String(absent)}:${String(unmarked)}`,
        message: t('live.class', {
          state: t(`state.${session.state}`),
          present,
          absent,
          unmarked,
        }),
      }}
      description={
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              <LearningTitle
                labels={course.labels}
                primaryLocale={course.primaryLocale}
                locale={locale}
              />
            </span>
            <span>{t(`kind.${session.kind}`)}</span>
            <SessionStateBadge state={session.state} t={t} />
          </p>
          <ClassTime session={session} locale={locale} accountZone={accountZone} t={t} />
        </>
      }
      action={
        <ActionLink
          href={localizedPath(
            locale,
            `/teacher/classes/today/${encodeURIComponent(session.id)}`,
          )}
          tone="secondary"
        >
          {t('common.openClass')}
        </ActionLink>
      }
    >
      {controls.attendance ? (
        <p className="text-sm text-foreground-muted">
          {t('attendancePage.markDescription')}
        </p>
      ) : session.state === 'cancelled' ? null : (
        <Alert tone="info">
          {t('session.attendanceOpens', {
            time: new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: ownZone(accountZone),
            }).format(session.startsAt),
          })}
        </Alert>
      )}
      {!participants.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : (
        <AttendanceMarks
          sessionId={session.id}
          participants={participants.value}
          names={names}
          locale={locale}
          action={markAttendanceAction}
          markable={controls.attendance}
          t={t}
        />
      )}
    </TeacherFrame>
  );
}
