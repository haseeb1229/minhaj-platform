import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { QuranResearchPage } from '@/components/quran/research';
import { QURAN_RESEARCH } from '@/components/quran/hubs';
import {
  readResearchQuery,
  researchCanonicalRedirect,
} from '@/components/topic-hub/research-view';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/research` — THE QURAN RESEARCH HUB (Quran Part 12;
 * ROUTE_MAP.md §3.3): Library's public Research and ResearchPaper records on
 * Taxonomy's `quran` Topic, composed at Layer 4 from Library's own public
 * reads — a kind, a content language, an author, a decade, "full text on the
 * platform", an order and a page, each a GET parameter, every view at ONE
 * address (any other spelling of it is one redirect there).
 *
 * CANONICAL TO ITSELF, the bare path, since Part 12: the hub is a curated
 * navigational view of its own (ROUTE_MAP.md §2.3), no longer a mirror of
 * `/library/research`; every filtered or paged view canonicalises to it.
 * While the corpus is not approved the page claims no canonical at all
 * (`quranMetadata`). Without the `quran` Topic nothing is research on the
 * Quran: the hub says so, as an empty state, never a 404.
 *
 * Signed out and `force-dynamic`: every part is mutable public data. The
 * honest unavailable state while no corpus is active, as on every Quran page.
 */
export const dynamic = 'force-dynamic';

interface ResearchParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ResearchParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: QURAN_RESEARCH.path,
    title: t('sections.research'),
    description: t('sectionBody.research'),
  });
}

export default async function QuranResearchRoute({
  params,
  searchParams,
}: ResearchParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.research')} />;
  }
  const query = await searchParams;
  // One address per view: a form's empty controls, a malformed value or
  // another order is ONE redirect to the canonical spelling.
  const canonical = researchCanonicalRedirect(QURAN_RESEARCH, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <QuranResearchPage
      locale={locale}
      availability={availability}
      query={readResearchQuery(query)}
    />
  );
}
