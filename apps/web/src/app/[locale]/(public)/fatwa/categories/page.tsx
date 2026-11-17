import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FatwaCategoriesPage } from '@/components/fatwa/categories';
import { FatwaAwaiting } from '@/components/fatwa/guide';
import { fatwaAvailability, fatwaMetadata } from '@/components/fatwa/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/categories` — every active Fatwa category (ROUTE_MAP.md
 * §3.8). Signed out and dynamic. While the service is inactive it awaits the
 * service (`FatwaAwaiting`, Fatwa Part 1) and lists nothing.
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
  if (!availability.active) return <FatwaAwaiting locale={locale} section="categories" />;
  return <FatwaCategoriesPage locale={locale} availability={availability} />;
}
