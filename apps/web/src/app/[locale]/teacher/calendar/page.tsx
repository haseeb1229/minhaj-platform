import { getTranslations } from 'next-intl/server';

import { Pagination } from '@/components/media/parts';
import { learningRead } from '@/components/my-learning/read';
import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import {
  dayHeading,
  groupByDay,
  ownZone,
  pager,
  readOffset,
} from '@/components/teacher/presentation';
import { SessionCard } from '@/components/teacher/session-card';
import { Alert, EmptyState, SectionHeading } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * The calendar (ROUTE_MAP.md §6): the teacher's classes over the next 62
 * days, a bounded page at a time, grouped by the calendar day each starts on
 * in the teacher's own zone. A group's heading is that day; each card carries
 * both of the class's times.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/teacher/calendar`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const offset = readOffset(await searchParams);
  const accountZone = gate.session.account.timezone;
  const zone = ownZone(accountZone);
  const read = await learningRead('teaching-calendar', () =>
    learningRuntime().teaching.calendar(gate.actor, null, offset),
  );

  if (!read.ok)
    return (
      <TeacherFrame title={t('calendar.title')}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );

  const page = pager(path, offset, read.value.hasMore);
  return (
    <TeacherFrame
      title={t('calendar.title')}
      description={<p>{t('calendar.description')}</p>}
    >
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}
      {read.value.items.length === 0 ? (
        <EmptyState>{offset === 0 ? t('calendar.empty') : t('common.beyond')}</EmptyState>
      ) : (
        groupByDay(read.value.items, zone).map((group) => {
          const heading = dayHeading(group.day, zone, locale);
          return (
            <section
              key={group.day}
              className="flex flex-col gap-3"
              aria-labelledby={`day-${group.day}`}
            >
              <span id={`day-${group.day}`}>
                <SectionHeading>{heading}</SectionHeading>
              </span>
              <ol
                className="flex flex-col gap-3"
                aria-label={t('calendar.day', { day: heading })}
              >
                {group.items.map((view) => (
                  <SessionCard
                    key={view.session.id}
                    view={view}
                    locale={locale}
                    accountZone={accountZone}
                    t={t}
                  />
                ))}
              </ol>
            </section>
          );
        })
      )}
      <Pagination
        label={t('calendar.title')}
        previous={page.previous}
        next={page.next}
        previousLabel={t('common.previous')}
        nextLabel={t('common.next')}
      />
    </TeacherFrame>
  );
}
