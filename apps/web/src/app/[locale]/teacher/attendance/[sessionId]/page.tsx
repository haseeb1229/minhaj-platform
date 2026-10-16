import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { AttendanceMarks } from '@/components/teacher/attendance-marks';
import { participantNames } from '@/components/teacher/names';
import {
  ClassTime,
  NotActivated,
  SessionStateBadge,
  TeacherFrame,
} from '@/components/teacher/parts';
import { Alert, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { markAttendanceAction } from '../../actions';
import { requireTeacher } from '../../guard';

/**
 * Marking one class's attendance (ROUTE_MAP.md §6): the participants and
 * their marks, nothing else — no meeting link is read here, because marking
 * who came needs none. The class detail page holds the rest.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MarkAttendancePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly sessionId: string }>;
}) {
  const locale = await requireLocale(params);
  const { sessionId } = await params;
  const path = `/${locale}/teacher/attendance/${encodeURIComponent(sessionId)}`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const { teaching } = learningRuntime();
  const read = await learningRead('teaching-attendance-session', () =>
    teaching.session(gate.actor, sessionId),
  );
  if (!read.ok)
    return (
      <TeacherFrame title={t('attendancePage.markTitle')}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );
  if (read.value === null) notFound();

  const { session, course } = read.value;
  const participants = await learningRead('teaching-attendance-participants', () =>
    teaching.participants(gate.actor, session.id),
  );
  const names = participants.ok
    ? await participantNames(participants.value.map((entry) => entry.accountId))
    : new Map<string, string>();

  return (
    <TeacherFrame
      title={t('attendancePage.markTitle')}
      description={
        <>
          <p className="flex flex-wrap items-center gap-2">
            <LearningTitle
              labels={course.labels}
              primaryLocale={course.primaryLocale}
              locale={locale}
            />
            <span>{t(`kind.${session.kind}`)}</span>
            <SessionStateBadge state={session.state} t={t} />
          </p>
          <ClassTime
            session={session}
            locale={locale}
            accountZone={gate.session.account.timezone}
            t={t}
          />
          <p>{t('attendancePage.markDescription')}</p>
          <p>
            <TextLink
              href={`/${locale}/teacher/classes/today/${encodeURIComponent(session.id)}`}
            >
              {t('common.openClass')}
            </TextLink>
          </p>
        </>
      }
    >
      {!participants.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : (
        <AttendanceMarks
          sessionId={session.id}
          participants={participants.value}
          names={names}
          locale={locale}
          action={markAttendanceAction}
          markable={session.state !== 'cancelled'}
          t={t}
        />
      )}
    </TeacherFrame>
  );
}
