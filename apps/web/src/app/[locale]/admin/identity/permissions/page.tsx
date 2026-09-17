import { getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { Alert, DataCell, DataRow, DataTable, PageHeading, Panel } from '@/components/ui';

/**
 * The permission catalogue — READ-ONLY, and structurally so.
 *
 * There is no create, no edit and no delete here, and not because they were
 * left out: the runtime principal holds SELECT and nothing else on the
 * `Permission` table, so a form that tried would be refused by the database.
 * The catalogue is migration-controlled, which is what makes "permissions are
 * the single enforcement vocabulary" a fact rather than an intention
 * (SECURITY_BASELINE.md §3.1).
 *
 * BUNDLING BELONGS TO ROLES. Which permissions an account holds is decided by
 * role membership, on the roles surface, under `permissions.grant`.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PermissionsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });

  await requireAdminPage(
    locale,
    'permissions.read',
    `/${locale}/admin/identity/permissions`,
  );

  const { administration } = identityRuntime();
  const catalogue = await administration.catalogue();

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('permissions.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('permissions.description')}
        </p>
      </header>

      <Alert tone="info">{t('permissions.readOnly')}</Alert>

      <Panel>
        <DataTable
          caption={t('permissions.title')}
          columns={[t('permissions.key'), t('permissions.permissionDescription')]}
        >
          {catalogue.map((entry) => (
            <DataRow key={entry.key}>
              <DataCell>
                <code className="text-xs">{entry.key}</code>
              </DataCell>
              <DataCell wrap>
                {entry.known ? entry.description : t('permissions.unknown')}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      </Panel>
    </main>
  );
}
