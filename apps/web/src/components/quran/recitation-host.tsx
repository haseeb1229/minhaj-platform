import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { referenceNames } from '@/composition/public-references';
import { surahName } from './presentation';
import { quranAvailability, readRecitations, readSurahs } from './read';
import { RecitationDock, type DockLabels } from './recitation-dock';
import { recitationGroups } from './recitation-plan';
import type { ListenLabels } from './recitation-listen';
import type { CatalogueEntry } from './recitation-store';

/**
 * The Quran layout's half of the recitation player (Quran Part 5): the public
 * catalogue — each public recitation with its reciter's public name, whether it
 * is timed and the language heard — every Surah's display label, and the
 * dock's words, handed once to the dock island the layout keeps mounted.
 *
 * PUBLIC DATA ONLY. Quran's public reader and People's public names, the same
 * for every visitor: nothing here reads a session, so the layout stays one
 * document for everyone (ARCHITECTURE.md §8.1). Nothing at all is rendered
 * while the corpus is inactive or no recitation is public.
 */

/**
 * A fixed string of this module's own, run before the page paints: it marks the
 * document as able to play audio, so each page's plain no-script fallback (a
 * native player, or the link to it) gives way at once to the player's controls
 * rather than flashing first. No request value reaches it.
 */
const PLAYER_BOOT_SCRIPT =
  "if('HTMLAudioElement' in window&&'fetch' in window)document.documentElement.setAttribute('data-quran-audio','')";

export async function RecitationHost({ locale }: { readonly locale: Locale }) {
  const availability = await quranAvailability();
  if (!availability.active) return null;
  const recitations = await readRecitations();
  if (recitations.length === 0) return null;

  const [names, surahs, t] = await Promise.all([
    referenceNames(
      { personIds: recitations.map((recitation) => recitation.reciterId), topicIds: [] },
      locale,
    ),
    readSurahs(),
    getTranslations({ locale, namespace: 'quran' }),
  ]);

  // In the catalogue's one order (`recitationGroups`): the chooser groups it
  // as listed, and the first timed entry is the player's default.
  const catalogue: readonly CatalogueEntry[] = recitationGroups(
    recitations
      .filter((recitation) => recitation.surahCount > 0)
      .map((recitation) => ({
        slug: recitation.slug,
        name: recitation.name,
        reciter: names.people.get(recitation.reciterId)?.name ?? null,
        style: recitation.style,
        languageCode: recitation.languageCode,
        timed: recitation.timed,
        translatedSurahs: recitation.translatedSurahs,
      })),
    locale,
  ).flatMap((group) => group.entries);
  if (catalogue.length === 0) return null;

  const labels: DockLabels = {
    region: t('dock.region'),
    play: t('dock.play'),
    pause: t('dock.pause'),
    previous: t('dock.previous'),
    next: t('dock.next'),
    close: t('dock.close'),
    options: t('dock.options'),
    loading: t('dock.loading'),
    buffering: t('dock.buffering'),
    ended: t('dock.ended'),
    failed: t('dock.failed'),
    noAudio: t('dock.noAudio'),
    untimed: t('dock.untimed'),
    now: t.raw('dock.now') as string,
    position: t('dock.position'),
    positionValue: t.raw('dock.positionValue') as string,
    ayah: t.raw('dock.ayah') as string,
    recitation: t('dock.recitation'),
    speed: t('dock.speed'),
    rate: t.raw('dock.rate') as string,
    repeat: t('dock.repeat'),
    repeatTimes: t.raw('dock.repeatTimes') as string,
    range: t('dock.range'),
    rangeFrom: t('dock.rangeFrom'),
    rangeTo: t('dock.rangeTo'),
    rangeTimes: t('dock.rangeTimes'),
    rangeForever: t('dock.rangeForever'),
    rangeApply: t('dock.rangeApply'),
    rangeClear: t('dock.rangeClear'),
    rangeActive: t.raw('dock.rangeActive') as string,
    follow: t('dock.follow'),
    continuous: t('dock.continuous'),
    translation: t('dock.translation'),
    translationAbout: t('dock.translationAbout'),
    translationNotHere: t.raw('dock.translationNotHere') as string,
    translationNarration: t('dock.translationNarration'),
    translating: t.raw('dock.translating') as string,
    translatingOne: t.raw('dock.translatingOne') as string,
    shortcuts: t('dock.shortcuts'),
    surahFallback: t.raw('dock.surahFallback') as string,
    surahs: Object.fromEntries(
      surahs.map((surah) => [
        String(surah.number),
        surahName(surah, locale)?.text ?? t('surahName', { number: surah.number }),
      ]),
    ),
  };

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: PLAYER_BOOT_SCRIPT }} />
      <RecitationDock catalogue={catalogue} labels={labels} locale={locale} />
    </>
  );
}

/** The listen controls' words, for a Surah, a Juz or one Ayah's page. */
export async function listenLabels(
  locale: Locale,
  scope: 'surah' | 'juz' | 'ayah',
): Promise<ListenLabels> {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const play = {
    surah: t('listen.playSurah'),
    juz: t('listen.playJuz'),
    ayah: t('reader.actions.play'),
  } as const;
  return {
    heading: t('listen.heading'),
    recitation: t('listen.recitation'),
    play: play[scope],
    timed: t('listen.timed'),
    untimed: t('listen.untimed'),
  };
}
