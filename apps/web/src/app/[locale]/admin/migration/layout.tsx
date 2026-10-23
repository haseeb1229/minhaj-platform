import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { TextLink } from '@/components/ui';

/**
 * The Migration administration shell (DELIVERY_PLAN.md Phase 29; ROUTE_MAP.md
 * §7): sources, runs, the staging review queue, duplicates, URL and topic
 * mapping, errors and missing records, manifests with their promotions, and
 * reconciliation.
 *
 * THREE KEYS, NONE IMPLYING ANOTHER. `migration.read` opens every screen
 * here; every preparing, reviewing or correcting act re-checks
 * `migration.administer` in its own Server Action; publishing, rolling back
 * and approving a promotion need `migration.publish` — externally gated,
 * bundled into no role — with a live `migration-publication` step-up. The
 * service checks each again, live, and the database refuses a publication
 * without both a third time.
 *
 * `noindex, nofollow` for the whole subtree and rendered per request. A
 * signed-in session without `migration.read` is refused HERE, above the area's
 * loading boundary, so the refusal is a real 404 status; a signed-out visitor
 * reaches the page's own guard, which sends them to sign in.
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = [
  { key: 'overview', path: '' },
  { key: 'sources', path: '/sources' },
  { key: 'runs', path: '/runs' },
  { key: 'staging', path: '/staging' },
  { key: 'duplicates', path: '/duplicates' },
  { key: 'urlMapping', path: '/url-mapping' },
  { key: 'errors', path: '/errors' },
  { key: 'manifests', path: '/manifests' },
  { key: 'reconciliation', path: '/reconciliation' },
] as const;

export default async function MigrationAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'adminMigration' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();
  if (active !== null && !held.has('migration.read')) notFound();

  return (
    <>
      {active === null ? null : (
        <nav aria-label={t('title')}>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {SURFACES.map((surface) => (
              <li key={surface.key}>
                <TextLink href={`/${locale}/admin/migration${surface.path}`}>
                  {t(`surface.${surface.key}`)}
                </TextLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          adminMigration: {
            unknown: t('unknown'),
            reload: t('reload'),
            loading: t('loading'),
          },
        }}
      >
        <div className="min-w-0 wrap-anywhere">{children}</div>
      </NextIntlClientProvider>
    </>
  );
}
