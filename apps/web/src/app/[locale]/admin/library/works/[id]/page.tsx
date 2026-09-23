import { notFound } from 'next/navigation';

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
  TextLink,
} from '@/components/ui';
import { queryValue } from '../../../shared';
import { libraryCopy, WorkForm } from '../../forms';

/**
 * `/{locale}/admin/library/works/{id}` — editing one Work.
 *
 * THE FORM CARRIES THE VERSION IT WAS RENDERED FROM, which is what makes a stale save
 * a conflict instead of a silent overwrite. Two operators who both open version 3
 * and both save do not both win: the second save compares 3 against the row's
 * current 4 inside the writing transaction and is refused with `conflict`, which the
 * form renders as "this record changed; reload it before trying again" (§40,
 * DOMAIN_MODEL.md §19.8).
 *
 * THE SLUG IS EDITABLE, AND THAT IS WHY LIBRARY OWNS SLUG HISTORY. Changing it
 * reserves the new slug and keeps the old one reserved forever, and the old address
 * 301s to the new one from the next request onwards — natively, in this phase, and
 * without Migration (DOMAIN_MODEL.md §19.7, §19). The reservation is made by the
 * database, so it cannot be skipped by any writer.
 *
 * THE EDITIONS ARE LISTED BUT NOT EDITED HERE. An Edition is a separate aggregate
 * with its own version and its own availability decisions; editing one inside the
 * Work's form would make two records share one expected version, and a conflict on
 * either would look like a conflict on both.
 */
export const dynamic = 'force-dynamic';

export default async function WorkEditor({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;

  const context = await requireAdminPage(
    locale,
    'library.read',
    `/${locale}/admin/library/works`,
  );

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  /**
   * A MALFORMED IDENTIFIER IS A 404, NOT A 500. The service validates the shape and
   * throws; an operator who followed a broken link should get the page's own
   * not-found answer rather than an error boundary.
   */
  const record = await libraryRuntime()
    .library.work(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const choices = await libraryReferenceChoices(locale, queryValue(query, 'q') ?? '');

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{record.slug}</PageHeading>

      <section className="flex flex-col gap-3">
        <SectionHeading>{t('admin.editions')}</SectionHeading>

        {record.editions.length === 0 ? (
          <EmptyState>{t('adminNoEditions')}</EmptyState>
        ) : (
          <DataTable
            caption={t('admin.editions')}
            columns={[t('editionLabel'), t('contentLanguage'), t('state'), t('version')]}
          >
            {record.editions.map((edition) => (
              <DataRow key={edition.id}>
                <DataCell wrap>
                  <TextLink href={`/${locale}/admin/library/editions/${edition.id}`}>
                    {edition.label}
                  </TextLink>
                </DataCell>
                <DataCell>{edition.languageCode}</DataCell>
                <DataCell>
                  {t(`stateName.${edition.state}` as 'stateName.draft')}
                </DataCell>
                <DataCell>{edition.version}</DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}

        <p className="text-sm">
          <TextLink href={`/${locale}/admin/library/editions`}>
            {t('adminManageEditions')}
          </TextLink>
        </p>
      </section>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('editWork')}</SectionHeading>

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

          <WorkForm locale={locale} record={record} choices={choices} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}
