import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';

/**
 * The Hadith administration shell (ROUTE_MAP.md §7:
 * `/admin/hadith/{collections|books|chapters|records|commentary|sciences}`),
 * Phase 19.
 *
 * ITS OWN SURFACE, NEVER THE EDITORIAL CMS AND NEVER THE QURAN'S. Hadith is a
 * religious context of its own, administered through its own screens with its
 * own permissions (SECURITY_BASELINE.md §5.3); nothing here lives under
 * `/admin/editorial` or `/admin/quran`.
 *
 * `noindex, nofollow` for the whole subtree and rendered per request — every
 * page reads a session and privilege state, and a cached copy of any of it would
 * be somebody else's (§17). The navigation is filtered by permission as
 * presentation only: every page re-checks `hadith.read` server-side and every
 * action re-checks `hadith.administer`, or `hadith.editCanonical` with step-up
 * for every sourced write (§3.4 rule 1).
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy — rather
 * than shipping every administrative message to the browser.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = [
  'collections',
  'books',
  'chapters',
  'records',
  'commentary',
  'sciences',
] as const;

export default async function HadithAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadithAdmin' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();

  return (
    <>
      {held.has('hadith.read') ? (
        <WorkspaceNav
          label={t('title')}
          variant="tabs"
          groups={[
            {
              key: 'hadith',
              links: SURFACES.map((surface) => ({
                key: surface,
                href: `/${locale}/admin/hadith/${surface}`,
                text: t(`surface.${surface}`),
              })),
            },
          ]}
        />
      ) : null}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          hadithAdmin: {
            unknown: t('unknown'),
            reload: t('reload'),
            loading: t('loading'),
          },
        }}
      >
        {children}
      </NextIntlClientProvider>
    </>
  );
}
