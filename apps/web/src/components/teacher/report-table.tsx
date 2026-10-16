import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { AttendanceReportRow } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { DataCell, DataRow, DataTable, TextLink } from '@/components/ui';
import { OwnTime, SessionStateBadge, type TeacherTranslator } from './parts';

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
              href={`/${locale}/teacher/attendance/${encodeURIComponent(row.session.id)}`}
            >
              <LearningTitle
                labels={row.course.labels}
                primaryLocale={row.course.primaryLocale}
                locale={locale}
              />
            </TextLink>{' '}
            <span className="text-[color:var(--color-foreground-muted)]">
              {t(`kind.${row.session.kind}`)}
            </span>
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
