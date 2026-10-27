import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';

/**
 * The Global Network administration shell (ROUTE_MAP.md §7:
 * `/admin/global/{countries|regions|cities|centres}`), Phase 16.
 *
 * `noindex, nofollow` for the whole subtree, and the navigation is filtered by
 * permission as presentation only: every page re-checks `global.read`
 * server-side and every action re-checks `global.administer`
 * (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy — rather
 * than shipping every administrative message to the browser.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = ['countries', 'regions', 'cities', 'centres'] as const;

export default async function GlobalAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin.global' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();

  return (
    <>
      {held.has('global.read') ? (
        <WorkspaceNav
          label={t('title')}
          variant="tabs"
          groups={[
            {
              key: 'global',
              links: SURFACES.map((surface) => ({
                key: surface,
                href: `/${locale}/admin/global/${surface}`,
                text: t(`surface.${surface}`),
              })),
            },
          ]}
        />
      ) : null}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          admin: {
            global: { unknown: t('unknown'), reload: t('reload'), loading: t('loading') },
          },
        }}
      >
        {children}
      </NextIntlClientProvider>
    </>
  );
}
