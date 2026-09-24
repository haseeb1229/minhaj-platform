import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { libraryReadRuntime } from '@/composition/library-read';
import { MagazineDetail, scholarlyMetadataInput } from '@/components/library/scholarly';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/library/magazines/{slug}` — one periodical and its issues
 * (ROUTE_MAP.md §3.6).
 *
 * The Magazine is public while it is published, including before any issue is:
 * the page then says plainly that no issue is published yet. The `offset` query
 * pages the issue list and is canonical to the bare address.
 */
export const dynamic = 'force-dynamic';

interface MagazineParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: MagazineParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await libraryReadRuntime().scholarlyRecord('magazine', slug);
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({ locale, ...scholarlyMetadataInput(locale, record) });
}

export default async function MagazinePage({ params, searchParams }: MagazineParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await libraryReadRuntime().scholarlyRecord('magazine', slug);
  if (record === null) notFound();
  return <MagazineDetail locale={locale} record={record} query={await searchParams} />;
}
