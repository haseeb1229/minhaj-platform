import { notFound } from 'next/navigation';

import { migrationIdSchema, type AssetProvenanceRow } from '@minhaj/contracts/migration';

import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  PageHeading,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { RightsBatchForm } from '../../../rights-batch-form';
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
export const metadata = { robots: { index: false, follow: false } };

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
  if (offset === null) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('migration.administer');
  const { read } = migrationRuntime();

  const assets = await migrationRead('migration-admin-run-rights', () =>
    read.assets(actor, { runId: id, visibility: 'restricted', offset }),
  );
  if (!assets.ok && ['denied', 'invalid'].includes(assets.failure)) notFound();

  const back = (
    <p>
      <TextLink href={runPath}>{t('rights.back')}</TextLink>
    </p>
  );

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('rights.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('rights.intro')}
        </p>
      </header>

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
              className="break-all font-medium text-[color:var(--color-action)] underline underline-offset-2"
            >
              {row.originalUrl}
            </a>
          </DataCell>
          <DataCell>
            <Code>{row.mediaType}</Code>
            <span className="block text-xs text-[color:var(--color-foreground-muted)]">
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
            <span className="block text-xs text-[color:var(--color-foreground-muted)]">
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
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('rights.bulk.help')}
      </p>
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
