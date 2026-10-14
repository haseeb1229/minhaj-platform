import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { citationOf } from '@minhaj/contracts/quran';

import { quranReadRuntime } from '@/composition/quran-read';
import {
  ayahPathOf,
  readAyahSegment,
  readReadingRequest,
  readSurahSegment,
} from '@/components/quran/presentation';
import { quranAvailability, quranMetadata, readSurah } from '@/components/quran/read';
import { AyahPage } from '@/components/quran/reader';
import { PersonalControls } from '@/components/personal-island/personal-controls';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/surah/{surahNumber}/{ayahNumber}` — THE CANONICAL CITATION
 * of one Ayah (ROUTE_MAP.md §2.1, §3.3). It never changes and backs every
 * citation for ever, whatever a reader chooses to read beside it: the reading
 * preferences are query values, and the canonical link is always this bare
 * address.
 *
 * Previous and next cross Surah boundaries using the reader's own counts; a
 * recitation is offered for the segment that covers this Ayah, when one does.
 * An address that names no public Ayah is a 404.
 */
export const dynamic = 'force-dynamic';

interface AyahParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly surahNumber: string;
    readonly ayahNumber: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const readAyah = cache((surah: number, ayah: number) =>
  quranReadRuntime().reader.ayah({ surah, ayah }),
);

async function load(params: AyahParams['params']) {
  const { surahNumber, ayahNumber } = await params;
  const surah = readSurahSegment(surahNumber);
  const ayah = readAyahSegment(ayahNumber);
  if (surah === null || ayah === null) return null;
  const [surahRecord, ayahRecord] = await Promise.all([
    readSurah(surah),
    readAyah(surah, ayah),
  ]);
  return surahRecord === null || ayahRecord === null
    ? null
    : { surah: surahRecord, ayah: ayahRecord };
}

export async function generateMetadata({ params }: AyahParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const found = await load(params);
  if (found === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'quran' });
  const ref = { surah: found.ayah.surah, ayah: found.ayah.ayah };
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: ayahPathOf(ref),
    title: `${t('ayahName', ref)} (${citationOf(ref)})`,
  });
}

export default async function AyahRoute({ params, searchParams }: AyahParams) {
  const locale = await requireLocale(params);
  const [availability, found] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || found === null) notFound();
  return (
    <>
      <AyahPage
        locale={locale}
        availability={availability}
        surah={found.surah}
        ayah={found.ayah}
        request={readReadingRequest(await searchParams)}
      />
      <PersonalControls
        locale={locale}
        target={{ kind: 'ayah', surah: found.ayah.surah, ayah: found.ayah.ayah }}
        framed
      />
    </>
  );
}
