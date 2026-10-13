import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { FATWA_PERMISSIONS } from '@minhaj/contracts/fatwa';
import type { PermissionKey } from '@minhaj/contracts/identity';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { TextLink } from '@/components/ui';
import { FATWA_KEYS } from './shared';

/**
 * The Fatwa administration shell (ROUTE_MAP.md §7:
 * `/admin/fatwa/{questions|assignment|drafts|review|published|categories}`),
 * Phase 20.
 *
 * ITS OWN SURFACE, NEVER THE EDITORIAL CMS. Fatwa is a bounded context of its
 * own, administered through its own screens under its own three keys
 * (DOMAIN_MODEL.md §12); nothing here lives under `/admin/editorial`.
 *
 * `noindex, nofollow` for the whole subtree and rendered per request — every
 * page reads a session and privilege state, and a private question is shown on
 * some of them; a cached copy of any of it would be somebody else's (§17). The
 * navigation is filtered by permission as presentation only: every page
 * re-checks its own key server-side and every action re-checks it again
 * (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy — rather
 * than shipping every administrative message to the browser.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

/** Each screen and the keys that open it — any one of them. */
const SURFACES: readonly {
  readonly key:
    'questions' | 'assignment' | 'drafts' | 'review' | 'published' | 'categories';
  readonly permissions: readonly PermissionKey[];
}[] = [
  { key: 'questions', permissions: [FATWA_PERMISSIONS.receive] },
  { key: 'assignment', permissions: [FATWA_PERMISSIONS.receive] },
  { key: 'drafts', permissions: [FATWA_PERMISSIONS.answer] },
  { key: 'review', permissions: [FATWA_PERMISSIONS.publish] },
  { key: 'published', permissions: [FATWA_PERMISSIONS.publish] },
  { key: 'categories', permissions: FATWA_KEYS },
];

export default async function FatwaAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'fatwaAdmin' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();

  // A signed-in session holding NONE of the three keys is refused here, above
  // the area's loading boundary, so the refusal is a real 404 status — a page
  // calling `notFound()` inside that boundary can only stream a 404 page under
  // a 200 once the shell has flushed. A signed-out visitor falls through to the
  // page's own guard, which sends them to sign in. Every page and action still
  // re-checks its own key.
  if (active !== null && !FATWA_KEYS.some((key) => held.has(key))) notFound();
  const visible = SURFACES.filter((surface) =>
    surface.permissions.some((permission) => held.has(permission)),
  );

  return (
    <>
      {visible.length === 0 ? null : (
        <nav className="flex flex-wrap gap-4" aria-label={t('title')}>
          {visible.map((surface) => (
            <TextLink key={surface.key} href={`/${locale}/admin/fatwa/${surface.key}`}>
              {t(`surface.${surface.key}`)}
            </TextLink>
          ))}
        </nav>
      )}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          fatwaAdmin: {
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
