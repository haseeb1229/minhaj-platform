import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { juzWindows, readJuzWindow, withJuzWindow } from '@/components/quran/juz-layout';
import {
  juzPathOf,
  readJuzSegment,
  readReadingRequest,
} from '@/components/quran/presentation';
import {
  quranAvailability,
  quranMetadata,
  readJuz,
  readJuzOutline,
} from '@/components/quran/read';
import { JuzPage } from '@/components/quran/reader';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/juz/{juzNumber}` — one Juz read by its own divisions
 * (Quran Part 3): one window per hizb the source recorded, a long hizb in
 * parts that break between mushaf pages. `?hizb=` and `?part=` name the
 * window (anything unknown is the first); each window canonicalises to itself
 * (ROUTE_MAP.md §9.1 rule 4), the first to the bare address. Every Ayah links
 * to its canonical citation. A Juz the reader does not have is a 404.
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
  const windows = juzWindows(await readJuzOutline(juz.number));
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: withJuzWindow(
      juzPathOf(juz.number),
      windows,
      readJuzWindow(await searchParams, windows),
    ),
    title: t('juzName', { number: juz.number }),
  });
}

export default async function JuzRoute({ params, searchParams }: JuzParams) {
  const locale = await requireLocale(params);
  const [availability, juz] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || juz === null) notFound();
  const query = await searchParams;
  return (
    <JuzPage
      locale={locale}
      availability={availability}
      juz={juz}
      window={query}
      request={readReadingRequest(query)}
    />
  );
}
