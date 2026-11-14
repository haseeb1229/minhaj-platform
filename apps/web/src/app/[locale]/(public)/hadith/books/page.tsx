import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { HadithBooksPage } from '@/components/hadith/hub-pages';
import { HADITH_BOOKS } from '@/components/hadith/hubs';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import {
  booksCanonicalRedirect,
  readBooksQuery,
} from '@/components/topic-hub/books-view';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/books` — THE HADITH BOOKS HUB (Hadith Part 1; ROUTE_MAP.md
 * §3.4): Library's public Works on Taxonomy's `hadith` Topic, composed at Layer 4 from its owner's own public reads —
 * a content language, a contributor, an order and a page, each a GET parameter, every view at ONE address (any other
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
    canonicalPath: HADITH_BOOKS.path,
    title: t('sections.books'),
    description: t('sectionBody.books'),
  });
}

export default async function HadithBooksRoute({ params, searchParams }: HubParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  // One address per view: a form's empty controls, a malformed value or
  // another order is ONE redirect to the canonical spelling.
  const canonical = booksCanonicalRedirect(HADITH_BOOKS, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <HadithBooksPage
      locale={locale}
      availability={await hadithAvailability()}
      query={readBooksQuery(HADITH_BOOKS, query)}
    />
  );
}
