import { getTranslations } from 'next-intl/server';

import { supportedTimeZones } from '@minhaj/contracts/platform';

import { Pagination } from '@/components/media/parts';
import { learningRead } from '@/components/my-learning/read';
import {
  ClassTime,
  NotActivated,
  TeacherFrame,
  teacherMessages,
} from '@/components/teacher/parts';
import { dateIn, ownZone, pager, readOffset } from '@/components/teacher/presentation';
import { ScheduleForm } from '@/components/teacher/schedule-form';
import { Alert, EmptyState, Panel, SectionHeading, StatusBadge } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { openAvailabilityAction, withdrawAvailabilityAction } from '../actions';
import { requireTeacher } from '../guard';

/**
 * Availability (ROUTE_MAP.md §6): the windows the teacher offers for trial
 * classes — open ones first, soonest first, then withdrawn ones — and a form
 * to offer another.
 *
 * A BOOKED WINDOW IS A CLASS NOW. It says "Booked" in words and offers no
 * withdraw control, because withdrawing it would strand a confirmed learner;
 * its class is cancelled from the class page instead. Only an open, unbooked
 * window carries a withdraw button — there is no control here that the
 * service would refuse by construction.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

export default async function AvailabilityPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/teacher/availability`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const offset = readOffset(await searchParams);
  const read = await learningRead('teaching-availability', () =>
    learningRuntime().teaching.availability(gate.actor, offset),
  );
  const accountZone = gate.session.account.timezone;
  const zone = ownZone(accountZone);
  const tomorrow = dateIn(new Date(Date.now() + DAY), zone);
  const page = read.ok ? pager(path, offset, read.value.hasMore) : null;

  return (
    <TeacherFrame
      title={t('availability.title')}
      description={<p>{t('availability.description')}</p>}
    >
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}

      <section className="flex flex-col gap-3" aria-labelledby="availability-list">
        <span id="availability-list">
          <SectionHeading>{t('availability.list')}</SectionHeading>
        </span>
        {!read.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : read.value.items.length === 0 ? (
          <EmptyState>
            {offset === 0 ? t('availability.empty') : t('common.beyond')}
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-3" aria-label={t('availability.list')}>
            {read.value.items.map((window) => (
              <Panel key={window.id} as="li">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <p>
                      {window.state === 'withdrawn' ? (
                        <StatusBadge tone="neutral">
                          {t('availability.withdrawn')}
                        </StatusBadge>
                      ) : window.booked ? (
                        <StatusBadge tone="caution">
                          {t('availability.booked')}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="positive">
                          {t('availability.open')}
                        </StatusBadge>
                      )}
                    </p>
                    <ClassTime
                      session={window}
                      locale={locale}
                      accountZone={accountZone}
                      t={t}
                    />
                    {window.state === 'open' && window.booked ? (
                      <p className="text-sm">{t('availability.cannotWithdraw')}</p>
                    ) : null}
                  </div>
                  {window.state === 'open' && !window.booked ? (
                    <ActionForm
                      action={withdrawAvailabilityAction}
                      submitLabel={t('availability.withdraw')}
                      pendingLabel={t('common.working')}
                      tone="secondary"
                      messages={teacherMessages(t, {
                        success: t('availability.withdrew'),
                      })}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={window.id} />
                      <input
                        type="hidden"
                        name="version"
                        value={String(window.version)}
                      />
                    </ActionForm>
                  ) : null}
                </div>
              </Panel>
            ))}
          </ol>
        )}
        {page === null ? null : (
          <Pagination
            label={t('availability.list')}
            previous={page.previous}
            next={page.next}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="availability-open">
        <span id="availability-open">
          <SectionHeading>{t('availability.openHeading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('availability.openHelp')}
        </p>
        <Panel>
          <ScheduleForm
            action={openAvailabilityAction}
            hidden={{ locale }}
            zones={supportedTimeZones()}
            defaults={{
              timeZone: zone,
              startsLocal: `${tomorrow}T18:00`,
              endsLocal: `${tomorrow}T19:00`,
            }}
            words={{
              timeZone: t('availability.timeZone'),
              timeZoneHelp: t('availability.timeZoneHelp'),
              starts: t('availability.starts'),
              ends: t('availability.ends'),
              startFold: t('availability.startFold'),
              endFold: t('availability.endFold'),
              foldHelp: t('reschedule.foldHelp'),
              foldEarlier: t('reschedule.foldEarlier'),
              foldLater: t('reschedule.foldLater'),
            }}
            submitLabel={t('availability.submit')}
            pendingLabel={t('common.working')}
            messages={teacherMessages(t, { success: t('availability.opened') })}
          />
        </Panel>
      </section>
    </TeacherFrame>
  );
}
