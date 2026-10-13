import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FatwaCategoriesPage } from '@/components/fatwa/categories';
import { FatwaUnavailable } from '@/components/fatwa/parts';
import { fatwaAvailability, fatwaMetadata } from '@/components/fatwa/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/categories` — every active Fatwa category (ROUTE_MAP.md
 * §3.8). Signed out and dynamic; honest while the service is inactive.
 */
export const dynamic = 'force-dynamic';

interface CategoriesParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: CategoriesParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return fatwaMetadata({
    locale,
    availability: await fatwaAvailability(),
    canonicalPath: '/fatwa/categories',
    title: t('sections.categories'),
    description: t('sectionBody.categories'),
  });
}

export default async function FatwaCategoriesRoute({ params }: CategoriesParams) {
  const locale = await requireLocale(params);
  const availability = await fatwaAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'fatwa' });
    return <FatwaUnavailable locale={locale} section={t('sections.categories')} />;
  }
  return <FatwaCategoriesPage locale={locale} availability={availability} />;
}
