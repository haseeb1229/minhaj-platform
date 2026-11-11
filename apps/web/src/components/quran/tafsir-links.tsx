import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { canonicalPassageOrder, type QuranPassage } from '@minhaj/contracts/passage';

import { Icon } from '@/components/ui';
import { surahName } from './presentation';
import { quranAvailability, readSurahs } from './read';
import { passageCitation, tafsirSurahPath } from './tafsir-layout';

/**
 * "ON THE QURAN" (Quran Part 8) — on a book's or a lecture's own page, the
 * Quran passages it explains, each a link to its place in the Tafsir hub.
 *
 * Layer-4 composition: the passages are the owner's (Library's, Media's)
 * citation values; the Surah names and whether a Quran is public at all are
 * Quran's public reader's. Nothing renders while no corpus is active, or for a
 * record that carries no passage.
 */
export async function QuranPassageLinks({
  locale,
  passages,
}: {
  readonly locale: Locale;
  readonly passages: readonly QuranPassage[];
}) {
  if (passages.length === 0) return null;
  const availability = await quranAvailability();
  if (!availability.active) return null;
  const [t, surahs] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    readSurahs(),
  ]);
  const byNumber = new Map(surahs.map((surah) => [surah.number, surah]));
  return (
    <section
      aria-labelledby="quran-passages"
      className="flex flex-col gap-3 rounded-panel border border-accent-rule bg-accent-surface p-4 sm:p-5"
    >
      <h2
        id="quran-passages"
        className="flex items-center gap-2 text-heading font-semibold"
      >
        <Icon name="book" size={20} className="text-accent" />
        {t('tafsirLinks.heading')}
      </h2>
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {t('tafsirLinks.help')}
      </p>
      <ul className="flex flex-wrap gap-2">
        {canonicalPassageOrder(passages).map((passage) => {
          const surah = byNumber.get(passage.surah);
          const name = surah === undefined ? null : surahName(surah, locale);
          return (
            <li key={passageCitation(passage)} className="min-w-0">
              <a
                href={`${tafsirSurahPath(locale, passage.surah)}?ayah=${String(passage.ayahFrom)}`}
                className="inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2 rounded-full border border-border-strong bg-surface-raised px-4 py-1.5 text-sm font-medium text-foreground no-underline hover:border-accent"
              >
                {name === null ? null : (
                  <span
                    lang={name.locale}
                    className={`wrap-anywhere ${name.locale === 'ar' ? 'quran-name' : ''}`}
                  >
                    {name.text}
                  </span>
                )}
                <bdi dir="ltr" className="font-semibold text-accent tabular-nums">
                  {passageCitation(passage)}
                </bdi>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
