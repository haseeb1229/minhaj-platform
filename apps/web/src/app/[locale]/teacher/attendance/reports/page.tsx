import { getTranslations } from 'next-intl/server';

import { Pagination } from '@/components/media/parts';
import { learningRead } from '@/components/my-learning/read';
import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { pager, readOffset } from '@/components/teacher/presentation';
import { ReportTable } from '@/components/teacher/report-table';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../guard';

/**
 * Attendance reports (ROUTE_MAP.md §6): every past class of the teacher's
 * current scopes, a bounded page at a time, with how many participants were
 * marked present, absent, or not yet — counted by the database, shown as
 * numbers under worded headings, never as colours.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function AttendanceReportsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/teacher/attendance/reports`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const offset = readOffset(await searchParams);
  const read = await learningRead('teaching-attendance-report', () =>
    learningRuntime().teaching.attendanceReport(gate.actor, offset),
  );
  const page = read.ok ? pager(path, offset, read.value.hasMore) : null;

  return (
    <TeacherFrame
      title={t('reports.title')}
      description={<p>{t('reports.description')}</p>}
    >
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.items.length === 0 ? (
        <EmptyState>{offset === 0 ? t('reports.empty') : t('common.beyond')}</EmptyState>
      ) : (
        <ReportTable
          rows={read.value.items}
          locale={locale}
          accountZone={gate.session.account.timezone}
          t={t}
        />
      )}
      {page === null ? null : (
        <Pagination
          label={t('reports.title')}
          previous={page.previous}
          next={page.next}
          previousLabel={t('common.previous')}
          nextLabel={t('common.next')}
        />
      )}
    </TeacherFrame>
  );
}
