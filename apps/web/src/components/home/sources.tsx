import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';
import type { QuranAvailability } from '@minhaj/contracts/quran';
import { getTranslations } from 'next-intl/server';

import { CardGrid, LinkCard } from '@/components/ui';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * THE QURAN AND THE HADITH — always present, and peers: two separate
 * top-level domains (INFORMATION_ARCHITECTURE §1.4). Each card says, in words,
 * whether its text is available here — an approved corpus, a labelled
 * reference preview, non-authoritative fixture text on a proof deployment, or
 * nothing yet — so the home page never promises a text it does not have, and
 * never hides a source because it is not yet published. Each card links to
 * its section's landing, which carries the same notice first.
 */
export async function SourcesModule({
  locale,
  quran,
  hadith,
}: {
  readonly locale: Locale;
  readonly quran: QuranAvailability;
  readonly hadith: HadithAvailability;
}) {
  const [t, all] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale }),
  ]);

  const status = (availability: QuranAvailability | HadithAvailability) =>
    !availability.active
      ? t('home.status.unavailable')
      : availability.mode === 'fixture'
        ? t('home.status.fixture')
        : availability.mode === 'reference'
          ? t('home.status.reference')
          : t('home.status.available');

  const quranBody = !quran.active
    ? all('quran.unavailable.body')
    : quran.mode === 'fixture'
      ? all('quran.fixture')
      : all('quran.description');
  const hadithBody = !hadith.active
    ? all('hadith.unavailable.body')
    : hadith.mode === 'fixture'
      ? all('hadith.fixture')
      : all('hadith.description');

  return (
    <HomeSection
      id="home-sources"
      header={{ heading: t('home.sources.heading'), intro: t('home.sources.intro') }}
    >
      <CardGrid columns={2}>
        <LinkCard
          href={pathFor(locale, requireRoute('quran'))}
          eyebrow={status(quran)}
          title={t('nav.quran')}
          description={quranBody}
        />
        <LinkCard
          href={pathFor(locale, requireRoute('hadith'))}
          eyebrow={status(hadith)}
          title={t('nav.hadith')}
          description={hadithBody}
        />
      </CardGrid>
    </HomeSection>
  );
}
