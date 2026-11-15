import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PublishedRecordsPage } from '@/components/library/published';
import { sectionBody, sectionTitle } from '@/components/library/scholarly-presentation';
import {
  LIBRARY_PUBLICATIONS,
  readResearchQuery,
  researchCanonicalRedirect,
} from '@/components/topic-hub/research-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/publications` — every published Publication (ROUTE_MAP.md
 * §3.6; Library Part 3), `?topic, language, contributor, decade, fulltext,
 * sort, page` — Library's published-records read, 24 a page, with the
 * research listings' rules: one address per view (a form's empty controls,
 * another order, a malformed value, a former `?offset=` or `?from=`/`?to=`
 * is ONE redirect to the canonical spelling), every view canonical to the bare
 * listing and never a sitemap entry (ROUTE_MAP.md §2.3). `force-dynamic`
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
    route: requireRoute('library.publications'),
    title: sectionTitle(t, 'publication'),
    description: sectionBody(t, 'publication'),
  });
}

export default async function PublicationsPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = researchCanonicalRedirect(LIBRARY_PUBLICATIONS, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <PublishedRecordsPage
      locale={locale}
      kind="publication"
      query={readResearchQuery(query, LIBRARY_PUBLICATIONS)}
    />
  );
}
