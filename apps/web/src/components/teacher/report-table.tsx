import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { AttendanceReportRow } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { DataCell, DataRow, DataTable, LinkTabs, TextLink } from '@/components/ui';
import { OwnTime, SessionStateBadge, type TeacherTranslator } from './parts';

/** The two views of attendance — what is still to mark, and every past class. */
export function AttendanceTabs({
  current,
  locale,
  t,
}: {
  readonly current: 'pending' | 'reports';
  readonly locale: Locale;
  readonly t: TeacherTranslator;
}) {
  return (
    <LinkTabs
      label={t('attendancePage.views')}
      tabs={[
        {
          href: localizedPath(locale, '/teacher/attendance'),
          text: t('attendancePage.pendingTab'),
          current: current === 'pending',
        },
        {
          href: localizedPath(locale, '/teacher/attendance/reports'),
          text: t('attendancePage.reports'),
          current: current === 'reports',
        },
      ]}
    />
  );
}

/**
 * Past classes with their attendance counts — present, absent, not marked —
 * as NUMBERS UNDER WORDED HEADINGS, never as coloured cells. Each class opens
 * its marking page.
 */
export function ReportTable({
  rows,
  locale,
  accountZone,
  t,
}: {
  readonly rows: readonly AttendanceReportRow[];
  readonly locale: Locale;
  readonly accountZone: string | null;
  readonly t: TeacherTranslator;
}) {
  return (
    <DataTable
      caption={t('reports.caption')}
      columns={[
        t('common.class'),
        t('common.when'),
        t('common.state'),
        t('reports.present'),
        t('reports.absent'),
        t('reports.unmarked'),
      ]}
    >
      {rows.map((row) => (
        <DataRow key={row.session.id}>
          <DataCell wrap>
            <TextLink
              href={localizedPath(
                locale,
                `/teacher/attendance/${encodeURIComponent(row.session.id)}`,
              )}
            >
              <LearningTitle
                labels={row.course.labels}
                primaryLocale={row.course.primaryLocale}
                locale={locale}
              />
            </TextLink>{' '}
            <span className="text-foreground-muted">{t(`kind.${row.session.kind}`)}</span>
          </DataCell>
          <DataCell>
            <OwnTime
              value={row.session.startsAt}
              locale={locale}
              accountZone={accountZone}
            />
          </DataCell>
          <DataCell>
            <SessionStateBadge state={row.session.state} t={t} />
          </DataCell>
          <DataCell>{String(row.present)}</DataCell>
          <DataCell>{String(row.absent)}</DataCell>
          <DataCell>{String(row.unmarked)}</DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}
