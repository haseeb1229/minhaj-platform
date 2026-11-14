import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { HadithResearchPage } from '@/components/hadith/hub-pages';
import { HADITH_RESEARCH } from '@/components/hadith/hubs';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import {
  researchCanonicalRedirect,
  readResearchQuery,
} from '@/components/topic-hub/research-view';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/research` — THE HADITH RESEARCH HUB (Hadith Part 1; ROUTE_MAP.md
 * §3.4): Library's public Research and ResearchPaper records on Taxonomy's `hadith`
 * Topic, composed at Layer 4 from its owner's own public reads —
 * a kind, a content language, an author, a decade, "full text on the
 * platform", an order and a page, each a GET parameter, every view at ONE address (any other
 * spelling of it is one redirect there). Nothing of Hadith's is read: there
 * is no Hadith corpus (OPEN_DECISIONS.md §1.3), so the hub stands whether or
 * not a collection is activated, and without the Topic it says, as its empty
 * state, that nothing is on Hadith yet — never a 404.
 *
 * CANONICAL TO ITSELF, the bare path, since Hadith Part 1 (until then the
 * owner's own collection — historical): every filtered or paged view
 * canonicalises to it. Like every Hadith page it is indexable only under an
 * approved activation on an indexable deployment (`hadithMetadata`);
 * otherwise it claims no canonical and is `noindex`.
 *
 * Signed out and `force-dynamic`: every part is mutable public data.
 */
export const dynamic = 'force-dynamic';

interface HubParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: HubParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: HADITH_RESEARCH.path,
    title: t('sections.research'),
    description: t('sectionBody.research'),
  });
}

export default async function HadithResearchRoute({ params, searchParams }: HubParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  // One address per view: a form's empty controls, a malformed value or
  // another order is ONE redirect to the canonical spelling.
  const canonical = researchCanonicalRedirect(HADITH_RESEARCH, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <HadithResearchPage
      locale={locale}
      availability={await hadithAvailability()}
      query={readResearchQuery(query)}
    />
  );
}
