import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { HadithLandingPage, HadithLandingUnavailable } from '@/components/hadith/landing';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith` — the Hadith landing (ROUTE_MAP.md §3.4; Phase 19).
 *
 * SIGNED OUT, AND `force-dynamic` because whether any collection is activated,
 * and what is public in it, is mutable data. While none is activated the page
 * says so honestly and is `noindex`; while the activation is fixture text it
 * carries the fixture banner and is `noindex`; only an approved activation is
 * indexable.
 */
export const dynamic = 'force-dynamic';

interface LandingParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: LandingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: '/hadith',
    title: t('title'),
    description: t('description'),
  });
}

export default async function HadithPage({ params }: LandingParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) return <HadithLandingUnavailable locale={locale} />;
  return <HadithLandingPage locale={locale} availability={availability} />;
}
