import { notFound } from 'next/navigation';

import {
  MIGRATION_LIMITS,
  migrationIdSchema,
  runRightsSchema,
  type AssetProvenanceRow,
} from '@minhaj/contracts/migration';

import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { rightsRunAction } from '../../../actions';
import { RightsBatchForm } from '../../../rights-batch-form';
import { RunBatchForm } from '../../../run-batch-form';
import {
  Code,
  Pager,
  actorOf,
  adminMigrationCopy,
  migrationPath,
  migrationRead,
  offsetOf,
  withQuery,
  type AdminMigrationCopy,
  type Query,
} from '../../../shared';
import { adminPageMetadata } from '../../../../metadata';

/**
 * `/{locale}/admin/migration/runs/{id}/rights` — Phase 30-R. The run's
 * acquisitions still RESTRICTED, under `migration.read`, one page at a time in
 * the order the run acquired them: each with its original address (a link to
 * the image on its official host, so the reviewer sees it where the source
 * shows it), its type and size, the box of the metadata-stripped public copy
 * Storage made of it, and the rights claim and evidence recorded with it.
 *
 * A PERSON DECIDES. For a holder of `migration.administer` the rows carry a
 * checkbox — pre-ticked only where the source itself stated organisational
 * ownership with evidence — and one form clears the selection for release
 * under the licence, evidence and holder the reviewer states. The action
 * re-checks the key, and the service decides and audits every acquisition on
 * its own; one it refuses is listed with its reason. A reader is offered no
 * act. Nothing here serves an image: the public copy is shown only through
 * the domain a published record names it from.
 */
export const generateMetadata = adminPageMetadata('adminMigration', 'rights.title');

export const dynamic = 'force-dynamic';

/** What the reviewer's evidence field starts as — the reviewer completes it. */
const EVIDENCE_TEMPLATE = 'Reviewed against the official source page: ';
const RIGHTS_HOLDER = 'Minhaj-ul-Quran International';

export default async function MigrationRunRightsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const runPath = migrationPath(locale, `/runs/${encodeURIComponent(id)}`);
  const base = `${runPath}/rights`;
  const context = await requireAdminPage(locale, 'migration.read', base);
  if (!migrationIdSchema.safeParse(id).success) notFound();
  const query = await searchParams;
  const offset = offsetOf(query);
  const hostOffset = offsetOf(query, 'hpage');
  const host = hostOf(query);
  if (offset === null || hostOffset === null || host === undefined) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('migration.administer');
  const { read } = migrationRuntime();

  const [assets, byHost] = await Promise.all([
    migrationRead('migration-admin-run-rights', () =>
      read.assets(actor, { runId: id, visibility: 'restricted', offset }),
    ),
    migrationRead('migration-admin-run-rights-hosts', () =>
      read.runRights(actor, { runId: id, host, offset: hostOffset }),
    ),
  ]);
  if (!assets.ok && ['denied', 'invalid'].includes(assets.failure)) notFound();
  // A host the run's source does not register is no filter: 404, never a list.
  if (!byHost.ok && ['denied', 'invalid'].includes(byHost.failure)) notFound();

  const back = (
    <p>
      <TextLink href={runPath}>{t('rights.back')}</TextLink>
    </p>
  );

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('rights.title')}</PageHeading>
        <p className="text-sm text-foreground-muted">{t('rights.intro')}</p>
      </header>

      {!byHost.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : byHost.value === null ? null : (
        <HostReview
          view={byHost.value}
          base={base}
          locale={locale}
          hostOffset={hostOffset}
          copy={copy}
          administer={administer}
        />
      )}

      <section className="flex flex-col gap-3" aria-labelledby="run-rights">
        <SectionHeading>
          <span id="run-rights">{t('rights.heading')}</span>
        </SectionHeading>
        {!assets.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : assets.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('rights.none') : t('beyond')}</EmptyState>
        ) : (
          <RightsTable
            rows={assets.value.rows}
            total={assets.value.total}
            locale={locale}
            copy={copy}
            administer={administer}
          />
        )}
        {assets.ok ? (
          <Pager
            offset={offset}
            total={assets.value.total}
            hrefFor={(page) => withQuery(base, { page: page > 1 ? String(page) : null })}
            label={t('rights.pages')}
            copy={copy}
          />
        ) : null}
      </section>

      {back}
    </main>
  );
}

/**
 * The `host` filter: `null` when absent, the host when it is shaped like one,
 * `undefined` otherwise (a 404). Whether the run's source registers it is the
 * service's answer.
 */
function hostOf(query: Query): string | null | undefined {
  const raw = query['host'];
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  return runRightsSchema.shape.host.safeParse(raw).success ? raw : undefined;
}

/** The administrative preview of an acquisition's public copy. */
function previewPath(provenanceId: string): string {
  return `/api/admin/migration/assets/${encodeURIComponent(provenanceId)}`;
}

type HostView = NonNullable<
  Awaited<ReturnType<ReturnType<typeof migrationRuntime>['read']['runRights']>>
>;

/**
 * R2. The run's pictures by REGISTERED HOST: each of its source's page and
 * image hosts with the pictures awaiting a decision there whose source stated
 * it owns them (with evidence) and which have a public copy. For the host
 * chosen, an administrator SEES each one — its public copy, served only
 * through the administrative preview, beside a link to the original on its
 * official host — and may clear the whole confirmed list for release, slice
 * by slice, every picture decided and audited on its own.
 */
function HostReview({
  view,
  base,
  locale,
  hostOffset,
  copy,
  administer,
}: {
  readonly view: HostView;
  readonly base: string;
  readonly locale: string;
  readonly hostOffset: number;
  readonly copy: AdminMigrationCopy;
  readonly administer: boolean;
}) {
  const { t } = copy;
  const { host, hosts, page, confirmation } = view;
  const slice =
    confirmation === null ? 0 : Math.min(confirmation.count, MIGRATION_LIMITS.runChunk);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="run-rights-hosts">
      <SectionHeading>
        <span id="run-rights-hosts">{t('runBatch.rights.hostsHeading')}</span>
      </SectionHeading>
      <p className="text-sm text-foreground-muted">{t('runBatch.rights.hostsHelp')}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {hosts.map((entry) => (
          <li key={entry.host} className="flex flex-wrap items-center gap-2">
            <FilterLink
              href={withQuery(base, { host: entry.host })}
              current={entry.host === host}
            >
              <bdi dir="ltr">{entry.host}</bdi>
            </FilterLink>
            <span className="text-foreground-muted">
              {t(`runBatch.rights.role.${entry.role}`)}
              {' · '}
              {t('runBatch.rights.awaiting', { count: entry.candidates })}
            </span>
          </li>
        ))}
      </ul>

      {host === null || page === null || confirmation === null ? null : !administer ? (
        <p className="text-sm">{t('runBatch.rights.readerNote')}</p>
      ) : page.rows.length === 0 ? (
        <EmptyState>
          {hostOffset === 0 ? t('runBatch.rights.gridNone') : t('beyond')}
        </EmptyState>
      ) : (
        <Panel>
          <div className="flex flex-col gap-4">
            <h3 className="font-semibold">
              {t('runBatch.rights.gridHeading', { host })}
            </h3>
            <p className="text-sm text-foreground-muted">
              {t('runBatch.rights.gridCaption', { total: page.total })}
            </p>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {page.rows.map((row) => (
                <li key={row.id}>
                  <figure className="flex flex-col gap-2">
                    {row.publicCopy === null ? null : (
                      <img
                        src={previewPath(row.id)}
                        alt={t('runBatch.rights.thumbnailAlt', { url: row.originalUrl })}
                        width={row.publicCopy.width}
                        height={row.publicCopy.height}
                        loading="lazy"
                        decoding="async"
                        className="aspect-square h-auto w-full rounded-control bg-surface-sunken object-contain"
                      />
                    )}
                    <figcaption className="flex flex-col gap-1 text-xs">
                      <a
                        href={row.originalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        dir="ltr"
                        className="break-all text-action underline underline-offset-2"
                      >
                        {t('runBatch.rights.openOriginal')}
                      </a>
                      <span className="text-foreground-muted">
                        {row.licenceEvidence ?? t('rights.noEvidence')}
                      </span>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
            <Pager
              offset={hostOffset}
              total={page.total}
              hrefFor={(number) =>
                withQuery(base, { host, hpage: number > 1 ? String(number) : null })
              }
              label={t('runBatch.rights.gridPages')}
              copy={copy}
            />
            <p className="text-sm">
              {t('runBatch.rights.actHelp', { count: confirmation.count, slice })}
            </p>
            <RunBatchForm
              action={rightsRunAction}
              locale={locale}
              runId={view.run.id}
              confirmation={confirmation}
              names={Object.fromEntries(
                page.rows.map((row) => [row.id, row.originalUrl]),
              )}
              labels={{
                confirm: t('runBatch.rights.confirm', { count: confirmation.count }),
                submit: t('runBatch.rights.submit', { count: slice }),
                pending: t('pending'),
                decided: t('rights.bulk.decided'),
                refused: t('runBatch.refused'),
                remaining: t('runBatch.remaining'),
                unknownItem: t('rights.bulk.unknownAcquisition'),
              }}
              messages={{
                ...copy.messages,
                success: t('runBatch.rights.done'),
                conflict: t('runBatch.conflict'),
                'items-refused': t('rights.bulk.partial'),
                'batch-interrupted': t('runBatch.interrupted'),
              }}
            >
              <input type="hidden" name="host" value={host} />
              <Field id="run-rights-licence" label={t('rights.bulk.licence')}>
                {(props) => (
                  <Select {...props} name="licence" defaultValue="organisation-owned">
                    <option value="organisation-owned">
                      {t('licence.organisation-owned')}
                    </option>
                    <option value="licensed">{t('licence.licensed')}</option>
                  </Select>
                )}
              </Field>
              <Field
                id="run-rights-evidence"
                label={t('rights.bulk.evidence')}
                help={t('rights.bulk.evidenceHelp')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name="licenceEvidence"
                    rows={3}
                    minLength={10}
                    maxLength={1000}
                    required
                    defaultValue={EVIDENCE_TEMPLATE}
                  />
                )}
              </Field>
              <Field id="run-rights-holder" label={t('rights.bulk.rightsHolder')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="rightsHolder"
                    maxLength={200}
                    required
                    defaultValue={RIGHTS_HOLDER}
                  />
                )}
              </Field>
            </RunBatchForm>
          </div>
        </Panel>
      )}
    </section>
  );
}

/** Whether the source itself stated organisational ownership, with evidence. */
function sourceVouches(row: AssetProvenanceRow): boolean {
  return (
    row.licence === 'organisation-owned' &&
    row.licenceEvidence !== null &&
    row.licenceEvidence.trim().length > 0
  );
}

function RightsTable({
  rows,
  total,
  locale,
  copy,
  administer,
}: {
  readonly rows: readonly AssetProvenanceRow[];
  readonly total: number;
  readonly locale: string;
  readonly copy: AdminMigrationCopy;
  readonly administer: boolean;
}) {
  const { t } = copy;
  const table = (
    <DataTable
      caption={t('rights.caption', { total })}
      columns={[
        ...(administer ? [t('rights.column.select')] : []),
        t('rights.column.source'),
        t('rights.column.type'),
        t('rights.column.publicCopy'),
        t('rights.column.claim'),
      ]}
    >
      {rows.map((row) => (
        <DataRow key={row.id}>
          {administer ? (
            <DataCell>
              <input
                id={`rights-batch-${row.id}`}
                type="checkbox"
                name="provenanceId"
                value={row.id}
                defaultChecked={sourceVouches(row)}
                className="size-5"
              />
              <label htmlFor={`rights-batch-${row.id}`} className="sr-only">
                {t('rights.select', { url: row.originalUrl })}
              </label>
              <input
                type="hidden"
                name={`version-${row.id}`}
                value={String(row.version)}
              />
            </DataCell>
          ) : null}
          <DataCell wrap>
            <a
              href={row.originalUrl}
              target="_blank"
              rel="noreferrer noopener"
              dir="ltr"
              className="break-all font-medium text-action underline underline-offset-2"
            >
              {row.originalUrl}
            </a>
          </DataCell>
          <DataCell>
            <Code>{row.mediaType}</Code>
            <span className="block text-xs text-foreground-muted">
              {t('snapshot.bytes', { count: row.byteSize })}
            </span>
          </DataCell>
          <DataCell>
            {row.publicCopy === null
              ? t('rights.noPublicCopy')
              : t('rights.dimensions', {
                  width: row.publicCopy.width,
                  height: row.publicCopy.height,
                })}
          </DataCell>
          <DataCell wrap>
            <span className="block">{t(`licence.${row.licence}`)}</span>
            <span className="block text-xs text-foreground-muted">
              {row.licenceEvidence ?? t('rights.noEvidence')}
            </span>
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
  if (!administer) return table;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-muted">{t('rights.bulk.help')}</p>
      <RightsBatchForm
        locale={locale}
        urls={Object.fromEntries(rows.map((row) => [row.id, row.originalUrl]))}
        defaults={{ evidence: EVIDENCE_TEMPLATE, rightsHolder: RIGHTS_HOLDER }}
        labels={{
          legend: t('rights.bulk.legend'),
          licence: t('rights.bulk.licence'),
          organisationOwned: t('licence.organisation-owned'),
          licensed: t('licence.licensed'),
          evidence: t('rights.bulk.evidence'),
          evidenceHelp: t('rights.bulk.evidenceHelp'),
          rightsHolder: t('rights.bulk.rightsHolder'),
          confirm: t('rights.bulk.confirm'),
          submit: t('rights.bulk.submit'),
          pending: t('pending'),
          decided: t('rights.bulk.decided'),
          refused: t('rights.bulk.refused'),
          unknownAcquisition: t('rights.bulk.unknownAcquisition'),
        }}
        messages={{
          ...copy.messages,
          success: t('rights.bulk.done'),
          'items-refused': t('rights.bulk.partial'),
          'none-selected': t('rights.bulk.noneSelected'),
          'batch-interrupted': t('rights.bulk.interrupted'),
        }}
      >
        {table}
      </RightsBatchForm>
    </div>
  );
}
