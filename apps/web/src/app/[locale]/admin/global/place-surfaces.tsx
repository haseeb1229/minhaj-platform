import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  globalIdSchema,
  type CityRecord,
  type CountryRecord,
  type GlobalChoice,
  type PlaceLabel,
  type RegionRecord,
} from '@minhaj/contracts/global';

import { requireAdminPage } from '@/composition/authorization';
import { globalRuntime } from '@/composition/global';
import {
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { queryValue } from '../shared';
import { saveCity, saveCountry, saveRegion } from './actions';
import {
  ChoiceName,
  ChoiceOptions,
  choiceById,
  CommonFields,
  countryIndex,
  CountryStep,
  DirectoryFilter,
  directoryHref,
  directoryQuery,
  DirectoryTable,
  EditIdentity,
  EditorHeading,
  editorTarget,
  globalCopy,
  Pager,
  PlaceNameFields,
  withSelected,
  type Copy,
  type DirectoryItem,
  type EditorParams,
  type Level,
  type ListParams,
  type Query,
} from './surfaces';

/**
 * The Global Network directories and the Country, Region and City editors
 * (ROUTE_MAP.md §7), Phase 16. The Centre editor, with its contacts and served
 * Cities, is `./centre-surfaces.tsx`.
 *
 * A FLEXIBLE HIERARCHY, NOT A CHAIN. A Region and a City belong to ONE Country
 * from the moment they are created — the screen says so and shows the Country
 * as fixed text on edit, because the domain refuses a move. A City's Region is
 * optional and offered only from its own Country.
 */

/* ===========================================================================
 * Directories
 * ========================================================================= */

async function Directory(level: Level, { params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/global/${level}`;
  const context = await requireAdminPage(locale, 'global.read', base);
  const copy = await globalCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const filter = directoryQuery(query, level !== 'countries');
  const service = globalRuntime();

  const page =
    level === 'countries'
      ? await service.countries(actor, filter)
      : level === 'regions'
        ? await service.regions(actor, filter)
        : level === 'cities'
          ? await service.cities(actor, filter)
          : await service.centres(actor, filter);
  const items: readonly DirectoryItem[] = page.items;
  const countries =
    level === 'countries'
      ? null
      : await countryIndex(
          actor,
          items.flatMap((item) => (item.countryId === undefined ? [] : [item.countryId])),
        );
  const createHref =
    filter.countryId === null || level === 'countries'
      ? `${base}/new`
      : `${base}/new?country=${filter.countryId}`;

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t(`surface.${level}`)}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t(`scope.${level}`)}
      </p>
      {context.authorization.can('global.administer') ? (
        <p className="text-sm">
          <TextLink href={createHref}>{t(`create.${level}`)}</TextLink>
        </p>
      ) : null}
      <DirectoryFilter
        base={base}
        filter={filter}
        countries={countries?.choices ?? null}
        locale={locale}
        copy={copy}
      />
      <DirectoryTable
        level={level}
        locale={locale}
        items={items}
        countries={countries?.byId ?? null}
        copy={copy}
      />
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t(`surface.${level}`)}
        copy={copy}
      />
    </main>
  );
}

export function CountryDirectory(props: ListParams) {
  return Directory('countries', props);
}

export function RegionDirectory(props: ListParams) {
  return Directory('regions', props);
}

export function CityDirectory(props: ListParams) {
  return Directory('cities', props);
}

export function CentreDirectory(props: ListParams) {
  return Directory('centres', props);
}

/* ===========================================================================
 * Shared editor parts
 * ========================================================================= */

/** What a reader without `global.administer` sees in place of the form. */
function PlaceFacts({
  labels,
  copy,
  children,
}: {
  readonly labels: readonly PlaceLabel[];
  readonly copy: Copy;
  readonly children: ReactNode;
}) {
  const { t } = copy;
  return (
    <Panel>
      <div className="flex flex-col gap-2">
        <SectionHeading>{t('details')}</SectionHeading>
        <dl className="flex flex-col">
          {children}
          {localeSchema.options.map((language) => {
            const label = labels.find((entry) => entry.locale === language);
            return (
              <DetailRow
                key={language}
                term={t('nameIn', { language: t(`language.${language}`) })}
              >
                {label === undefined ? (
                  t('none')
                ) : (
                  <span lang={language} dir="auto">
                    {label.name}
                  </span>
                )}
              </DetailRow>
            );
          })}
        </dl>
      </div>
    </Panel>
  );
}

/** The common read-only rows: slug, primary language and state. */
function CommonFacts({
  record,
  copy,
}: {
  readonly record: { readonly slug: string; readonly primaryLocale: Locale };
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <DetailRow term={t('slug')}>
        <span dir="ltr">{record.slug}</span>
      </DetailRow>
      <DetailRow term={t('primaryLocale')}>
        {t(`language.${record.primaryLocale}`)}
      </DetailRow>
    </>
  );
}

/** A Country shown as fixed text, carried by a hidden field, with the reason. */
function FixedCountry({
  country,
  countryId,
  locale,
  copy,
}: {
  readonly country: GlobalChoice | undefined;
  readonly countryId: string;
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name="countryId" value={countryId} />
      <p className="text-sm font-medium">{t('country')}</p>
      <p className="text-base">
        <ChoiceName choice={country} locale={locale} copy={copy} />
      </p>
      <p className="text-xs text-[color:var(--color-foreground-muted)]">
        {t('countryFixedHelp')}
      </p>
    </div>
  );
}

/** A valid Country identifier from the query, or `null`. */
function queryCountry(query: Query): string | null {
  const parsed = globalIdSchema.safeParse(queryValue(query, 'country'));
  return parsed.success ? parsed.data : null;
}

/* ===========================================================================
 * Country
 * ========================================================================= */

function CountryForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: CountryRecord | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-country' : 'country';
  return (
    <ActionForm
      action={saveCountry}
      submitLabel={record === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <Field id={`${prefix}-code`} label={t('code')} help={t('codeHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="code"
            required
            defaultValue={record?.code ?? ''}
            minLength={2}
            maxLength={2}
            autoCapitalize="characters"
            autoComplete="off"
            dir="ltr"
          />
        )}
      </Field>
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />
      <PlaceNameFields prefix={prefix} record={record} copy={copy} />
    </ActionForm>
  );
}

export async function CountryEditor({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const id = editorTarget((await params).id);
  const base = `/${locale}/admin/global/countries`;
  const context = await requireAdminPage(locale, 'global.read', `${base}/${id}`);
  const copy = await globalCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('global.administer');

  const record =
    id === 'new'
      ? null
      : await globalRuntime()
          .country(actor, id)
          .catch(() => null);
  if ((id !== 'new' && record === null) || (record === null && !administer)) notFound();

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={base}
        locale={locale}
        record={record}
        title={t('create.countries')}
        copy={copy}
      >
        {record === null ? null : (
          <span>
            {t('code')}: <span dir="ltr">{record.code}</span>
          </span>
        )}
      </EditorHeading>
      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>
              {record === null ? t('create.countries') : t('edit')}
            </SectionHeading>
            <CountryForm locale={locale} record={record} copy={copy} />
          </div>
        </Panel>
      ) : record === null ? null : (
        <PlaceFacts labels={record.labels} copy={copy}>
          <DetailRow term={t('code')}>
            <span dir="ltr">{record.code}</span>
          </DetailRow>
          <CommonFacts record={record} copy={copy} />
        </PlaceFacts>
      )}
    </main>
  );
}

/* ===========================================================================
 * Region
 * ========================================================================= */

function RegionForm({
  locale,
  record,
  countries,
  country,
  preselected,
  copy,
}: {
  readonly locale: Locale;
  readonly record: RegionRecord | null;
  /** Offered on creation only. */
  readonly countries: readonly GlobalChoice[];
  /** The Region's own Country, on edit. */
  readonly country: GlobalChoice | undefined;
  readonly preselected: string | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-region' : 'region';
  return (
    <ActionForm
      action={saveRegion}
      submitLabel={record === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      {record === null ? (
        <Field
          id={`${prefix}-country`}
          label={t('country')}
          help={t('regionCountryHelp')}
        >
          {(props) => (
            <Select {...props} name="countryId" required defaultValue={preselected ?? ''}>
              <option value="">{t('chooseCountry')}</option>
              <ChoiceOptions choices={countries} locale={locale} copy={copy} />
            </Select>
          )}
        </Field>
      ) : (
        <FixedCountry
          country={country}
          countryId={record.countryId}
          locale={locale}
          copy={copy}
        />
      )}
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />
      <PlaceNameFields prefix={prefix} record={record} copy={copy} />
    </ActionForm>
  );
}

export async function RegionEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = editorTarget((await params).id);
  const query = await searchParams;
  const base = `/${locale}/admin/global/regions`;
  const context = await requireAdminPage(locale, 'global.read', `${base}/${id}`);
  const copy = await globalCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('global.administer');

  const record =
    id === 'new'
      ? null
      : await globalRuntime()
          .region(actor, id)
          .catch(() => null);
  if ((id !== 'new' && record === null) || (record === null && !administer)) notFound();

  const [countries, country] = await Promise.all([
    record === null ? globalRuntime().countryChoices(actor) : Promise.resolve([]),
    record === null
      ? Promise.resolve(undefined)
      : choiceById(actor, 'country', record.countryId),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={base}
        locale={locale}
        record={record}
        title={t('create.regions')}
        copy={copy}
      />
      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>
              {record === null ? t('create.regions') : t('edit')}
            </SectionHeading>
            {record === null && countries.length === 0 ? (
              <CountryStep
                action={`${base}/new`}
                countries={countries}
                selected={null}
                locale={locale}
                copy={copy}
                help={t('regionCountryHelp')}
              />
            ) : (
              <RegionForm
                locale={locale}
                record={record}
                countries={countries}
                country={country}
                preselected={queryCountry(query)}
                copy={copy}
              />
            )}
          </div>
        </Panel>
      ) : record === null ? null : (
        <PlaceFacts labels={record.labels} copy={copy}>
          <DetailRow term={t('country')}>
            <ChoiceName choice={country} locale={locale} copy={copy} />
          </DetailRow>
          <CommonFacts record={record} copy={copy} />
        </PlaceFacts>
      )}
    </main>
  );
}

/* ===========================================================================
 * City
 * ========================================================================= */

function CityForm({
  locale,
  record,
  country,
  countryId,
  regions,
  copy,
}: {
  readonly locale: Locale;
  readonly record: CityRecord | null;
  readonly country: GlobalChoice | undefined;
  readonly countryId: string;
  readonly regions: readonly GlobalChoice[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-city' : 'city';
  return (
    <ActionForm
      action={saveCity}
      submitLabel={record === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <FixedCountry country={country} countryId={countryId} locale={locale} copy={copy} />
      <Field
        id={`${prefix}-region`}
        label={t('regionOptional')}
        help={t('cityRegionHelp')}
      >
        {(props) => (
          <Select {...props} name="regionId" defaultValue={record?.regionId ?? ''}>
            <option value="">{t('noRegion')}</option>
            <ChoiceOptions choices={regions} locale={locale} copy={copy} />
          </Select>
        )}
      </Field>
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />
      <PlaceNameFields prefix={prefix} record={record} copy={copy} />
    </ActionForm>
  );
}

export async function CityEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = editorTarget((await params).id);
  const query = await searchParams;
  const base = `/${locale}/admin/global/cities`;
  const context = await requireAdminPage(locale, 'global.read', `${base}/${id}`);
  const copy = await globalCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('global.administer');
  const service = globalRuntime();

  const record = id === 'new' ? null : await service.city(actor, id).catch(() => null);
  if ((id !== 'new' && record === null) || (record === null && !administer)) notFound();

  // On creation the Country is chosen first, through the query; on edit it is
  // the City's own and cannot change.
  const countryId = record?.countryId ?? queryCountry(query);
  const [country, countries] = await Promise.all([
    choiceById(actor, 'country', countryId),
    record === null ? service.countryChoices(actor) : Promise.resolve([]),
  ]);
  const [regions, currentRegion] =
    country === undefined
      ? [[], undefined]
      : await Promise.all([
          service.regionChoices(actor, country.id),
          choiceById(actor, 'region', record?.regionId ?? null),
        ]);
  const offered = withSelected(
    regions,
    currentRegion === undefined ? [] : [currentRegion],
  );

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={base}
        locale={locale}
        record={record}
        title={t('create.cities')}
        copy={copy}
      />
      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>
              {record === null ? t('create.cities') : t('edit')}
            </SectionHeading>
            {record === null ? (
              <CountryStep
                action={`${base}/new`}
                countries={countries}
                selected={country?.id ?? null}
                locale={locale}
                copy={copy}
                help={t('cityCountryStepHelp')}
              />
            ) : null}
            {country === undefined ? null : (
              <CityForm
                locale={locale}
                record={record}
                country={country}
                countryId={country.id}
                regions={offered}
                copy={copy}
              />
            )}
          </div>
        </Panel>
      ) : record === null ? null : (
        <PlaceFacts labels={record.labels} copy={copy}>
          <DetailRow term={t('country')}>
            <ChoiceName choice={country} locale={locale} copy={copy} />
          </DetailRow>
          <DetailRow term={t('region')}>
            {currentRegion === undefined ? (
              t('noRegion')
            ) : (
              <ChoiceName choice={currentRegion} locale={locale} copy={copy} />
            )}
          </DetailRow>
          <CommonFacts record={record} copy={copy} />
        </PlaceFacts>
      )}
      {record === null && country === undefined && countries.length > 0 ? (
        <EmptyState>{t('chooseCountryFirst')}</EmptyState>
      ) : null}
    </main>
  );
}
