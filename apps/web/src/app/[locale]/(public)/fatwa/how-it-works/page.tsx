import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FatwaHowItWorksPage } from '@/components/fatwa/how-it-works';
import { fatwaAvailability, fatwaMetadata } from '@/components/fatwa/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/how-it-works` — how the Fatwa service works
 * (ROUTE_MAP.md §3.8).
 *
 * THE ONE PUBLIC FATWA PAGE THAT RENDERS WHILE THE SERVICE IS INACTIVE: the
 * process is true either way, and the page says whether questions are being
 * accepted now. Dynamic, because that sentence is mutable data; indexable only
 * under an approved activation, like every other Fatwa page.
 */
export const dynamic = 'force-dynamic';

interface ProcessParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: ProcessParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return fatwaMetadata({
    locale,
    availability: await fatwaAvailability(),
    canonicalPath: '/fatwa/how-it-works',
    title: t('howItWorks.title'),
    description: t('sectionBody.howItWorks'),
  });
}

export default async function FatwaHowItWorksRoute({ params }: ProcessParams) {
  const locale = await requireLocale(params);
  return <FatwaHowItWorksPage locale={locale} availability={await fatwaAvailability()} />;
}
