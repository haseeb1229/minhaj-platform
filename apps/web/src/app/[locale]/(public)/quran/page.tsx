import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { QuranLandingPage, QuranLandingUnavailable } from '@/components/quran/landing';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran` — the Quran landing (ROUTE_MAP.md §3.3; Phase 18).
 *
 * SIGNED OUT, AND `force-dynamic` because whether a corpus is active, and what
 * is public beside it, is mutable data. While no corpus is active the page says
 * so honestly and is `noindex`; while the corpus is fixture text it carries the
 * fixture banner and is `noindex`; only an approved corpus is indexable.
 */
export const dynamic = 'force-dynamic';

interface LandingParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: LandingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: '/quran',
    title: t('title'),
    description: t('description'),
  });
}

export default async function QuranPage({ params }: LandingParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) return <QuranLandingUnavailable locale={locale} />;
  return <QuranLandingPage locale={locale} availability={availability} />;
}
