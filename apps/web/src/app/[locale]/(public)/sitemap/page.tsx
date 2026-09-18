import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Container, Prose, StatusBadge } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import {
  SHELL_ROUTES,
  isAvailable,
  pathFor,
  requireRoute,
  type AvailableRoute,
} from '@/shell/registry';

/**
 * The HUMAN-readable sitemap (ROUTE_MAP.md §3.1, §5.1 — Phase 4, extended as
 * domains ship).
 *
 * A Layer-4 composition over the one registry, so it lists exactly what the
 * header, the menu and the footer lead to. It is not the machine sitemap and
 * shares none of its rules: this page is for a person trying to find
 * something.
 *
 * WHAT IT EXCLUDES, and why each exclusion is the registry's doing rather than
 * a hand-maintained list (§31 of the phase contract):
 *
 *   - PRIVATE routes — `/my` and everything beneath it — because a public index
 *     of an authenticated area is not navigation, it is reconnaissance;
 *   - ADMINISTRATIVE routes, which are not in the public registry at all;
 *   - API, `robots.txt` and the machine sitemaps, which are not pages;
 *   - DEFERRED capabilities, which have no route to list.
 *
 * WHAT IT INCLUDES HONESTLY. Reserved shells appear, MARKED as reserved. A
 * visitor looking for the privacy policy is better served by "this page exists
 * and is not published yet" than by silence, and the badge is text rather than
 * a colour so it survives monochrome and a screen reader alike.
 */

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'shell' });

  return shellMetadata({
    locale,
    route: requireRoute('sitemap'),
    title: t('sitemap.title'),
    description: t('sitemap.description'),
  });
}

export default async function HumanSitemapPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });

  const listed: readonly AvailableRoute[] = SHELL_ROUTES.filter(
    (route): route is AvailableRoute =>
      isAvailable(route) && route.visibility === 'public',
  );

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Prose>
          <h1 className="text-3xl font-semibold tracking-tight">{t('sitemap.title')}</h1>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('sitemap.description')}
          </p>
        </Prose>

        <nav aria-label={t('sitemap.title')}>
          <ul className="flex flex-col gap-2">
            {listed.map((route) => (
              <li key={route.key} className="flex flex-wrap items-center gap-2 text-sm">
                <a href={pathFor(locale, route)} className="underline underline-offset-2">
                  {t(route.label as 'nav.home')}
                </a>
                {route.availability === 'reserved' ? (
                  <StatusBadge tone="caution">{t('sitemap.reservedBadge')}</StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Container>
  );
}
