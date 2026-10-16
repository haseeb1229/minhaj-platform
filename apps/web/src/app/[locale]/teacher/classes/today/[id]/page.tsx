import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { MEETING_PROVIDERS, reminderLeadOf } from '@minhaj/contracts/learning';
import { supportedTimeZones } from '@minhaj/contracts/platform';

import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { ConfirmField } from '@/components/personal/parts';
import { AttendanceMarks } from '@/components/teacher/attendance-marks';
import { participantNames } from '@/components/teacher/names';
import {
  ClassTime,
  NotActivated,
  SessionStateBadge,
  TeacherFrame,
  teacherMessages,
} from '@/components/teacher/parts';
import { REMINDER_CHOICES } from '@/components/teacher/presentation';
import { ScheduleForm } from '@/components/teacher/schedule-form';
import {
  Alert,
  Field,
  Panel,
  SectionHeading,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import {
  cancelSessionAction,
  clearMeetingAction,
  completeSessionAction,
  markAttendanceAction,
  rescheduleAction,
  setMeetingAction,
} from '../../../actions';
import { requireTeacher } from '../../../guard';

/**
 * One class of the teacher's own (ROUTE_MAP.md §6): its Course and times,
 * its participants with their marks, its meeting link, and every change the
 * teacher may make to it while it is still scheduled.
 *
 * ONLY THE TEACHER'S OWN CLASS OPENS IT. The session is read under the live
 * assignments and the current scope, so another teacher's class is this
 * page's 404 exactly like one that does not exist.
 *
 * THE MEETING ADDRESS APPEARS EXACTLY ONCE, as the `href` of one described
 * external link, read by the one disclosure operation and only for a
 * scheduled class. It is never written as text, never echoed into a form
 * field, never part of any list (SECURITY_BASELINE.md §11).
 *
 * EVERY CHANGE NAMES THE VERSION IT SAW. A class moved, cancelled or
 * completed elsewhere since the page loaded is refused as a conflict, never
 * silently overwritten.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session and a private address. */
export const dynamic = 'force-dynamic';

export default async function ClassDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const path = `/${locale}/teacher/classes/today/${encodeURIComponent(id)}`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const { teaching } = learningRuntime();
  const read = await learningRead('teaching-session', () =>
    teaching.session(gate.actor, id),
  );
  if (!read.ok)
    return (
      <TeacherFrame title={t('session.fallbackTitle')}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );
  if (read.value === null) notFound();

  const { session, course } = read.value;
  const scheduled = session.state === 'scheduled';
  const accountZone = gate.session.account.timezone;
  const [participants, meeting] = await Promise.all([
    learningRead('teaching-participants', () =>
      teaching.participants(gate.actor, session.id),
    ),
    scheduled && session.hasMeetingUrl
      ? learningRead('teaching-meeting-url', () =>
          teaching.meetingUrl(gate.actor, session.id),
        )
      : Promise.resolve({ ok: true as const, value: null }),
  ]);
  const names = participants.ok
    ? await participantNames(participants.value.map((entry) => entry.accountId))
    : new Map<string, string>();
  const hidden = { locale, id: session.id, version: String(session.version) };
  const lead = reminderLeadOf(session.startsAt, session.reminderAt);
  const leadWords = (minutes: 60 | 180 | 1440) => t(`reschedule.lead${minutes}`);

  return (
    <TeacherFrame
      title={
        <LearningTitle
          labels={course.labels}
          primaryLocale={course.primaryLocale}
          locale={locale}
        />
      }
      description={
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span>{t(`kind.${session.kind}`)}</span>
            <SessionStateBadge state={session.state} t={t} />
          </p>
          <ClassTime session={session} locale={locale} accountZone={accountZone} t={t} />
          <p>
            <TextLink
              href={`/${locale}/teacher/courses/${encodeURIComponent(course.id)}`}
            >
              {t('common.course')}
            </TextLink>
          </p>
        </>
      }
    >
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}

      {/* ---- Meeting link ------------------------------------------------ */}

      <section className="flex flex-col gap-3" aria-labelledby="class-meeting">
        <span id="class-meeting">
          <SectionHeading>{t('meeting.heading')}</SectionHeading>
        </span>
        {!scheduled ? (
          <p className="text-sm">{t('meeting.notScheduled')}</p>
        ) : (
          <>
            {!session.hasMeetingUrl ? (
              <Alert tone="warning">{t('meeting.none')}</Alert>
            ) : !meeting.ok || meeting.value === null ? (
              <Alert tone="error">{t('meeting.unreadable')}</Alert>
            ) : (
              <p className="flex flex-wrap items-center gap-3">
                <span className="text-sm">{t('meeting.held')}</span>
                <a
                  href={meeting.value}
                  rel="noreferrer noopener"
                  target="_blank"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[color:var(--color-action)] px-4 py-2 text-sm font-medium text-[color:var(--color-action-foreground)] hover:bg-[color:var(--color-action-hover)]"
                >
                  {t('meeting.join')}
                </a>
              </p>
            )}
            <Panel>
              <ActionForm
                action={setMeetingAction}
                submitLabel={
                  session.hasMeetingUrl ? t('meeting.replace') : t('meeting.set')
                }
                pendingLabel={t('common.working')}
                messages={teacherMessages(t, { success: t('meeting.saved') })}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="id" value={session.id} />
                <input type="hidden" name="version" value={String(session.version)} />
                <Field id="meeting-provider" label={t('meeting.provider')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="provider"
                      defaultValue={MEETING_PROVIDERS[0]}
                    >
                      <option value={MEETING_PROVIDERS[0]}>
                        {t('meeting.providerName')}
                      </option>
                    </Select>
                  )}
                </Field>
                <Field
                  id="meeting-url"
                  label={t('meeting.url')}
                  help={t('meeting.urlHelp')}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      type="url"
                      name="url"
                      inputMode="url"
                      autoComplete="off"
                      required
                      maxLength={200}
                      placeholder="https://meet.google.com/"
                    />
                  )}
                </Field>
              </ActionForm>
            </Panel>
            {session.hasMeetingUrl ? (
              <div className="self-start">
                <ActionForm
                  action={clearMeetingAction}
                  submitLabel={t('meeting.clear')}
                  pendingLabel={t('common.working')}
                  tone="secondary"
                  messages={teacherMessages(t, { success: t('meeting.cleared') })}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="id" value={session.id} />
                  <input type="hidden" name="version" value={String(session.version)} />
                </ActionForm>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* ---- Participants and attendance -------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="class-participants">
        <span id="class-participants">
          <SectionHeading>{t('session.participants')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('session.markHelp')}
        </p>
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
      </section>

      {/* ---- Changes ----------------------------------------------------- */}

      <section className="flex flex-col gap-4" aria-labelledby="class-changes">
        <span id="class-changes">
          <SectionHeading>{t('session.changes')}</SectionHeading>
        </span>
        {!scheduled ? (
          <p className="text-sm">
            {t('session.closed', { state: t(`state.${session.state}`) })}
          </p>
        ) : (
          <>
            <Panel>
              <div className="flex flex-col gap-3">
                <h3 className="font-semibold">{t('reschedule.heading')}</h3>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t('reschedule.help')}
                </p>
                <p className="text-sm">
                  {lead === null
                    ? t('reschedule.currentReminderNone')
                    : t('reschedule.currentReminder', { lead: leadWords(lead) })}
                </p>
                <ScheduleForm
                  action={rescheduleAction}
                  hidden={hidden}
                  zones={supportedTimeZones()}
                  defaults={{
                    timeZone: session.timeZone,
                    startsLocal: session.startsLocal,
                    endsLocal: session.endsLocal,
                  }}
                  reminder={{
                    label: t('reschedule.reminder'),
                    help: t('reschedule.reminderHelp'),
                    keep: t('reschedule.reminderKeep'),
                    none: t('reschedule.reminderNone'),
                    leads: REMINDER_CHOICES.map((minutes) => ({
                      value: String(minutes),
                      text: leadWords(minutes),
                    })),
                  }}
                  words={{
                    timeZone: t('reschedule.timeZone'),
                    timeZoneHelp: t('reschedule.timeZoneHelp'),
                    starts: t('reschedule.starts'),
                    ends: t('reschedule.ends'),
                    startFold: t('reschedule.startFold'),
                    endFold: t('reschedule.endFold'),
                    foldHelp: t('reschedule.foldHelp'),
                    foldEarlier: t('reschedule.foldEarlier'),
                    foldLater: t('reschedule.foldLater'),
                  }}
                  submitLabel={t('reschedule.submit')}
                  pendingLabel={t('common.working')}
                  messages={teacherMessages(t, { success: t('reschedule.moved') })}
                />
              </div>
            </Panel>

            <Panel>
              <div className="flex flex-col gap-3">
                <h3 className="font-semibold">{t('complete.heading')}</h3>
                <p className="text-sm">{t('complete.body')}</p>
                <div className="self-start">
                  <ActionForm
                    action={completeSessionAction}
                    submitLabel={t('complete.submit')}
                    pendingLabel={t('common.working')}
                    tone="secondary"
                    messages={teacherMessages(t, { success: t('complete.completed') })}
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={session.id} />
                    <input type="hidden" name="version" value={String(session.version)} />
                  </ActionForm>
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="flex flex-col gap-3">
                <h3 className="font-semibold">{t('cancel.heading')}</h3>
                <p className="text-sm">{t('cancel.body')}</p>
                <div className="self-start">
                  <ActionForm
                    action={cancelSessionAction}
                    submitLabel={t('cancel.submit')}
                    pendingLabel={t('common.working')}
                    tone="destructive"
                    messages={teacherMessages(t, { success: t('cancel.cancelled') })}
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={session.id} />
                    <input type="hidden" name="version" value={String(session.version)} />
                    <ConfirmField id="cancel-confirm" label={t('cancel.confirm')} />
                  </ActionForm>
                </div>
              </div>
            </Panel>
          </>
        )}
      </section>
    </TeacherFrame>
  );
}
