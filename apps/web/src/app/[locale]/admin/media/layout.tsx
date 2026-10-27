import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';

/**
 * The Media administration shell (ROUTE_MAP.md §7).
 *
 * ONLY WHAT EXISTS. ROUTE_MAP.md §7 names
 * `/admin/media/{videos|audio|photos|galleries|playlists|series|assets}`; Phase
 * 10 delivered videos, series and playlists, and Phase 11 delivers audio, with
 * audio series beneath it at `audio/series` so they are never confused with the
 * Video series screen; Phase 12 delivers photos and galleries. There is no
 * generic asset library — a file is managed on the record it belongs to — so
 * `assets` has no link here.
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

const SURFACES = [
  { key: 'videos', path: 'videos' },
  { key: 'series', path: 'series' },
  { key: 'playlists', path: 'playlists' },
  { key: 'audio', path: 'audio' },
  { key: 'audioSeries', path: 'audio/series' },
  { key: 'photos', path: 'photos' },
  { key: 'galleries', path: 'galleries' },
] as const;

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
        <WorkspaceNav
          label={t('title')}
          variant="tabs"
          groups={[
            {
              key: 'media',
              links: SURFACES.map((surface) => ({
                key: surface.key,
                href: `/${locale}/admin/media/${surface.path}`,
                text: t(`surface.${surface.key}`),
              })),
            },
          ]}
        />
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
