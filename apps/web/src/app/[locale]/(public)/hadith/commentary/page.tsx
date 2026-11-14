import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CommentaryPage } from '@/components/hadith/commentary';
import { HadithAwaiting } from '@/components/hadith/guide';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/commentary` — the public commentary works. Their entries
 * are read on the citations they comment on.
 *
 * Signed out and `force-dynamic`: activation and what is public are mutable
 * data. While no collection is activated it awaits an authorised source
 * (`HadithAwaiting`, Hadith Part 2); the
 * fixture banner and `noindex` while the activation is fixture text.
 */
export const dynamic = 'force-dynamic';

interface SectionParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: '/hadith/commentary',
    title: t('sections.commentary'),
    description: t('sectionBody.commentary'),
  });
}

export default async function CommentaryRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active)
    return <HadithAwaiting locale={locale} section="commentary" />;
  return <CommentaryPage locale={locale} availability={availability} />;
}
