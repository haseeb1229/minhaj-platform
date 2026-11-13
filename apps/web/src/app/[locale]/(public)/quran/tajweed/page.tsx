import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import {
  quranAvailability,
  quranMetadata,
  readTajweedOverlays,
} from '@/components/quran/read';
import { TajweedHubPage } from '@/components/quran/tajweed';
import { TajweedListingPage } from '@/components/quran/works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/tajweed` — the Tajweed hub (Quran Part 9): with a public
 * colour overlay, every rule with its colour and real examples, the published
 * guidance beside them; without one, the public Tajweed guidance alone, in its
 * recorded order.
 *
 * Signed out and `force-dynamic`: the corpus and its works are mutable data.
 * The honest unavailable state while no corpus is active; the fixture banner
 * and `noindex` while it is fixture text (Phase 18 §6).
 */
export const dynamic = 'force-dynamic';

interface SectionParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: '/quran/tajweed',
    title: t('sections.tajweed'),
    description: t('sectionBody.tajweed'),
  });
}

export default async function TajweedRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.tajweed')} />;
  }
  const [overlay] = await readTajweedOverlays();
  return overlay === undefined ? (
    <TajweedListingPage locale={locale} availability={availability} />
  ) : (
    <TajweedHubPage locale={locale} availability={availability} overlay={overlay} />
  );
}
