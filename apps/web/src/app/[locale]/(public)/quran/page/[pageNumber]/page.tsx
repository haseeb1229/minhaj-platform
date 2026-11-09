import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { quranReadRuntime } from '@/composition/quran-read';
import { readPageSegment, readReadingRequest } from '@/components/quran/presentation';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { MushafPage } from '@/components/quran/reader';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/page/{pageNumber}` — one mushaf page (ROUTE_MAP.md §3.3;
 * Quran Part 1, owner direction 2026-11-09).
 *
 * THE SOURCE'S PAGES, AS TEXT. The ayat are those whose stored page is this
 * one (the Tanzil metadata's Medina mushaf pages on the reference preview),
 * read in ONE bounded query; no mushaf image is shown, because none is
 * licensed. A page no public Ayah carries — outside the corpus's range, any
 * page while no corpus is active, or every page of a corpus that records none
 * — is a 404: the resource is absent. Reading preferences are query values,
 * as on a Surah; the canonical address is the bare page address.
 */
export const dynamic = 'force-dynamic';

interface PageParams {
  readonly params: Promise<{ readonly locale: string; readonly pageNumber: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const readPage = cache((page: number) => quranReadRuntime().reader.pageAyat(page));

async function load(params: PageParams['params']) {
  const { pageNumber } = await params;
  const page = readPageSegment(pageNumber);
  if (page === null) return null;
  const ayat = await readPage(page);
  return ayat.length === 0 ? null : { page, ayat };
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const found = await load(params);
  if (found === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: `/quran/page/${String(found.page)}`,
    title: t('page.title', { number: found.page }),
  });
}

export default async function MushafPageRoute({ params, searchParams }: PageParams) {
  const locale = await requireLocale(params);
  const [availability, found] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || found === null) notFound();
  return (
    <MushafPage
      locale={locale}
      availability={availability}
      page={found.page}
      ayat={found.ayat}
      request={readReadingRequest(await searchParams)}
    />
  );
}
