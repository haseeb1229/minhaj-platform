import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { quranReadRuntime } from '@/composition/quran-read';
import { readQuranOffset, readSlugSegment } from '@/components/quran/presentation';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { WorkDetailPage } from '@/components/quran/works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/tafsir/{slug}` — one public Tafsir work and its entries in
 * canonical order, in bounded pages that each canonicalise to themselves
 * (ROUTE_MAP.md §9.1 rule 4). A work that is not public now is a 404.
 */
export const dynamic = 'force-dynamic';

interface WorkParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const readWork = cache((slug: string) => quranReadRuntime().reader.tafsir(slug));

async function load(params: WorkParams['params']) {
  const { slug } = await params;
  const valid = readSlugSegment(slug);
  return valid === null ? null : readWork(valid);
}

export async function generateMetadata({
  params,
  searchParams,
}: WorkParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const work = await load(params);
  if (work === null) return { robots: { index: false, follow: false } };
  const offset = readQuranOffset(await searchParams);
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: `/quran/tafsir/${encodeURIComponent(work.slug)}${
      offset === 0 ? '' : `?offset=${String(offset)}`
    }`,
    title: work.name,
    ...(work.description === null ? {} : { description: work.description.slice(0, 160) }),
  });
}

export default async function TafsirRoute({ params, searchParams }: WorkParams) {
  const locale = await requireLocale(params);
  const [availability, work] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || work === null) notFound();
  return (
    <WorkDetailPage
      locale={locale}
      availability={availability}
      kind="tafsir"
      work={work}
      offset={readQuranOffset(await searchParams)}
    />
  );
}
