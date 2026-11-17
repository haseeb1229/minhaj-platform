import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { formatDuration, isoDuration } from '@minhaj/contracts/media';
import {
  canonicalPassageOrder,
  type QuranPassage,
  type TimedQuranPassage,
} from '@minhaj/contracts/passage';

import { Icon } from '@/components/ui';
import { surahName } from './presentation';
import { quranAvailability, readSurahs } from './read';
import { lectureHref, passageCitation, tafsirSurahPath } from './tafsir-layout';

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

/**
 * "WATCH FROM" (Watch Part 1) — on a lecture's own page, where in it the
 * lecture takes up each passage it explains: the moment, the passage (with
 * its Surah's name while a Quran is public), as a link that opens this page
 * at that moment (`?start=`, Quran Part 8's verified parameter) — the Play
 * press then begins there, and nothing plays before it. Only passages whose
 * editor recorded a start past 0:00 are offered; nothing renders otherwise.
 * Its own section beside "On the Quran", whose links lead to the tafsir.
 */
export async function LectureMoments({
  locale,
  path,
  passages,
  duration,
}: {
  readonly locale: Locale;
  /** The lecture's own locale-prefixed path. */
  readonly path: string;
  readonly passages: readonly TimedQuranPassage[];
  /** Its recorded running time: a moment past it would be ignored, so is not offered. */
  readonly duration: number | null;
}) {
  const moments = passages
    .filter(
      (passage) =>
        passage.startSeconds !== null &&
        passage.startSeconds > 0 &&
        (duration === null || passage.startSeconds < duration),
    )
    .sort((a, b) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0));
  if (moments.length === 0) return null;
  const [t, availability] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    quranAvailability(),
  ]);
  const surahs = availability.active ? await readSurahs() : [];
  const byNumber = new Map(surahs.map((surah) => [surah.number, surah]));
  return (
    <section aria-labelledby="lecture-moments" className="flex flex-col gap-3">
      <h2 id="lecture-moments" className="text-heading font-semibold">
        {t('tafsirLinks.momentsHeading')}
      </h2>
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {t('tafsirLinks.momentsHelp')}
      </p>
      <ol className="flex list-none flex-col divide-y divide-border border-y border-border p-0">
        {moments.map((passage) => {
          const surah = byNumber.get(passage.surah);
          const name = surah === undefined ? null : surahName(surah, locale);
          const time = formatDuration(passage.startSeconds ?? 0);
          return (
            <li key={`${passageCitation(passage)}-${String(passage.startSeconds)}`}>
              <a
                href={lectureHref(path, passage)}
                className="group flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 no-underline"
              >
                <span className="inline-flex items-center gap-1.5 font-semibold text-action tabular-nums">
                  <Icon name="play" size={16} />
                  <span className="sr-only">{t('tafsirLinks.watchFrom')} </span>
                  <time dateTime={isoDuration(passage.startSeconds ?? 0)}>{time}</time>
                </span>
                <span className="min-w-0 text-foreground group-hover:underline">
                  {name === null ? null : (
                    <span
                      lang={name.locale}
                      className={`wrap-anywhere ${name.locale === 'ar' ? 'quran-name' : ''}`}
                    >
                      {name.text}{' '}
                    </span>
                  )}
                  <bdi dir="ltr" className="tabular-nums">
                    {passageCitation(passage)}
                  </bdi>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
