import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { fatwaCategoryName } from '@minhaj/contracts/fatwa';

import { FatwaCategoryPage } from '@/components/fatwa/categories';
import {
  categoryPathOf,
  readCategorySegment,
  readFatwaOffset,
} from '@/components/fatwa/presentation';
import {
  fatwaAvailability,
  fatwaMetadata,
  readFatwaCategory,
} from '@/components/fatwa/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/categories/{slug}` — the published rulings in one active
 * category (ROUTE_MAP.md §3.8). A named browse destination, canonical to
 * itself; a paged view canonicalises to the first page. An archived, unknown
 * or malformed category is a 404.
 */
export const dynamic = 'force-dynamic';

interface CategoryParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function load(params: CategoryParams['params']) {
  const { slug } = await params;
  const valid = readCategorySegment(slug);
  return valid === null ? null : readFatwaCategory(valid);
}

export async function generateMetadata({ params }: CategoryParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const category = await load(params);
  if (category === null) return { robots: { index: false, follow: false } };
  return fatwaMetadata({
    locale,
    availability: await fatwaAvailability(),
    canonicalPath: categoryPathOf(category.slug),
    title: fatwaCategoryName(category.names, locale) ?? category.slug,
  });
}

export default async function FatwaCategoryRoute({
  params,
  searchParams,
}: CategoryParams) {
  const locale = await requireLocale(params);
  const availability = await fatwaAvailability();
  // A named view while the service is inactive is absent (ROUTE_MAP.md §3.8).
  if (!availability.active) notFound();
  const category = await load(params);
  if (category === null) notFound();
  return (
    <FatwaCategoryPage
      locale={locale}
      availability={availability}
      category={category}
      offset={readFatwaOffset(await searchParams)}
    />
  );
}
