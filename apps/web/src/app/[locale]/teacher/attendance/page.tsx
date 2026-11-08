import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { collectPages } from '@/components/teacher/read';
import { AttendanceTabs, ReportTable } from '@/components/teacher/report-table';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Attendance still to mark (ROUTE_MAP.md §6): the teacher's recent past
 * classes with at least one participant not yet marked, most recent first,
 * each opening its marking page. Only classes that have STARTED are listed —
 * the report reads nothing later — so there is never a future class to mark.
 *
 * BOUNDED, AND SAYS SO. The report is read a bounded number of pages deep;
 * older classes are on the reports page, which this one links to rather
 * than implying the list is everything.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'attendance');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const REPORT_PAGES = 4;

export default async function AttendancePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, localizedPath(locale, '/teacher/attendance'));
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await learningRead('teaching-attendance-pending', () =>
    collectPages(
      (offset) => learningRuntime().teaching.attendanceReport(gate.actor, offset),
      REPORT_PAGES,
    ),
  );
  const pending = read.ok ? read.value.items.filter((row) => row.unmarked > 0) : [];

  return (
    <TeacherFrame
      title={t('attendancePage.title')}
      description={<p>{t('attendancePage.description')}</p>}
    >
      <AttendanceTabs current="pending" locale={locale} t={t} />
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : pending.length === 0 ? (
        <EmptyState icon="check" title={t('attendancePage.empty')}>
          {t('attendancePage.emptyBody')}
        </EmptyState>
      ) : (
        <ReportTable
          rows={pending}
          locale={locale}
          accountZone={gate.session.account.timezone}
          t={t}
        />
      )}
      {read.ok && read.value.truncated ? (
        <p className="text-sm">{t('attendancePage.bounded')}</p>
      ) : null}
    </TeacherFrame>
  );
}
