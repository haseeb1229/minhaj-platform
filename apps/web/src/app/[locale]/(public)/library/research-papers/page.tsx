import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryResearchPage } from '@/components/library/research';
import { sectionBody, sectionTitle } from '@/components/library/scholarly-presentation';
import {
  LIBRARY_RESEARCH_PAPERS,
  readResearchQuery,
  researchCanonicalRedirect,
} from '@/components/topic-hub/research-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/research-papers` — every published ResearchPaper
 * (ROUTE_MAP.md §3.6; the shared research listing since Library Part 3),
 * `?topic, language, contributor, decade, fulltext, sort, page` — the same
 * rules as `/library/research`, over the other aggregate.
 *
 * ONE ADDRESS PER VIEW: a form's empty controls, another order, a malformed
 * value, a former `?offset=` or `?from=`/`?to=` is ONE redirect to the
 * canonical spelling. Every view is canonical to the bare listing and never a
 * sitemap entry (ROUTE_MAP.md §2.3); `force-dynamic` because records are
 * published and withdrawn.
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
    route: requireRoute('library.research-papers'),
    title: sectionTitle(t, 'research-paper'),
    description: sectionBody(t, 'research-paper'),
  });
}

export default async function ResearchPapersPage({
  params,
  searchParams,
}: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = researchCanonicalRedirect(LIBRARY_RESEARCH_PAPERS, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <LibraryResearchPage
      locale={locale}
      kind="research-paper"
      query={readResearchQuery(query, LIBRARY_RESEARCH_PAPERS)}
    />
  );
}
