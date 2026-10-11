import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import { personSlugSchema } from '@minhaj/contracts/people';

import { peopleReadRuntime } from '@/composition/people-read';
import { quranReadRuntime } from '@/composition/quran-read';
import { reciterPath } from '@/components/quran/presentation';
import { quranAvailability, quranContentMetadata } from '@/components/quran/read';
import { ReciterPage } from '@/components/quran/recitations';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/recitations/{reciter}` — one reciter's public recitations,
 * each with its segments' native players (ROUTE_MAP.md §3.3).
 *
 * THE RECITER IS A PEOPLE PERSON, addressed by their public slug; People says
 * whether they are public and what they are called, Quran says which public
 * recitations are theirs. Being a reciter grants nothing (DOMAIN_MODEL.md §4.5).
 * A Person who is not public, or who has no public recitation, has no page here.
 *
 * The page exists in the locales the PERSON's profile exists in — their name is
 * the page's subject — so those are its alternates (ROUTE_MAP.md §9.2).
 */
export const dynamic = 'force-dynamic';

interface ReciterParams {
  readonly params: Promise<{ readonly locale: string; readonly reciter: string }>;
}

const readReciter = cache(async (slug: string, locale: Locale) => {
  if (!personSlugSchema.safeParse(slug).success) return null;
  const person = await peopleReadRuntime().people.publicProfile({ slug, locale });
  if (person === null) return null;
  const recitations = await quranReadRuntime().reader.recitationsByReciter(person.id);
  return recitations.length === 0 ? null : { person, recitations };
});

export async function generateMetadata({ params }: ReciterParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { reciter } = await params;
  const found = await readReciter(reciter, locale);
  if (found === null) return { robots: { index: false, follow: false } };
  const { person } = found;
  return quranContentMetadata(await quranAvailability(), {
    locale,
    contentLocales: person.contentLocales,
    primaryLocale: person.primaryLocale,
    pathFor: (target) => reciterPath(target, person.slug),
    title: person.label.name,
  });
}

export default async function ReciterRoute({ params }: ReciterParams) {
  const locale = await requireLocale(params);
  const { reciter } = await params;
  const [availability, found] = await Promise.all([
    quranAvailability(),
    readReciter(reciter, locale),
  ]);
  if (!availability.active || found === null) notFound();
  return (
    <ReciterPage
      locale={locale}
      availability={availability}
      reciter={{
        slug: found.person.slug,
        name: found.person.label.name,
        locales: found.person.contentLocales,
      }}
      recitations={found.recitations}
    />
  );
}
