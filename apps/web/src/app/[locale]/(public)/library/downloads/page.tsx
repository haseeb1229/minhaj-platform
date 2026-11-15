import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryDownloadsPage } from '@/components/library/downloads';
import {
  downloadsCanonicalRedirect,
  readDownloadsView,
} from '@/components/library/browse-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/downloads` — every downloadable Edition, with its
 * language, format, size and rights statement, `?language, topic, sort, page`
 * (Library Part 2; ROUTE_MAP.md §3.6, "Access"). Each download is the existing
 * asset route, `/assets/library/editions/{editionId}/download/{assetId}`,
 * whose rules are unchanged. One address per view: empty controls, another
 * order, a malformed value or a former `?offset=` (which paged Works, not
 * Editions) is one redirect to the canonical spelling.
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
    route: requireRoute('library.downloads'),
    title: t('section.downloads'),
    description: t('sectionBody.downloads'),
  });
}

export default async function Page({ params, searchParams }: BrowseParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = downloadsCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <LibraryDownloadsPage locale={locale} view={readDownloadsView(query)} />;
}
