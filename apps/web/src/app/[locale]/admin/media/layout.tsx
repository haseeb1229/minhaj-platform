import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { TextLink } from '@/components/ui';

/**
 * The Media administration shell (ROUTE_MAP.md §7).
 *
 * THREE SURFACES, AND ONLY THREE. ROUTE_MAP.md §7 names
 * `/admin/media/{videos|audio|photos|galleries|playlists|series|assets}`; Phase
 * 10 delivers videos, series and playlists. Audio, photos, galleries and the
 * asset library belong to Phases 11 and 12 and have no link here at all.
 *
 * `noindex, nofollow` for the whole subtree, and the navigation is filtered by
 * permission as presentation only: every page re-checks `media.read`
 * server-side and every action re-checks `media.administer`
 * (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy — rather
 * than shipping every administrative message to the browser.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = ['videos', 'series', 'playlists'] as const;

export default async function MediaAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'media' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();

  return (
    <>
      {held.has('media.read') ? (
        <nav className="flex flex-wrap gap-4" aria-label={t('title')}>
          {SURFACES.map((surface) => (
            <TextLink key={surface} href={`/${locale}/admin/media/${surface}`}>
              {t(`surface.${surface}`)}
            </TextLink>
          ))}
        </nav>
      ) : null}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          media: { unknown: t('unknown'), reload: t('reload'), loading: t('loading') },
        }}
      >
        {children}
      </NextIntlClientProvider>
    </>
  );
}
