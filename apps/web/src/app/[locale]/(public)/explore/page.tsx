import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Container, PageHero } from '@/components/ui';
import { ExplorePanel } from '@/components/shell/explore-panel';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * The Explore landing (ROUTE_MAP.md §3.2).
 *
 * A genuine navigational hub — the index of the section — which is why it is
 * `delivered` and indexing-eligible while everything beneath it is a reserved
 * shell. Its content is the navigation itself, and the same panel the mega menu
 * and the mobile drawer render, so the three cannot list different things.
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
    route: requireRoute('explore'),
    title: t('explore.title'),
    description: t('explore.description'),
  });
}

export default async function ExplorePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <>
      <PageHero title={t('explore.title')} lede={t('explore.description')} />
      <Container>
        <div className="py-[var(--space-page)]">
          <ExplorePanel locale={locale} />
        </div>
      </Container>
    </>
  );
}
