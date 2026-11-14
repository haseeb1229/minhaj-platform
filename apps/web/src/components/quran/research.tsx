import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { ResearchHub } from '@/components/topic-hub/research';
import type { ResearchQuery } from '@/components/topic-hub/research-view';
import { QURAN_RESEARCH } from './hubs';
import { QuranFrame, quranTrail } from './parts';
import { quranPath } from './presentation';
import { readQuranTopic } from './read';

/**
 * THE QURAN RESEARCH HUB (Quran Part 12) — `/quran/research`: the shared
 * Research hub (`@/components/topic-hub/research`) on Taxonomy's `quran`
 * Topic. No record carries a Quran passage, so there are no Surah links;
 * the ways onward are the Tafsir hub and the Quran's Books hub. Without the
 * Topic nothing is research on the Quran: the hub says so, as an empty state.
 */
export async function QuranResearchPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: ResearchQuery;
}) {
  const [t, parts, topic] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    quranTrail(locale),
    readQuranTopic(locale),
  ]);
  const title = t('sections.research');
  return (
    <ResearchHub
      domain={{
        key: 'quran',
        locale,
        topicId: topic?.id ?? null,
        title,
        frame: (children) => (
          <QuranFrame
            locale={locale}
            availability={availability}
            trail={[parts.home, parts.quran, { text: title }]}
          >
            {children}
          </QuranFrame>
        ),
        previous: t('previous'),
        next: t('next'),
      }}
      scope={QURAN_RESEARCH}
      query={query}
      copy={{
        lede: t('researchHub.lede'),
        stat: (count) => t('researchHub.statRecords', { count }),
        listIntro: t('researchHub.kindHelp.all'),
        emptyTitle: t('researchHub.emptyTitle'),
        empty: t('researchHub.empty'),
        noResults: t('researchHub.noResults'),
      }}
      actions={[
        { href: quranPath(locale, 'tafsir'), text: t('booksHub.tafsirLink') },
        { href: quranPath(locale, 'books'), text: t('sections.books') },
      ]}
    />
  );
}
