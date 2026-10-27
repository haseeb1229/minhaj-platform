import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  SOURCE_ACCESS_METHODS,
  SOURCE_STATES,
  type SourcePolicy,
  type SourceRecord,
} from '@minhaj/contracts/migration';

import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { createSourceAction, updateSourceAction } from '../actions';
import {
  Code,
  Pager,
  RowIdentity,
  StateBadge,
  actorOf,
  adminMigrationCopy,
  migrationPath,
  migrationRead,
  offsetOf,
  withQuery,
  type AdminMigrationCopy,
  type Query,
} from '../shared';
import { ContentKindLabel } from '../status';

/**
 * `/{locale}/admin/migration/sources` — legacy sources (DOMAIN_MODEL.md §16.1
 * LegacySource) under `migration.read`; registering and editing re-check
 * `migration.administer`.
 *
 * TWO REGISTRATION DOORS, NEITHER WITH A KIND FIELD. An AUTHORISED source
 * (Phase 30) is registered only by the operator command
 * (`npm run migration:register-source`; on staging, `migration-run.sh
 * register`) with its written authorisation reference and date, a real
 * `https` scope and the politeness floor — created inactive, and activated as
 * a separate, audited act. The form on this page is the other door: it has NO
 * authority field, every source it creates is a synthetic fixture naming only
 * `*.fixture.invalid` hosts, and the service refuses a request that tries to
 * record an authorised one.
 *
 * Each source's details show its authority, content kind and — for an
 * authorised source — the recorded authorisation reference and date, with its
 * licensing evidence and policy notes, all as escaped text: a reference is
 * never a link. An edit changes the name, state, language, politeness and
 * notes — never the key, kind, access method, hosts or evidence — at the
 * version the operator saw; the service refuses to activate a real source
 * without its recorded authorisation.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const DEFAULT_POLICY: SourcePolicy = {
  minIntervalMs: 1000,
  maxConcurrency: 1,
  maxAttempts: 3,
  timeoutMs: 10_000,
  maxBodyBytes: 1_048_576,
  maxRedirects: 2,
};

const POLICY_FIELDS = [
  'minIntervalMs',
  'maxConcurrency',
  'maxAttempts',
  'timeoutMs',
  'maxBodyBytes',
  'maxRedirects',
] as const satisfies readonly (keyof SourcePolicy)[];

export default async function MigrationSourcesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/sources');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const offset = offsetOf(await searchParams);
  if (offset === null) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const administer = context.authorization.can('migration.administer');

  const listing = await migrationRead('migration-admin-sources', () =>
    migrationRuntime().sources.sources(actorOf(context), offset),
  );
  if (!listing.ok && listing.failure === 'denied') notFound();

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('sources.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('sources.description')}
        </p>
        <Alert tone="info">{t('sources.registration')}</Alert>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="migration-sources">
        <SectionHeading>
          <span id="migration-sources">{t('sources.heading')}</span>
        </SectionHeading>
        {!listing.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : listing.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('sources.empty') : t('beyond')}</EmptyState>
        ) : (
          <>
            <DataTable
              caption={t('sources.caption', { total: listing.value.total })}
              columns={[
                t('sources.column.key'),
                t('sources.column.name'),
                t('sources.column.authority'),
                t('sources.column.contentKind'),
                t('sources.column.access'),
                t('sources.column.state'),
              ]}
            >
              {listing.value.rows.map((source) => (
                <DataRow key={source.id}>
                  <DataCell>
                    <Code>{source.key}</Code>
                  </DataCell>
                  <DataCell wrap>{source.name}</DataCell>
                  <DataCell>{t(`authority.${source.authorityKind}`)}</DataCell>
                  <DataCell>
                    <ContentKindLabel kind={source.contentKind} copy={copy} />
                  </DataCell>
                  <DataCell>{t(`access.${source.accessMethod}`)}</DataCell>
                  <DataCell>
                    <StateBadge tone={source.state === 'active' ? 'positive' : 'neutral'}>
                      {t(`sourceState.${source.state}`)}
                    </StateBadge>
                  </DataCell>
                </DataRow>
              ))}
            </DataTable>
            <ul className="flex flex-col gap-3" aria-label={t('sources.details')}>
              {listing.value.rows.map((source) => (
                <SourceDetail
                  key={source.id}
                  source={source}
                  locale={locale}
                  administer={administer}
                  copy={copy}
                />
              ))}
            </ul>
          </>
        )}
        {listing.ok ? (
          <Pager
            offset={offset}
            total={listing.value.total}
            hrefFor={(page) => withQuery(base, { page: page > 1 ? String(page) : null })}
            label={t('sources.pages')}
            copy={copy}
          />
        ) : null}
      </section>

      {administer ? <CreateSource locale={locale} copy={copy} /> : null}
    </main>
  );
}

/** One source's provenance, and — for an administrator — its edit form. */
function SourceDetail({
  source,
  locale,
  administer,
  copy,
}: {
  readonly source: SourceRecord;
  readonly locale: Locale;
  readonly administer: boolean;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  const prefix = `source-${source.id}`;
  return (
    <Panel as="li">
      <details className="flex flex-col gap-3">
        <summary className="cursor-pointer font-medium">
          <bdi>{source.name}</bdi> · <Code>{source.key}</Code>
        </summary>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('sources.field.authority')}>
            {t(`authority.${source.authorityKind}`)}
          </DetailRow>
          <DetailRow term={t('sources.field.contentKind')}>
            <ContentKindLabel kind={source.contentKind} copy={copy} />
          </DetailRow>
          {source.authorityKind === 'authorised' ? (
            <>
              <DetailRow term={t('sources.field.authorisationReference')}>
                {source.authorisationReference === null ? (
                  t('none')
                ) : (
                  <Code>{source.authorisationReference}</Code>
                )}
              </DetailRow>
              <DetailRow term={t('sources.field.authorisedOn')}>
                {source.authorisedOn === null ? (
                  t('none')
                ) : (
                  <AuthorisedOn value={source.authorisedOn} locale={locale} />
                )}
              </DetailRow>
            </>
          ) : null}
          <DetailRow term={t('sources.field.baseUrl')}>
            {source.baseUrl === null ? t('none') : <Code>{source.baseUrl}</Code>}
          </DetailRow>
          <DetailRow term={t('sources.field.hosts')}>
            {source.hosts.length === 0 ? (
              t('none')
            ) : (
              <ul className="flex flex-col gap-1">
                {source.hosts.map((host) => (
                  <li key={host}>
                    <Code>{host}</Code>
                  </li>
                ))}
              </ul>
            )}
          </DetailRow>
          <DetailRow term={t('sources.field.language')}>
            {source.defaultLanguageCode === null ? (
              t('none')
            ) : (
              <Code>{source.defaultLanguageCode}</Code>
            )}
          </DetailRow>
          <DetailRow term={t('sources.field.policy')}>
            <Code>
              {POLICY_FIELDS.map((name) => `${name}=${String(source.policy[name])}`).join(
                ' · ',
              )}
            </Code>
          </DetailRow>
          <DetailRow term={t('sources.field.licensingEvidence')}>
            {source.licensingEvidence === null ? (
              t('none')
            ) : (
              <bdi className="whitespace-pre-wrap">{source.licensingEvidence}</bdi>
            )}
          </DetailRow>
          <DetailRow term={t('sources.field.policyNotes')}>
            {source.policyNotes === null ? (
              t('none')
            ) : (
              <bdi className="whitespace-pre-wrap">{source.policyNotes}</bdi>
            )}
          </DetailRow>
          <DetailRow term={t('sources.field.version')}>{source.version}</DetailRow>
        </dl>
        {administer ? (
          <ActionForm
            action={updateSourceAction}
            submitLabel={t('sources.edit.submit')}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={copy.messages}
            preserveInput
          >
            <RowIdentity locale={locale} row={source} />
            <Field id={`${prefix}-name`} label={t('sources.field.name')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={source.name}
                />
              )}
            </Field>
            <Field id={`${prefix}-state`} label={t('sources.field.state')}>
              {(props) => (
                <Select {...props} name="state" defaultValue={source.state}>
                  {SOURCE_STATES.map((state) => (
                    <option key={state} value={state}>
                      {t(`sourceState.${state}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <SharedSourceFields
              prefix={prefix}
              copy={copy}
              values={{
                language: source.defaultLanguageCode ?? '',
                policy: source.policy,
                licensingEvidence: source.licensingEvidence ?? '',
                policyNotes: source.policyNotes ?? '',
              }}
            />
          </ActionForm>
        ) : null}
      </details>
    </Panel>
  );
}

/**
 * A recorded authorisation date (`YYYY-MM-DD`), in the operator's language.
 * A calendar date, not a moment: formatted in UTC so no time zone moves it.
 */
function AuthorisedOn({
  value,
  locale,
}: {
  readonly value: string;
  readonly locale: Locale;
}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (date === null || Number.isNaN(date.getTime())) return <Code>{value}</Code>;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
        date,
      )}
    </time>
  );
}

/** Registering a fixture source — no authority field exists to fill. */
function CreateSource({
  locale,
  copy,
}: {
  readonly locale: Locale;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <SectionHeading>{t('sources.create.heading')}</SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('sources.create.help')}
        </p>
        <ActionForm
          action={createSourceAction}
          submitLabel={t('sources.create.submit')}
          pendingLabel={t('pending')}
          messages={{ ...copy.messages, success: t('sources.create.done') }}
          preserveInput
        >
          <input type="hidden" name="locale" value={locale} />
          <Field
            id="source-key"
            label={t('sources.field.key')}
            help={t('sources.field.keyHelp')}
          >
            {(props) => (
              <TextInput
                {...props}
                name="key"
                required
                maxLength={64}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field id="source-name" label={t('sources.field.name')}>
            {(props) => <TextInput {...props} name="name" required maxLength={200} />}
          </Field>
          <Field id="source-access" label={t('sources.field.access')}>
            {(props) => (
              <Select {...props} name="accessMethod" defaultValue="http">
                {SOURCE_ACCESS_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`access.${method}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            id="source-base-url"
            label={t('sources.field.baseUrl')}
            help={t('sources.field.baseUrlHelp')}
          >
            {(props) => (
              <TextInput
                {...props}
                name="baseUrl"
                type="url"
                maxLength={2000}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field
            id="source-hosts"
            label={t('sources.field.hosts')}
            help={t('sources.field.hostsHelp')}
          >
            {(props) => (
              <TextArea
                {...props}
                name="hosts"
                rows={3}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <SharedSourceFields
            prefix="source-new"
            copy={copy}
            values={{
              language: '',
              policy: DEFAULT_POLICY,
              licensingEvidence: '',
              policyNotes: '',
            }}
          />
        </ActionForm>
      </div>
    </Panel>
  );
}

/** The fields registration and an edit share: language, politeness and notes. */
function SharedSourceFields({
  prefix,
  copy,
  values,
}: {
  readonly prefix: string;
  readonly copy: AdminMigrationCopy;
  readonly values: {
    readonly language: string;
    readonly policy: SourcePolicy;
    readonly licensingEvidence: string;
    readonly policyNotes: string;
  };
}) {
  const { t } = copy;
  return (
    <>
      <Field
        id={`${prefix}-language`}
        label={t('sources.field.language')}
        help={t('sources.field.languageHelp')}
      >
        {(props) => (
          <TextInput
            {...props}
            name="defaultLanguageCode"
            maxLength={16}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            defaultValue={values.language}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">{t('sources.field.policy')}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {POLICY_FIELDS.map((name) => (
            <Field
              key={name}
              id={`${prefix}-${name}`}
              label={t(`sources.policy.${name}`)}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name={name}
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  required
                  maxLength={10}
                  defaultValue={String(values.policy[name])}
                />
              )}
            </Field>
          ))}
        </div>
      </fieldset>
      <Field id={`${prefix}-licensing`} label={t('sources.field.licensingEvidence')}>
        {(props) => (
          <TextArea
            {...props}
            name="licensingEvidence"
            rows={2}
            maxLength={2000}
            defaultValue={values.licensingEvidence}
          />
        )}
      </Field>
      <Field id={`${prefix}-notes`} label={t('sources.field.policyNotes')}>
        {(props) => (
          <TextArea
            {...props}
            name="policyNotes"
            rows={2}
            maxLength={2000}
            defaultValue={values.policyNotes}
          />
        )}
      </Field>
    </>
  );
}
