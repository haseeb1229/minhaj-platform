import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { SessionParticipant } from '@minhaj/contracts/learning';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import { ActionForm } from '@/app/[locale]/(identity)/form-state';
import { DataCell, DataRow, DataTable, EmptyState } from '@/components/ui';
import { AttendanceWord, teacherMessages, type TeacherTranslator } from './parts';

/**
 * A class's participants with their marks, and one form per mark.
 *
 * EACH MARK IS ITS OWN POST. "Mark present" and "Mark absent" are two
 * buttons per row, each a form naming the class, the learner and one status;
 * the service re-checks that the learner is a participant of the teacher's
 * own class before it writes. Saving the mark a row already holds changes
 * nothing, so a double press is harmless. The mark the row holds now is
 * written in words beside the buttons, never by colour alone.
 *
 * ONLY NAMES AND MARKS. Identity answers a display name for an active account
 * and nothing else; a learner it does not name is written as "Learner".
 */
export function AttendanceMarks({
  sessionId,
  participants,
  names,
  locale,
  action,
  markable,
  t,
}: {
  readonly sessionId: string;
  readonly participants: readonly SessionParticipant[];
  readonly names: ReadonlyMap<string, string>;
  readonly locale: Locale;
  readonly action: (state: FormActionState, form: FormData) => Promise<FormActionState>;
  /** False for a cancelled class: marks are shown, and no control the service would refuse. */
  readonly markable: boolean;
  readonly t: TeacherTranslator;
}) {
  if (participants.length === 0)
    return <EmptyState>{t('session.participantsEmpty')}</EmptyState>;
  const messages = teacherMessages(t, { success: t('session.marked') });
  return (
    <DataTable
      caption={t('session.participantsHelp')}
      columns={[t('session.participant'), t('session.participation'), t('session.mark')]}
    >
      {participants.map((participant) => {
        const name = names.get(participant.accountId) ?? t('common.learner');
        const mark = (status: 'present' | 'absent', label: string) => (
          <ActionForm
            action={action}
            submitLabel={label}
            pendingLabel={t('common.working')}
            tone={participant.attendance === status ? 'secondary' : 'primary'}
            messages={messages}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={sessionId} />
            <input type="hidden" name="accountId" value={participant.accountId} />
            <input type="hidden" name="status" value={status} />
          </ActionForm>
        );
        return (
          <DataRow key={participant.accountId}>
            <DataCell wrap>
              <span dir="auto" className="wrap-anywhere">
                {name}
              </span>
            </DataCell>
            <DataCell wrap>{t(`participation.${participant.participation}`)}</DataCell>
            <DataCell wrap>
              <div className="flex flex-col gap-2">
                <AttendanceWord status={participant.attendance} t={t} />
                {markable ? (
                  <div className="flex flex-wrap gap-2">
                    {mark('present', t('session.markPresent', { name }))}
                    {mark('absent', t('session.markAbsent', { name }))}
                  </div>
                ) : null}
              </div>
            </DataCell>
          </DataRow>
        );
      })}
    </DataTable>
  );
}
