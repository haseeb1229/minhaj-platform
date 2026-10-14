import { LEARNING_PAGE } from '@minhaj/contracts/learning';

import {
  Alert,
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
 * `/{locale}/admin/learning/trials` — how many trial-class requests each live
 * Course holds, and since when (ROUTE_MAP.md §7; Phase 22).
 *
 * READ-ONLY, AND COUNTS ONLY. A trial request is a request: nothing on this
 * page confirms one, schedules a class, assigns a teacher or names who asked.
 * Confirmation is its own act and its own record, and it is not offered yet —
 * the page says so rather than leaving an operator to look for the button.
 */
export const dynamic = 'force-dynamic';

export default async function TrialSummaryPage({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/learning/trials`;
  const context = await requireAdminPage(locale, 'learning.read', base);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const offset = pageOffset(await searchParams, LEARNING_PAGE);
  const page = await learningRuntime().learning.trialSummary(
    { accountId: context.session.account.id },
    offset,
  );
  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <PageHeading>{t('surface.trials')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('trials.description')}
        </p>
      </div>
      <Alert tone="info">{t('trials.notScheduled')}</Alert>
      {page.items.length === 0 ? (
        <EmptyState>{t('trials.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.trials')}
          columns={[
            t('labelTitle'),
            t('state'),
            t('trials.requests'),
            t('trials.oldest'),
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
              <DataCell>{row.requests}</DataCell>
              <DataCell>
                {row.oldest === null ? (
                  '—'
                ) : (
                  <time dateTime={row.oldest.toISOString()}>
                    {date.format(row.oldest)}
                  </time>
                )}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        hasMore={page.hasMore}
        hrefFor={pageHref(base)}
        label={t('surface.trials')}
        copy={copy}
      />
    </main>
  );
}
