import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { personStatusSchema, type ProfileKind } from '@minhaj/contracts/people';

import { requireAdminPage } from '@/composition/authorization';
import { peopleRuntime } from '@/composition/people';
import { requireLocale } from '@/config/route-locale';
import { missingTranslations } from '@/contexts/people-contributors';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { PAGE_SIZE, pageOffset, queryValue } from '../shared';

/**
 * The four facet directories, as ONE implementation.
 *
 * ROUTE_MAP.md §7 promises `/admin/people/{persons|authors|speakers|scholars|
 * teachers}` — five routes. Four of them are the same screen filtered by a
 * different profile kind, and writing them four times would be four files to
 * keep in step: the day one gained a column, the other three would be the
 * screens nobody noticed.
 *
 * THEY ARE VIEWS, NOT EDITORS. Each row links into
 * `/admin/people/persons?person=…`, which is the single place a contributor is
 * changed. One human being is one record; four editors would be four places to
 * change the same name, and the fourth would be the one with the stale copy.
 *
 * THE PERMISSION IS `people.read` FOR ALL FIVE. The five routes are five views
 * of one administrative concern with one owner, which is why the catalogue has
 * two People keys rather than ten (`packages/contracts/src/identity/permissions.ts`).
 *
 * `noindex, nofollow` and `force-dynamic` are declared by each route module
 * rather than here: they are route segment configuration, and Next reads them
 * from the module it renders.
 */

/** Every interface locale a contributor may be described in. */
const LOCALES: readonly Locale[] = localeSchema.options;

type Search = Record<string, string | string[] | undefined>;

export async function FacetDirectory({
  kind,
  params,
  searchParams,
}: {
  readonly kind: ProfileKind;
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Search>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'admin' });

  const segment = `${kind}s`;
  const page = await requireAdminPage(
    locale,
    'people.read',
    `/${locale}/admin/people/${segment}`,
  );
  const mayAdminister = page.authorization.can('people.administer');

  const search = queryValue(query, 'q');
  const statusFilter = personStatusSchema.safeParse(queryValue(query, 'status'));
  const status = statusFilter.success ? statusFilter.data : null;
  const offset = pageOffset(query, PAGE_SIZE);
  const currentPage = offset / PAGE_SIZE + 1;

  const directory = await peopleRuntime().people.listPeople({
    query: search,
    status,
    profileKind: kind,
    locale,
    offset,
  });

  const pageHref = (target: number): string => {
    const next = new URLSearchParams();
    if (search !== null) next.set('q', search);
    if (status !== null) next.set('status', status);
    if (target > 1) next.set('page', String(target));
    const suffix = next.toString();
    return `/${locale}/admin/people/${segment}${suffix === '' ? '' : `?${suffix}`}`;
  };

  const editHref = (id: string): string =>
    `/${locale}/admin/people/persons?person=${encodeURIComponent(id)}`;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>
          {t(`people.facets.${kind}.title` as 'people.facets.author.title')}
        </PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t(`people.facets.${kind}.description` as 'people.facets.author.description')}
        </p>
      </header>

      {/* THE FACET IS NOT AN AUTHORISATION, said in words on the two screens
          where somebody might expect it to be. A teacher facet describes; a
          RoleAssignment authorises (DOMAIN_MODEL.md §4.5). */}
      {kind === 'teacher' || kind === 'scholar' ? (
        <Alert tone="info">
          {t(`people.facets.${kind}.notice` as 'people.facets.scholar.notice')}
        </Alert>
      ) : null}

      <Panel>
        <form method="get" className="flex flex-col gap-4">
          <Field
            id={`${kind}-search`}
            label={t('people.persons.search')}
            help={t('people.persons.searchHelp')}
          >
            {(props) => (
              <TextInput
                {...props}
                name="q"
                type="search"
                maxLength={160}
                defaultValue={search ?? ''}
              />
            )}
          </Field>

          <Field id={`${kind}-status-filter`} label={t('people.persons.statusFilter')}>
            {(props) => (
              <Select {...props} name="status" defaultValue={status ?? ''}>
                <option value="">{t('people.persons.statusAny')}</option>
                {personStatusSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {t(`people.status.${option}` as 'people.status.draft')}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div>
            <button
              type="submit"
              className="rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--color-surface-sunken)]"
            >
              {t('people.persons.searchSubmit')}
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        {directory.items.length === 0 ? (
          <EmptyState>
            {t(`people.facets.${kind}.empty` as 'people.facets.author.empty')}
          </EmptyState>
        ) : (
          <DataTable
            caption={t(`people.facets.${kind}.caption` as 'people.facets.author.caption')}
            columns={[
              t('people.persons.name'),
              t('people.persons.slug'),
              t('people.persons.status'),
              t('people.persons.coverage'),
              t('people.persons.actions'),
            ]}
          >
            {directory.items.map((person) => {
              const missing = missingTranslations(person, LOCALES);

              return (
                <DataRow key={person.id}>
                  <DataCell wrap>{person.label.name}</DataCell>
                  <DataCell>
                    <code className="text-xs">{person.slug}</code>
                  </DataCell>
                  <DataCell>
                    <StatusBadge
                      tone={
                        person.status === 'published'
                          ? 'positive'
                          : person.status === 'archived'
                            ? 'caution'
                            : 'neutral'
                      }
                    >
                      {t(`people.status.${person.status}` as 'people.status.draft')}
                    </StatusBadge>
                  </DataCell>
                  <DataCell wrap>
                    {missing.length === 0
                      ? t('people.persons.complete')
                      : t('people.persons.missing', { locales: missing.join(', ') })}
                  </DataCell>
                  <DataCell>
                    <TextLink href={editHref(person.id)}>
                      {mayAdminister
                        ? t('people.persons.edit')
                        : t('people.persons.view')}
                    </TextLink>
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        )}

        <nav aria-label={t('people.pagination')} className="flex gap-4 pt-4 text-sm">
          {currentPage > 1 ? (
            <TextLink href={pageHref(currentPage - 1)}>{t('people.previous')}</TextLink>
          ) : null}
          {directory.more ? (
            <TextLink href={pageHref(currentPage + 1)}>{t('people.next')}</TextLink>
          ) : null}
        </nav>
      </Panel>
    </main>
  );
}
