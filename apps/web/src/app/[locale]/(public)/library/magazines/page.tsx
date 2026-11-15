import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  magazinesCanonicalRedirect,
  readMagazinesTopic,
} from '@/components/library/magazine-view';
import { MagazinesListing } from '@/components/library/scholarly';
import { sectionBody, sectionTitle } from '@/components/library/scholarly-presentation';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/magazines` — the periodicals directory (ROUTE_MAP.md
 * §3.6; rebuilt in Library Part 3), `?topic`: every published Magazine with
 * its cover, issues and years, the Topics they are filed under, and the
 * newest issues across every title.
 *
 * ONE ADDRESS PER VIEW: a malformed or repeated Topic, and the former
 * `?offset=`, `?language=`, `?from=` and `?to=` (a Magazine has no language
 * or date of its own, and every Magazine is now on one page), are ONE
 * redirect to the canonical spelling. Every view is canonical to the bare
 * listing and never a sitemap entry (ROUTE_MAP.md §2.3); `force-dynamic`
 * because records are published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library.magazines'),
    title: sectionTitle(t, 'magazine'),
    description: sectionBody(t, 'magazine'),
  });
}

export default async function MagazinesPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = magazinesCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <MagazinesListing locale={locale} topic={readMagazinesTopic(query)} />;
}
