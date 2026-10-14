import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CitationPage } from '@/components/hadith/citation';
import { PersonalControls } from '@/components/personal-island/personal-controls';
import {
  hadithCitationPath,
  readCollectionSegment,
  readNumberSegment,
} from '@/components/hadith/presentation';
import {
  hadithAvailability,
  hadithMetadata,
  readCitation,
} from '@/components/hadith/read';
import { collectionText } from '@/components/hadith/structure';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/{collectionSlug}/{hadithNumber}` — THE CANONICAL CITATION
 * of one Hadith (ROUTE_MAP.md §2.1, §3.4), and the only Hadith entity address.
 *
 * The number is a collection-local public citation, mapped by a reviewed
 * mapping to exactly one source-qualified record; it is not the source's key,
 * which the page shows as the source's own reference. A citation that is not
 * public now — withdrawn, unverified at its current version, carrying conflict
 * evidence, or in a collection that is not activated — is a 404, and so is any
 * malformed address. A collection slug can never be one of this section's own
 * path words, so this route never shadows a section page.
 */
export const dynamic = 'force-dynamic';

interface CitationParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly collectionSlug: string;
    readonly hadithNumber: string;
  }>;
}

async function load(params: CitationParams['params']) {
  const { collectionSlug, hadithNumber } = await params;
  const collection = readCollectionSegment(collectionSlug);
  const number = readNumberSegment(hadithNumber);
  return collection === null || number === null ? null : readCitation(collection, number);
}

export async function generateMetadata({ params }: CitationParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const hadith = await load(params);
  if (hadith === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: hadithCitationPath(hadith.collection.slug, hadith.number),
    title: t('citationName', {
      collection: collectionText(hadith.collection, locale),
      number: hadith.number,
    }),
  });
}

export default async function CitationRoute({ params }: CitationParams) {
  const locale = await requireLocale(params);
  const [availability, hadith] = await Promise.all([hadithAvailability(), load(params)]);
  if (!availability.active || hadith === null) notFound();
  return (
    <>
      <CitationPage locale={locale} availability={availability} hadith={hadith} />
      <PersonalControls
        locale={locale}
        target={{ kind: 'hadith', id: hadith.citationId }}
        framed
      />
    </>
  );
}
