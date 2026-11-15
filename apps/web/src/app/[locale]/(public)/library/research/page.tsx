import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryResearchPage } from '@/components/library/research';
import { sectionBody, sectionTitle } from '@/components/library/scholarly-presentation';
import {
  LIBRARY_RESEARCH,
  readResearchQuery,
  researchCanonicalRedirect,
} from '@/components/topic-hub/research-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/research` — every published Research record (ROUTE_MAP.md
 * §3.6; the shared research listing since Library Part 3),
 * `?topic, language, contributor, decade, fulltext, sort, page`.
 *
 * BOUNDED, DETERMINISTIC AND FILTERED IN SQL. Library's `topicResearch`
 * (`scope: 'library'`) returns one page of 20 in a total order with the total
 * the view admits; every filter is part of the query.
 *
 * ONE ADDRESS PER VIEW. A form's empty controls, another order of the same
 * parameters, a malformed value, a former `?offset=` (25 a page until Library
 * Part 3) or the former `?from=`/`?to=` year range is ONE redirect to the
 * canonical spelling, built from the parsed view. Every view is canonical to
 * the bare listing and never a sitemap entry (ROUTE_MAP.md §2.3);
 * `force-dynamic` because records are published and withdrawn.
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
    route: requireRoute('library.research'),
    title: sectionTitle(t, 'research'),
    description: sectionBody(t, 'research'),
  });
}

export default async function ResearchPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = researchCanonicalRedirect(LIBRARY_RESEARCH, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <LibraryResearchPage
      locale={locale}
      kind="research"
      query={readResearchQuery(query, LIBRARY_RESEARCH)}
    />
  );
}
