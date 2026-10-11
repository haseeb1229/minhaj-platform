import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  juzPathOf,
  readJuzSegment,
  readQuranOffset,
} from '@/components/quran/presentation';
import { quranAvailability, quranMetadata, readJuz } from '@/components/quran/read';
import { JuzPage } from '@/components/quran/reader';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/juz/{juzNumber}` — one Juz in bounded pages of
 * `QURAN_JUZ_PAGE` ayat, every Ayah linked to its canonical citation. Each page
 * canonicalises to itself (ROUTE_MAP.md §9.1 rule 4). A Juz the reader does not
 * have is a 404.
 */
export const dynamic = 'force-dynamic';

interface JuzParams {
  readonly params: Promise<{ readonly locale: string; readonly juzNumber: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function load(params: JuzParams['params']) {
  const { juzNumber } = await params;
  const number = readJuzSegment(juzNumber);
  return number === null ? null : readJuz(number);
}

export async function generateMetadata({
  params,
  searchParams,
}: JuzParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const juz = await load(params);
  if (juz === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'quran' });
  const offset = readQuranOffset(await searchParams);
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: `${juzPathOf(juz.number)}${offset === 0 ? '' : `?offset=${String(offset)}`}`,
    title: t('juzName', { number: juz.number }),
  });
}

export default async function JuzRoute({ params, searchParams }: JuzParams) {
  const locale = await requireLocale(params);
  const [availability, juz] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || juz === null) notFound();
  return (
    <JuzPage
      locale={locale}
      availability={availability}
      juz={juz}
      offset={readQuranOffset(await searchParams)}
    />
  );
}
