import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  MAX_NAME_VARIANTS_PER_LOCALE,
  MAX_PROFILE_LANGUAGES,
  PROFILE_KINDS,
  personStatusSchema,
  profileStatusSchema,
  type PersonDetail,
  type PersonStatus,
  type ProfileKind,
  type ProfileRecordView,
} from '@minhaj/contracts/people';
import type { ContributorCapabilities } from '@minhaj/contracts/identity';
import { CONTRIBUTOR_CAPABILITY_SOURCES } from '@minhaj/contracts/identity';

import { requireAdminPage } from '@/composition/authorization';
import { peopleRuntime } from '@/composition/people';
import { requireLocale } from '@/config/route-locale';
import { addableProfileKinds, missingTranslations } from '@/contexts/people-contributors';
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
import { PAGE_SIZE, pageOffset, queryValue } from '../../shared';
import {
  addNameVariantAction,
  createPersonAction,
  createProfileAction,
  linkAccountAction,
  removeNameVariantAction,
  removePersonTranslationAction,
  setPersonStatusAction,
  setPersonTranslationAction,
  setProfileLanguagesAction,
  setProfileStatusAction,
  setProfileTranslationAction,
  unlinkAccountAction,
} from '../actions';
import { peopleCopy } from '../copy';

/**
 * Contributor administration — the canonical People surface.
 *
 * ONE ROUTE, TWO SELECTIONS. `?q=` and `?status=` say which contributors are
 * being browsed and `?person=` says which one is open for editing. Keeping both
 * in the URL is what makes this surface navigable without JavaScript, linkable,
 * and bounded — the editor's forms are rendered for ONE contributor rather than
 * for every row, so a directory of two thousand people produces the same page
 * weight as one of five.
 *
 * THE FOUR FACET ROUTES ARE VIEWS OF THIS ONE. `/admin/people/authors` and its
 * three siblings list the contributors holding that facet and link here to
 * edit; they are not four parallel editors. One human being is one record, and
 * four editors would be four places to change the same name.
 *
 * THE SLUG IS SHOWN AND IS NOT EDITABLE. It is fixed at creation
 * (DOMAIN_MODEL.md §19.7 — an editable canonical slug requires native slug
 * history and automatic 301s, which this phase does not ship), and the control
 * is ABSENT from the markup rather than disabled: a disabled control is a
 * client-side rule (SECURITY_BASELINE.md §3.4 rule 1). The runtime principal is
 * additionally denied UPDATE on the column.
 *
 * THERE IS NO GRANT CONTROL ANYWHERE ON THIS PAGE, and its absence is the
 * phase's central claim rather than an omission. The capability panel is
 * READ-ONLY and says in words where authority comes from: adding a
 * TeacherProfile confers no teaching privilege, and approval is a
 * `RoleAssignment` made on Identity's privileged path (DOMAIN_MODEL.md §4.5).
 *
 * THERE IS NO ACCOUNT PICKER EITHER. Linking takes an identifier the operator
 * already holds, and the only place to obtain one is the Identity accounts
 * surface, which costs `users.read`. A search control here would make
 * `people.administer` a quiet grant of the account directory that permission
 * exists to guard (SECURITY_BASELINE.md §19.1).
 *
 * The search form is a GET. It selects what to look at and changes nothing, so
 * it is not a mutation and carries no CSRF concern; every mutation on this page
 * is a Server Action (SECURITY_BASELINE.md §7.1).
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Every interface locale a contributor may be described in. */
const LOCALES: readonly Locale[] = localeSchema.options;

type Search = Record<string, string | string[] | undefined>;

/** The lifecycle badge tone for one contributor state. */
function personTone(status: PersonStatus): 'neutral' | 'positive' | 'caution' {
  if (status === 'published') return 'positive';
  if (status === 'archived') return 'caution';
  return 'neutral';
}

export default async function PersonsPage({
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
    'people.read',
    `/${locale}/admin/people/persons`,
  );
  const copy = await peopleCopy(locale);
  const mayAdminister = page.authorization.can('people.administer');

  /**
   * Whether this operator may also see the linked account's IDENTIFIER.
   *
   * `people.administer` lets somebody attach an account they were given the
   * identifier for; it does not make them an account administrator. Revealing
   * an identifier they did not supply — one another operator attached — would
   * hand out an association `users.read` guards, so the identifier is shown
   * only to holders of that permission and everyone else sees whether a link
   * EXISTS (SECURITY_BASELINE.md §19.1, ROUTE_MAP.md §7).
   */
  const maySeeAccounts = page.authorization.can('users.read');

  const search = queryValue(query, 'q');
  const statusFilter = personStatusSchema.safeParse(queryValue(query, 'status'));
  const status = statusFilter.success ? statusFilter.data : null;
  const selectedId = queryValue(query, 'person');
  const offset = pageOffset(query, PAGE_SIZE);
  const currentPage = offset / PAGE_SIZE + 1;

  const { people } = peopleRuntime();

  const [directory, selected] = await Promise.all([
    people.listPeople({
      query: search,
      status,
      profileKind: null,
      locale,
      offset,
    }),
    selectedId === null
      ? Promise.resolve(null)
      : people.findPerson({ personId: selectedId, locale }),
  ]);

  // ONE CALL, AND ONLY WHEN THERE IS AN ACCOUNT TO ASK ABOUT. A contributor
  // with no account projects false without a round trip, and the directory
  // never asks at all — a capability column would be one Identity read per row.
  const capabilities: ContributorCapabilities | null =
    selected === null ? null : await people.capabilitiesFor(selected.linkedAccountId);

  const pageHref = (target: number): string => {
    const next = new URLSearchParams();
    if (search !== null) next.set('q', search);
    if (status !== null) next.set('status', status);
    if (target > 1) next.set('page', String(target));
    const suffix = next.toString();
    return `/${locale}/admin/people/persons${suffix === '' ? '' : `?${suffix}`}`;
  };

  const editHref = (id: string): string => {
    const next = new URLSearchParams();
    if (search !== null) next.set('q', search);
    if (status !== null) next.set('status', status);
    if (currentPage > 1) next.set('page', String(currentPage));
    next.set('person', id);
    return `/${locale}/admin/people/persons?${next.toString()}`;
  };

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('people.persons.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('people.persons.description')}
        </p>
      </header>

      <Alert tone="info">{t('people.persons.acceptanceNotice')}</Alert>

      {/* ---- Search ------------------------------------------------------- */}
      <Panel>
        <form method="get" className="flex flex-col gap-4">
          <Field
            id="person-search"
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

          <Field id="person-status-filter" label={t('people.persons.statusFilter')}>
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

      {/* ---- Directory ---------------------------------------------------- */}
      <Panel>
        <SectionHeading>{t('people.persons.directory')}</SectionHeading>

        {directory.items.length === 0 ? (
          <EmptyState>{t('people.persons.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('people.persons.caption')}
            columns={[
              t('people.persons.name'),
              t('people.persons.slug'),
              t('people.persons.status'),
              t('people.persons.coverage'),
              t('people.persons.facets'),
              t('people.persons.account'),
              t('people.persons.actions'),
            ]}
          >
            {directory.items.map((person) => {
              const missing = missingTranslations(person, LOCALES);

              return (
                <DataRow key={person.id}>
                  <DataCell wrap>
                    {person.label.name}
                    {person.label.fallback ? (
                      <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                        {t('people.persons.shownIn', {
                          locale: person.label.resolvedLocale,
                        })}
                      </span>
                    ) : null}
                  </DataCell>
                  <DataCell>
                    <code className="text-xs">{person.slug}</code>
                  </DataCell>
                  <DataCell>
                    <StatusBadge tone={personTone(person.status)}>
                      {t(`people.status.${person.status}` as 'people.status.draft')}
                    </StatusBadge>
                  </DataCell>
                  <DataCell wrap>
                    {missing.length === 0
                      ? t('people.persons.complete')
                      : t('people.persons.missing', { locales: missing.join(', ') })}
                  </DataCell>
                  <DataCell wrap>
                    {person.profileKinds.length === 0
                      ? t('people.persons.noFacets')
                      : person.profileKinds
                          .map((kind) => t(`people.kind.${kind}` as 'people.kind.author'))
                          .join(', ')}
                  </DataCell>
                  <DataCell>
                    {person.linked
                      ? t('people.persons.accountLinked')
                      : t('people.persons.accountNone')}
                  </DataCell>
                  <DataCell>
                    <TextLink href={editHref(person.id)}>
                      {t('people.persons.edit')}
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

      {/* ---- Editor ------------------------------------------------------- */}
      {selected === null ? null : (
        <ContributorEditor
          detail={selected}
          capabilities={capabilities}
          locale={locale}
          mayAdminister={mayAdminister}
          maySeeAccounts={maySeeAccounts}
          messages={copy.messages}
          t={t}
        />
      )}

      {/* ---- Create ------------------------------------------------------- */}
      {!mayAdminister ? null : (
        <Panel>
          <SectionHeading>{t('people.persons.createTitle')}</SectionHeading>
          <p className="pb-4 text-sm text-[color:var(--color-foreground-muted)]">
            {t('people.persons.createHelp')}
          </p>

          <ActionForm
            action={createPersonAction}
            submitLabel={t('people.persons.createSubmit')}
            pendingLabel={t('common.saving')}
            messages={copy.messages}
          >
            <input type="hidden" name="locale" value={locale} />

            <Field
              id="create-slug"
              label={t('people.persons.slug')}
              help={t('people.persons.slugHelp')}
            >
              {(props) => <TextInput {...props} name="slug" required maxLength={160} />}
            </Field>

            <Field
              id="create-primary-locale"
              label={t('people.persons.primaryLocale')}
              help={t('people.persons.primaryLocaleHelp')}
            >
              {(props) => (
                <Select {...props} name="primaryLocale" defaultValue={locale}>
                  {LOCALES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="create-name" label={t('people.persons.nameField')}>
              {(props) => <TextInput {...props} name="name" required maxLength={200} />}
            </Field>

            <Field
              id="create-biography"
              label={t('people.persons.biography')}
              help={t('people.persons.biographyHelp')}
            >
              {(props) => (
                <textarea
                  {...props}
                  name="biography"
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2 text-base"
                />
              )}
            </Field>
          </ActionForm>
        </Panel>
      )}
    </main>
  );
}

/* ===========================================================================
 * The editor
 * ========================================================================= */

type Translator = Awaited<ReturnType<typeof getTranslations<'admin'>>>;

/**
 * Everything one contributor's record can be changed to.
 *
 * A SERVER COMPONENT, like the page that renders it. The only client code on
 * this surface is `ActionForm`, which exists for pending state and a result to
 * announce; the forms themselves submit and work without JavaScript
 * (ARCHITECTURE.md §7).
 */
function ContributorEditor({
  detail,
  capabilities,
  locale,
  mayAdminister,
  maySeeAccounts,
  messages,
  t,
}: {
  readonly detail: PersonDetail;
  readonly capabilities: ContributorCapabilities | null;
  readonly locale: Locale;
  readonly mayAdminister: boolean;
  readonly maySeeAccounts: boolean;
  readonly messages: Readonly<Record<string, string>>;
  readonly t: Translator;
}) {
  const addable = addableProfileKinds(detail);

  return (
    <>
      {/* ---- Identity of the record ------------------------------------- */}
      <Panel>
        <SectionHeading>
          {t('people.editor.title', { name: detail.label.name })}
        </SectionHeading>

        <dl className="grid gap-2 py-4 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium">{t('people.persons.slug')}</dt>
          <dd>
            <code className="text-xs">{detail.slug}</code>
            <span className="block text-xs text-[color:var(--color-foreground-muted)]">
              {t('people.editor.slugImmutable')}
            </span>
          </dd>

          <dt className="font-medium">{t('people.persons.primaryLocale')}</dt>
          <dd>{detail.primaryLocale}</dd>

          <dt className="font-medium">{t('people.persons.status')}</dt>
          <dd>
            <StatusBadge tone={personTone(detail.status)}>
              {t(`people.status.${detail.status}` as 'people.status.draft')}
            </StatusBadge>
          </dd>
        </dl>

        {detail.status === 'published' ? (
          <p className="text-sm">
            <TextLink href={`/${locale}/people/${detail.slug}`}>
              {t('people.editor.viewPublic')}
            </TextLink>
          </p>
        ) : null}

        {!mayAdminister ? null : (
          <ActionForm
            action={setPersonStatusAction}
            submitLabel={t('people.editor.statusSubmit')}
            pendingLabel={t('common.saving')}
            messages={messages}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="personId" value={detail.id} />

            <Field
              id="person-status"
              label={t('people.editor.statusField')}
              help={t('people.editor.statusHelp')}
            >
              {(props) => (
                <Select {...props} name="status" defaultValue={detail.status}>
                  {personStatusSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {t(`people.status.${option}` as 'people.status.draft')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </ActionForm>
        )}
      </Panel>

      {/* ---- Translations ------------------------------------------------ */}
      <Panel>
        <SectionHeading>{t('people.editor.translations')}</SectionHeading>
        <p className="pb-4 text-sm text-[color:var(--color-foreground-muted)]">
          {t('people.editor.translationsHelp')}
        </p>

        {LOCALES.map((contentLocale) => {
          const existing = detail.translations.find(
            (entry) => entry.locale === contentLocale,
          );
          const isPrimary = contentLocale === detail.primaryLocale;

          return (
            <section
              key={contentLocale}
              className="border-t border-[color:var(--color-border)] py-4"
            >
              <h4 className="pb-2 text-sm font-semibold">
                {contentLocale}
                {isPrimary ? ` — ${t('people.editor.primaryBadge')}` : ''}
              </h4>

              {!mayAdminister ? (
                <p className="text-sm">
                  {existing?.name ?? t('people.editor.noTranslation')}
                </p>
              ) : (
                <ActionForm
                  action={setPersonTranslationAction}
                  submitLabel={t('people.editor.translationSubmit')}
                  pendingLabel={t('common.saving')}
                  messages={messages}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="personId" value={detail.id} />
                  <input type="hidden" name="contentLocale" value={contentLocale} />

                  <Field
                    id={`name-${contentLocale}`}
                    label={t('people.persons.nameField')}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        name="name"
                        required
                        maxLength={200}
                        defaultValue={existing?.name ?? ''}
                      />
                    )}
                  </Field>

                  <Field
                    id={`biography-${contentLocale}`}
                    label={t('people.persons.biography')}
                    help={t('people.persons.biographyHelp')}
                  >
                    {(props) => (
                      <textarea
                        {...props}
                        name="biography"
                        rows={4}
                        maxLength={4000}
                        defaultValue={existing?.biography ?? ''}
                        className="w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2 text-base"
                      />
                    )}
                  </Field>
                </ActionForm>
              )}

              {/* The PRIMARY translation has no remove control, and it is
                  absent rather than disabled. A contributor without one has no
                  genuine language version for their canonical URL to point at
                  (ROUTE_MAP.md §9.3); the database refuses the removal too. */}
              {!mayAdminister || isPrimary || existing === undefined ? null : (
                <div className="pt-2">
                  <ActionForm
                    action={removePersonTranslationAction}
                    submitLabel={t('people.editor.translationRemove')}
                    pendingLabel={t('common.saving')}
                    messages={messages}
                    tone="destructive"
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="personId" value={detail.id} />
                    <input type="hidden" name="contentLocale" value={contentLocale} />
                  </ActionForm>
                </div>
              )}
            </section>
          );
        })}
      </Panel>

      {/* ---- Name variants ----------------------------------------------- */}
      <Panel>
        <SectionHeading>{t('people.editor.variants')}</SectionHeading>
        <p className="pb-4 text-sm text-[color:var(--color-foreground-muted)]">
          {t('people.editor.variantsHelp', { max: MAX_NAME_VARIANTS_PER_LOCALE })}
        </p>

        {detail.nameVariants.length === 0 ? (
          <EmptyState>{t('people.editor.noVariants')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2 pb-4">
            {detail.nameVariants.map((variant) => (
              <li key={variant.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{variant.value}</span>
                <span className="text-xs text-[color:var(--color-foreground-muted)]">
                  {variant.locale}
                </span>
                {!mayAdminister ? null : (
                  <ActionForm
                    action={removeNameVariantAction}
                    submitLabel={t('people.editor.variantRemove')}
                    pendingLabel={t('common.saving')}
                    messages={messages}
                    tone="destructive"
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="personId" value={detail.id} />
                    <input type="hidden" name="variantId" value={variant.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}

        {!mayAdminister ? null : (
          <ActionForm
            action={addNameVariantAction}
            submitLabel={t('people.editor.variantAdd')}
            pendingLabel={t('common.saving')}
            messages={messages}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="personId" value={detail.id} />

            <Field id="variant-locale" label={t('people.editor.variantLocale')}>
              {(props) => (
                <Select
                  {...props}
                  name="contentLocale"
                  defaultValue={detail.primaryLocale}
                >
                  {LOCALES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="variant-value" label={t('people.editor.variantValue')}>
              {(props) => <TextInput {...props} name="value" required maxLength={200} />}
            </Field>
          </ActionForm>
        )}
      </Panel>

      {/* ---- The optional account link ----------------------------------- */}
      <Panel>
        <SectionHeading>{t('people.editor.account')}</SectionHeading>
        <p className="pb-4 text-sm text-[color:var(--color-foreground-muted)]">
          {t('people.editor.accountHelp')}
        </p>

        <p className="pb-4 text-sm">
          {detail.linkedAccountId === null
            ? t('people.editor.accountAbsent')
            : maySeeAccounts
              ? t('people.editor.accountPresentWithId', {
                  id: detail.linkedAccountId,
                })
              : t('people.editor.accountPresent')}
        </p>

        {!mayAdminister ? null : detail.linkedAccountId === null ? (
          <ActionForm
            action={linkAccountAction}
            submitLabel={t('people.editor.accountLink')}
            pendingLabel={t('common.saving')}
            messages={messages}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="personId" value={detail.id} />

            <Field
              id="account-id"
              label={t('people.editor.accountField')}
              help={t('people.editor.accountFieldHelp')}
            >
              {(props) => (
                <TextInput {...props} name="accountId" required maxLength={36} />
              )}
            </Field>
          </ActionForm>
        ) : (
          <ActionForm
            action={unlinkAccountAction}
            submitLabel={t('people.editor.accountUnlink')}
            pendingLabel={t('common.saving')}
            messages={messages}
            tone="destructive"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="personId" value={detail.id} />
          </ActionForm>
        )}
      </Panel>

      {/* ---- Capability projections — READ ONLY --------------------------- */}
      <Panel>
        <SectionHeading>{t('people.editor.capabilities')}</SectionHeading>
        <Alert tone="info">{t('people.editor.capabilitiesNotice')}</Alert>

        <DataTable
          caption={t('people.editor.capabilitiesCaption')}
          columns={[
            t('people.editor.capability'),
            t('people.editor.capabilitySource'),
            t('people.editor.capabilityHeld'),
          ]}
        >
          {(
            Object.entries(CONTRIBUTOR_CAPABILITY_SOURCES) as readonly [
              keyof ContributorCapabilities,
              string,
            ][]
          ).map(([capability, source]) => (
            <DataRow key={capability}>
              <DataCell>
                {t(`people.capability.${capability}` as 'people.capability.canTeach')}
              </DataCell>
              <DataCell>
                <code className="text-xs">{source}</code>
              </DataCell>
              <DataCell>
                {/* NO CONTROL, DELIBERATELY. There is nothing to toggle: the
                    answer is a read of Identity's grants, and the only way to
                    change it is a RoleAssignment made on Identity's privileged
                    path (DOMAIN_MODEL.md §4.5). */}
                <StatusBadge
                  tone={capabilities?.[capability] === true ? 'positive' : 'neutral'}
                >
                  {capabilities?.[capability] === true
                    ? t('people.editor.capabilityYes')
                    : t('people.editor.capabilityNo')}
                </StatusBadge>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Panel>

      {/* ---- Profiles ----------------------------------------------------- */}
      <Panel>
        <SectionHeading>{t('people.editor.profiles')}</SectionHeading>
        <p className="pb-4 text-sm text-[color:var(--color-foreground-muted)]">
          {t('people.editor.profilesHelp')}
        </p>

        {PROFILE_KINDS.map((kind) => {
          const profile = detail.profiles.find((entry) => entry.kind === kind);
          if (profile === undefined) return null;

          return (
            <ProfileSection
              key={kind}
              detail={detail}
              profile={profile}
              kind={kind}
              locale={locale}
              mayAdminister={mayAdminister}
              messages={messages}
              t={t}
            />
          );
        })}

        {!mayAdminister || addable.length === 0 ? null : (
          <div className="border-t border-[color:var(--color-border)] pt-4">
            <h4 className="pb-2 text-sm font-semibold">{t('people.editor.addFacet')}</h4>
            <ActionForm
              action={createProfileAction}
              submitLabel={t('people.editor.addFacetSubmit')}
              pendingLabel={t('common.saving')}
              messages={messages}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="personId" value={detail.id} />

              <Field
                id="add-facet-kind"
                label={t('people.editor.addFacetField')}
                help={t('people.editor.addFacetHelp')}
              >
                {(props) => (
                  <Select {...props} name="kind" defaultValue={addable[0]}>
                    {addable.map((option) => (
                      <option key={option} value={option}>
                        {t(`people.kind.${option}` as 'people.kind.author')}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </ActionForm>
          </div>
        )}
      </Panel>
    </>
  );
}

/**
 * One facet's own lifecycle and, where the aggregate has them, its fields.
 *
 * AUTHOR AND SPEAKER GET NO FIELD CONTROLS, and the absence is the model rather
 * than an unfinished screen: DOMAIN_MODEL.md §5.2 names no field for either.
 * The note says so in words, because an empty section would read as something
 * missing.
 */
function ProfileSection({
  detail,
  profile,
  kind,
  locale,
  mayAdminister,
  messages,
  t,
}: {
  readonly detail: PersonDetail;
  readonly profile: ProfileRecordView;
  readonly kind: ProfileKind;
  readonly locale: Locale;
  readonly mayAdminister: boolean;
  readonly messages: Readonly<Record<string, string>>;
  readonly t: Translator;
}) {
  if (profile.id === null) return null;

  const hasDetail = kind === 'scholar' || kind === 'teacher';

  return (
    <section className="border-t border-[color:var(--color-border)] py-4">
      <h4 className="flex flex-wrap items-center gap-3 pb-2 text-sm font-semibold">
        {t(`people.kind.${kind}` as 'people.kind.author')}
        <StatusBadge tone={profile.status === 'active' ? 'positive' : 'neutral'}>
          {t(
            `people.profileStatus.${profile.status ?? 'draft'}` as 'people.profileStatus.draft',
          )}
        </StatusBadge>
      </h4>

      {/* NO HARD DELETE CONTROL. The runtime principal holds no DELETE on any
          profile table, so a removal control would be a button that cannot
          work; archiving is the lifecycle, and it keeps the record a later
          content domain may reference. */}
      {!mayAdminister ? null : (
        <ActionForm
          action={setProfileStatusAction}
          submitLabel={t('people.editor.facetStatusSubmit')}
          pendingLabel={t('common.saving')}
          messages={messages}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="personId" value={detail.id} />
          <input type="hidden" name="kind" value={kind} />

          <Field id={`facet-status-${kind}`} label={t('people.editor.facetStatusField')}>
            {(props) => (
              <Select {...props} name="status" defaultValue={profile.status ?? 'draft'}>
                {profileStatusSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {t(`people.profileStatus.${option}` as 'people.profileStatus.draft')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </ActionForm>
      )}

      {!hasDetail ? (
        <p className="pt-2 text-xs text-[color:var(--color-foreground-muted)]">
          {t('people.editor.facetNoFields')}
        </p>
      ) : (
        <>
          {LOCALES.map((contentLocale) => {
            const stored = profile.translations.find(
              (entry) => entry.locale === contentLocale,
            );

            if (!mayAdminister) {
              return null;
            }

            return (
              <div key={contentLocale} className="pt-4">
                <h5 className="pb-2 text-xs font-semibold uppercase">{contentLocale}</h5>
                <ActionForm
                  action={setProfileTranslationAction}
                  submitLabel={t('people.editor.facetDetailSubmit')}
                  pendingLabel={t('common.saving')}
                  messages={messages}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="personId" value={detail.id} />
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="contentLocale" value={contentLocale} />

                  {kind === 'scholar' ? (
                    <>
                      <Field
                        id={`qualifications-${contentLocale}`}
                        label={t('people.editor.qualifications')}
                        help={t('people.editor.qualificationsHelp')}
                      >
                        {(props) => (
                          <textarea
                            {...props}
                            name="qualifications"
                            rows={3}
                            maxLength={2000}
                            defaultValue={stored?.qualifications ?? ''}
                            className="w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2 text-base"
                          />
                        )}
                      </Field>
                      <Field
                        id={`expertise-${contentLocale}`}
                        label={t('people.editor.expertise')}
                      >
                        {(props) => (
                          <textarea
                            {...props}
                            name="expertise"
                            rows={3}
                            maxLength={2000}
                            defaultValue={stored?.expertise ?? ''}
                            className="w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2 text-base"
                          />
                        )}
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field
                        id={`profile-biography-${contentLocale}`}
                        label={t('people.editor.facetBiography')}
                        help={t('people.editor.facetBiographyHelp')}
                      >
                        {(props) => (
                          <textarea
                            {...props}
                            name="profileBiography"
                            rows={3}
                            maxLength={2000}
                            defaultValue={stored?.biography ?? ''}
                            className="w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2 text-base"
                          />
                        )}
                      </Field>
                      <Field
                        id={`subjects-${contentLocale}`}
                        label={t('people.editor.subjects')}
                        help={t('people.editor.subjectsHelp')}
                      >
                        {(props) => (
                          <textarea
                            {...props}
                            name="subjects"
                            rows={3}
                            maxLength={2000}
                            defaultValue={stored?.subjects ?? ''}
                            className="w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2 text-base"
                          />
                        )}
                      </Field>
                    </>
                  )}
                </ActionForm>
              </div>
            );
          })}

          {!mayAdminister ? null : (
            <div className="pt-4">
              <ActionForm
                action={setProfileLanguagesAction}
                submitLabel={t('people.editor.languagesSubmit')}
                pendingLabel={t('common.saving')}
                messages={messages}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="personId" value={detail.id} />
                <input type="hidden" name="kind" value={kind} />

                <Field
                  id={`languages-${kind}`}
                  label={t('people.editor.languages')}
                  help={t('people.editor.languagesHelp', { max: MAX_PROFILE_LANGUAGES })}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name="languages"
                      maxLength={400}
                      defaultValue={profile.languages.join(' ')}
                    />
                  )}
                </Field>
              </ActionForm>
            </div>
          )}
        </>
      )}
    </section>
  );
}
