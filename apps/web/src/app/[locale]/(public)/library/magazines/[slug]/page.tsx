import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { libraryReadRuntime } from '@/composition/library-read';
import {
  magazineCanonicalRedirect,
  readMagazineView,
} from '@/components/library/magazine-view';
import { MagazineDetail, scholarlyMetadataInput } from '@/components/library/scholarly';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/library/magazines/{slug}` — one periodical and its issues
 * (ROUTE_MAP.md §3.6; rebuilt in Library Part 3), `?year, undated, page`.
 *
 * The Magazine is public while it is published, including before any issue is:
 * the page then says plainly that no issue is published yet. A year of the
 * year index (`?year=`), the undated issues (`?undated=1`) and a page
 * (`?page=`, 24 a page) are each one address, canonical to the bare one; any
 * other spelling — a form's empty value, another order, a malformed value or
 * the former `?offset=` (25 a page until Library Part 3) — is ONE redirect to
 * the canonical spelling.
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
  const query = await searchParams;
  const canonical = magazineCanonicalRedirect(locale, record.slug, query);
  if (canonical !== null) redirect(canonical);
  return (
    <MagazineDetail locale={locale} record={record} view={readMagazineView(query)} />
  );
}
