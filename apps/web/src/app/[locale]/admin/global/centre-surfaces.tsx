import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  CONTACT_CHANNELS,
  GLOBAL_LIMITS,
  globalIdSchema,
  type CentreDetail,
  type GlobalChoice,
} from '@minhaj/contracts/global';

import { requireAdminPage } from '@/composition/authorization';
import { globalRuntime } from '@/composition/global';
import {
  Alert,
  DetailRow,
  EmptyState,
  Field,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { queryValue } from '../shared';
import { changeCentreContacts, changeCentreServedCities, saveCentre } from './actions';
import {
  ChoiceName,
  ChoiceOptions,
  choiceById,
  CitySearch,
  CommonFields,
  CountryStep,
  EditIdentity,
  EditorHeading,
  editorTarget,
  globalCopy,
  Name,
  StateBadge,
  withSelected,
  type Copy,
  type EditorParams,
} from './surfaces';

/**
 * The Centre editor (ROUTE_MAP.md §7: `/admin/global/centres/{id}`), Phase 16 —
 * its place, its words, its public contacts and the Cities it serves.
 *
 * ONE LOCALITY FACT. A Centre names a City, or — only with no City — a Region,
 * or neither; the form offers both as separate optional choices and says so,
 * and the domain refuses both at once. A VIRTUAL Centre is one an operator
 * marks so, never one inferred from a missing address.
 *
 * NAMED CHANGES. Contacts and served Cities change one at a time, each its own
 * small form carrying the Centre's expected version — never a list the browser
 * supplies — so a stale page cannot drop what somebody else just added.
 *
 * PUBLIC CONTACT VALUES ARE LEFT-TO-RIGHT DATA. A telephone number, an email
 * address and a web address are shown `dir="ltr"` inside right-to-left pages,
 * and exactly as recorded.
 */

/* ===========================================================================
 * Centre form
 * ========================================================================= */

function CentreForm({
  locale,
  record,
  country,
  cities,
  regions,
  sameCountry,
  copy,
}: {
  readonly locale: Locale;
  readonly record: CentreDetail | null;
  readonly country: GlobalChoice;
  readonly cities: readonly GlobalChoice[];
  readonly regions: readonly GlobalChoice[];
  /** Whether the Centre's recorded locality belongs to the Country offered. */
  readonly sameCountry: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-centre' : 'centre';
  return (
    <ActionForm
      action={saveCentre}
      submitLabel={record === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <input type="hidden" name="countryId" value={country.id} />
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t('country')}</p>
        <p className="text-base">
          <ChoiceName choice={country} locale={locale} copy={copy} />
        </p>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-4">
        <legend className="px-1 text-sm font-semibold">{t('locality')}</legend>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('localityHelp')}
        </p>
        <Field id={`${prefix}-city`} label={t('cityOptional')} help={t('centreCityHelp')}>
          {(props) => (
            <Select
              {...props}
              name="cityId"
              defaultValue={sameCountry ? (record?.cityId ?? '') : ''}
            >
              <option value="">{t('noCity')}</option>
              <ChoiceOptions choices={cities} locale={locale} copy={copy} />
            </Select>
          )}
        </Field>
        <Field
          id={`${prefix}-region`}
          label={t('regionOnly')}
          help={t('centreRegionHelp')}
        >
          {(props) => (
            <Select
              {...props}
              name="regionId"
              defaultValue={sameCountry ? (record?.regionId ?? '') : ''}
            >
              <option value="">{t('noRegion')}</option>
              <ChoiceOptions choices={regions} locale={locale} copy={copy} />
            </Select>
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="isVirtual"
              defaultChecked={record?.isVirtual ?? false}
              aria-describedby={`${prefix}-virtual-help`}
              className="size-5"
            />
            {t('virtual')}
          </label>
          <p
            id={`${prefix}-virtual-help`}
            className="text-xs text-[color:var(--color-foreground-muted)]"
          >
            {t('virtualHelp')}
          </p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-4">
        <legend className="px-1 text-sm font-semibold">{t('coordinates')}</legend>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('coordinatesHelp')}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${prefix}-latitude`} label={t('latitude')}>
            {(props) => (
              <TextInput
                {...props}
                name="latitude"
                inputMode="decimal"
                autoComplete="off"
                maxLength={12}
                defaultValue={record?.coordinates?.latitude ?? ''}
                dir="ltr"
              />
            )}
          </Field>
          <Field id={`${prefix}-longitude`} label={t('longitude')}>
            {(props) => (
              <TextInput
                {...props}
                name="longitude"
                inputMode="decimal"
                autoComplete="off"
                maxLength={12}
                defaultValue={record?.coordinates?.longitude ?? ''}
                dir="ltr"
              />
            )}
          </Field>
        </div>
      </fieldset>

      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />

      <SectionHeading>{t('centreWords')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('centreWordsHelp')}
      </p>
      {localeSchema.options.map((language) => {
        const existing = record?.labels.find((label) => label.locale === language);
        const dir = directionOf(language);
        const heading = t(`language.${language}`);
        return (
          <Panel key={language}>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-semibold">{heading}</legend>
              <Field
                id={`${prefix}-name-${language}`}
                label={t('nameIn', { language: heading })}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name={`name-${language}`}
                    defaultValue={existing?.name ?? ''}
                    maxLength={GLOBAL_LIMITS.centreName}
                    lang={language}
                    dir={dir}
                  />
                )}
              </Field>
              <Field
                id={`${prefix}-description-${language}`}
                label={t('description')}
                help={t('descriptionHelp')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name={`description-${language}`}
                    defaultValue={existing?.description ?? ''}
                    maxLength={GLOBAL_LIMITS.description}
                    rows={4}
                    lang={language}
                    dir={dir}
                  />
                )}
              </Field>
              <Field
                id={`${prefix}-address-${language}`}
                label={t('address')}
                help={t('addressHelp')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name={`address-${language}`}
                    defaultValue={existing?.address ?? ''}
                    maxLength={GLOBAL_LIMITS.address}
                    rows={3}
                    lang={language}
                    dir={dir}
                  />
                )}
              </Field>
            </fieldset>
          </Panel>
        );
      })}
    </ActionForm>
  );
}

/** What a reader without `global.administer` sees in place of the form. */
function CentreFacts({
  locale,
  record,
  country,
  city,
  region,
  copy,
}: {
  readonly locale: Locale;
  readonly record: CentreDetail;
  readonly country: GlobalChoice | undefined;
  readonly city: GlobalChoice | undefined;
  readonly region: GlobalChoice | undefined;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <Panel>
      <div className="flex flex-col gap-2">
        <SectionHeading>{t('details')}</SectionHeading>
        <dl className="flex flex-col">
          <DetailRow term={t('country')}>
            <ChoiceName choice={country} locale={locale} copy={copy} />
          </DetailRow>
          <DetailRow term={t('city')}>
            {city === undefined ? (
              t('noCity')
            ) : (
              <ChoiceName choice={city} locale={locale} copy={copy} />
            )}
          </DetailRow>
          {/* A Centre with a City takes its Region from that City. */}
          {city === undefined ? (
            <DetailRow term={t('region')}>
              {region === undefined ? (
                t('noRegion')
              ) : (
                <ChoiceName choice={region} locale={locale} copy={copy} />
              )}
            </DetailRow>
          ) : null}
          <DetailRow term={t('virtual')}>
            {record.isVirtual ? t('yes') : t('no')}
          </DetailRow>
          <DetailRow term={t('coordinates')}>
            {record.coordinates === null ? (
              t('none')
            ) : (
              <span dir="ltr">
                {record.coordinates.latitude}, {record.coordinates.longitude}
              </span>
            )}
          </DetailRow>
          <DetailRow term={t('slug')}>
            <span dir="ltr">{record.slug}</span>
          </DetailRow>
          <DetailRow term={t('primaryLocale')}>
            {t(`language.${record.primaryLocale}`)}
          </DetailRow>
          {record.labels.map((label) => (
            <DetailRow
              key={label.locale}
              term={t('nameIn', { language: t(`language.${label.locale}`) })}
            >
              <span className="flex flex-col gap-1" lang={label.locale} dir="auto">
                <span>{label.name}</span>
                {label.description === null ? null : (
                  <span className="whitespace-pre-line">{label.description}</span>
                )}
                {label.address === null ? null : (
                  <span className="whitespace-pre-line">{label.address}</span>
                )}
              </span>
            </DetailRow>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

/* ===========================================================================
 * Contacts
 * ========================================================================= */

/** One named contact change, as its own small form. */
function ContactChange({
  locale,
  centre,
  position,
  op,
  direction,
  label,
  copy,
  tone = 'secondary',
}: {
  readonly locale: Locale;
  readonly centre: CentreDetail;
  readonly position: number;
  readonly op: 'remove' | 'move';
  readonly direction?: 'earlier' | 'later';
  readonly label: string;
  readonly copy: Copy;
  readonly tone?: 'secondary' | 'destructive';
}) {
  return (
    <ActionForm
      action={changeCentreContacts}
      submitLabel={label}
      pendingLabel={copy.t('pending')}
      messages={copy.messages}
      tone={tone}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="centreId" value={centre.id} />
      <input type="hidden" name="version" value={String(centre.version)} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="position" value={String(position)} />
      {direction === undefined ? null : (
        <input type="hidden" name="direction" value={direction} />
      )}
    </ActionForm>
  );
}

function Contacts({
  locale,
  record,
  administer,
  copy,
}: {
  readonly locale: Locale;
  readonly record: CentreDetail;
  readonly administer: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const last = record.contacts.length - 1;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="centre-contacts">
      <SectionHeading>
        <span id="centre-contacts">{t('contacts')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('contactsHelp', {
          count: String(record.contacts.length),
          limit: String(GLOBAL_LIMITS.contacts),
        })}
      </p>
      {record.contacts.length === 0 ? (
        <EmptyState>{t('contactsEmpty')}</EmptyState>
      ) : (
        <ol aria-labelledby="centre-contacts" className="flex flex-col gap-3">
          {record.contacts.map((contact, index) => (
            <Panel key={`${contact.channel}-${contact.value}`} as="li">
              <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="text-[color:var(--color-foreground-muted)]">
                    {t('position', { number: index + 1 })}
                  </span>
                  <span className="font-medium">
                    {t(`channelName.${contact.channel}`)}
                  </span>
                  <span dir="ltr" className="break-all">
                    {contact.value}
                  </span>
                </p>
                {administer ? (
                  <div className="flex flex-wrap gap-2">
                    {index === 0 ? null : (
                      <ContactChange
                        locale={locale}
                        centre={record}
                        position={index}
                        op="move"
                        direction="earlier"
                        label={t('moveEarlier')}
                        copy={copy}
                      />
                    )}
                    {index === last ? null : (
                      <ContactChange
                        locale={locale}
                        centre={record}
                        position={index}
                        op="move"
                        direction="later"
                        label={t('moveLater')}
                        copy={copy}
                      />
                    )}
                    <ContactChange
                      locale={locale}
                      centre={record}
                      position={index}
                      op="remove"
                      label={t('remove')}
                      copy={copy}
                      tone="destructive"
                    />
                  </div>
                ) : null}
              </div>
            </Panel>
          ))}
        </ol>
      )}

      {!administer ? null : record.contacts.length >= GLOBAL_LIMITS.contacts ? (
        <Alert tone="info">{t('contactsFull')}</Alert>
      ) : (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('addContact')}</SectionHeading>
            <ActionForm
              action={changeCentreContacts}
              submitLabel={t('addContactSubmit')}
              pendingLabel={t('pending')}
              messages={copy.messages}
              preserveInput
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="centreId" value={record.id} />
              <input type="hidden" name="version" value={String(record.version)} />
              <input type="hidden" name="op" value="add" />
              <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                <Field id="contact-channel" label={t('channel')}>
                  {(props) => (
                    <Select {...props} name="channel" defaultValue="phone">
                      {CONTACT_CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {t(`channelName.${channel}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  id="contact-value"
                  label={t('contactValue')}
                  help={t('contactValueHelp')}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name="value"
                      required
                      autoComplete="off"
                      maxLength={GLOBAL_LIMITS.contactValue}
                      dir="ltr"
                    />
                  )}
                </Field>
              </div>
            </ActionForm>
          </div>
        </Panel>
      )}
    </section>
  );
}

/* ===========================================================================
 * Served Cities
 * ========================================================================= */

function ServedCities({
  locale,
  record,
  candidates,
  administer,
  copy,
}: {
  readonly locale: Locale;
  readonly record: CentreDetail;
  /** Cities of the Centre's own Country it does not yet serve, bounded. */
  readonly candidates: readonly GlobalChoice[];
  readonly administer: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="centre-served">
      <SectionHeading>
        <span id="centre-served">{t('served')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('servedHelp', {
          count: String(record.servedCities.length),
          limit: String(GLOBAL_LIMITS.servedCities),
        })}
      </p>
      {record.servedCities.length === 0 ? (
        <EmptyState>{t('servedEmpty')}</EmptyState>
      ) : (
        <ul aria-labelledby="centre-served" className="flex flex-col gap-3">
          {record.servedCities.map((city) => (
            <Panel key={city.id} as="li">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Name record={city} locale={locale} copy={copy} />
                  {city.state === 'published' ? null : (
                    <StateBadge state={city.state} copy={copy} />
                  )}
                </p>
                {administer ? (
                  <ActionForm
                    action={changeCentreServedCities}
                    submitLabel={t('remove')}
                    pendingLabel={t('pending')}
                    messages={copy.messages}
                    tone="destructive"
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="centreId" value={record.id} />
                    <input type="hidden" name="version" value={String(record.version)} />
                    <input type="hidden" name="op" value="remove" />
                    <input type="hidden" name="cityId" value={city.id} />
                  </ActionForm>
                ) : null}
              </div>
            </Panel>
          ))}
        </ul>
      )}

      {!administer ? null : record.servedCities.length >= GLOBAL_LIMITS.servedCities ? (
        <Alert tone="info">{t('servedFull')}</Alert>
      ) : (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('addServed')}</SectionHeading>
            {candidates.length === 0 ? (
              <EmptyState>{t('addServedNone')}</EmptyState>
            ) : (
              <ActionForm
                action={changeCentreServedCities}
                submitLabel={t('addServedSubmit')}
                pendingLabel={t('pending')}
                messages={copy.messages}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="centreId" value={record.id} />
                <input type="hidden" name="version" value={String(record.version)} />
                <input type="hidden" name="op" value="add" />
                <Field id="served-city" label={t('city')} help={t('addServedHelp')}>
                  {(props) => (
                    <Select {...props} name="cityId" required defaultValue="">
                      <option value="">{t('chooseCity')}</option>
                      <ChoiceOptions choices={candidates} locale={locale} copy={copy} />
                    </Select>
                  )}
                </Field>
              </ActionForm>
            )}
          </div>
        </Panel>
      )}
    </section>
  );
}

/* ===========================================================================
 * The editor
 * ========================================================================= */

export async function CentreEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = editorTarget((await params).id);
  const query = await searchParams;
  const base = `/${locale}/admin/global/centres`;
  const context = await requireAdminPage(locale, 'global.read', `${base}/${id}`);
  const copy = await globalCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('global.administer');
  const service = globalRuntime();

  const record = id === 'new' ? null : await service.centre(actor, id).catch(() => null);
  if ((id !== 'new' && record === null) || (record === null && !administer)) notFound();

  // The Country whose places the form offers: one chosen through the query —
  // on creation, or to move the Centre — else the Centre's own.
  const chosen = globalIdSchema.safeParse(queryValue(query, 'country'));
  const requested = administer && chosen.success ? chosen.data : null;
  const text = queryValue(query, 'q');
  const search = text !== null && text.length <= 120 ? text : null;

  const [countries, ownCountry, requestedCountry, ownCity, ownRegion] = await Promise.all(
    [
      administer ? service.countryChoices(actor) : Promise.resolve([]),
      choiceById(actor, 'country', record?.countryId ?? null),
      choiceById(actor, 'country', requested),
      choiceById(actor, 'city', record?.cityId ?? null),
      choiceById(actor, 'region', record?.regionId ?? null),
    ],
  );
  const country = requestedCountry ?? ownCountry;
  const sameCountry = record !== null && country?.id === record.countryId;
  const moving = record !== null && country !== undefined && !sameCountry;

  const [cities, regions] =
    administer && country !== undefined
      ? await Promise.all([
          service.cityChoices(actor, country.id, search),
          service.regionChoices(actor, country.id),
        ])
      : [[], []];
  // Served Cities are always of the Centre's OWN Country — the one it is saved in.
  const servedPool =
    record === null || !administer
      ? []
      : sameCountry
        ? cities
        : await service.cityChoices(actor, record.countryId, search);
  const served = new Set(record?.servedCities.map((city) => city.id) ?? []);
  const candidates = servedPool.filter(
    (city) => !served.has(city.id) && city.id !== record?.cityId,
  );

  const offeredCities = withSelected(
    cities,
    sameCountry && ownCity !== undefined ? [ownCity] : [],
  );
  const offeredRegions = withSelected(
    regions,
    sameCountry && ownRegion !== undefined ? [ownRegion] : [],
  );

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={base}
        locale={locale}
        record={record}
        title={t('create.centres')}
        copy={copy}
      />

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>
              {record === null ? t('create.centres') : t('edit')}
            </SectionHeading>
            <CountryStep
              action={`${base}/${id}`}
              countries={withSelected(
                countries,
                ownCountry === undefined ? [] : [ownCountry],
              )}
              selected={country?.id ?? null}
              locale={locale}
              copy={copy}
              help={record === null ? t('centreCountryStepHelp') : t('centreCountryHelp')}
            />
            {moving ? (
              <Alert tone="warning">
                {t('centreMoving')}
                {record.servedCities.length > 0 ? ` ${t('servedCities')}` : ''}
              </Alert>
            ) : null}
            {country === undefined ? null : (
              <>
                <CitySearch query={search ?? ''} country={requested} copy={copy} />
                <CentreForm
                  locale={locale}
                  record={record}
                  country={country}
                  cities={offeredCities}
                  regions={offeredRegions}
                  sameCountry={sameCountry}
                  copy={copy}
                />
              </>
            )}
          </div>
        </Panel>
      ) : record === null ? null : (
        <CentreFacts
          locale={locale}
          record={record}
          country={ownCountry}
          city={ownCity}
          region={ownRegion}
          copy={copy}
        />
      )}

      {record === null ? null : (
        <>
          <Contacts locale={locale} record={record} administer={administer} copy={copy} />
          <ServedCities
            locale={locale}
            record={record}
            candidates={candidates}
            administer={administer}
            copy={copy}
          />
        </>
      )}
    </main>
  );
}
