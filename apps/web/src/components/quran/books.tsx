import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { BooksHub } from '@/components/topic-hub/books';
import type { BooksQuery } from '@/components/topic-hub/books-view';
import { PassageChips } from './explore';
import { surahChips } from './explore-view';
import { QURAN_BOOKS } from './hubs';
import { QuranFrame, quranTrail } from './parts';
import { quranPath, surahName } from './presentation';
import { readQuranTopic, readSurahs } from './read';

/**
 * THE QURAN BOOKS HUB (Quran Part 10) — `/quran/books`: the shared Books hub
 * (`@/components/topic-hub/books`) on Taxonomy's `quran` Topic WITH the Quran
 * passage parts — every public Work that explains a Quran passage joins the
 * set, the shelves (explains a Surah, the rest), a Surah filter and the Quran
 * order are offered, and each book carries the Surahs it explains, each
 * linking to that Surah's tafsir. The Surah names are Quran's public
 * reader's; the books are Library's, composed at Layer 4.
 */
export async function QuranBooksPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: BooksQuery;
}) {
  const [t, parts, topic, surahList] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    quranTrail(locale),
    readQuranTopic(locale),
    readSurahs(),
  ]);
  const surahs = new Map(surahList.map((surah) => [surah.number, surah]));
  const title = t('sections.books');

  /** "18. Al-Kahf" for a select's option, which cannot carry markup. */
  const surahOption = (number: number): string => {
    const surah = surahs.get(number);
    const name = surah === undefined ? null : surahName(surah, locale);
    return name === null
      ? t('surahName', { number })
      : t('booksHub.surahOption', { number, name: name.text });
  };

  return (
    <BooksHub
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
      scope={QURAN_BOOKS}
      query={query}
      copy={{
        lede: t('booksHub.lede'),
        stat: (count) => t('booksHub.statBooks', { count }),
        listIntro: t('booksHub.shelfHelp.all'),
        emptyTitle: t('booksHub.emptyTitle'),
        empty: t('booksHub.empty'),
        noResults: t('booksHub.noResults'),
        about: t('booksHub.about'),
      }}
      actions={[
        { href: quranPath(locale, 'tafsir'), text: t('booksHub.tafsirLink') },
        { href: quranPath(locale, 'surah'), text: t('booksHub.readLink') },
      ]}
      passages={{
        statExplaining: (count) => t('booksHub.statExplaining', { count }),
        shelves: t('booksHub.shelves'),
        shelf: {
          all: t('booksHub.shelf.all'),
          explains: t('booksHub.shelf.explains'),
          general: t('booksHub.shelf.general'),
        },
        shelfHelp: {
          explains: t('booksHub.shelfHelp.explains'),
          general: t('booksHub.shelfHelp.general'),
        },
        filterSurah: t('booksHub.filterSurah'),
        anySurah: t('booksHub.anySurah'),
        sortQuran: t('booksHub.sort.quran'),
        surahOption,
        chips: (work) => {
          const { chips, more } = surahChips(work.passages);
          return (
            <PassageChips
              locale={locale}
              label={t('booksHub.explains')}
              chips={chips}
              more={more}
              moreText={t('booksHub.moreSurahs', { count: more })}
              surahs={surahs}
            />
          );
        },
      }}
    />
  );
}
