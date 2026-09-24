import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import {
  ScholarlyListing,
  sectionBody,
  sectionTitle,
} from '@/components/library/scholarly';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/publications` — Publications (ROUTE_MAP.md §3.6, DELIVERY_PLAN.md
 * Phase 9).
 *
 * Public and signed out. A filtered view is canonical to this base listing and
 * never a sitemap entry (ROUTE_MAP.md §2.3); `force-dynamic` because records are
 * published and withdrawn, and a cached copy would keep offering a withdrawn one.
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
    route: requireRoute('library.publications'),
    title: sectionTitle(t, 'publication'),
    description: sectionBody(t, 'publication'),
  });
}

export default async function PublicationsPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  return (
    <ScholarlyListing locale={locale} kind="publication" query={await searchParams} />
  );
}
