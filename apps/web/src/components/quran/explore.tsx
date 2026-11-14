import type { Locale } from '@minhaj/contracts';
import type { PublicSurah } from '@minhaj/contracts/quran';

import type { SurahChip } from './explore-view';
import { surahName } from './presentation';
import { tafsirSurahPath } from './tafsir-layout';

/**
 * THE QURAN HUBS' SURAH CHIPS (Quran Part 10; the Quran's own part of the
 * shared topic hubs since Hadith Part 1). A book or a lecture on the Quran
 * may explain passages; these chips name the Surahs and link to each Surah's
 * tafsir. No other subject has a passage model, so no other hub has them.
 *
 * LOGICAL PROPERTIES ONLY, so the same markup is right in English, Urdu and
 * Arabic; every chip is a 44-pixel target.
 */

/**
 * The Surahs a book or a lecture explains: each a chip naming the Surah (in
 * the interface's script where the reader records one, else its Arabic name,
 * marked as Arabic) with the citations, linking to that Surah's tafsir.
 */
export function PassageChips({
  locale,
  label,
  chips,
  more,
  moreText,
  surahs,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly chips: readonly SurahChip[];
  readonly more: number;
  readonly moreText: string;
  readonly surahs: ReadonlyMap<number, PublicSurah>;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-caption font-semibold text-foreground-muted">{label}</p>
      <ul aria-label={label} className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const surah = surahs.get(chip.surah);
          const name = surah === undefined ? null : surahName(surah, locale);
          return (
            <li key={chip.surah} className="min-w-0 max-w-full">
              <a
                href={tafsirSurahPath(locale, chip.surah)}
                className="inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-1.5 rounded-full border border-border-strong bg-surface-raised px-3 py-1 text-caption font-medium text-foreground no-underline hover:border-accent"
              >
                {name === null ? null : (
                  <span
                    lang={name.locale}
                    className={`wrap-anywhere ${name.locale === 'ar' ? 'quran-name' : ''}`}
                  >
                    {name.text}
                  </span>
                )}
                <bdi
                  dir="ltr"
                  className="min-w-0 font-semibold wrap-anywhere text-accent tabular-nums"
                >
                  {chip.citations.join(' · ')}
                </bdi>
              </a>
            </li>
          );
        })}
        {more === 0 ? null : (
          <li className="inline-flex min-h-11 items-center px-1 text-caption text-foreground-muted">
            {moreText}
          </li>
        )}
      </ul>
    </div>
  );
}
