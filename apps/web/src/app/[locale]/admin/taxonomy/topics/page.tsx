import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { TOPIC_FALLBACK_LOCALE } from '@minhaj/contracts/taxonomy';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { requireAdminPage } from '@/composition/authorization';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { requireLocale } from '@/config/route-locale';
import { missingTranslations, topicBreadcrumb } from '@/contexts/taxonomy';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { queryValue } from '../../shared';
import {
  createTopicAction,
  moveTopicAction,
  removeTopicTranslationAction,
  reorderTopicsAction,
  setTopicStatusAction,
  setTopicTranslationAction,
} from '../actions';
import { taxonomyCopy } from '../copy';

/**
 * Canonical topic administration.
 *
 * ONE ROUTE, TWO SELECTIONS. `?parent=` says which level of the hierarchy is
 * being browsed and `?topic=` says which topic is open for editing. Keeping
 * both in the URL is what makes this surface navigable without JavaScript,
 * linkable, and bounded — the editor's forms are rendered for ONE topic rather
 * than for every row, so a taxonomy of two thousand topics produces the same
 * page weight as one of nineteen.
 *
 * THE CANONICAL SEED IS VISIBLE AND PARTLY UNTOUCHABLE. Its slug, its place in
 * the hierarchy and its lifecycle are foundation data the migration controls,
 * and those controls are ABSENT from the markup rather than disabled — a
 * disabled control is a client-side rule (SECURITY_BASELINE.md §3.4 rule 1).
 * Its localised names and descriptions ARE editable, because wording a subject
 * in Urdu is editorial work and not a schema decision.
 *
 * TRANSLATION GAPS ARE SHOWN, NOT HIDDEN. The seed ships with English only,
 * deliberately; a surface that quietly rendered the fallback everywhere would
 * turn a known omission into one nobody notices.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Every interface locale a topic may be translated into. */
const LOCALES: readonly Locale[] = localeSchema.options;

type Search = Record<string, string | string[] | undefined>;

/** The order that puts one sibling before the one above it. */
function swapped(
  siblings: readonly TopicView[],
  index: number,
  offset: -1 | 1,
): readonly string[] {
  const order = siblings.map((sibling) => sibling.id);
  const target = index + offset;
  const moving = order[index];
  const displaced = order[target];
  if (moving === undefined || displaced === undefined) return order;

  order[index] = displaced;
  order[target] = moving;
  return order;
}

export default async function TopicsPage({
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
    `/${locale}/admin/taxonomy/topics`,
  );
  const copy = await taxonomyCopy(locale);
  const mayAdminister = page.authorization.can('taxonomy.administer');

  const includeArchived = query['archived'] === '1';
  const parentId = queryValue(query, 'parent');
  const selectedId = queryValue(query, 'topic');

  const { taxonomy } = taxonomyRuntime();

  // The whole shallow tree is read once: the breadcrumb, the parent chooser and
  // the current level all need it, and three reads of the same bounded set
  // would be three round trips for one answer.
  const [tree, siblings, selected] = await Promise.all([
    taxonomy.listTree({ locale, includeArchived: true }),
    taxonomy.listChildren({ parentId, locale, includeArchived }),
    selectedId === null
      ? Promise.resolve(null)
      : taxonomy.findTopic({ topicId: selectedId, locale }),
  ]);

  const here =
    parentId === null ? null : (tree.find((row) => row.id === parentId) ?? null);
  const trail = here === null ? [] : [...topicBreadcrumb(here, tree), here];

  const browseHref = (id: string | null): string => {
    const search = new URLSearchParams();
    if (id !== null) search.set('parent', id);
    if (includeArchived) search.set('archived', '1');
    const suffix = search.toString();
    return `/${locale}/admin/taxonomy/topics${suffix === '' ? '' : `?${suffix}`}`;
  };

  /** This level, with the archived filter flipped. */
  const archivedHref = ((): string => {
    const search = new URLSearchParams();
    if (parentId !== null) search.set('parent', parentId);
    if (!includeArchived) search.set('archived', '1');
    const suffix = search.toString();
    return `/${locale}/admin/taxonomy/topics${suffix === '' ? '' : `?${suffix}`}`;
  })();

  const editHref = (id: string): string => {
    const search = new URLSearchParams();
    if (parentId !== null) search.set('parent', parentId);
    if (includeArchived) search.set('archived', '1');
    search.set('topic', id);
    return `/${locale}/admin/taxonomy/topics?${search.toString()}`;
  };

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('taxonomy.topics.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('taxonomy.topics.description')}
        </p>
      </header>

      {/* ---- Where we are ------------------------------------------------ */}
      <nav aria-label={t('taxonomy.topics.breadcrumb')}>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <li>
            <TextLink href={browseHref(null)}>{t('taxonomy.topics.root')}</TextLink>
          </li>
          {trail.map((ancestor) => (
            <li key={ancestor.id} className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <TextLink href={browseHref(ancestor.id)}>{ancestor.label.name}</TextLink>
            </li>
          ))}
        </ol>
      </nav>

      <p className="text-sm">
        <TextLink href={archivedHref}>
          {includeArchived
            ? t('taxonomy.topics.hideArchived')
            : t('taxonomy.topics.showArchived')}
        </TextLink>
      </p>

      {/* ---- This level -------------------------------------------------- */}
      {siblings.length === 0 ? (
        <EmptyState>{t('taxonomy.topics.noChildren')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('taxonomy.topics.caption')}
            columns={[
              t('taxonomy.topics.name'),
              t('taxonomy.topics.slug'),
              t('taxonomy.topics.status'),
              t('taxonomy.topics.coverage'),
              t('taxonomy.topics.actions'),
            ]}
          >
            {siblings.map((topic, index) => {
              const missing = missingTranslations(topic, LOCALES);

              return (
                <DataRow key={topic.id}>
                  <DataCell wrap>
                    <span className="flex flex-col gap-1">
                      <TextLink href={browseHref(topic.id)}>{topic.label.name}</TextLink>
                      {topic.label.fallback ? (
                        <span className="text-xs text-[color:var(--color-foreground-muted)]">
                          {t('taxonomy.topics.shownInFallback', {
                            locale: topic.label.resolvedLocale,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </DataCell>

                  <DataCell>
                    <code className="text-xs">{topic.slug}</code>
                  </DataCell>

                  <DataCell>
                    <span className="flex flex-wrap gap-1">
                      <StatusBadge
                        tone={topic.status === 'active' ? 'positive' : 'caution'}
                      >
                        {t(
                          topic.status === 'active'
                            ? 'taxonomy.topics.statusActive'
                            : 'taxonomy.topics.statusArchived',
                        )}
                      </StatusBadge>
                      {topic.system ? (
                        <StatusBadge tone="caution">
                          {t('taxonomy.topics.canonical')}
                        </StatusBadge>
                      ) : null}
                    </span>
                  </DataCell>

                  <DataCell>
                    {missing.length === 0 ? (
                      <span className="text-xs">{t('taxonomy.topics.complete')}</span>
                    ) : (
                      <span className="text-xs text-[color:var(--color-foreground-muted)]">
                        {t('taxonomy.topics.missing', { locales: missing.join(', ') })}
                      </span>
                    )}
                  </DataCell>

                  <DataCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <TextLink href={editHref(topic.id)}>
                        {t('taxonomy.topics.edit')}
                      </TextLink>

                      {/*
                       * REORDERING WITHOUT JAVASCRIPT. Each button submits the
                       * COMPLETE new order rather than a relative nudge, so the
                       * server writes an absolute arrangement it can audit —
                       * and two administrators cannot interleave two nudges
                       * into an order neither of them chose.
                       */}
                      {mayAdminister && index > 0 ? (
                        <ActionForm
                          action={reorderTopicsAction}
                          submitLabel={t('taxonomy.topics.moveUp')}
                          pendingLabel={t('common.saving')}
                          tone="secondary"
                          messages={{
                            ...copy.messages,
                            success: t('taxonomy.topics.reordered'),
                          }}
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="parentId" value={parentId ?? ''} />
                          {swapped(siblings, index, -1).map((id) => (
                            <input
                              key={id}
                              type="hidden"
                              name="orderedTopicIds"
                              value={id}
                            />
                          ))}
                        </ActionForm>
                      ) : null}

                      {mayAdminister && index < siblings.length - 1 ? (
                        <ActionForm
                          action={reorderTopicsAction}
                          submitLabel={t('taxonomy.topics.moveDown')}
                          pendingLabel={t('common.saving')}
                          tone="secondary"
                          messages={{
                            ...copy.messages,
                            success: t('taxonomy.topics.reordered'),
                          }}
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="parentId" value={parentId ?? ''} />
                          {swapped(siblings, index, 1).map((id) => (
                            <input
                              key={id}
                              type="hidden"
                              name="orderedTopicIds"
                              value={id}
                            />
                          ))}
                        </ActionForm>
                      ) : null}
                    </span>
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        </Panel>
      )}

      {/* ---- Create ------------------------------------------------------ */}
      {mayAdminister ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('taxonomy.topics.createTitle')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('taxonomy.topics.createHere', {
                parent: here === null ? t('taxonomy.topics.root') : here.label.name,
              })}
            </p>

            <ActionForm
              action={createTopicAction}
              submitLabel={t('taxonomy.topics.createSubmit')}
              pendingLabel={t('common.saving')}
              messages={{ ...copy.messages, success: t('taxonomy.topics.created') }}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="parentId" value={parentId ?? ''} />

              <Field
                id="topic-slug"
                label={t('taxonomy.topics.slug')}
                help={t('taxonomy.topics.slugHelp')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name="slug"
                    type="text"
                    required
                    maxLength={160}
                  />
                )}
              </Field>

              <Field
                id="topic-name"
                label={t('taxonomy.topics.fallbackName', {
                  locale: TOPIC_FALLBACK_LOCALE,
                })}
                help={t('taxonomy.topics.fallbackNameHelp')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name="name"
                    type="text"
                    required
                    maxLength={200}
                  />
                )}
              </Field>

              <Field
                id="topic-description"
                label={t('taxonomy.topics.descriptionField')}
                help={t('taxonomy.topics.descriptionHelp')}
              >
                {(props) => (
                  <TextInput {...props} name="description" type="text" maxLength={500} />
                )}
              </Field>
            </ActionForm>
          </div>
        </Panel>
      ) : null}

      {/* ---- The selected topic ------------------------------------------ */}
      {selectedId !== null && selected === null ? (
        <Alert tone="error">{t('denied.notFound')}</Alert>
      ) : null}

      {selected !== null ? (
        <Panel>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <SectionHeading>
                {t('taxonomy.topics.editing', { name: selected.label.name })}
              </SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                <code className="text-xs">{selected.slug}</code>
              </p>
            </div>

            {selected.system ? (
              <Alert tone="info">{t('taxonomy.topics.canonicalNote')}</Alert>
            ) : null}

            {/* ---- Translations, one form per interface locale ----------- */}
            <div className="flex flex-col gap-4">
              <h3 className="text-base font-semibold">
                {t('taxonomy.topics.translationsTitle')}
              </h3>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('taxonomy.topics.translationsHelp', {
                  locale: TOPIC_FALLBACK_LOCALE,
                })}
              </p>

              {LOCALES.map((translationLocale) => {
                const existing = selected.translations.find(
                  (entry) => entry.locale === translationLocale,
                );
                const isFallback = translationLocale === TOPIC_FALLBACK_LOCALE;

                return (
                  <div
                    key={translationLocale}
                    className="flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-4"
                  >
                    <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span>{translationLocale}</span>
                      {isFallback ? (
                        <StatusBadge tone="caution">
                          {t('taxonomy.topics.fallbackBadge')}
                        </StatusBadge>
                      ) : null}
                      {existing === undefined ? (
                        <StatusBadge tone="neutral">
                          {t('taxonomy.topics.untranslated')}
                        </StatusBadge>
                      ) : null}
                    </h4>

                    {mayAdminister ? (
                      <ActionForm
                        action={setTopicTranslationAction}
                        submitLabel={t('taxonomy.topics.translationSubmit')}
                        pendingLabel={t('common.saving')}
                        tone="secondary"
                        messages={{
                          ...copy.messages,
                          success: t('taxonomy.topics.translationSaved'),
                        }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="topicId" value={selected.id} />
                        <input
                          type="hidden"
                          name="translationLocale"
                          value={translationLocale}
                        />

                        <Field
                          id={`name-${translationLocale}`}
                          label={t('taxonomy.topics.name')}
                        >
                          {(props) => (
                            <TextInput
                              {...props}
                              name="name"
                              type="text"
                              required
                              maxLength={200}
                              defaultValue={existing?.name ?? ''}
                              lang={translationLocale}
                            />
                          )}
                        </Field>

                        <Field
                          id={`description-${translationLocale}`}
                          label={t('taxonomy.topics.descriptionField')}
                        >
                          {(props) => (
                            <TextInput
                              {...props}
                              name="description"
                              type="text"
                              maxLength={500}
                              defaultValue={existing?.description ?? ''}
                              lang={translationLocale}
                            />
                          )}
                        </Field>
                      </ActionForm>
                    ) : (
                      <p className="text-sm" lang={translationLocale}>
                        {existing?.name ?? t('taxonomy.topics.untranslated')}
                      </p>
                    )}

                    {/*
                     * The fallback translation offers NO remove control. It is
                     * what every other locale resolves to, and the database
                     * refuses to lose it; offering a button the server would
                     * refuse is how an interface teaches people to distrust it.
                     */}
                    {mayAdminister && !isFallback && existing !== undefined ? (
                      <ActionForm
                        action={removeTopicTranslationAction}
                        submitLabel={t('taxonomy.topics.translationRemove')}
                        pendingLabel={t('common.saving')}
                        tone="destructive"
                        messages={{
                          ...copy.messages,
                          success: t('taxonomy.topics.translationRemoved'),
                        }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="topicId" value={selected.id} />
                        <input
                          type="hidden"
                          name="translationLocale"
                          value={translationLocale}
                        />
                      </ActionForm>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* ---- Identity and placement, for administrable topics ------ */}
            {mayAdminister && !selected.system ? (
              <div className="flex flex-col gap-4 border-t border-[color:var(--color-border)] pt-4">
                <h3 className="text-base font-semibold">
                  {t('taxonomy.topics.placementTitle')}
                </h3>

                <ActionForm
                  action={moveTopicAction}
                  submitLabel={t('taxonomy.topics.moveSubmit')}
                  pendingLabel={t('common.saving')}
                  tone="secondary"
                  messages={{ ...copy.messages, success: t('taxonomy.topics.moved') }}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="topicId" value={selected.id} />

                  <Field
                    id="move-parent"
                    label={t('taxonomy.topics.parent')}
                    help={t('taxonomy.topics.moveHelp')}
                  >
                    {(props) => (
                      <Select
                        {...props}
                        name="parentId"
                        defaultValue={selected.parentId ?? ''}
                      >
                        <option value="">{t('taxonomy.topics.root')}</option>
                        {tree
                          .filter(
                            (candidate) =>
                              candidate.id !== selected.id &&
                              candidate.status === 'active',
                          )
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.label.name} ({candidate.slug})
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                </ActionForm>

                <ActionForm
                  action={setTopicStatusAction}
                  submitLabel={t(
                    selected.status === 'active'
                      ? 'taxonomy.topics.archiveSubmit'
                      : 'taxonomy.topics.restoreSubmit',
                  )}
                  pendingLabel={t('common.saving')}
                  tone={selected.status === 'active' ? 'destructive' : 'secondary'}
                  messages={{
                    ...copy.messages,
                    success: t('taxonomy.topics.statusChanged'),
                  }}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="topicId" value={selected.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={selected.status === 'active' ? 'archived' : 'active'}
                  />
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('taxonomy.topics.archiveHelp')}
                  </p>
                </ActionForm>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </main>
  );
}
