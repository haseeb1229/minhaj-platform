import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { libraryReadRuntime } from '@/composition/library-read';
import { ScholarlyDetail, scholarlyMetadataInput } from '@/components/library/scholarly';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/library/publications/{slug}` — one publication (ROUTE_MAP.md §3.6).
 *
 * PUBLISHED ONLY, and the predicate is in the query: a draft or archived record
 * is a 404 here, not a page that forgot a check. A FORMER slug never reaches this
 * page — the request proxy answers it with a single 301 to the current address
 * through Library's own slug history (DOMAIN_MODEL.md §19.7).
 */
export const dynamic = 'force-dynamic';

interface DetailParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: DetailParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await libraryReadRuntime().scholarlyRecord('publication', slug);
  // A 404 carries no canonical and no alternates (ROUTE_MAP.md §9.2).
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({ locale, ...scholarlyMetadataInput(locale, record) });
}

export default async function PublicationPage({ params }: DetailParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await libraryReadRuntime().scholarlyRecord('publication', slug);
  if (record === null) notFound();
  return <ScholarlyDetail locale={locale} record={record} />;
}
