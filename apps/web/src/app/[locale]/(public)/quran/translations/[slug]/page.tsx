import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { quranReadRuntime } from '@/composition/quran-read';
import { readSlugSegment } from '@/components/quran/presentation';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { WorkDetailPage } from '@/components/quran/works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/translations/{slug}` — one public Translation work and the
 * way to read the Quran with it. The slug is immutable, so there is no history
 * to redirect; a work that is not public now is a 404.
 */
export const dynamic = 'force-dynamic';

interface WorkParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

const readWork = cache((slug: string) => quranReadRuntime().reader.translation(slug));

async function load(params: WorkParams['params']) {
  const { slug } = await params;
  const valid = readSlugSegment(slug);
  return valid === null ? null : readWork(valid);
}

export async function generateMetadata({ params }: WorkParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const work = await load(params);
  if (work === null) return { robots: { index: false, follow: false } };
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: `/quran/translations/${encodeURIComponent(work.slug)}`,
    title: work.name,
    ...(work.description === null ? {} : { description: work.description.slice(0, 160) }),
  });
}

export default async function TranslationRoute({ params }: WorkParams) {
  const locale = await requireLocale(params);
  const [availability, work] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || work === null) notFound();
  return (
    <WorkDetailPage
      locale={locale}
      availability={availability}
      kind="translations"
      work={work}
      offset={0}
    />
  );
}
