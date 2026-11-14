import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { quranReadRuntime } from '@/composition/quran-read';
import { CoursesHub } from '@/components/topic-hub/courses';
import type { CoursesQuery } from '@/components/topic-hub/courses-view';
import { QURAN_COURSES } from './hubs';
import { QuranFrame, quranTrail } from './parts';
import { quranPath } from './presentation';
import { readQuranTopic, readTajweedOverlays } from './read';

/**
 * THE QURAN COURSES HUB (Quran Part 13) — `/quran/courses`: the shared
 * Courses hub (`@/components/topic-hub/courses`) on Taxonomy's `quran` Topic,
 * studied alongside the Quran's own surfaces — the reader, the Tafsir hub
 * and, while tajweed guidance or colours are public, the Tajweed hub. Without
 * the Topic no course is on the Quran: the hub says so, as an empty state.
 */
export async function QuranCoursesPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: CoursesQuery;
}) {
  const [t, parts, topic, tajweedRules, tajweedOverlays] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    quranTrail(locale),
    readQuranTopic(locale),
    quranReadRuntime().reader.tajweedRules(),
    readTajweedOverlays(),
  ]);
  const title = t('sections.courses');
  const alongside = (['read', 'tafsir', 'tajweed'] as const)
    .filter(
      (key) => key !== 'tajweed' || tajweedRules.length > 0 || tajweedOverlays.length > 0,
    )
    .map((key) => ({
      key,
      href: quranPath(locale, key),
      title: t(`sections.${key}`),
      body: t(`sectionBody.${key}`),
    }));
  return (
    <CoursesHub
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
      scope={QURAN_COURSES}
      query={query}
      copy={{
        lede: t('coursesHub.lede'),
        stat: (count) => t('coursesHub.statCourses', { count }),
        listIntro: t('coursesHub.formatHelp.all'),
        emptyTitle: t('coursesHub.emptyTitle'),
        empty: t('coursesHub.empty'),
        noResults: t('coursesHub.noResults'),
        pathsIntro: t('coursesHub.pathsIntro'),
        alongsideIntro: t('coursesHub.alongsideIntro'),
      }}
      alongside={alongside}
    />
  );
}
