import { getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  PageHeading,
  StatusBadge,
} from '@/components/ui';
import { publicIndexingEnabled } from '@/config/indexing';
import { SHELL_ROUTES, isAvailable, type ShellRoute } from '@/shell/registry';

/**
 * `/{locale}/admin/system/navigation` — READ-ONLY, and only what is promised.
 *
 * ROUTE_MAP.md §5.1 places this surface at Phase 4 "only to the extent it is
 * genuinely promised", and what is genuinely promised is visibility: an
 * operator being able to see the effective public shell — which routes exist,
 * which are placeholders, which are still deferred, and what each one is
 * eligible for in a search index.
 *
 * IT EDITS NOTHING, AND THERE IS NOTHING HERE TO EDIT.
 *
 * The shell route registry is CODE (`apps/web/src/shell/registry.ts`),
 * reviewed like code and deployed like code. There is no Navigation table, no
 * Menu table, no SiteSettings row and no Page record behind any of this, so
 * there is no mutation contract to expose — and a Save button with nothing
 * behind it would be worse than no button. Making navigation editable at
 * runtime would be introducing a navigation CMS, which Phase 4 explicitly must
 * not do (DELIVERY_PLAN.md, Phase 4).
 *
 * WHY IT IS PERMISSION-CHECKED ANYWAY. It discloses the platform's shape,
 * including routes that are reserved and not yet linked from anywhere public.
 * That is operator information, so it is gated on `navigation.read` like every
 * other administrative surface — server-side, by key, never by role name
 * (SECURITY_BASELINE.md §3.1). A signed-in visitor without the key gets a 404,
 * not a 403, for the same reason every other admin route does.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** How each availability is badged. Text, never colour alone. */
function toneFor(route: ShellRoute): 'positive' | 'caution' | 'neutral' {
  if (route.availability === 'delivered') return 'positive';
  if (route.availability === 'reserved') return 'caution';
  return 'neutral';
}

export default async function NavigationStatusPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  await requireAdminPage(locale, 'navigation.read', `/${locale}/admin/system/navigation`);

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('navigation.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('navigation.description')}
        </p>
      </header>

      {/*
       * THE SOURCE OF TRUTH, STATED ON THE SCREEN.
       *
       * An operator looking at a status table is entitled to know why it has no
       * controls. Saying "this is code-managed" here is the difference between
       * a read-only surface and a surface whose edit controls somebody assumes
       * are missing by mistake.
       */}
      <Alert tone="info">{t('navigation.codeManaged')}</Alert>

      <Alert tone={publicIndexingEnabled() ? 'warning' : 'info'}>
        {publicIndexingEnabled()
          ? t('navigation.indexingEnabled')
          : t('navigation.indexingDisabled')}
      </Alert>

      <DataTable
        caption={t('navigation.caption')}
        columns={[
          t('navigation.columnRoute'),
          t('navigation.columnPath'),
          t('navigation.columnPlacement'),
          t('navigation.columnAvailability'),
          t('navigation.columnIndexing'),
        ]}
      >
        {SHELL_ROUTES.map((route) => (
          <DataRow key={route.key}>
            <DataCell wrap>
              <span className="font-medium">{shell(route.label as 'nav.home')}</span>
              <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                {route.key}
              </span>
            </DataCell>

            {/*
             * A DEFERRED ROUTE HAS NO PATH TO SHOW, and the registry gives it
             * no `path` field at all — so this cell cannot accidentally render
             * a link to something that does not exist.
             */}
            <DataCell wrap>
              {isAvailable(route) ? `/${locale}${route.path}` : t('navigation.noPath')}
            </DataCell>

            <DataCell wrap>
              {route.placements.length === 0
                ? t('navigation.noPlacement')
                : route.placements.join(', ')}
            </DataCell>

            <DataCell>
              <StatusBadge tone={toneFor(route)}>
                {t(`navigation.availability.${route.availability}` as const)}
              </StatusBadge>
            </DataCell>

            <DataCell>
              {isAvailable(route)
                ? t(`navigation.indexing.${route.indexing}` as const)
                : t('navigation.indexing.excluded')}
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
    </main>
  );
}
