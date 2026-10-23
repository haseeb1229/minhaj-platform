import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  ASSET_LICENCES,
  ASSET_VISIBILITIES,
  migrationIdSchema,
  type AssetProvenanceRow,
  type StagedDetail,
} from '@minhaj/contracts/migration';

import { ConfirmField } from '@/components/personal/parts';
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
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { migrationRuntime } from '@/composition/migration';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { disposeSnapshotAction, reviewAction, rightsAction } from '../../actions';
import { RightsFields } from '../../rights-fields';
import {
  Code,
  MigrationTime,
  Pager,
  RowIdentity,
  actorOf,
  adminMigrationCopy,
  migrationPath,
  migrationRead,
  offsetOf,
  withQuery,
  type AdminMigrationCopy,
  type Query,
} from '../../shared';
import {
  LinkDispositionBadge,
  PersonalDataBadge,
  ReviewBadge,
  TopicMappingBadge,
  ValidationBadge,
} from '../../status';

/**
 * `/{locale}/admin/migration/staging/{id}` — one staged revision, as a
 * reviewer reads it, under `migration.read`; deciding it re-checks
 * `migration.administer`, at the version shown.
 *
 * NOTHING FROM A LEGACY SOURCE IS LIVE MARKUP HERE (SECURITY_BASELINE.md
 * §10.3). The payload was sanitised before it was staged, and it is STILL
 * shown only as React-escaped text in a `<pre>` — the reviewer reads exactly
 * what was stored, and no tag in it can run, load or navigate. The raw
 * snapshot is never rendered: its metadata is shown, an escaped-text preview
 * (bounded, and an AUDITED read) appears only when an administrator asks for
 * it, and the bytes leave only as an attachment from the private download
 * route. A legacy address is shown as text, never a link: following it would
 * be live access to a legacy source.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

/** The stored payload, pretty-printed when it parses; as stored when not. Text either way. */
function readablePayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

/** Topic names in the interface locale for the confirmed mappings shown. */
async function topicNames(
  ids: readonly string[],
  locale: Locale,
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  try {
    const found = await taxonomyRuntime().taxonomy.topicReferences(unique, locale);
    return new Map(found.map((topic) => [topic.id, topic.name]));
  } catch {
    appLogger().error(
      { operation: 'migration-admin-topic-names' },
      'Topic names unavailable.',
    );
    return new Map();
  }
}

export default async function MigrationStagedRecordPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const base = migrationPath(locale, `/staging/${encodeURIComponent(id)}`);
  const context = await requireAdminPage(locale, 'migration.read', base);
  if (!migrationIdSchema.safeParse(id).success) notFound();
  const query = await searchParams;
  const assetOffset = offsetOf(query, 'apage');
  if (assetOffset === null) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const timeZone = context.session.account.timezone;
  const administer = context.authorization.can('migration.administer');
  const runtime = migrationRuntime();

  const found = await migrationRead('migration-admin-staged-record', () =>
    runtime.read.stagedDetail(actor, id),
  );
  if (!found.ok && ['denied', 'not-found', 'invalid'].includes(found.failure)) notFound();
  if (found.ok && found.value === null) notFound();
  const back = (
    <p>
      <TextLink href={migrationPath(locale, '/staging')}>{t('staging.back')}</TextLink>
    </p>
  );
  if (!found.ok || found.value === null)
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('staged.title')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  const staged = found.value;

  // The raw preview is an AUDITED read of evidence: only when asked for, and
  // only for an administrator — the service re-checks the key.
  const wantsPreview = administer && query['preview'] === '1';
  const [snapshot, preview, names, assets] = await Promise.all([
    migrationRead('migration-admin-snapshot', () =>
      runtime.read.snapshot(actor, staged.snapshotId),
    ),
    wantsPreview
      ? migrationRead('migration-admin-snapshot-preview', () =>
          runtime.raw.preview(actor, staged.snapshotId),
        )
      : Promise.resolve(null),
    topicNames(
      staged.categories.flatMap((category) =>
        category.topicId === null ? [] : [category.topicId],
      ),
      locale,
    ),
    migrationRead('migration-admin-record-assets', () =>
      runtime.read.assets(actor, { recordId: staged.recordId, offset: assetOffset }),
    ),
  ]);

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('staged.title')}</PageHeading>
        <p className="text-lg font-medium">
          <bdi>{staged.title}</bdi>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ReviewBadge state={staged.review} copy={copy} />
          <ValidationBadge state={staged.validation} copy={copy} />
          <PersonalDataBadge state={staged.personalData} copy={copy} />
        </div>
        <Alert tone="info">{t('staged.inert')}</Alert>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('staged.revision')}>{staged.revision}</DetailRow>
          <DetailRow term={t('staged.recordStatus')}>
            {t(`recordStatus.${staged.recordStatus}`)}
          </DetailRow>
          <DetailRow term={t('staged.externalKey')}>
            <Code>{staged.externalKey}</Code>
          </DetailRow>
          <DetailRow term={t('staged.originalUrl')}>
            {staged.originalUrl === null ? t('none') : <Code>{staged.originalUrl}</Code>}
          </DetailRow>
          <DetailRow term={t('staged.language')}>
            {staged.languageCode === null ? (
              t('none')
            ) : (
              <Code>{staged.languageCode}</Code>
            )}
          </DetailRow>
          <DetailRow term={t('staged.run')}>
            <TextLink
              href={migrationPath(locale, `/runs/${encodeURIComponent(staged.runId)}`)}
            >
              <Code>{staged.runId}</Code>
            </TextLink>
          </DetailRow>
          <DetailRow term={t('staged.produced')}>
            <MigrationTime
              value={staged.producedAt}
              locale={locale}
              timeZone={timeZone}
            />
          </DetailRow>
          {staged.reviewedAt === null ? null : (
            <DetailRow term={t('staged.reviewed')}>
              <MigrationTime
                value={staged.reviewedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
          {staged.reviewNote === null ? null : (
            <DetailRow term={t('staged.reviewNote')}>
              <bdi>{staged.reviewNote}</bdi>
            </DetailRow>
          )}
          <DetailRow term={t('staged.version')}>{staged.version}</DetailRow>
        </dl>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="staged-provenance">
        <SectionHeading>
          <span id="staged-provenance">{t('staged.provenance')}</span>
        </SectionHeading>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('provenance.adapter')}>
            <Code>{`${staged.provenance.adapterKey}@${staged.provenance.adapterVersion}`}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.parser')}>
            <Code>{`${staged.provenance.parserKey}@${staged.provenance.parserVersion}`}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.normalizer')}>
            <Code>{staged.provenance.normalizerVersion}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.codeRevision')}>
            <Code>{staged.provenance.codeRevision}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.inputChecksum')}>
            <Code>{staged.inputChecksum}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.payloadChecksum')}>
            <Code>{staged.payloadChecksum}</Code>
          </DetailRow>
        </dl>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="staged-validation">
        <SectionHeading>
          <span id="staged-validation">{t('staged.validation')}</span>
        </SectionHeading>
        {staged.issues.length === 0 ? (
          <p className="text-sm">{t('staged.noIssues')}</p>
        ) : (
          <ul className="list-inside list-disc text-sm">
            {staged.issues.map((issue) => (
              <li key={issue}>{t(`issue.${issue}`)}</li>
            ))}
          </ul>
        )}
        {staged.personalData === 'flagged' ? (
          <Alert tone="warning">{t('staged.personalDataFlagged')}</Alert>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="staged-payload">
        <SectionHeading>
          <span id="staged-payload">{t('staged.payload')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('staged.payloadHelp')}
        </p>
        <EscapedText label={t('staged.payload')} testId="staged-payload">
          {readablePayload(staged.payload)}
        </EscapedText>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="staged-categories">
        <SectionHeading>
          <span id="staged-categories">{t('staged.categories')}</span>
        </SectionHeading>
        {staged.categories.length === 0 ? (
          <EmptyState>{t('staged.noCategories')}</EmptyState>
        ) : (
          <DataTable
            caption={t('staged.categories')}
            columns={[
              t('mapping.column.category'),
              t('mapping.column.state'),
              t('mapping.column.topic'),
            ]}
          >
            {staged.categories.map((category) => (
              <DataRow key={category.mappingId}>
                <DataCell wrap>
                  <bdi>{category.label}</bdi> <Code>{category.categoryKey}</Code>
                </DataCell>
                <DataCell>
                  <TopicMappingBadge state={category.state} copy={copy} />
                </DataCell>
                <DataCell wrap>
                  {category.topicId === null
                    ? t('none')
                    : (names.get(category.topicId) ?? t('mapping.topicUnknown'))}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        <p className="text-sm">
          <TextLink href={migrationPath(locale, '/url-mapping')}>
            {t('staged.mappingLink')}
          </TextLink>
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="staged-links">
        <SectionHeading>
          <span id="staged-links">{t('staged.links')}</span>
        </SectionHeading>
        {staged.links.length === 0 ? (
          <EmptyState>{t('staged.noLinks')}</EmptyState>
        ) : (
          <DataTable
            caption={t('staged.linksCaption', { total: staged.links.length })}
            columns={[
              t('staged.column.href'),
              t('staged.column.disposition'),
              t('staged.column.rewrittenTo'),
            ]}
          >
            {staged.links.map((link) => (
              <DataRow key={link.position}>
                <DataCell wrap>
                  <Code>{link.href}</Code>
                </DataCell>
                <DataCell>
                  <LinkDispositionBadge disposition={link.disposition} copy={copy} />
                </DataCell>
                <DataCell wrap>
                  {link.rewrittenTo === null ? (
                    t('none')
                  ) : (
                    <Code>{link.rewrittenTo}</Code>
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="staged-snapshot">
        <SectionHeading>
          <span id="staged-snapshot">{t('snapshot.heading')}</span>
        </SectionHeading>
        {!snapshot.ok || snapshot.value === null ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : (
          <>
            <dl className="divide-y divide-[color:var(--color-border)]">
              <DetailRow term={t('snapshot.requestedUrl')}>
                <Code>{snapshot.value.requestedUrl}</Code>
              </DetailRow>
              <DetailRow term={t('snapshot.finalUrl')}>
                <Code>{snapshot.value.finalUrl}</Code>
              </DetailRow>
              <DetailRow term={t('snapshot.httpStatus')}>
                {snapshot.value.httpStatus === null
                  ? t('none')
                  : snapshot.value.httpStatus}
              </DetailRow>
              <DetailRow term={t('snapshot.contentType')}>
                {snapshot.value.contentType === null ? (
                  t('none')
                ) : (
                  <Code>{snapshot.value.contentType}</Code>
                )}
              </DetailRow>
              <DetailRow term={t('snapshot.size')}>
                {t('snapshot.bytes', { count: snapshot.value.byteSize })}
              </DetailRow>
              <DetailRow term={t('snapshot.checksum')}>
                <Code>{snapshot.value.checksum}</Code>
              </DetailRow>
              <DetailRow term={t('snapshot.fetched')}>
                <MigrationTime
                  value={snapshot.value.fetchedAt}
                  locale={locale}
                  timeZone={timeZone}
                />
              </DetailRow>
              <DetailRow term={t('snapshot.personalData')}>
                <PersonalDataBadge state={snapshot.value.personalData} copy={copy} />
              </DetailRow>
              {snapshot.value.disposedAt === null ? null : (
                <DetailRow term={t('snapshot.disposed')}>
                  <MigrationTime
                    value={snapshot.value.disposedAt}
                    locale={locale}
                    timeZone={timeZone}
                  />
                </DetailRow>
              )}
            </dl>
            {!administer ? (
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('snapshot.administerOnly')}
              </p>
            ) : snapshot.value.disposedAt !== null ? (
              <p className="text-sm">{t('snapshot.disposedHelp')}</p>
            ) : (
              <>
                <Alert tone="info">{t('snapshot.audited')}</Alert>
                <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {wantsPreview ? null : (
                    <TextLink href={withQuery(base, { preview: '1' })}>
                      {t('snapshot.showPreview')}
                    </TextLink>
                  )}
                  <TextLink
                    href={`/api/admin/migration/snapshots/${encodeURIComponent(snapshot.value.id)}`}
                  >
                    {t('snapshot.download')}
                  </TextLink>
                </p>
              </>
            )}
            {preview === null ? null : !preview.ok ? (
              <Alert tone="error">{copy.refusals[preview.failure]}</Alert>
            ) : preview.value.disposed ? (
              <p className="text-sm" data-testid="snapshot-preview-disposed">
                {t('snapshot.previewDisposed')}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">{t('snapshot.preview')}</h3>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {preview.value.truncated
                    ? t('snapshot.previewTruncated')
                    : t('snapshot.previewHelp')}
                </p>
                <EscapedText label={t('snapshot.preview')} testId="snapshot-preview">
                  {preview.value.text}
                </EscapedText>
              </div>
            )}
            {administer && snapshot.value.disposedAt === null ? (
              <DisposeForm snapshotId={snapshot.value.id} locale={locale} copy={copy} />
            ) : null}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="staged-assets">
        <SectionHeading>
          <span id="staged-assets">{t('assets.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('assets.help')}
        </p>
        {!assets.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : assets.value.rows.length === 0 ? (
          <EmptyState>{assetOffset === 0 ? t('assets.empty') : t('beyond')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('assets.heading')}>
            {assets.value.rows.map((asset) => (
              <Acquisition
                key={asset.id}
                asset={asset}
                locale={locale}
                administer={administer}
                copy={copy}
              />
            ))}
          </ul>
        )}
        {assets.ok ? (
          <Pager
            offset={assetOffset}
            total={assets.value.total}
            hrefFor={(page) => withQuery(base, { apage: page > 1 ? String(page) : null })}
            label={t('assets.pages')}
            copy={copy}
          />
        ) : null}
      </section>

      {administer ? <ReviewForms staged={staged} locale={locale} copy={copy} /> : null}

      {back}
    </main>
  );
}

/**
 * Legacy-derived text in a bounded, scrollable, keyboard-reachable box.
 * React escapes `children`; nothing here is ever HTML.
 */
function EscapedText({
  label,
  testId,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly children: string;
}) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      data-testid={testId}
      dir="ltr"
      className="max-h-[32rem] overflow-auto rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] p-3 text-xs whitespace-pre-wrap wrap-anywhere"
    >
      {children}
    </pre>
  );
}

/** Approve, reject or withdraw an approval — each at the version shown. */
function ReviewForms({
  staged,
  locale,
  copy,
}: {
  readonly staged: StagedDetail;
  readonly locale: Locale;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  const publishable = staged.validation === 'valid' && staged.personalData === 'none';
  const decisions: readonly ('approve' | 'reject' | 'withdraw-approval')[] =
    staged.review === 'pending'
      ? publishable
        ? ['approve', 'reject']
        : ['reject']
      : staged.review === 'approved'
        ? ['withdraw-approval']
        : [];
  return (
    <section className="flex flex-col gap-3" aria-labelledby="staged-review">
      <SectionHeading>
        <span id="staged-review">{t('review.heading')}</span>
      </SectionHeading>
      {staged.review === 'pending' && !publishable ? (
        <p className="text-sm">{t('review.notPublishable')}</p>
      ) : null}
      {decisions.length === 0 ? (
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('review.closed')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {decisions.map((decision) => (
            <Panel key={decision}>
              <ActionForm
                action={reviewAction}
                submitLabel={t(`review.${decision}`)}
                pendingLabel={t('pending')}
                tone={decision === 'approve' ? 'primary' : 'secondary'}
                messages={{ ...copy.messages, success: t(`review.done.${decision}`) }}
              >
                <RowIdentity locale={locale} row={staged} />
                <input type="hidden" name="decision" value={decision} />
                <Field id={`review-note-${decision}`} label={t('review.note')}>
                  {(props) => (
                    <TextArea {...props} name="note" rows={2} maxLength={500} />
                  )}
                </Field>
              </ActionForm>
            </Panel>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One acquisition and its rights. A decision here applies to THIS acquisition
 * only — another acquisition of identical bytes keeps its own licence and
 * visibility until a person decides it too.
 */
function Acquisition({
  asset,
  locale,
  administer,
  copy,
}: {
  readonly asset: AssetProvenanceRow;
  readonly locale: Locale;
  readonly administer: boolean;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  const prefix = `asset-${asset.id}`;
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3" data-testid={prefix}>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('assets.originalUrl')}>
            <Code>{asset.originalUrl}</Code>
          </DetailRow>
          <DetailRow term={t('assets.checksum')}>
            <Code>{asset.checksum}</Code>
          </DetailRow>
          <DetailRow term={t('assets.size')}>
            {t('snapshot.bytes', { count: asset.byteSize })}
          </DetailRow>
          <DetailRow term={t('assets.mediaType')}>
            <Code>{asset.mediaType}</Code>
          </DetailRow>
          <DetailRow term={t('assets.licence')}>
            {t(`licence.${asset.licence}`)}
          </DetailRow>
          <DetailRow term={t('assets.visibility')}>
            {t(`visibility.${asset.visibility}`)}
          </DetailRow>
          <DetailRow term={t('assets.rightsHolder')}>
            {asset.rightsHolder === null ? t('none') : <bdi>{asset.rightsHolder}</bdi>}
          </DetailRow>
        </dl>
        {administer ? (
          <ActionForm
            action={rightsAction}
            submitLabel={t('assets.submit')}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={{ ...copy.messages, success: t('assets.done') }}
          >
            <RowIdentity locale={locale} row={asset} />
            <p className="text-sm">{t('assets.thisAcquisitionOnly')}</p>
            <RightsFields
              prefix={prefix}
              licence={asset.licence}
              visibility={asset.visibility}
              labels={{
                licence: t('assets.licence'),
                visibility: t('assets.visibility'),
                visibilityHelp: t('assets.visibilityHelp'),
                licences: Object.fromEntries(
                  ASSET_LICENCES.map((value) => [value, t(`licence.${value}`)]),
                ) as Record<(typeof ASSET_LICENCES)[number], string>,
                visibilities: Object.fromEntries(
                  ASSET_VISIBILITIES.map((value) => [value, t(`visibility.${value}`)]),
                ) as Record<(typeof ASSET_VISIBILITIES)[number], string>,
              }}
            />
            <Field id={`${prefix}-holder`} label={t('assets.rightsHolder')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="rightsHolder"
                  maxLength={200}
                  defaultValue={asset.rightsHolder ?? ''}
                />
              )}
            </Field>
            <Field id={`${prefix}-evidence`} label={t('assets.licenceEvidence')}>
              {(props) => (
                <TextArea {...props} name="licenceEvidence" rows={2} maxLength={1000} />
              )}
            </Field>
          </ActionForm>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Disposing of a raw body: a stated reason and an explicit confirmation. The
 * metadata and checksum stay, and the act is audited.
 */
function DisposeForm({
  snapshotId,
  locale,
  copy,
}: {
  readonly snapshotId: string;
  readonly locale: Locale;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('dispose.heading')}</h3>
        <p className="text-sm">{t('dispose.help')}</p>
        <ActionForm
          action={disposeSnapshotAction}
          submitLabel={t('dispose.submit')}
          pendingLabel={t('pending')}
          tone="destructive"
          messages={{ ...copy.messages, success: t('dispose.done') }}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="snapshotId" value={snapshotId} />
          <Field id="dispose-reason" label={t('dispose.reason')}>
            {(props) => (
              <TextArea {...props} name="reason" rows={2} required maxLength={500} />
            )}
          </Field>
          <ConfirmField id="dispose-confirm" label={t('dispose.confirm')} />
        </ActionForm>
      </div>
    </Panel>
  );
}
