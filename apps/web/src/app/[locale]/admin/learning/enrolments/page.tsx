import { LEARNING_PAGE } from '@minhaj/contracts/learning';

import {
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  PageHeading,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { pageOffset } from '../../shared';
import {
  Pager,
  StateBadge,
  Title,
  learningCopy,
  pageHref,
  type ListParams,
} from '../shared';

/**
 * `/{locale}/admin/learning/enrolments` — how many people are enrolled on each
 * Course and how many have completed it (ROUTE_MAP.md §7; Phase 22).
 *
 * COUNTS, NEVER PEOPLE. `learning.read` reveals how a Course is used, not who
 * uses it: there is no name, address, account or per-person progress here, and
 * no Learning permission reaches one. Nothing here changes anybody's
 * Enrolment or Progress.
 */
export const dynamic = 'force-dynamic';

export default async function EnrolmentSummaryPage({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/learning/enrolments`;
  const context = await requireAdminPage(locale, 'learning.read', base);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const offset = pageOffset(await searchParams, LEARNING_PAGE);
  const page = await learningRuntime().learning.enrolmentSummary(
    { accountId: context.session.account.id },
    offset,
  );

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <PageHeading>{t('surface.enrolments')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('enrolments.description')}
        </p>
      </div>
      {page.items.length === 0 ? (
        <EmptyState>{t('enrolments.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.enrolments')}
          columns={[
            t('labelTitle'),
            t('state'),
            t('enrolments.learners'),
            t('enrolments.completed'),
          ]}
        >
          {page.items.map((row) => (
            <DataRow key={row.course.id}>
              <DataCell wrap>
                <TextLink href={`/${locale}/admin/learning/courses/${row.course.id}`}>
                  <Title record={row.course} locale={locale} />
                </TextLink>
              </DataCell>
              <DataCell>
                <StateBadge state={row.course.state} copy={copy} />
              </DataCell>
              <DataCell>{row.learners}</DataCell>
              <DataCell>{row.completed}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        hasMore={page.hasMore}
        hrefFor={pageHref(base)}
        label={t('surface.enrolments')}
        copy={copy}
      />
    </main>
  );
}
