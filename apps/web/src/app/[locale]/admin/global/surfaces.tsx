import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  GLOBAL_ADMIN_PAGE,
  GLOBAL_LIMITS,
  globalIdSchema,
  globalStateSchema,
  labelFor,
  type GlobalAdminQuery,
  type GlobalChoice,
  type GlobalState,
  type PlaceLabel,
} from '@minhaj/contracts/global';

import { globalRuntime } from '@/composition/global';
import {
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { pageOffset, queryValue } from '../shared';

/**
 * The parts every Global Network administration screen shares — Countries,
 * Regions, Cities and Centres (ROUTE_MAP.md §7: `/admin/global/*`).
 *
 * THE SAME CONVENTIONS AS THE MEDIA ADMINISTRATION. `global.read` opens a
 * screen and `global.administer` is what every action re-checks, live; every
 * form carries its record's expected version, so a stale save is a visible
 * conflict rather than a silent overwrite.
 *
 * NAMES, NOT IDENTIFIERS. A parent is chosen from its Country, Region or City
 * NAME, and a parent that has since been archived or never published is still
 * shown, with its state in words, rather than silently cleared.
 */

export type Query = Record<string, string | string[] | undefined>;

export interface ListParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}

export interface EditorParams {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}

export type Level = 'countries' | 'regions' | 'cities' | 'centres';

export interface GlobalActor {
  readonly accountId: string;
}

/** The copy every Global screen needs, and a message for every refusal. */
export async function globalCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'admin.global' });
  return {
    t,
    messages: {
      success: t('saved'),
      denied: t('denied'),
      invalid: t('invalid'),
      conflict: t('conflict'),
      'not-found': t('notFound'),
      'duplicate-slug': t('duplicateSlug'),
      'duplicate-code': t('duplicateCode'),
      'duplicate-contact': t('duplicateContact'),
      'duplicate-city': t('duplicateCity'),
      limit: t('limit'),
      'country-fixed': t('countryFixed'),
      'served-cities': t('servedCities'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type Copy = Awaited<ReturnType<typeof globalCopy>>;

/** `new` creates; otherwise the segment must be an identifier, or it is a 404. */
export function editorTarget(id: string): string {
  if (id === 'new' || globalIdSchema.safeParse(id).success) return id;
  notFound();
}

/* ===========================================================================
 * Names and states
 * ========================================================================= */

export function StateBadge({
  state,
  copy,
}: {
  readonly state: GlobalState;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge
      tone={
        state === 'published' ? 'positive' : state === 'archived' ? 'caution' : 'neutral'
      }
    >
      {copy.t(`stateName.${state}`)}
    </StatusBadge>
  );
}

/** A record's name in the reader's language where it has one, marked with its own. */
export function Name({
  record,
  locale,
  copy,
}: {
  readonly record: {
    readonly labels: readonly { readonly locale: Locale; readonly name: string }[];
    readonly primaryLocale: Locale;
    readonly slug: string;
  };
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  const label = labelFor(record, locale);
  if (label === null)
    return (
      <span>
        {copy.t('unnamed')} <span dir="ltr">({record.slug})</span>
      </span>
    );
  return (
    <span lang={label.locale} dir="auto">
      {label.name}
    </span>
  );
}

/** A choice as one line of option text: its name, and its state when not public. */
export function choiceText(choice: GlobalChoice, locale: Locale, copy: Copy): string {
  const name = labelFor(choice, locale)?.name ?? choice.slug;
  if (choice.state === 'published') return name;
  return `${name} ${copy.t(choice.state === 'draft' ? 'choiceDraft' : 'choiceArchived')}`;
}

/** A named choice in running text, with its state in words when not public. */
export function ChoiceName({
  choice,
  locale,
  copy,
}: {
  readonly choice: GlobalChoice | undefined;
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  if (choice === undefined) return <span>{copy.t('none')}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Name record={choice} locale={locale} copy={copy} />
      {choice.state === 'published' ? null : (
        <StateBadge state={choice.state} copy={copy} />
      )}
    </span>
  );
}

export function ChoiceOptions({
  choices,
  locale,
  copy,
}: {
  readonly choices: readonly GlobalChoice[];
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  return (
    <>
      {choices.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choiceText(choice, locale, copy)}
        </option>
      ))}
    </>
  );
}

/** The currently selected choices stay offered even when off the bounded list. */
export function withSelected(
  options: readonly GlobalChoice[],
  selected: readonly GlobalChoice[],
): readonly GlobalChoice[] {
  const missing = selected.filter(
    (choice) => !options.some((option) => option.id === choice.id),
  );
  return missing.length === 0 ? options : [...missing, ...options];
}

/**
 * The Countries a screen names, by identifier: the bounded selector list, and
 * any named Country beyond it read by identifier — so a parent is always shown.
 */
export async function countryIndex(actor: GlobalActor, named: readonly string[]) {
  const service = globalRuntime();
  const choices = await service.countryChoices(actor);
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  const missing = [...new Set(named)].filter((id) => !byId.has(id)).slice(0, 50);
  if (missing.length > 0)
    for (const choice of await service.choicesByIds(actor, 'country', missing))
      byId.set(choice.id, choice);
  return { choices, byId: byId as ReadonlyMap<string, GlobalChoice> };
}

/** One choice by identifier, in any state, or `undefined`. */
export async function choiceById(
  actor: GlobalActor,
  level: 'country' | 'region' | 'city',
  id: string | null,
): Promise<GlobalChoice | undefined> {
  if (id === null || !globalIdSchema.safeParse(id).success) return undefined;
  const [found] = await globalRuntime().choicesByIds(actor, level, [id]);
  return found;
}

export function UpdatedAt({
  date,
  locale,
}: {
  readonly date: Date;
  readonly locale: Locale;
}) {
  return (
    <time dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        date,
      )}
    </time>
  );
}

/* ===========================================================================
 * Directories
 * ========================================================================= */

/** The directory filter read back from the query, bounded to what the schema accepts. */
export function directoryQuery(query: Query, byCountry: boolean): GlobalAdminQuery {
  const state = globalStateSchema.safeParse(queryValue(query, 'state'));
  const text = queryValue(query, 'text');
  const country = globalIdSchema.safeParse(queryValue(query, 'country'));
  return {
    offset: pageOffset(query, GLOBAL_ADMIN_PAGE),
    state: state.success ? state.data : null,
    text: text !== null && text.length <= 120 ? text : null,
    countryId: byCountry && country.success ? country.data : null,
  };
}

export function directoryHref(
  base: string,
  filter: GlobalAdminQuery,
): (page: number) => string {
  return (page) => {
    const search = new URLSearchParams();
    if (page > 1) search.set('page', String(page));
    if (filter.state !== null) search.set('state', filter.state);
    if (filter.text !== null) search.set('text', filter.text);
    if (filter.countryId !== null) search.set('country', filter.countryId);
    const encoded = search.toString();
    return encoded === '' ? base : `${base}?${encoded}`;
  };
}

export function Pager({
  offset,
  hasMore,
  hrefFor,
  label,
  copy,
}: {
  readonly offset: number;
  readonly hasMore: boolean;
  readonly hrefFor: (page: number) => string;
  readonly label: string;
  readonly copy: Copy;
}) {
  if (offset === 0 && !hasMore) return null;
  const current = offset / GLOBAL_ADMIN_PAGE + 1;
  return (
    <nav className="flex gap-6" aria-label={label}>
      {offset > 0 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
}

const SUBMIT_CLASSES =
  'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium';

/** A narrowing GET form: a state, a name or slug, and — below Country — a Country. */
export function DirectoryFilter({
  base,
  filter,
  countries,
  locale,
  copy,
}: {
  readonly base: string;
  readonly filter: GlobalAdminQuery;
  /** `null` for the Country directory, which has no parent to narrow by. */
  readonly countries: readonly GlobalChoice[] | null;
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <form method="get" action={base} className="flex flex-wrap items-end gap-3">
      <Field id="state-filter" label={t('state')}>
        {(props) => (
          <Select {...props} name="state" defaultValue={filter.state ?? ''}>
            <option value="">{t('allStates')}</option>
            {globalStateSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`stateName.${option}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {countries === null ? null : (
        <Field id="country-filter" label={t('country')}>
          {(props) => (
            <Select {...props} name="country" defaultValue={filter.countryId ?? ''}>
              <option value="">{t('allCountries')}</option>
              <ChoiceOptions choices={countries} locale={locale} copy={copy} />
            </Select>
          )}
        </Field>
      )}
      <Field id="text-filter" label={t('textFilter')}>
        {(props) => (
          <TextInput
            {...props}
            name="text"
            defaultValue={filter.text ?? ''}
            maxLength={120}
          />
        )}
      </Field>
      <button type="submit" className={SUBMIT_CLASSES}>
        {t('filterApply')}
      </button>
    </form>
  );
}

/** One directory row's facts, whatever the level. */
export interface DirectoryItem {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: GlobalState;
  readonly labels: readonly { readonly locale: Locale; readonly name: string }[];
  readonly updatedAt: Date;
  readonly countryId?: string;
  readonly code?: string;
  readonly isVirtual?: boolean;
}

export function DirectoryTable({
  level,
  locale,
  items,
  countries,
  copy,
}: {
  readonly level: Level;
  readonly locale: Locale;
  readonly items: readonly DirectoryItem[];
  readonly countries: ReadonlyMap<string, GlobalChoice> | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  if (items.length === 0) return <EmptyState>{t('empty')}</EmptyState>;
  return (
    <DataTable
      caption={t(`surface.${level}`)}
      columns={[
        t('name'),
        t('slug'),
        ...(level === 'countries' ? [t('code')] : [t('country')]),
        t('state'),
        t('updated'),
      ]}
    >
      {items.map((item) => (
        <DataRow key={item.id}>
          <DataCell wrap>
            <span className="inline-flex flex-wrap items-center gap-2">
              <TextLink href={`/${locale}/admin/global/${level}/${item.id}`}>
                <Name record={item} locale={locale} copy={copy} />
              </TextLink>
              {item.isVirtual === true ? (
                <StatusBadge tone="neutral">{t('virtualBadge')}</StatusBadge>
              ) : null}
            </span>
          </DataCell>
          <DataCell wrap>
            <span dir="ltr">{item.slug}</span>
          </DataCell>
          <DataCell>
            {level === 'countries' ? (
              <span dir="ltr">{item.code}</span>
            ) : (
              <ChoiceName
                choice={
                  item.countryId === undefined
                    ? undefined
                    : countries?.get(item.countryId)
                }
                locale={locale}
                copy={copy}
              />
            )}
          </DataCell>
          <DataCell>
            <StateBadge state={item.state} copy={copy} />
          </DataCell>
          <DataCell>
            <UpdatedAt date={item.updatedAt} locale={locale} />
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

/* ===========================================================================
 * Forms
 * ========================================================================= */

/** The hidden fields that make an edit an edit: its record and expected version. */
export function EditIdentity({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: { readonly id: string; readonly version: number } | null;
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}
    </>
  );
}

/** Slug, primary locale and lifecycle — the fields every Global record has. */
export function CommonFields({
  prefix,
  locale,
  record,
  copy,
}: {
  readonly prefix: string;
  readonly locale: Locale;
  readonly record: {
    readonly slug: string;
    readonly primaryLocale: Locale;
    readonly state: GlobalState;
  } | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <Field id={`${prefix}-slug`} label={t('slug')} help={t('slugHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="slug"
            required
            defaultValue={record?.slug ?? ''}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={120}
            dir="ltr"
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-primary`}
          label={t('primaryLocale')}
          help={t('primaryLocaleHelp')}
        >
          {(props) => (
            <Select
              {...props}
              name="primaryLocale"
              defaultValue={record?.primaryLocale ?? locale}
            >
              {localeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`language.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${prefix}-state`} label={t('state')} help={t('stateHelp')}>
          {(props) => (
            <Select {...props} name="state" defaultValue={record?.state ?? 'draft'}>
              {globalStateSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`stateName.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </>
  );
}

/** A place's name in each interface language; an empty row gives no name in it. */
export function PlaceNameFields({
  prefix,
  record,
  copy,
}: {
  readonly prefix: string;
  readonly record: { readonly labels: readonly PlaceLabel[] } | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-sm font-semibold">{t('names')}</legend>
      <p className="text-xs text-[color:var(--color-foreground-muted)]">
        {t('namesHelp')}
      </p>
      {localeSchema.options.map((language) => (
        <Field
          key={language}
          id={`${prefix}-name-${language}`}
          label={t('nameIn', { language: t(`language.${language}`) })}
        >
          {(props) => (
            <TextInput
              {...props}
              name={`name-${language}`}
              defaultValue={
                record?.labels.find((label) => label.locale === language)?.name ?? ''
              }
              maxLength={GLOBAL_LIMITS.placeName}
              lang={language}
              dir={directionOf(language)}
            />
          )}
        </Field>
      ))}
    </fieldset>
  );
}

/** The heading block of an editor: back link, name, state, version and update. */
export function EditorHeading({
  base,
  locale,
  record,
  title,
  copy,
  children,
}: {
  readonly base: string;
  readonly locale: Locale;
  readonly record: {
    readonly slug: string;
    readonly primaryLocale: Locale;
    readonly state: GlobalState;
    readonly version: number;
    readonly updatedAt: Date;
    readonly labels: readonly { readonly locale: Locale; readonly name: string }[];
  } | null;
  readonly title: string;
  readonly copy: Copy;
  readonly children?: ReactNode;
}) {
  const { t } = copy;
  return (
    <>
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          {record === null ? title : <Name record={record} locale={locale} copy={copy} />}
        </PageHeading>
        {record === null ? null : (
          <p className="flex flex-wrap items-center gap-3 text-sm">
            <StateBadge state={record.state} copy={copy} />
            <span>
              {t('version')}: {record.version}
            </span>
            <span>
              {t('updated')}: <UpdatedAt date={record.updatedAt} locale={locale} />
            </span>
            {children}
          </p>
        )}
      </div>
    </>
  );
}

/** A narrowing GET form for the City lists, beside — never inside — a save form. */
export function CitySearch({
  query,
  country,
  copy,
}: {
  readonly query: string;
  /** The Country chosen through the query, kept so a search does not lose it. */
  readonly country: string | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <div className="flex flex-col gap-2">
      <form method="get" className="flex flex-wrap items-end gap-3">
        {country === null ? null : <input type="hidden" name="country" value={country} />}
        <Field id="city-search" label={t('citySearch')}>
          {(props) => (
            <TextInput {...props} name="q" defaultValue={query} maxLength={120} />
          )}
        </Field>
        <button type="submit" className={SUBMIT_CLASSES}>
          {t('citySearchSubmit')}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('citySearchHelp')}
      </p>
    </div>
  );
}

/**
 * The first step of creating a City or a Centre, or of moving a Centre: a GET
 * form that reloads the page with that Country's Regions and Cities. No script.
 */
export function CountryStep({
  action,
  countries,
  selected,
  locale,
  copy,
  help,
}: {
  readonly action: string;
  readonly countries: readonly GlobalChoice[];
  readonly selected: string | null;
  readonly locale: Locale;
  readonly copy: Copy;
  readonly help: string;
}) {
  const { t } = copy;
  if (countries.length === 0)
    return (
      <EmptyState>
        {t('countryNone')}{' '}
        <TextLink href={`/${locale}/admin/global/countries/new`}>
          {t('create.countries')}
        </TextLink>
      </EmptyState>
    );
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      <Field id="country-step" label={t('country')} help={help}>
        {(props) => (
          <Select {...props} name="country" required defaultValue={selected ?? ''}>
            <option value="">{t('chooseCountry')}</option>
            <ChoiceOptions choices={countries} locale={locale} copy={copy} />
          </Select>
        )}
      </Field>
      <button type="submit" className={SUBMIT_CLASSES}>
        {t('chooseCountrySubmit')}
      </button>
    </form>
  );
}
