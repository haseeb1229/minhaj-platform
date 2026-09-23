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
import { pageOffset, PAGE_SIZE } from '../../shared';
import { EditionForm, libraryCopy } from '../forms';

/**
 * `/{locale}/admin/library/editions` — the Editions directory and the create form
 * (ROUTE_MAP.md §7).
 *
 * THE READING AND DOWNLOAD STATES ARE SEPARATE COLUMNS, because they are separate
 * decisions and an operator has to be able to see that they differ. A single
 * "available" column would hide exactly the case this phase exists to model
 * honestly: an edition that may be read online and may not be taken away (§26, §27).
 *
 * BOUNDED AND DETERMINISTICALLY ORDERED, by owning Work and then by identifier, from
 * the persistence layer's own cap.
 */
export const dynamic = 'force-dynamic';

export default async function EditionsDirectory({
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
    `/${locale}/admin/library/editions`,
  );

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const offset = pageOffset(query, PAGE_SIZE);

  const [page, works, choices] = await Promise.all([
    libraryRuntime().library.editions(actor, offset),
    libraryRuntime().library.works(actor, 0),
    libraryReferenceChoices(locale, ''),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('admin.editions')}</PageHeading>

      {page.items.length === 0 ? (
        <EmptyState>{t('adminEmpty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('admin.editions')}
          columns={[
            t('editionLabel'),
            t('contentLanguage'),
            t('state'),
            t('readingState'),
            t('downloadState'),
            t('version'),
          ]}
        >
          {page.items.map((record) => (
            <DataRow key={record.id}>
              <DataCell wrap>
                <TextLink href={`/${locale}/admin/library/editions/${record.id}`}>
                  {record.label}
                </TextLink>
              </DataCell>
              <DataCell>{record.languageCode}</DataCell>
              <DataCell>
                <StatusBadge tone={record.state === 'published' ? 'positive' : 'neutral'}>
                  {t(`stateName.${record.state}` as 'stateName.draft')}
                </StatusBadge>
              </DataCell>
              <DataCell>
                {record.reading === 'allowed'
                  ? t('readingAllowed')
                  : t('readingUnavailable')}
              </DataCell>
              <DataCell>
                {record.download === 'allowed'
                  ? t('downloadAllowed')
                  : t('downloadDenied')}
              </DataCell>
              <DataCell>{record.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}

      <nav className="flex gap-6" aria-label={t('admin.editions')}>
        {offset > 0 ? (
          <TextLink href={`?page=${String(Math.max(1, offset / PAGE_SIZE))}`}>
            {t('previous')}
          </TextLink>
        ) : null}
        {page.hasMore ? (
          <TextLink href={`?page=${String(offset / PAGE_SIZE + 2)}`}>
            {t('next')}
          </TextLink>
        ) : null}
      </nav>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('createEdition')}</SectionHeading>
          <EditionForm
            locale={locale}
            record={null}
            works={works.items}
            choices={choices}
            copy={copy}
          />
        </div>
      </Panel>
    </main>
  );
}
