import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FatwaLandingPage } from '@/components/fatwa/landing';
import { FatwaUnavailable } from '@/components/fatwa/parts';
import { fatwaAvailability, fatwaMetadata } from '@/components/fatwa/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa` — the Fatwa landing and browse (ROUTE_MAP.md §3.8; Phase 20).
 *
 * EVERY QUERY VIEW CANONICALISES TO `/fatwa`. `?sort=`, `?category=`,
 * `?topic=` and `?offset=` are derived views of one collection, so the
 * canonical link never carries a query and none of them is a sitemap entry
 * (ROUTE_MAP.md §2.3, §9.4).
 *
 * SIGNED OUT, AND `force-dynamic` because whether the service is activated,
 * and what is published, is mutable data. Inactive: an honest unavailable
 * state, `noindex`. Fixture: the fixture banner, `noindex`. Only an approved
 * activation on an indexable deployment is indexable.
 */
export const dynamic = 'force-dynamic';

interface LandingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: LandingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return fatwaMetadata({
    locale,
    availability: await fatwaAvailability(),
    canonicalPath: '/fatwa',
    title: t('title'),
    description: t('description'),
  });
}

export default async function FatwaPage({ params, searchParams }: LandingParams) {
  const locale = await requireLocale(params);
  const availability = await fatwaAvailability();
  if (!availability.active) return <FatwaUnavailable locale={locale} />;
  return (
    <FatwaLandingPage
      locale={locale}
      availability={availability}
      query={await searchParams}
    />
  );
}
