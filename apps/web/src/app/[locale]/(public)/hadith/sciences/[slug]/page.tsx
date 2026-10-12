import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  readSlugSegment,
  scienceLocales,
  sciencePathOf,
  scienceTextFor,
} from '@/components/hadith/presentation';
import {
  hadithAvailability,
  hadithContentMetadata,
  readScience,
} from '@/components/hadith/read';
import { SciencePage } from '@/components/hadith/sciences';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/sciences/{slug}` — one public study page.
 *
 * IT EXISTS IN THE LANGUAGES ITS SOURCE SUPPLIED, so its alternates are exactly
 * those interface locales and its canonical is the existing-language address
 * (ROUTE_MAP.md §9.2, §9.3). Shown in another language it says so. A page that
 * is not public now is a 404.
 */
export const dynamic = 'force-dynamic';

interface ScienceParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

async function load(params: ScienceParams['params']) {
  const { slug } = await params;
  const valid = readSlugSegment(slug);
  return valid === null ? null : readScience(valid);
}

export async function generateMetadata({ params }: ScienceParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const science = await load(params);
  if (science === null) return { robots: { index: false, follow: false } };
  const contentLocales = scienceLocales(science);
  return hadithContentMetadata(await hadithAvailability(), {
    locale,
    contentLocales,
    primaryLocale: contentLocales[0] ?? locale,
    pathFor: (target) => `/${target}${sciencePathOf(science.slug)}`,
    title: scienceTextFor(science, locale)?.text.title ?? science.slug,
  });
}

export default async function ScienceRoute({ params }: ScienceParams) {
  const locale = await requireLocale(params);
  const [availability, science] = await Promise.all([hadithAvailability(), load(params)]);
  if (!availability.active || science === null) notFound();
  return <SciencePage locale={locale} availability={availability} science={science} />;
}
