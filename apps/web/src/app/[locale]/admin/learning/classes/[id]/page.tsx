import { notFound } from 'next/navigation';

import { ATTENDANCE_STATUSES, sessionIsFuture } from '@minhaj/contracts/learning';

import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import {
  cancelSessionAction,
  completeSessionAction,
  correctAttendanceAction,
  replaceTeacherAction,
  rescheduleSessionAction,
} from '../../actions';
import {
  EditIdentity,
  Title,
  learningCopy,
  titleText,
  type EditorParams,
} from '../../shared';
import {
  ActivationNotice,
  PersonName,
  ScheduleFields,
  SessionKindBadge,
  SessionStateBadge,
  SessionTimes,
  classesBase,
  participantNameMap,
  scopeOptionText,
} from '../parts';

/**
 * `/{locale}/admin/learning/classes/{id}` — one class: its facts, its
 * participants with their attendance, and the operator's acts on it
 * (ROUTE_MAP.md §7; DELIVERY_PLAN.md Phase 23).
 *
 * READING PARTICIPANTS IS AUDITED by the service — it is an identity read —
 * and shown under `learning.classes.read`. Every act is under
 * `learning.classes.administer`, re-checked live by its action, and every
 * form carries the version the operator is looking at, so a stale page is a
 * visible conflict.
 *
 * THE MEETING LINK IS THE DISCLOSURE READ'S ANSWER: asked once, for a
 * scheduled class that holds one, rendered as a described external link and
 * never otherwise printed, listed or logged (SECURITY_BASELINE.md §11).
 *
 * A REPLACEMENT TEACHER IS CHOSEN AMONG CURRENT SCOPES OF THE SAME COURSE,
 * and only for a class that has not started; a finished or cancelled class
 * offers no act but the attendance correction.
 */
export const dynamic = 'force-dynamic';

export default async function ClassDetailPage({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const base = classesBase(locale);
  const context = await requireAdminPage(
    locale,
    'learning.classes.read',
    `${base}/${id}`,
  );
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const { classes } = learningRuntime();

  const view = await classes.session(actor, id);
  if (view === null) notFound();
  const { session, course } = view;
  const administer = context.authorization.can('learning.classes.administer');
  const future = sessionIsFuture(session, new Date());

  const [mode, participants, meeting, alternatives] = await Promise.all([
    classes.activation(actor),
    classes.participants(actor, session.id),
    session.state === 'scheduled' && session.hasMeetingUrl
      ? classes.meetingUrl(actor, session.id)
      : Promise.resolve(null),
    administer && future
      ? classes.scopes(actor, { courseId: session.courseId, current: true }, 0)
      : Promise.resolve({ items: [], hasMore: false }),
  ]);
  const replacements = alternatives.items.filter(
    (scope) => scope.scope.id !== session.teachingScopeId,
  );
  const names = await participantNameMap([
    session.teacherAccountId,
    ...participants.map((participant) => participant.accountId),
    ...replacements.map((scope) => scope.scope.accountId),
  ]);
  const record = { id: session.id, version: session.version };

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <PageHeading>
          <Title record={course} locale={locale} />
        </PageHeading>
        <div className="flex flex-wrap items-center gap-2">
          <SessionKindBadge kind={session.kind} copy={copy} />
          <SessionStateBadge state={session.state} copy={copy} />
        </div>
        <p>
          <TextLink href={base}>{t('backToList')}</TextLink>
        </p>
      </div>
      <ActivationNotice mode={mode} copy={copy} />

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('classes.when')}>
            <SessionTimes session={session} locale={locale} copy={copy} />
          </DetailRow>
          <DetailRow term={t('classes.teacher')}>
            <PersonName
              accountId={session.teacherAccountId}
              names={names}
              fallback={t('classes.teacherUnnamed')}
            />
          </DetailRow>
          <DetailRow term={t('classes.course')}>
            <TextLink href={`/${locale}/admin/learning/courses/${course.id}`}>
              <Title record={course} locale={locale} />
            </TextLink>
          </DetailRow>
          <DetailRow term={t('classes.reminder')}>
            {session.reminderAt === null ? (
              t('classes.reminderNone')
            ) : (
              <time dateTime={session.reminderAt.toISOString()}>
                {new Intl.DateTimeFormat(locale, {
                  timeZone: session.timeZone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(session.reminderAt)}
              </time>
            )}
          </DetailRow>
          <DetailRow term={t('classes.meeting')}>
            {meeting === null ? (
              session.hasMeetingUrl ? (
                t('classes.meetingWithheld')
              ) : (
                t('classes.meetingNone')
              )
            ) : (
              <a href={meeting} target="_blank" rel="noreferrer noopener">
                {t('classes.meetingOpen')}
              </a>
            )}
          </DetailRow>
          <DetailRow term={t('version')}>{session.version}</DetailRow>
        </dl>
      </Panel>

      {/* ---- Participants ------------------------------------------------ */}

      <section className="flex flex-col gap-3" aria-labelledby="class-participants">
        <SectionHeading>
          <span id="class-participants">{t('classes.participants')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('classes.participantsHelp')}
        </p>
        {participants.length === 0 ? (
          <EmptyState>{t('classes.noParticipants')}</EmptyState>
        ) : (
          <DataTable
            caption={t('classes.participants')}
            columns={[
              t('classes.participant'),
              t('classes.participation'),
              t('classes.attendance'),
              ...(administer ? [t('classes.correct')] : []),
            ]}
          >
            {participants.map((participant) => (
              <DataRow key={participant.accountId}>
                <DataCell wrap>
                  <PersonName
                    accountId={participant.accountId}
                    names={names}
                    fallback={t('classes.learnerUnnamed')}
                  />
                </DataCell>
                <DataCell>
                  {t(`classes.participationName.${participant.participation}`)}
                </DataCell>
                <DataCell>
                  {participant.attendance === null
                    ? t('classes.unmarked')
                    : t(`classes.attendanceName.${participant.attendance}`)}
                </DataCell>
                {administer ? (
                  <DataCell>
                    <ActionForm
                      action={correctAttendanceAction}
                      submitLabel={t('classes.correct')}
                      pendingLabel={t('pending')}
                      tone="secondary"
                      messages={copy.messages}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input
                        type="hidden"
                        name="accountId"
                        value={participant.accountId}
                      />
                      <Field
                        id={`attendance-${participant.accountId}`}
                        label={t('classes.attendance')}
                      >
                        {(props) => (
                          <Select
                            {...props}
                            name="status"
                            defaultValue={participant.attendance ?? 'present'}
                          >
                            {ATTENDANCE_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {t(`classes.attendanceName.${status}`)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </ActionForm>
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {/* ---- Acts ------------------------------------------------------- */}

      {!administer ? null : session.state !== 'scheduled' ? (
        <Alert tone="info">{t('classes.closed')}</Alert>
      ) : (
        <>
          {future ? (
            <section className="flex flex-col gap-3" aria-labelledby="class-reschedule">
              <SectionHeading>
                <span id="class-reschedule">{t('classes.reschedule')}</span>
              </SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('classes.rescheduleHelp')}
              </p>
              <Panel>
                <ActionForm
                  action={rescheduleSessionAction}
                  submitLabel={t('classes.rescheduleSubmit')}
                  pendingLabel={t('pending')}
                  messages={copy.messages}
                  preserveInput
                >
                  <EditIdentity locale={locale} record={record} />
                  <ScheduleFields
                    prefix="reschedule"
                    copy={copy}
                    session={session}
                    timeZone={session.timeZone}
                  />
                </ActionForm>
              </Panel>
            </section>
          ) : null}

          {future ? (
            <section className="flex flex-col gap-3" aria-labelledby="class-teacher">
              <SectionHeading>
                <span id="class-teacher">{t('classes.replaceTeacher')}</span>
              </SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('classes.replaceTeacherHelp')}
              </p>
              {replacements.length === 0 ? (
                <EmptyState>{t('classes.noReplacement')}</EmptyState>
              ) : (
                <Panel>
                  <ActionForm
                    action={replaceTeacherAction}
                    submitLabel={t('classes.replaceTeacherSubmit')}
                    pendingLabel={t('pending')}
                    tone="secondary"
                    messages={copy.messages}
                  >
                    <EditIdentity locale={locale} record={record} />
                    <Field id="replacement-scope" label={t('classes.teacher')}>
                      {(props) => (
                        <Select {...props} name="scopeId" required defaultValue="">
                          <option value="" disabled>
                            {t('classes.chooseTeacher')}
                          </option>
                          {replacements.map((scope) => (
                            <option key={scope.scope.id} value={scope.scope.id}>
                              {scopeOptionText(
                                scope,
                                names,
                                titleText(
                                  scope.course.labels,
                                  locale,
                                  scope.course.primaryLocale,
                                ),
                                copy,
                              )}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </ActionForm>
                </Panel>
              )}
            </section>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Panel as="div">
              <div className="flex flex-col gap-3">
                <SectionHeading>{t('classes.complete')}</SectionHeading>
                <p className="text-sm">{t('classes.completeHelp')}</p>
                <ActionForm
                  action={completeSessionAction}
                  submitLabel={t('classes.completeSubmit')}
                  pendingLabel={t('pending')}
                  tone="secondary"
                  messages={copy.messages}
                >
                  <EditIdentity locale={locale} record={record} />
                </ActionForm>
              </div>
            </Panel>
            <Panel as="div">
              <div className="flex flex-col gap-3">
                <SectionHeading>{t('classes.cancel')}</SectionHeading>
                <p className="text-sm">{t('classes.cancelHelp')}</p>
                <ActionForm
                  action={cancelSessionAction}
                  submitLabel={t('classes.cancelSubmit')}
                  pendingLabel={t('pending')}
                  tone="destructive"
                  messages={copy.messages}
                >
                  <EditIdentity locale={locale} record={record} />
                  <ConfirmField id="cancel-session" label={t('classes.cancelConfirm')} />
                </ActionForm>
              </div>
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
