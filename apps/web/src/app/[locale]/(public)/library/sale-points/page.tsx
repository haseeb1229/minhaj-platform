import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibrarySalePointsPage } from '@/components/library/sale-points';
import {
  readSalePointsView,
  salePointsCanonicalRedirect,
} from '@/components/library/browse-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/sale-points` — where printed books can be obtained: the
 * published sale points A–Z, their public business facts and the books each
 * sells, `?q, page` (Library Part 2; ROUTE_MAP.md §3.6, DOMAIN_MODEL.md
 * §10.2). Information, not commerce. One address per view: an empty search,
 * another order or a former `?offset=` is one redirect to the canonical
 * spelling (the offset to the page holding the sale point it began with).
 *
 * `force-dynamic`, because every figure here is data an administrator
 * changes: a cached copy would keep offering a record since withdrawn. Signed
 * out, always — nothing here reaches Identity or a cookie.
 */
export const dynamic = 'force-dynamic';

interface BrowseParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: BrowseParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library.sale-points'),
    title: t('section.sale-points'),
    description: t('sectionBody.sale-points'),
  });
}

export default async function Page({ params, searchParams }: BrowseParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = salePointsCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <LibrarySalePointsPage locale={locale} view={readSalePointsView(query)} />;
}
