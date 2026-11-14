import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { HadithIntroductionPage } from '@/components/hadith/guide';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/introduction` — what the Hadith section is, how it is
 * organised, what is open now and how to read a citation page. Product
 * guidance only; it claims nothing about any narration.
 *
 * IT STANDS WITHOUT A CORPUS (Hadith Part 2; ROUTE_MAP.md §3.4). It reads no
 * Hadith record — only whether a collection is activated, to say so and to
 * link the pages that are open — so while none is it is the section's honest
 * guide rather than an unavailable state (its form from Phase 19 to Hadith
 * Part 2, historical). Signed out and `force-dynamic`: activation and the
 * hubs' figures are mutable data. The fixture banner and `noindex` while the
 * activation is fixture text; `noindex` with no canonical claim while no
 * activation is approved.
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
    canonicalPath: '/hadith/introduction',
    title: t('sections.introduction'),
    description: t('sectionBody.introduction'),
  });
}

export default async function IntroductionRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  return (
    <HadithIntroductionPage locale={locale} availability={await hadithAvailability()} />
  );
}
