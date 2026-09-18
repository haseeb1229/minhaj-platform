import { getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  Button,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { PAGE_SIZE, pageOffset, queryValue } from '../../shared';
import { createTagAction, relabelTagAction, setTagStatusAction } from '../actions';
import { taxonomyCopy } from '../copy';

/**
 * Editorial tags.
 *
 * SMALL ON PURPOSE. A tag has a slug, a label and a lifecycle, and this screen
 * offers exactly those. There is no parent chooser, no ordering, no translation
 * editor and no canonical badge — because DOMAIN_MODEL.md §6.4 says a tag has
 * none of that, and an interface that implied otherwise would teach editors to
 * use tags where the canonical taxonomy is required. The notice at the top says
 * the distinction in words rather than leaving it to be inferred from what is
 * missing.
 *
 * BOUNDED IN BOTH DIRECTIONS. Tags are the one aggregate in this phase that
 * genuinely grows, so the listing is paginated and the search is a PREFIX
 * search on the two indexed columns — a "contains" search would be a leading
 * wildcard no index can seek, which is a table scan on every keystroke.
 *
 * The search form is a GET. It selects what to look at and changes nothing, so
 * it is not a mutation and carries no CSRF concern; every mutation on this page
 * is a Server Action (SECURITY_BASELINE.md §7.1).
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

export default async function TagsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Search>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'admin' });

  const page = await requireAdminPage(
    locale,
    'taxonomy.read',
    `/${locale}/admin/taxonomy/tags`,
  );
  const copy = await taxonomyCopy(locale);
  const mayAdminister = page.authorization.can('taxonomy.administer');

  const search = queryValue(query, 'q');
  const includeRetired = query['retired'] === '1';
  const offset = pageOffset(query, PAGE_SIZE);
  const currentPage = offset / PAGE_SIZE + 1;

  const tags = await taxonomyRuntime().taxonomy.listTags({
    query: search,
    includeRetired,
    limit: PAGE_SIZE,
    offset,
  });

  const pageHref = (target: number): string => {
    const next = new URLSearchParams();
    if (search !== null) next.set('q', search);
    if (includeRetired) next.set('retired', '1');
    if (target > 1) next.set('page', String(target));
    const suffix = next.toString();
    return `/${locale}/admin/taxonomy/tags${suffix === '' ? '' : `?${suffix}`}`;
  };

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('taxonomy.tags.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('taxonomy.tags.description')}
        </p>
      </header>

      <Alert tone="info">{t('taxonomy.tags.notTopics')}</Alert>

      {/* ---- Search ------------------------------------------------------- */}
      <Panel>
        <form method="get" className="flex flex-col gap-4">
          <Field
            id="tag-search"
            label={t('taxonomy.tags.search')}
            help={t('taxonomy.tags.searchHelp')}
          >
            {(props) => (
              <TextInput
                {...props}
                name="q"
                type="search"
                maxLength={120}
                defaultValue={search ?? ''}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="retired"
              value="1"
              defaultChecked={includeRetired}
            />
            {t('taxonomy.tags.includeRetired')}
          </label>

          <Button tone="secondary">{t('taxonomy.tags.searchSubmit')}</Button>
        </form>
      </Panel>

      {/* ---- The listing -------------------------------------------------- */}
      {tags.items.length === 0 ? (
        <EmptyState>{t('taxonomy.tags.none')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('taxonomy.tags.caption')}
            columns={[
              t('taxonomy.tags.label'),
              t('taxonomy.tags.slug'),
              t('taxonomy.tags.status'),
              ...(mayAdminister ? [t('taxonomy.tags.actions')] : []),
            ]}
          >
            {tags.items.map((tag) => (
              <DataRow key={tag.id}>
                <DataCell wrap>{tag.label}</DataCell>
                <DataCell>
                  <code className="text-xs">{tag.slug}</code>
                </DataCell>
                <DataCell>
                  <StatusBadge tone={tag.status === 'active' ? 'positive' : 'caution'}>
                    {t(
                      tag.status === 'active'
                        ? 'taxonomy.tags.statusActive'
                        : 'taxonomy.tags.statusRetired',
                    )}
                  </StatusBadge>
                </DataCell>

                {mayAdminister ? (
                  <DataCell>
                    <div className="flex flex-col gap-3">
                      <ActionForm
                        action={relabelTagAction}
                        submitLabel={t('taxonomy.tags.relabelSubmit')}
                        pendingLabel={t('common.saving')}
                        tone="secondary"
                        messages={{
                          ...copy.messages,
                          success: t('taxonomy.tags.relabelled'),
                        }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="tagId" value={tag.id} />

                        <Field id={`label-${tag.id}`} label={t('taxonomy.tags.label')}>
                          {(props) => (
                            <TextInput
                              {...props}
                              name="label"
                              type="text"
                              required
                              maxLength={120}
                              defaultValue={tag.label}
                            />
                          )}
                        </Field>
                      </ActionForm>

                      <ActionForm
                        action={setTagStatusAction}
                        submitLabel={t(
                          tag.status === 'active'
                            ? 'taxonomy.tags.retireSubmit'
                            : 'taxonomy.tags.restoreSubmit',
                        )}
                        pendingLabel={t('common.saving')}
                        tone={tag.status === 'active' ? 'destructive' : 'secondary'}
                        messages={{
                          ...copy.messages,
                          success: t('taxonomy.tags.statusChanged'),
                        }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="tagId" value={tag.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={tag.status === 'active' ? 'retired' : 'active'}
                        />
                      </ActionForm>
                    </div>
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>

          <nav
            aria-label={t('taxonomy.tags.pagination')}
            className="flex items-center gap-4 pt-4 text-sm"
          >
            {currentPage > 1 ? (
              <TextLink href={pageHref(currentPage - 1)}>
                {t('taxonomy.tags.previous')}
              </TextLink>
            ) : null}
            {tags.more ? (
              <TextLink href={pageHref(currentPage + 1)}>
                {t('taxonomy.tags.next')}
              </TextLink>
            ) : null}
          </nav>
        </Panel>
      )}

      {/* ---- Create ------------------------------------------------------- */}
      {mayAdminister ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('taxonomy.tags.createTitle')}</SectionHeading>

            <ActionForm
              action={createTagAction}
              submitLabel={t('taxonomy.tags.createSubmit')}
              pendingLabel={t('common.saving')}
              messages={{ ...copy.messages, success: t('taxonomy.tags.created') }}
            >
              <input type="hidden" name="locale" value={locale} />

              <Field
                id="tag-slug"
                label={t('taxonomy.tags.slug')}
                help={t('taxonomy.tags.slugHelp')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name="slug"
                    type="text"
                    required
                    maxLength={120}
                  />
                )}
              </Field>

              <Field
                id="tag-label"
                label={t('taxonomy.tags.label')}
                help={t('taxonomy.tags.labelHelp')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name="label"
                    type="text"
                    required
                    maxLength={120}
                  />
                )}
              </Field>
            </ActionForm>
          </div>
        </Panel>
      ) : null}
    </main>
  );
}
