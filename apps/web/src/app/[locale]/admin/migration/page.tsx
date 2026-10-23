import { Alert, PageHeading, Panel, SectionHeading, TextLink } from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { requireLocale } from '@/config/route-locale';
import { adminMigrationCopy, migrationPath } from './shared';

/**
 * `/{locale}/admin/migration` — the Migration area's overview
 * (DELIVERY_PLAN.md Phase 29) under `migration.read`: what each surface is
 * for, and the two facts an operator must not have to discover by accident —
 * that Phase 29 works over synthetic FIXTURE sources only and contacts no
 * live source, and that runs and promotions are carried out by the command
 * line, not from this browser.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = [
  { key: 'sources', path: '/sources' },
  { key: 'runs', path: '/runs' },
  { key: 'staging', path: '/staging' },
  { key: 'duplicates', path: '/duplicates' },
  { key: 'urlMapping', path: '/url-mapping' },
  { key: 'errors', path: '/errors' },
  { key: 'manifests', path: '/manifests' },
  { key: 'reconciliation', path: '/reconciliation' },
] as const;

export default async function MigrationOverviewPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  await requireAdminPage(locale, 'migration.read', migrationPath(locale));
  const { t } = await adminMigrationCopy(locale);

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('overview.description')}
        </p>
        <Alert tone="info">{t('overview.fixturesOnly')}</Alert>
        <p className="text-sm">{t('overview.commandLine')}</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {SURFACES.map((surface) => (
          <Panel key={surface.key} as="li">
            <div className="flex flex-col gap-2">
              <SectionHeading>
                <TextLink href={migrationPath(locale, surface.path)}>
                  {t(`surface.${surface.key}`)}
                </TextLink>
              </SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t(`overview.surface.${surface.key}`)}
              </p>
            </div>
          </Panel>
        ))}
      </ul>
    </main>
  );
}
