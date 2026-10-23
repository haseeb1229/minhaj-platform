import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  migrationIdSchema,
  type ManifestEntryRecord,
  type ManifestRecord,
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
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import {
  createPromotionAction,
  discardManifestAction,
  publishManifestAction,
  rollbackManifestAction,
} from '../../actions';
import {
  Code,
  MigrationPublicationStepUp,
  MigrationTime,
  RowIdentity,
  actorOf,
  adminMigrationCopy,
  migrationPath,
  migrationRead,
  type AdminMigrationCopy,
} from '../../shared';
import { EntryStateBadge, ManifestStateBadge } from '../../status';

/**
 * `/{locale}/admin/migration/manifests/{id}` — one publish manifest and its
 * entries, under `migration.read`.
 *
 * PUBLISHING AND ROLLING BACK need `migration.publish` — externally gated,
 * bundled into no role — with a live `migration-publication` step-up, checked
 * by the action, re-verified by the service and checked again by the
 * database. Each goes through the TARGET's own public interface, whose own
 * rules and authority apply; a target's refusal is final and shown per entry,
 * and a target that does not answer leaves the manifest resumable. A rollback
 * leaves an entry edited since publication — or held by a person — for a
 * person, never forced.
 *
 * Under `migration.administer`: discarding a draft, and creating a promotion
 * from published entries (carried by the command line once approved).
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MigrationManifestPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const base = migrationPath(locale, `/manifests/${encodeURIComponent(id)}`);
  const context = await requireAdminPage(locale, 'migration.read', base);
  if (!migrationIdSchema.safeParse(id).success) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const timeZone = context.session.account.timezone;
  const administer = context.authorization.can('migration.administer');
  const publisher = context.authorization.can('migration.publish');

  const found = await migrationRead('migration-admin-manifest', () =>
    migrationRuntime().read.manifest(actorOf(context), id),
  );
  if (!found.ok && ['denied', 'not-found', 'invalid'].includes(found.failure)) notFound();
  if (found.ok && found.value === null) notFound();
  const back = (
    <p>
      <TextLink href={migrationPath(locale, '/manifests')}>
        {t('manifests.back')}
      </TextLink>
    </p>
  );
  if (!found.ok || found.value === null)
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('manifest.title')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  const { manifest, entries } = found.value;
  const published = entries.filter((entry) => entry.state === 'published');
  const publishable = manifest.state === 'draft' || manifest.state === 'publishing';
  const reversible = manifest.state === 'published' || manifest.state === 'rolling-back';

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('manifest.title')}</PageHeading>
        <div className="flex flex-wrap items-center gap-2">
          <ManifestStateBadge state={manifest.state} copy={copy} />
        </div>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('manifest.run')}>
            <TextLink
              href={migrationPath(locale, `/runs/${encodeURIComponent(manifest.runId)}`)}
            >
              <Code>{manifest.runId}</Code>
            </TextLink>
          </DetailRow>
          <DetailRow term={t('manifest.created')}>
            <MigrationTime
              value={manifest.createdAt}
              locale={locale}
              timeZone={timeZone}
            />
          </DetailRow>
          {manifest.publishedAt === null ? null : (
            <DetailRow term={t('manifest.published')}>
              <MigrationTime
                value={manifest.publishedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
          {manifest.rollbackReason === null ? null : (
            <DetailRow term={t('manifest.rollbackReason')}>
              <bdi>{manifest.rollbackReason}</bdi>
            </DetailRow>
          )}
          {manifest.rolledBackAt === null ? null : (
            <DetailRow term={t('manifest.rolledBack')}>
              <MigrationTime
                value={manifest.rolledBackAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
          <DetailRow term={t('manifest.version')}>{manifest.version}</DetailRow>
        </dl>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="manifest-entries">
        <SectionHeading>
          <span id="manifest-entries">{t('manifest.entries')}</span>
        </SectionHeading>
        {entries.length === 0 ? (
          <EmptyState>{t('manifest.noEntries')}</EmptyState>
        ) : (
          <DataTable
            caption={t('manifest.entriesCaption', { total: entries.length })}
            columns={[
              t('manifest.column.position'),
              t('manifest.column.revision'),
              t('manifest.column.state'),
              t('manifest.column.canonicalPath'),
              t('manifest.column.refusal'),
            ]}
          >
            {entries.map((entry) => (
              <DataRow key={entry.id}>
                <DataCell>{entry.position + 1}</DataCell>
                <DataCell>
                  <TextLink
                    href={migrationPath(
                      locale,
                      `/staging/${encodeURIComponent(entry.stagedRecordId)}`,
                    )}
                  >
                    {t('manifest.openRevision')}
                  </TextLink>
                </DataCell>
                <DataCell>
                  <EntryStateBadge state={entry.state} copy={copy} />
                </DataCell>
                <DataCell wrap>
                  {entry.canonicalPath === null ? (
                    t('none')
                  ) : (
                    <Code>{entry.canonicalPath}</Code>
                  )}
                </DataCell>
                <DataCell wrap>
                  {entry.refusal === null ? t('none') : <Code>{entry.refusal}</Code>}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {publisher && (publishable || reversible) ? (
        <section className="flex flex-col gap-3" aria-labelledby="manifest-publication">
          <SectionHeading>
            <span id="manifest-publication">{t('publication.heading')}</span>
          </SectionHeading>
          <p className="text-sm">{t('publication.help')}</p>
          <MigrationPublicationStepUp locale={locale} />
          {publishable ? (
            <PublishForm manifest={manifest} copy={copy} locale={locale} />
          ) : null}
          {reversible ? (
            <RollbackForm manifest={manifest} copy={copy} locale={locale} />
          ) : null}
        </section>
      ) : publishable || reversible ? (
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('publication.publisherOnly')}
        </p>
      ) : null}

      {administer && manifest.state === 'draft' ? (
        <section className="flex flex-col gap-3" aria-labelledby="manifest-discard">
          <SectionHeading>
            <span id="manifest-discard">{t('manifest.discard.heading')}</span>
          </SectionHeading>
          <ActionForm
            action={discardManifestAction}
            submitLabel={t('manifest.discard.submit')}
            pendingLabel={t('pending')}
            tone="destructive"
            messages={{ ...copy.messages, success: t('manifest.discard.done') }}
          >
            <RowIdentity locale={locale} row={manifest} />
            <ConfirmField
              id="manifest-discard-confirm"
              label={t('manifest.discard.confirm')}
            />
          </ActionForm>
        </section>
      ) : null}

      {administer && published.length > 0 ? (
        <PromotionForm entries={published} copy={copy} locale={locale} />
      ) : null}

      {back}
    </main>
  );
}

function PublishForm({
  manifest,
  copy,
  locale,
}: {
  readonly manifest: ManifestRecord;
  readonly copy: AdminMigrationCopy;
  readonly locale: Locale;
}) {
  const { t } = copy;
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('publication.publish.heading')}</h3>
        <p className="text-sm">{t('publication.publish.help')}</p>
        <ActionForm
          action={publishManifestAction}
          submitLabel={t('publication.publish.submit')}
          pendingLabel={t('pending')}
          messages={{
            ...copy.messages,
            success: t('publication.publish.done'),
            'entries-refused': t('publication.publish.refused'),
          }}
        >
          <RowIdentity locale={locale} row={manifest} />
          <ConfirmField
            id="manifest-publish-confirm"
            label={t('publication.publish.confirm')}
          />
        </ActionForm>
      </div>
    </Panel>
  );
}

function RollbackForm({
  manifest,
  copy,
  locale,
}: {
  readonly manifest: ManifestRecord;
  readonly copy: AdminMigrationCopy;
  readonly locale: Locale;
}) {
  const { t } = copy;
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('publication.rollback.heading')}</h3>
        <p className="text-sm">{t('publication.rollback.help')}</p>
        <ActionForm
          action={rollbackManifestAction}
          submitLabel={t('publication.rollback.submit')}
          pendingLabel={t('pending')}
          tone="destructive"
          messages={{
            ...copy.messages,
            success: t('publication.rollback.done'),
            'entries-left': t('publication.rollback.left'),
          }}
        >
          <RowIdentity locale={locale} row={manifest} />
          <Field id="manifest-rollback-reason" label={t('publication.rollback.reason')}>
            {(props) => (
              <TextArea {...props} name="reason" rows={2} required maxLength={500} />
            )}
          </Field>
          <ConfirmField
            id="manifest-rollback-confirm"
            label={t('publication.rollback.confirm')}
          />
        </ActionForm>
      </div>
    </Panel>
  );
}

function PromotionForm({
  entries,
  copy,
  locale,
}: {
  readonly entries: readonly ManifestEntryRecord[];
  readonly copy: AdminMigrationCopy;
  readonly locale: Locale;
}) {
  const { t } = copy;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="manifest-promotion">
      <SectionHeading>
        <span id="manifest-promotion">{t('promotions.create.heading')}</span>
      </SectionHeading>
      <p className="text-sm">{t('promotions.create.help')}</p>
      <ActionForm
        action={createPromotionAction}
        submitLabel={t('promotions.create.submit')}
        pendingLabel={t('pending')}
        messages={{ ...copy.messages, success: t('promotions.create.done') }}
      >
        <input type="hidden" name="locale" value={locale} />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            {t('promotions.create.entries')}
          </legend>
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 text-sm">
              <input
                id={`promotion-entry-${entry.id}`}
                type="checkbox"
                name="manifestEntryId"
                value={entry.id}
                defaultChecked
                className="mt-1"
              />
              <label htmlFor={`promotion-entry-${entry.id}`}>
                {entry.canonicalPath === null ? (
                  t('promotions.create.entry', { position: entry.position + 1 })
                ) : (
                  <Code>{entry.canonicalPath}</Code>
                )}
              </label>
            </div>
          ))}
        </fieldset>
      </ActionForm>
    </section>
  );
}
