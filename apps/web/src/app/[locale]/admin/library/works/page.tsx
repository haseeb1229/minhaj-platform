import { requireAdminPage } from '@/composition/authorization';
import { libraryReferenceChoices, libraryRuntime } from '@/composition/library';
import { requireLocale } from '@/config/route-locale';
import {
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  PageHeading,
  Panel,
  SectionHeading,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import { pageOffset, queryValue, PAGE_SIZE } from '../../shared';
import { libraryCopy, WorkForm } from '../forms';

/**
 * `/{locale}/admin/library/works` — the Works directory and the create form
 * (ROUTE_MAP.md §7).
 *
 * `library.read` OPENS THE SCREEN; `library.administer` is what the form's action
 * requires. Rendering a create form to a reader is deliberate rather than sloppy:
 * the action re-checks independently and refuses, and hiding the form would make the
 * refusal a surprise rather than an answer. Route protection is navigational; the
 * action is the boundary (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * BOUNDED AND DETERMINISTIC. One page of 25 rows in a stable order, from the
 * persistence layer's own cap — never a full-table load filtered in the process
 * (§49).
 *
 * `noindex` AND `no-store`, inherited from the administrative layout above. Every
 * value on this screen is private operator state.
 */
export const dynamic = 'force-dynamic';

export default async function WorksDirectory({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;

  const context = await requireAdminPage(
    locale,
    'library.read',
    `/${locale}/admin/library/works`,
  );

  const copy = await libraryCopy(locale);
  const { t } = copy;

  const actor = { accountId: context.session.account.id };
  const offset = pageOffset(query, PAGE_SIZE);

  const [page, choices] = await Promise.all([
    libraryRuntime().library.works(actor, offset),
    libraryReferenceChoices(locale, queryValue(query, 'q') ?? ''),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('admin.works')}</PageHeading>

      {page.items.length === 0 ? (
        <EmptyState>{t('adminEmpty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('admin.works')}
          columns={[t('slug'), t('state'), t('primaryLocale'), t('version')]}
        >
          {page.items.map((record) => (
            <DataRow key={record.id}>
              <DataCell wrap>
                <TextLink href={`/${locale}/admin/library/works/${record.id}`}>
                  {record.slug}
                </TextLink>
              </DataCell>
              <DataCell>
                <StatusBadge tone={record.state === 'published' ? 'positive' : 'neutral'}>
                  {t(`stateName.${record.state}` as 'stateName.draft')}
                </StatusBadge>
              </DataCell>
              <DataCell>{record.primaryLocale}</DataCell>
              <DataCell>{record.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}

      <nav className="flex gap-6" aria-label={t('admin.works')}>
        {offset > 0 ? (
          <TextLink
            href={`?page=${String(Math.max(1, offset / PAGE_SIZE))}&q=${encodeURIComponent(queryValue(query, 'q') ?? '')}`}
          >
            {t('previous')}
          </TextLink>
        ) : null}
        {page.hasMore ? (
          <TextLink
            href={`?page=${String(offset / PAGE_SIZE + 2)}&q=${encodeURIComponent(queryValue(query, 'q') ?? '')}`}
          >
            {t('next')}
          </TextLink>
        ) : null}
      </nav>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('createWork')}</SectionHeading>

          {/*
           * THE CONTRIBUTOR SEARCH IS A SEPARATE GET FORM, not a control inside the
           * create form. Submitting the create form to run a search would discard
           * everything typed into it; a separate form reloads the page with a
           * narrowed set of contributor options and nothing else.
           */}
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('referenceQuery')}
              <input
                type="text"
                name="q"
                defaultValue={queryValue(query, 'q') ?? ''}
                maxLength={200}
                className="rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
            >
              {t('findReferences')}
            </button>
          </form>

          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('referenceHelp')}
          </p>

          <WorkForm locale={locale} record={null} choices={choices} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}
