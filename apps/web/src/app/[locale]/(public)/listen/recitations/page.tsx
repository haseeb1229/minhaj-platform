import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { quranReadRuntime } from '@/composition/quran-read';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { ListenRecitationsPage } from '@/components/quran/recitations';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/listen/recitations` — the CATALOGUE PROJECTION of Quran-owned
 * recitations into Listen (ROUTE_MAP.md §3.7; DOMAIN_MODEL.md §8.1).
 *
 * LAYER 4 OVER QURAN'S PUBLIC READER, AND NOTHING ELSE. Every row comes from
 * `quranReadRuntime()`; this page reaches no Media composition, context or
 * contract, so an AudioTrack can never fill it. It canonicalises to
 * `/quran/recitations`, so the two addresses never compete.
 *
 * ABSENT UNTIL QURAN DELIVERS IT. While no corpus is active there is no
 * recitation catalogue to project, and the address is a 404 rather than an
 * empty frame (ROUTE_MAP.md §3.7, §5.2). Fixture text carries the banner and is
 * `noindex`.
 */
export const dynamic = 'force-dynamic';

interface ListenParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: ListenParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: '/quran/recitations',
    title: t('sections.recitations'),
    description: t('sectionBody.recitations'),
  });
}

export default async function ListenRecitationsRoute({ params }: ListenParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) notFound();
  return (
    <ListenRecitationsPage
      locale={locale}
      availability={availability}
      recitations={await quranReadRuntime().reader.recitations()}
    />
  );
}
