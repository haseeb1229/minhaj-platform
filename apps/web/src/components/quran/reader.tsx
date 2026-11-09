import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  QURAN_JUZ_PAGE,
  QURAN_SURAH_MAX,
  citationOf,
  type LayerText,
  type PublicAyah,
  type PublicJuz,
  type PublicLayerWork,
  type PublicSurah,
  type QuranAvailability,
  type QuranRef,
  type TafsirEntryRecord,
} from '@minhaj/contracts/quran';

import { contentLanguages, type ContentLanguage } from '@/composition/public-references';
import { directionOf } from '@/config/locale';
import { playableSegments } from '@/composition/quran-assets';
import { quranReadRuntime } from '@/composition/quran-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import { personalIslandLabels } from '@/components/personal-island/personal-controls';
import {
  Alert,
  Button,
  DetailRow,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { ContinueReading, QuickJumpForm } from './landing-islands';
import {
  AboutThisText,
  LAYER_SIZE,
  LayerBlock,
  LayerNotices,
  QuranFrame,
  READING_OPTIONS_ID,
  ReadingForm,
  SegmentPlayer,
  languageOf,
  segmentRange,
  quranTrail,
} from './parts';
import {
  DEFAULT_TEXT_SIZE,
  ayahPath,
  juzPath,
  nextAyah,
  offsetPathOf,
  pageLinks,
  previousAyah,
  quranPath,
  segmentCovering,
  surahMeaning,
  surahName,
  surahPath,
  tafsirPlacement,
  withReading,
  type ReadingChoice,
  type ReadingRequest,
  type TextSize,
} from './presentation';
import { QUICK_JUMP_MAX_LENGTH, type JumpSurah } from './quick-jump';
import { ArabicText, TranslationText } from './scripture';
import { juzSpans, type SurahIndexQuery, type SurahIndexRow } from './surah-index';
import { SurahIndex, type SurahIndexLabels } from './surah-index-island';
import {
  corpusNotice,
  quranIndexable,
  readAyah,
  readAyahBefore,
  readLastPage,
  readOpening,
  readSurah,
  readSurahs,
  readingContext,
} from './read';
import {
  QuranModeSwitch,
  QuranReaderControls,
  type ReaderControlLabels,
} from './reader-controls';
import {
  READER_BOOT_SCRIPT,
  TRANSLATIONS_RENDERED_MAX,
  defaultShown,
  primaryLanguage,
} from './reader-preferences';
import {
  QURAN_WINDOW,
  ayahElementId,
  boundariesOf,
  mushafPagePath,
  readWindow,
  spanOf,
  startingPointsIn,
  surahPlacePath,
  windowStartOf,
  withWindow,
  type AyahBoundary,
} from './reading-layout';

/**
 * The public Quran reader — the Surah index, a Surah, a canonical Ayah
 * citation, a mushaf page, the Juz index and a Juz (ROUTE_MAP.md §3.3; Phase
 * 18; R2; Quran Part 1).
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read is Quran's public
 * reader, Taxonomy's content languages and nothing else: no session, no
 * progress, no cookie. A signed-in reader sees exactly what an anonymous one
 * does; the client islands (`./reader-controls`, `./landing-islands`) keep
 * preferences and the last Ayah read in this browser, and ask the private
 * `/api/my/*` handlers only after the page has rendered.
 *
 * BATCHED AND BOUNDED (Quran Part 1). A Surah page is ONE WINDOW of
 * `QURAN_WINDOW` ayat — one read for its ayat and one per shown layer, never a
 * read per Ayah — and the next window is a link the reader island fetches as
 * the reader nears it (`./reading-layout`). Al-Baqarah no longer ships 286
 * ayat with two translations in one document. A Juz is read in bounded pages;
 * a mushaf page is one read.
 *
 * NOTHING INVENTED. Every name, count, boundary and text shown comes from the
 * reader; where a source recorded no name, the page says "Surah {number}" and
 * nothing more, and a division the source did not record is not marked.
 *
 * ONE DOCUMENT, THREE MODES. Every reading page renders the verse-by-verse
 * view; the reading and mushaf modes are the same elements laid out as
 * flowing Arabic (`globals.css`, `data-mode` on the reader). With no
 * JavaScript the page is complete: the translations are server-rendered,
 * every choice is a GET form and every window a link.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;

/** "Surah 2" and, where recorded, its display name in the language it is in. */
function SurahTitle({
  surah,
  locale,
  t,
}: {
  readonly surah: PublicSurah;
  readonly locale: Locale;
  readonly t: QuranTranslator;
}) {
  const name = surahName(surah, locale);
  return (
    <>
      {t('surahName', { number: surah.number })}
      {name === null ? null : (
        <>
          {' · '}
          <span
            lang={name.locale}
            dir={directionOf(name.locale)}
            className="wrap-anywhere"
          >
            {name.text}
          </span>
        </>
      )}
    </>
  );
}

/** The source's Arabic name of a Surah, in the Quran face, when it supplied one. */
function ArabicName({
  surah,
  className = 'text-2xl',
}: {
  readonly surah: PublicSurah;
  readonly className?: string;
}) {
  if (surah.nameArabic === null) return null;
  return (
    // Whatever a source supplies must wrap at the narrowest width rather than
    // widen the page. `wrap-anywhere` (`overflow-wrap: anywhere`) — unlike
    // `break-words` — also lowers the name's minimum width, so as a flex item
    // (the reader heading) it can shrink instead of pushing the page wider.
    <span lang="ar" dir="rtl" className={`quran-name min-w-0 wrap-anywhere ${className}`}>
      {surah.nameArabic}
    </span>
  );
}

/** What the shown name means ("The Opening"), in its own language, where recorded. */
function SurahMeaningLine({
  surah,
  locale,
}: {
  readonly surah: PublicSurah;
  readonly locale: Locale;
}) {
  const meaning = surahMeaning(surah, surahName(surah, locale));
  if (meaning === null) return null;
  return (
    <p
      lang={meaning.locale}
      dir={directionOf(meaning.locale)}
      className="max-w-full text-lg wrap-anywhere text-foreground-muted"
    >
      {meaning.text}
    </p>
  );
}

/** The facts a source recorded for a Surah — count and, if known, revelation. */
function surahFacts(surah: PublicSurah, t: QuranTranslator): string {
  const count = t('ayahCount', { count: surah.ayahCount });
  return surah.revelation === null
    ? count
    : `${count} · ${t(`revelation.${surah.revelation}`)}`;
}

/** A text from a layer, by Ayah number. */
function byAyah(texts: readonly LayerText[]): ReadonlyMap<number, string> {
  return new Map(texts.map((entry) => [entry.ayah, entry.text]));
}

/** The label a copied citation gives a Surah: its recorded name, or none. */
function citationLabel(surah: PublicSurah, locale: Locale): string | null {
  return surahName(surah, locale)?.text ?? surah.nameArabic;
}

/* ===========================================================================
 * The indexes — shared by the landing, /quran/surah and /quran/juz
 * ========================================================================= */

/**
 * Every Surah as the index shows it (Quran Part 2): its display name and the
 * name's meaning in the language each is in, its Arabic name, its facts — ayat,
 * revelation place and the Juz it spans, derived from the reader's own Juz
 * ranges — and every recorded name and meaning, in every language, for the
 * filter to match. Nothing is written here that the reader did not return.
 */
function surahIndexRows(
  locale: Locale,
  surahs: readonly PublicSurah[],
  juzList: readonly PublicJuz[],
  t: QuranTranslator,
): SurahIndexRow[] {
  const spans = juzSpans(juzList);
  return surahs.map((surah) => {
    const name = surahName(surah, locale);
    const span = spans.get(surah.number);
    const juz =
      span === undefined
        ? []
        : [
            span.first === span.last
              ? t('juzName', { number: span.first })
              : t('index.juzSpan', { first: span.first, last: span.last }),
          ];
    return {
      number: surah.number,
      href: surahPath(locale, surah.number),
      name,
      meaning: surahMeaning(surah, name),
      nameArabic: surah.nameArabic,
      ayahCount: surah.ayahCount,
      revelation: surah.revelation,
      facts: [surahFacts(surah, t), ...juz].join(' · '),
      terms: [
        ...Object.values(surah.names),
        ...Object.values(surah.meanings),
        ...(surah.nameArabic === null ? [] : [surah.nameArabic]),
      ].filter((term): term is string => term !== undefined && term !== ''),
    };
  });
}

/** The Surah index's words, from the public catalogue. */
async function surahIndexLabels(locale: Locale): Promise<SurahIndexLabels> {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return {
    list: t('sections.surah'),
    filter: t('index.filter'),
    filterHelp: t('index.filterHelp'),
    order: t('index.order'),
    sorts: {
      number: t('index.sort.number'),
      revelation: t('index.sort.revelation'),
      longest: t('index.sort.longest'),
      shortest: t('index.sort.shortest'),
    },
    apply: t('index.apply'),
    count: t.raw('index.count') as string,
    none: t.raw('index.none') as string,
    clear: t('index.clear'),
    surah: t.raw('surahName') as string,
    groups: {
      meccan: t('revelation.meccan'),
      medinan: t('revelation.medinan'),
      unrecorded: t('index.unrecorded'),
    },
  };
}

/**
 * The Surah index — the landing's Surah tab and `/quran/surah` alike: a GET
 * filter and order that work without JavaScript, the same answered on every
 * keystroke with it, and every Surah as a row whose whole area is its link.
 */
export async function SurahIndexSection({
  locale,
  surahs,
  juzList,
  initial,
  idPrefix,
  headingLevel,
  syncAddress,
}: {
  readonly locale: Locale;
  readonly surahs: readonly PublicSurah[];
  readonly juzList: readonly PublicJuz[];
  readonly initial: SurahIndexQuery;
  readonly idPrefix: string;
  readonly headingLevel: 'h2' | 'h3';
  readonly syncAddress: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return (
    <SurahIndex
      rows={surahIndexRows(locale, surahs, juzList, t)}
      initial={initial}
      action={quranPath(locale, 'surah')}
      idPrefix={idPrefix}
      headingLevel={headingLevel}
      syncAddress={syncAddress}
      labels={await surahIndexLabels(locale)}
    />
  );
}

/** Every Juz as a row: its name (the link) and the range the reader derived. */
export function JuzIndexList({
  locale,
  list,
  label,
  t,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly list: readonly PublicJuz[];
  readonly label: string;
  readonly t: QuranTranslator;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <ol
      aria-label={label}
      className="grid list-none grid-cols-1 gap-x-8 p-0 sm:grid-cols-2 lg:grid-cols-3"
    >
      {list.map((juz) => (
        <li
          key={juz.number}
          className="relative flex min-w-0 items-center gap-4 border-b border-border py-4 transition-colors duration-[var(--duration-fast)] hover:bg-surface-raised"
        >
          <span
            aria-hidden="true"
            className="w-9 shrink-0 text-center text-sm font-semibold text-accent tabular-nums"
          >
            {juz.number}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <Heading className="text-base font-semibold">
              <a
                href={juzPath(locale, juz.number)}
                className="text-foreground no-underline after:absolute after:inset-0 hover:text-action"
              >
                {t('juzName', { number: juz.number })}
              </a>
            </Heading>
            <JuzRange juz={juz} t={t} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "From 2:142 to 2:252 · 111 ayat" — the reader's own derived range. */
function JuzRange({ juz, t }: { readonly juz: PublicJuz; readonly t: QuranTranslator }) {
  return (
    <p className="text-caption text-foreground-muted">
      {t('juzRange', {
        start: citationOf(juz.start),
        end: citationOf(juz.end),
      })}
      {' · '}
      {t('ayahCount', { count: juz.ayahCount })}
    </p>
  );
}

/** The two index pages are siblings: one row of route tabs between them. */
async function IndexTabs({
  locale,
  current,
}: {
  readonly locale: Locale;
  readonly current: 'surah' | 'juz';
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return (
    <LinkTabs
      label={t('index.tabs')}
      tabs={(['surah', 'juz'] as const).map((key) => ({
        href: quranPath(locale, key),
        text: t(`sections.${key}`),
        current: key === current,
      }))}
    />
  );
}

/* ===========================================================================
 * /quran/surah
 * ========================================================================= */

/**
 * `/quran/surah` (Quran Part 2): the reader's own "Continue where you stopped"
 * card where there is a place to return to, then the whole index, filtered and
 * ordered by the address's `?q=` and `?sort=`.
 */
export async function SurahIndexPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: SurahIndexQuery;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const [surahs, juzList] = await Promise.all([
    readSurahs(),
    quranReadRuntime().reader.juzList(),
  ]);
  const title = t('sections.surah');

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-foreground-muted">{t('sectionBody.surah')}</p>
      </div>
      <IndexTabs locale={locale} current="surah" />
      {surahs.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <>
          <ContinueReading {...await continueProps(locale, surahs)} card />
          <SurahIndexSection
            locale={locale}
            surahs={surahs}
            juzList={juzList}
            initial={query}
            idPrefix="surah-index"
            headingLevel="h2"
            syncAddress
          />
        </>
      )}
      <AboutThisText
        locale={locale}
        availability={availability}
        translation={(await quranReadRuntime().reader.translations()).length > 0}
      />
    </QuranFrame>
  );
}

/* ===========================================================================
 * The layers shown beside the Arabic
 * ========================================================================= */

interface TranslationLayer {
  readonly work: PublicLayerWork;
  readonly language: ReturnType<typeof languageOf>;
  /** The work's place among the rendered translations: the reader shows it by this. */
  readonly index: number;
  readonly texts: ReadonlyMap<number, string>;
}

interface AyahLayers {
  readonly translations: readonly TranslationLayer[];
  readonly transliteration: {
    readonly name: string;
    readonly language: ReturnType<typeof languageOf>;
    readonly texts: ReadonlyMap<number, string>;
  } | null;
  readonly tafsir: {
    readonly name: string;
    readonly language: ReturnType<typeof languageOf>;
    readonly placed: ReadonlyMap<number, readonly TafsirEntryRecord[]>;
  } | null;
}

/** The translations a page renders, and whether the address chose them. */
interface TranslationSet {
  readonly works: readonly PublicLayerWork[];
  readonly fixed: boolean;
}

/**
 * WHICH TRANSLATIONS A PAGE RENDERS (Quran Part 1 — no longer hard-wired to
 * Urdu and English).
 *
 * A translation the ADDRESS chose (`?translation=`) is rendered alone, as
 * before, and always shown. One it asked for that is not public is rendered as
 * NOTHING — the page says so (`LayerNotices`) and never substitutes another
 * work. With no choice in the address, the page renders the public
 * translations — the interface language's first, then Urdu, then English, then
 * the rest in their own order — up to `TRANSLATIONS_RENDERED_MAX`, so the
 * reader's settings can show any of them, side by side or stacked, without
 * another request. Which of them SHOW by default is `defaultShown`.
 */
function translationSet(
  context: Awaited<ReturnType<typeof readingContext>>,
  request: ReadingRequest,
  locale: Locale,
): TranslationSet {
  const chosen = context.chosen.translation;
  if (chosen !== null) return { works: [chosen], fixed: true };
  if (request.translation.state !== 'none') return { works: [], fixed: false };
  const rank = (code: string) => {
    const language = primaryLanguage(code);
    return language === locale ? 0 : language === 'ur' ? 1 : language === 'en' ? 2 : 3;
  };
  const works = context.options.translations
    .map((work, order) => ({ work, order }))
    .sort(
      (a, b) =>
        rank(a.work.languageCode) - rank(b.work.languageCode) || a.order - b.order,
    )
    .map((entry) => entry.work)
    .slice(0, TRANSLATIONS_RENDERED_MAX);
  return { works, fixed: false };
}

/** The indexes shown before the reader chooses: all chosen ones, else the default. */
function shownByDefault(set: TranslationSet, locale: Locale): readonly number[] {
  return set.fixed
    ? set.works.map((_, index) => index)
    : defaultShown(
        locale,
        set.works.map((work) => work.languageCode),
      );
}

/** Builds the shown layers for a range of one Surah — one read per layer. */
async function layersFor(
  context: Awaited<ReturnType<typeof readingContext>>,
  set: TranslationSet,
  languages: ReadonlyMap<string, ContentLanguage>,
  surah: number,
  from: number,
  to: number,
  shown: readonly number[],
): Promise<AyahLayers> {
  const reader = quranReadRuntime().reader;
  const { transliteration, tafsir } = context.chosen;
  const [translationTexts, transliterationTexts, tafsirEntries] = await Promise.all([
    Promise.all(
      set.works.map((work) => reader.translationTexts(work.id, surah, from, to)),
    ),
    transliteration === null
      ? Promise.resolve([])
      : reader.transliterationTexts(transliteration.id, surah, from, to),
    tafsir === null
      ? Promise.resolve([])
      : reader.tafsirEntries(tafsir.id, surah, from, to),
  ]);
  return {
    translations: set.works.map((work, index) => ({
      work,
      index,
      language: languageOf(languages, work.languageCode),
      texts: byAyah(translationTexts[index] ?? []),
    })),
    transliteration:
      transliteration === null
        ? null
        : {
            name: transliteration.name,
            language: languageOf(languages, transliteration.languageCode),
            texts: byAyah(transliterationTexts),
          },
    tafsir:
      tafsir === null
        ? null
        : {
            name: tafsir.name,
            language: languageOf(languages, tafsir.languageCode),
            placed: tafsirPlacement(tafsirEntries, shown),
          },
  };
}

const NO_LAYERS: AyahLayers = { translations: [], transliteration: null, tafsir: null };

/* ===========================================================================
 * One Ayah, as a Surah, a page, a Juz or a citation shows it
 * ========================================================================= */

/** A Tafsir entry, collapsed by default — commentary can be long. */
function TafsirEntry({
  entry,
  work,
  language,
  size,
  t,
  open = false,
}: {
  readonly entry: TafsirEntryRecord;
  readonly work: { readonly name: string };
  readonly language: { readonly code: string; readonly direction: 'ltr' | 'rtl' };
  readonly size: TextSize;
  readonly t: QuranTranslator;
  readonly open?: boolean;
}) {
  const range =
    entry.startAyah === entry.endAyah
      ? t('tafsirOne', { name: work.name, ayah: entry.startAyah })
      : t('tafsirRange', { name: work.name, start: entry.startAyah, end: entry.endAyah });
  return (
    <details open={open} className="rounded-control border border-border px-4 py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
        {range}
      </summary>
      <div
        lang={language.code}
        dir={language.direction}
        className={`flex max-w-[var(--measure-prose)] flex-col gap-3 pb-2 ${LAYER_SIZE[size]}`}
      >
        {paragraphsOf(entry.text).map((paragraph, index) => (
          <p key={index} className="break-words">
            {paragraph}
          </p>
        ))}
      </div>
    </details>
  );
}

const TOOL =
  'inline-flex size-11 items-center justify-center rounded-full text-foreground-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken hover:text-foreground active:bg-border';

/** Where an Ayah page's personal controls sit — the reader's Save links here. */
export const PERSONAL_ANCHOR = 'personal';

/**
 * An Ayah's quiet actions (benchmark pattern 25): Copy with its citation and
 * Share are buttons the reader island serves, hidden until it has mounted.
 * Save is a link to the citation page's signed-in controls — which work with
 * no script at all — and, once the island is there, opens those same controls
 * in a sheet on the page being read (Quran Part 1).
 *
 * THE SEAM FOR RECITATION. Nothing here plays: a player that highlights the
 * Ayah being recited finds each row by its stable `id` (`ayah-{s}-{a}`) and
 * `data-ayah`, and adds its own control beside these when it exists. No
 * placeholder control is drawn before then.
 */
function AyahTools({
  t,
  save,
}: {
  readonly t: QuranTranslator;
  readonly save: string | null;
}) {
  return (
    <div
      role="group"
      aria-label={t('reader.actions.group')}
      className="flex items-center"
    >
      <button
        type="button"
        data-ayah-action="copy"
        aria-label={t('reader.actions.copy')}
        className={`quran-ayah-tool ${TOOL}`}
      >
        <Icon name="copy" size={20} />
      </button>
      <button
        type="button"
        data-ayah-action="share"
        aria-label={t('reader.actions.share')}
        className={`quran-ayah-tool ${TOOL}`}
      >
        <Icon name="share" size={20} />
      </button>
      {save === null ? null : (
        <a
          href={save}
          data-ayah-action="save"
          aria-label={t('reader.actions.save')}
          className={TOOL}
        >
          <Icon name="bookmark" size={20} />
        </a>
      )}
    </div>
  );
}

/**
 * WHAT BEGINS AT AN AYAH (Quran Part 1): a mushaf page — "Page 50", with the
 * Juz and hizb it is in for the mushaf mode's page header — and a Juz or a
 * hizb, as small labels. Only divisions the source recorded, only where they
 * begin (`boundariesOf`). The rub' al-hizb quarters are not stored apart from
 * the text, which carries its own ۞ sign where the source wrote one.
 */
function AyahMarks({
  locale,
  ayah,
  boundary,
  pageLink,
  t,
}: {
  readonly locale: Locale;
  readonly ayah: PublicAyah;
  readonly boundary: AyahBoundary;
  /** Link a page mark to its `/quran/page/{n}` (not on that page itself). */
  readonly pageLink: boolean;
  readonly t: QuranTranslator;
}) {
  const divisions = [
    boundary.juz === null ? null : t('juzName', { number: boundary.juz }),
    boundary.hizb === null ? null : t('reader.marks.hizb', { number: boundary.hizb }),
  ].filter((label): label is string => label !== null);
  if (boundary.page === null && divisions.length === 0) return null;
  const pageText =
    boundary.page === null ? null : t('reader.marks.page', { number: boundary.page });
  const context = [
    t('juzName', { number: ayah.juz }),
    ...(ayah.hizb === null ? [] : [t('reader.marks.hizb', { number: ayah.hizb })]),
  ].join(' · ');
  return (
    <p className="quran-marks" dir={directionOf(locale)}>
      {boundary.page === null || pageText === null ? null : (
        <span className="quran-mark-page">
          {pageLink ? (
            <a
              href={mushafPagePath(locale, boundary.page)}
              className="font-semibold text-foreground-muted underline-offset-4 hover:text-action hover:underline"
            >
              {pageText}
            </a>
          ) : (
            <span className="font-semibold">{pageText}</span>
          )}
          <span className="quran-mark-context">{` · ${context}`}</span>
        </span>
      )}
      {divisions.map((label) => (
        <span key={label} className="quran-mark-division">
          {label}
        </span>
      ))}
    </p>
  );
}

/**
 * One Ayah as a list item: an `<article>` NAMED "Surah 2, Ayah 3" so a screen
 * reader announces the verse it is in, the stable `id="ayah-2-3"` every
 * listing uses, the citation chip (keyboard-reachable, and the way to its
 * canonical page), the Arabic, and each rendered layer in its own labelled
 * group. `data-*` carries what the reader island — and a future recitation
 * player — needs: the citation, the Juz, the mushaf page and the canonical
 * address.
 */
function AyahItem({
  locale,
  ayah,
  layers,
  choice,
  boundary,
  pageLink = true,
  t,
}: {
  readonly locale: Locale;
  readonly ayah: PublicAyah;
  readonly layers: AyahLayers;
  readonly choice: ReadingChoice;
  readonly boundary: AyahBoundary;
  readonly pageLink?: boolean;
  readonly t: QuranTranslator;
}) {
  const ref = { surah: ayah.surah, ayah: ayah.ayah };
  const key = `${String(ayah.surah)}-${String(ayah.ayah)}`;
  const canonical = ayahPath(locale, ref);
  const transliteration = layers.transliteration?.texts.get(ayah.ayah);
  const tafsirLayer = layers.tafsir;
  const tafsir = tafsirLayer?.placed.get(ayah.ayah) ?? [];
  const translations = layers.translations.flatMap((layer) => {
    const text = layer.texts.get(ayah.ayah);
    return text === undefined ? [] : [{ layer, text }];
  });

  return (
    <li
      id={ayahElementId(ref)}
      data-ayah={citationOf(ref)}
      data-juz={ayah.juz}
      {...(ayah.page === null ? {} : { 'data-page': ayah.page })}
      data-canonical={canonical}
      className="scroll-mt-20"
    >
      <AyahMarks
        locale={locale}
        ayah={ayah}
        boundary={boundary}
        pageLink={pageLink}
        t={t}
      />
      <article
        aria-label={t('ayahName', { surah: ayah.surah, ayah: ayah.ayah })}
        className="quran-ayah-body flex min-w-0 flex-col gap-4 border-b border-border py-7"
      >
        <div className="quran-ayah-head flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={withReading(canonical, choice)}
              className="group inline-flex min-h-11 items-center no-underline"
            >
              <span className="inline-flex min-w-12 items-center justify-center rounded-full border border-accent-rule bg-accent-surface px-2.5 py-0.5 text-caption font-semibold text-accent tabular-nums group-hover:border-accent">
                <bdi dir="ltr">{citationOf(ref)}</bdi>
              </span>
            </a>
            {ayah.sajdah === null ? null : (
              <StatusBadge tone="neutral">{t(`sajdah.${ayah.sajdah}`)}</StatusBadge>
            )}
          </div>
          <AyahTools t={t} save={`${canonical}#${PERSONAL_ANCHOR}`} />
        </div>
        <ArabicText
          id={`arabic-${key}`}
          label={t('layer.arabic')}
          text={ayah.text}
          ayah={ayah.ayah}
          open={t('reader.openAyah', ref)}
        />
        {ayah.sajdah === null ? null : (
          <span
            className="quran-mark-sajdah quran-mark-division"
            dir={directionOf(locale)}
          >
            {t('reader.marks.sajdah')}
          </span>
        )}
        {translations.length === 0 ? null : (
          <div className="quran-translations">
            {translations.map(({ layer, text }) => (
              <TranslationText
                key={layer.work.id}
                id={`translation-${key}${layer.index === 0 ? '' : `-${String(layer.index + 1)}`}`}
                label={t('layer.translation', { name: layer.work.name })}
                name={layer.work.name}
                text={text}
                language={layer.language}
                index={layer.index}
              />
            ))}
          </div>
        )}
        {layers.transliteration === null || transliteration === undefined ? null : (
          <div className="quran-layer max-w-[var(--measure-prose)]">
            <LayerBlock
              id={`transliteration-${key}`}
              label={t('layer.transliteration', { name: layers.transliteration.name })}
              text={transliteration}
              language={layers.transliteration.language}
              size={choice.size}
              muted
            />
          </div>
        )}
        {tafsirLayer === null || tafsir.length === 0 ? null : (
          <div className="quran-tafsir flex flex-col gap-3">
            {tafsir.map((entry) => (
              <TafsirEntry
                key={entry.id}
                entry={entry}
                work={tafsirLayer}
                language={tafsirLayer.language}
                size={choice.size}
                t={t}
              />
            ))}
          </div>
        )}
      </article>
    </li>
  );
}

/** A run of ayat as one ordered list, each with what begins at it. */
function AyahList({
  id,
  surah,
  locale,
  ayat,
  previous,
  layers,
  choice,
  pageLink = true,
  labelledBy,
  t,
}: {
  readonly id?: string;
  /** The Surah a windowed list reads, for the island's window check. */
  readonly surah?: number;
  readonly locale: Locale;
  readonly ayat: readonly PublicAyah[];
  /** The Ayah before the first, in canonical order, or null at the start. */
  readonly previous: PublicAyah | null;
  readonly layers: AyahLayers;
  readonly choice: ReadingChoice;
  readonly pageLink?: boolean;
  readonly labelledBy: string;
  readonly t: QuranTranslator;
}) {
  const boundaries = boundariesOf(ayat, previous);
  return (
    <ol
      {...(id === undefined ? {} : { id })}
      {...(surah === undefined ? {} : { 'data-surah': surah })}
      aria-labelledby={labelledBy}
      className="quran-ayat flex flex-col"
    >
      {ayat.map((ayah, index) => (
        <AyahItem
          key={`${String(ayah.surah)}:${String(ayah.ayah)}`}
          locale={locale}
          ayah={ayah}
          layers={layers}
          choice={choice}
          boundary={boundaries[index] ?? { juz: null, hizb: null, page: null }}
          pageLink={pageLink}
          t={t}
        />
      ))}
    </ol>
  );
}

/* ===========================================================================
 * The reading frame — the sticky context bar and the reader element
 * ========================================================================= */

/**
 * WHERE THE BISMILLAH HEADER IS SHOWN. Only over the reference preview, whose
 * Tanzil text gives the Bismillah as part of Al-Fatiha's first Ayah alone —
 * so it is shown at the head of every other Surah except At-Tawbah (9), which
 * opens without it. It is that Ayah's stored text, unchanged, as a separate
 * presentational element: never counted, never copied as an Ayah, hidden from
 * assistive technology (which reads it at 1:1). An approved corpus decides its
 * own conventions, so nothing is shown there until that is a recorded decision.
 */
const BISMILLAH_OMITTED: ReadonlySet<number> = new Set([1, 9]);

async function Bismillah({
  availability,
  surah,
}: {
  readonly availability: QuranAvailability;
  readonly surah: number;
}) {
  if (corpusNotice(availability) !== 'reference' || BISMILLAH_OMITTED.has(surah))
    return null;
  const opening = await readOpening();
  if (opening === null) return null;
  return (
    <p
      aria-hidden="true"
      lang="ar"
      dir="rtl"
      translate="no"
      className="quran-text quran-bismillah py-6 text-center"
    >
      {opening.text}
    </p>
  );
}

const READER_ID = 'quran-reader';
/** The ayat list of a reading page — the skip link's target and the island's. */
const AYAT_ID = 'quran-ayat';
/** The text of a reading page, for "Skip to the text". */
const TEXT_ID = 'quran-text';

/** The island's words, from the public catalogue. */
async function controlLabels(locale: Locale): Promise<ReaderControlLabels> {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return {
    translationSwitch: t('reader.translationSwitch'),
    settings: t('reader.settings'),
    settingsTitle: t('reader.settingsTitle'),
    close: t('reader.close'),
    modes: {
      label: t('reader.modes.label'),
      translation: t('reader.modes.translation'),
      reading: t('reader.modes.reading'),
      mushaf: t('reader.modes.mushaf'),
    },
    translationsLegend: t('reader.translationsLegend'),
    arabicSize: t('reader.arabicSize'),
    translationSize: t('reader.translationSize'),
    decrease: t('reader.decrease'),
    increase: t('reader.increase'),
    leading: {
      label: t('reader.leading.label'),
      compact: t('reader.leading.compact'),
      comfortable: t('reader.leading.comfortable'),
      spacious: t('reader.leading.spacious'),
    },
    layout: {
      label: t('reader.layout.label'),
      stacked: t('reader.layout.stacked'),
      side: t('reader.layout.side'),
    },
    reset: t('reader.reset'),
    kept: t('reader.kept'),
    moreOptions: t('reader.moreOptions'),
    useDefault: t('reader.useDefault'),
    position: t.raw('juzName') as string,
    ayahName: t.raw('ayahName') as string,
    openPage: t('reader.ayahSheet.openPage'),
    noTranslation: t('reader.ayahSheet.noTranslation'),
    copy: t('reader.actions.copy'),
    share: t('reader.actions.share'),
    save: t('reader.actions.save'),
    copied: t('reader.status.copied'),
    linkCopied: t('reader.status.linkCopied'),
    copyFailed: t('reader.status.failed'),
    loadFailed: t('reader.status.loadFailed'),
  };
}

/**
 * The reader element and its sticky context bar. The bar names the place on
 * its inline start and carries the island at its inline end; the island
 * draws the position line along the bar's lower edge.
 *
 * THE ELEMENT DECLARES THE PAGE. Its `data-*` attributes say what the server
 * rendered — which translations (`data-slugs`) and which show by default
 * (`data-shown`), whether the address chose them (`data-fixed`) or a size
 * (`data-explicit-size`), whether the page reads in modes (`data-modes`) — and
 * its first child, the boot script, applies this browser's stored preferences
 * to them before the text is painted. The attributes it may change are the
 * only ones React is told not to compare on hydration.
 */
async function ReadingFrame({
  locale,
  availability,
  title,
  request,
  set,
  languages,
  initialJuz,
  surahs,
  remember,
  modes,
  surah,
  defaultsHref,
  children,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly title: ReactNode;
  readonly request: ReadingRequest;
  readonly set: TranslationSet;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly initialJuz: number;
  readonly surahs: readonly PublicSurah[];
  readonly remember: boolean;
  /** Translation, reading and mushaf modes (a reading page, not a citation). */
  readonly modes: boolean;
  /** The Surah a page reads in windows, with the window shown. */
  readonly surah: {
    readonly number: number;
    readonly ayahCount: number;
    readonly start: number;
  } | null;
  /** This page with its default translations: the address chose none. */
  readonly defaultsHref: string;
  readonly children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const labels = await controlLabels(locale);
  const explicitSize = request.size !== DEFAULT_TEXT_SIZE;
  const defaults = shownByDefault(set, locale);
  const chosen = set.fixed ? set.works[0] : undefined;

  return (
    <div
      id={READER_ID}
      data-mode="translation"
      {...(modes ? { 'data-modes': '' } : {})}
      data-slugs={set.works.map((work) => work.slug).join(' ')}
      data-shown={defaults.join(' ')}
      {...(set.fixed ? { 'data-fixed': '' } : {})}
      {...(explicitSize ? { 'data-explicit-size': '' } : {})}
      data-leading="comfortable"
      data-layout="stacked"
      suppressHydrationWarning
      className={`quran-reader quran-size-${request.size} flex min-w-0 flex-col`}
    >
      {/* A fixed string of this module's own — no request value reaches it. */}
      <script dangerouslySetInnerHTML={{ __html: READER_BOOT_SCRIPT }} />
      <div className="sticky top-0 z-[var(--layer-header)] border-b border-border bg-surface">
        {/* Wraps rather than widens the page when a long Surah name and the
            controls cannot share the narrowest row. */}
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5 sm:gap-x-3">
          <p className="flex min-w-0 items-center gap-3 truncate text-sm font-semibold">
            {title}
          </p>
          <QuranReaderControls
            readerId={READER_ID}
            listId={AYAT_ID}
            locale={locale}
            labels={labels}
            translations={set.works.map((work) => ({
              slug: work.slug,
              name: work.name,
              language: languageOf(languages, work.languageCode).name,
            }))}
            defaults={defaults}
            fixedTranslation={
              chosen === undefined
                ? null
                : {
                    text: t('reader.fixed', { name: chosen.name }),
                    resetHref: defaultsHref,
                  }
            }
            explicitSize={explicitSize}
            modes={modes}
            initialJuz={initialJuz}
            arabicSources={
              corpusNotice(availability) === 'reference' ? [t('reader.arabicSource')] : []
            }
            surahLabels={Object.fromEntries(
              surahs.map((each) => [String(each.number), citationLabel(each, locale)]),
            )}
            remember={remember}
            moreOptionsHref={`#${READING_OPTIONS_ID}`}
            surah={surah}
            personal={modes ? await personalIslandLabels(locale) : null}
          />
        </div>
      </div>
      {modes ? (
        <div className="pt-6">
          <QuranModeSwitch labels={{ modes: labels.modes }} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** "Skip to the text" — the first stop of a reading page, visible on focus. */
function SkipToText({ t }: { readonly t: QuranTranslator }) {
  return (
    <a
      href={`#${TEXT_ID}`}
      className="sr-only self-start rounded-control bg-action px-4 py-2 text-sm font-semibold text-action-foreground focus:not-sr-only"
    >
      {t('reader.skip')}
    </a>
  );
}

/* ===========================================================================
 * /quran/surah/{surahNumber}
 * ========================================================================= */

/** One neighbouring Surah as a large previous/next link. */
function NeighbourLink({
  locale,
  surah,
  choice,
  direction,
  t,
}: {
  readonly locale: Locale;
  readonly surah: PublicSurah;
  readonly choice: ReadingChoice;
  readonly direction: 'previous' | 'next';
  readonly t: QuranTranslator;
}) {
  const next = direction === 'next';
  return (
    <a
      href={withReading(surahPath(locale, surah.number), choice)}
      className={`flex min-h-16 items-center gap-4 rounded-panel border border-border bg-surface-raised px-5 py-4 no-underline transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:bg-surface-sunken ${
        next ? 'sm:col-start-2 sm:justify-end sm:text-end' : ''
      }`}
    >
      {next ? null : (
        <Icon name="arrow-start" size={20} className="text-foreground-muted" />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">
          {t(next ? 'nextSurah' : 'previousSurah', { number: surah.number })}
        </span>
        <ArabicName
          surah={surah}
          className="text-lg leading-loose text-foreground-muted"
        />
      </span>
      {next ? (
        <Icon name="arrow-end" size={20} className="text-foreground-muted" />
      ) : null}
    </a>
  );
}

/** "Juz 1–3 · Pages 2–49": the spans a Surah covers, where the source recorded them. */
function spanText(
  first: PublicAyah | null,
  last: PublicAyah | null,
  t: QuranTranslator,
): string {
  const juz = spanOf(first, last, 'juz');
  const pages = spanOf(first, last, 'page');
  return [
    juz === null
      ? null
      : juz.start === juz.end
        ? t('juzName', { number: juz.start })
        : t('reader.juzSpan', juz),
    pages === null
      ? null
      : pages.start === pages.end
        ? t('reader.marks.page', { number: pages.start })
        : t('reader.pageSpan', pages),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

export async function SurahPage({
  locale,
  availability,
  surah,
  request,
  from,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly surah: PublicSurah;
  readonly request: ReadingRequest;
  /** The window the address asked for: `?from=`, any value, validated here. */
  readonly from: string | string[] | undefined;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const path = surahPath(locale, surah.number);
  const window = readWindow(from, surah.ayahCount);

  const [context, languages, ayat, first, last, before, neighbours] = await Promise.all([
    readingContext(request),
    contentLanguages(),
    reader.ayat(surah.number, window.start, window.end),
    readAyah(surah.number, 1),
    readAyah(surah.number, surah.ayahCount),
    readAyahBefore({ surah: surah.number, ayah: window.start }),
    Promise.all([
      surah.number > 1 ? readSurah(surah.number - 1) : Promise.resolve(null),
      surah.number < QURAN_SURAH_MAX
        ? readSurah(surah.number + 1)
        : Promise.resolve(null),
    ]),
  ]);
  const shown = ayat.map((ayah) => ayah.ayah);
  const set = translationSet(context, request, locale);
  const [layers, segments] = await Promise.all([
    layersFor(context, set, languages, surah.number, window.start, window.end, shown),
    context.chosen.reciter === null
      ? Promise.resolve([])
      : reader
          .recitationSegments(context.chosen.reciter.id, surah.number)
          .then(playableSegments),
  ]);
  const { choice } = context;
  const reciter = context.chosen.reciter;
  const [previous, next] = neighbours;
  const heading = t('surahName', { number: surah.number });
  const spans = spanText(first, last, t);
  const reading = withReading(path, choice);
  const earlier = window.start > 1 ? window.start - QURAN_WINDOW : null;
  const later = window.end < surah.ayahCount ? window.end + 1 : null;
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: t('sections.surah'), path: quranPath(locale, 'surah') },
    { name: heading, path },
  ];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: heading },
      ]}
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
        <SkipToText t={t} />
        <header className="flex flex-col items-center gap-2 border-b border-border pb-8 text-center">
          {/* A centred flex item sizes to its content, so a long source word
              must be breakable at any point (`wrap-anywhere`) to keep the
              heading within the narrowest viewport. */}
          <h1 className="max-w-full text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
            <SurahTitle surah={surah} locale={locale} t={t} />
          </h1>
          <ArabicName surah={surah} className="order-first text-5xl leading-loose" />
          <SurahMeaningLine surah={surah} locale={locale} />
          <p className="text-sm text-foreground-muted">
            {surahFacts(surah, t)}
            {spans === '' ? null : ` · ${spans}`}
          </p>
          {/* The neighbours, quietly, at the head too; the landmark is the
              pair of large links after the text. */}
          <p className="flex flex-wrap justify-center gap-x-6 gap-y-1 pt-1 text-sm">
            {previous === null ? null : (
              <TextLink href={withReading(surahPath(locale, previous.number), choice)}>
                {t('previousSurah', { number: previous.number })}
              </TextLink>
            )}
            {next === null ? null : (
              <TextLink href={withReading(surahPath(locale, next.number), choice)}>
                {t('nextSurah', { number: next.number })}
              </TextLink>
            )}
          </p>
        </header>

        <LayerNotices locale={locale} unavailable={context.unavailable} />

        {reciter === null ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="surah-recitation">
            <SectionHeading>
              <span id="surah-recitation">
                {t('recitationOf', { name: reciter.name })}
              </span>
            </SectionHeading>
            {segments.length === 0 ? (
              <Alert tone="info">{t('recitationNone')}</Alert>
            ) : (
              <ol className="flex flex-col gap-4" aria-labelledby="surah-recitation">
                {segments.map((segment) => (
                  <li key={segment.id} className="flex flex-col gap-2">
                    <p className="text-sm font-medium">
                      <TextLink
                        href={surahPlacePath(locale, {
                          surah: segment.surah,
                          ayah: segment.startAyah,
                        })}
                      >
                        {segmentRange(t, segment)}
                      </TextLink>
                    </p>
                    <SegmentPlayer
                      locale={locale}
                      recitation={reciter}
                      segment={segment}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <ReadingFrame
          locale={locale}
          availability={availability}
          title={
            <>
              <span className="truncate">{heading}</span>
              <ArabicName surah={surah} className="text-xl leading-normal font-normal" />
            </>
          }
          request={request}
          set={set}
          languages={languages}
          initialJuz={ayat[0]?.juz ?? 1}
          surahs={[surah]}
          remember
          modes
          surah={{
            number: surah.number,
            ayahCount: surah.ayahCount,
            start: window.start,
          }}
          defaultsHref={withReading(path, { ...choice, translation: null })}
        >
          {earlier === null ? null : (
            <p className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4 text-sm">
              <TextLink href={withWindow(reading, earlier)}>
                {t('reader.window.earlier', {
                  start: earlier,
                  end: window.start - 1,
                })}
              </TextLink>
              <span className="text-foreground-muted tabular-nums">
                {t('reader.window.position', {
                  start: window.start,
                  end: window.end,
                  count: surah.ayahCount,
                })}
              </span>
            </p>
          )}
          {window.start === 1 ? (
            <Bismillah availability={availability} surah={surah.number} />
          ) : null}
          <section
            id={TEXT_ID}
            tabIndex={-1}
            className="flex scroll-mt-20 flex-col"
            aria-labelledby="surah-ayat"
          >
            <h2 id="surah-ayat" className="sr-only">
              {t('ayatOf', { number: surah.number })}
            </h2>
            {ayat.length === 0 ? (
              <EmptyState>{t('empty')}</EmptyState>
            ) : (
              <AyahList
                id={AYAT_ID}
                surah={surah.number}
                locale={locale}
                ayat={ayat}
                previous={before}
                layers={layers}
                choice={choice}
                labelledBy="surah-ayat"
                t={t}
              />
            )}
          </section>
          {later === null ? null : (
            <nav
              data-window-nav=""
              aria-label={t('reader.window.label')}
              className="flex justify-center py-6"
            >
              <a
                data-window-next=""
                href={withWindow(reading, later)}
                className="inline-flex min-h-12 items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-5 text-sm font-semibold text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken"
              >
                {t('reader.window.continue', {
                  start: later,
                  end: Math.min(surah.ayahCount, later + QURAN_WINDOW - 1),
                })}
                <Icon name="chevron-down" size={20} />
              </a>
            </nav>
          )}
          <GoToAyah locale={locale} surah={surah} t={t} />
        </ReadingFrame>

        <nav
          aria-label={t('surahNavigation')}
          className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2"
        >
          {previous === null ? null : (
            <NeighbourLink
              locale={locale}
              surah={previous}
              choice={choice}
              direction="previous"
              t={t}
            />
          )}
          {next === null ? null : (
            <NeighbourLink
              locale={locale}
              surah={next}
              choice={choice}
              direction="next"
              t={t}
            />
          )}
        </nav>

        <ReadingForm
          locale={locale}
          action={path}
          context={context}
          languages={languages}
          keep={window.start > 1 ? { from: String(window.start) } : {}}
        />

        <AboutThisText
          locale={locale}
          availability={availability}
          translation={context.options.translations.length > 0}
        />
      </div>

      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? localeSchema.options : []}
        trail={trail}
      />
    </QuranFrame>
  );
}

/**
 * Keyboard navigation to one Ayah without scrolling a long Surah: a GET form to
 * the reader entry, which validates the number against the reader and opens
 * the Ayah IN this Surah — its window, at its own element (`place=surah`).
 */
function GoToAyah({
  locale,
  surah,
  t,
}: {
  readonly locale: Locale;
  readonly surah: PublicSurah;
  readonly t: QuranTranslator;
}) {
  return (
    <form
      method="get"
      action={quranPath(locale, 'read')}
      aria-label={t('goTo.heading')}
      className="flex flex-wrap items-end gap-3 border-t border-border pt-6"
    >
      <input type="hidden" name="surah" value={String(surah.number)} />
      <input type="hidden" name="place" value="surah" />
      <div className="flex w-40 flex-col gap-1.5">
        <label htmlFor="go-to-ayah" className="text-sm font-medium">
          {t('goTo.ayah')}
        </label>
        <TextInput
          id="go-to-ayah"
          name="ayah"
          type="number"
          inputMode="numeric"
          min={1}
          max={surah.ayahCount}
          required
        />
      </div>
      <Button tone="secondary">{t('goTo.submit')}</Button>
    </form>
  );
}

/* ===========================================================================
 * /quran/page/{pageNumber} — one mushaf page (Quran Part 1)
 * ========================================================================= */

/**
 * One mushaf page: the ayat the source placed on it, in canonical order,
 * grouped by Surah — a Surah's opening (and its Bismillah, under the rule
 * above) wherever one begins on the page — under a header naming the page and
 * the Juz and hizb it is in, with the pages before and after. TEXT ONLY: no
 * mushaf image is shown (none is licensed). Every reading mode applies.
 */
export async function MushafPage({
  locale,
  availability,
  page,
  ayat,
  request,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly page: number;
  /** The page's ayat, already read by the route (empty is its 404). */
  readonly ayat: readonly PublicAyah[];
  readonly request: ReadingRequest;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const firstAyah = ayat[0];
  const [surahs, context, languages, lastPage, before] = await Promise.all([
    readSurahs(),
    readingContext(request),
    contentLanguages(),
    readLastPage(),
    firstAyah === undefined ? Promise.resolve(null) : readAyahBefore(firstAyah),
  ]);
  const surahByNumber = new Map(surahs.map((surah) => [surah.number, surah]));
  const path = mushafPagePath(locale, page);
  const heading = t('page.title', { number: page });
  const set = translationSet(context, request, locale);

  // Consecutive ayat of one Surah are one group, so a heading marks each.
  const groups: { surah: number; ayat: PublicAyah[] }[] = [];
  for (const ayah of ayat) {
    const last = groups.at(-1);
    if (last !== undefined && last.surah === ayah.surah) last.ayat.push(ayah);
    else groups.push({ surah: ayah.surah, ayat: [ayah] });
  }
  const layered = await Promise.all(
    groups.map((group) => {
      const from = group.ayat[0]?.ayah ?? 1;
      const to = group.ayat.at(-1)?.ayah ?? from;
      return layersFor(
        context,
        set,
        languages,
        group.surah,
        from,
        to,
        group.ayat.map((ayah) => ayah.ayah),
      );
    }),
  );
  const onPage = groups.flatMap((group) => {
    const surah = surahByNumber.get(group.surah);
    return surah === undefined ? [] : [surah];
  });
  const where = [
    firstAyah === undefined ? null : t('juzName', { number: firstAyah.juz }),
    firstAyah === undefined || firstAyah.hizb === null
      ? null
      : t('reader.marks.hizb', { number: firstAyah.hizb }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: heading, path },
  ];
  const pageHref = (number: number) =>
    withReading(mushafPagePath(locale, number), context.choice);

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: heading },
      ]}
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
        <SkipToText t={t} />
        <header className="flex flex-col items-center gap-2 border-b border-border pb-6 text-center">
          <h1 className="text-title font-semibold tracking-[var(--tracking-display)]">
            {heading}
          </h1>
          <p className="text-sm text-foreground-muted">{where}</p>
          <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
            <span className="sr-only">{t('page.onPage')}</span>
            {onPage.map((surah) => (
              <TextLink key={surah.number} href={surahPath(locale, surah.number)}>
                <SurahTitle surah={surah} locale={locale} t={t} />
              </TextLink>
            ))}
          </p>
        </header>

        <LayerNotices locale={locale} unavailable={context.unavailable} />

        <ReadingFrame
          locale={locale}
          availability={availability}
          title={<span className="truncate">{heading}</span>}
          request={request}
          set={set}
          languages={languages}
          initialJuz={firstAyah?.juz ?? 1}
          surahs={onPage}
          remember
          modes
          surah={null}
          defaultsHref={withReading(path, { ...context.choice, translation: null })}
        >
          <div id={TEXT_ID} tabIndex={-1} className="flex scroll-mt-20 flex-col">
            {groups.map((group, index) => {
              const surah = surahByNumber.get(group.surah);
              const id = `page-surah-${String(group.surah)}`;
              const opens = group.ayat[0]?.ayah === 1;
              const previousOf =
                index === 0 ? before : (groups[index - 1]?.ayat.at(-1) ?? null);
              return (
                <section
                  key={group.surah}
                  className="flex flex-col pt-6"
                  aria-labelledby={id}
                >
                  <h2
                    id={id}
                    className={`flex flex-wrap items-baseline gap-x-3 text-heading font-semibold break-words ${
                      opens
                        ? 'justify-center border-b border-border pb-4 text-center'
                        : ''
                    }`}
                  >
                    <TextLink href={surahPath(locale, group.surah)}>
                      {surah === undefined ? (
                        t('surahName', { number: group.surah })
                      ) : (
                        <SurahTitle surah={surah} locale={locale} t={t} />
                      )}
                    </TextLink>
                    {surah === undefined ? null : (
                      <ArabicName
                        surah={surah}
                        className="text-2xl leading-loose font-normal"
                      />
                    )}
                  </h2>
                  {opens ? (
                    <Bismillah availability={availability} surah={group.surah} />
                  ) : null}
                  <AyahList
                    locale={locale}
                    ayat={group.ayat}
                    previous={previousOf}
                    layers={layered[index] ?? NO_LAYERS}
                    choice={context.choice}
                    pageLink={false}
                    labelledBy={id}
                    t={t}
                  />
                </section>
              );
            })}
          </div>
        </ReadingFrame>

        <nav
          aria-label={t('page.navigation')}
          className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-3"
        >
          {page <= 1 ? (
            <span />
          ) : (
            <a
              href={pageHref(page - 1)}
              rel="prev"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action no-underline hover:underline"
            >
              <Icon name="arrow-start" size={16} />
              {t('page.previous', { number: page - 1 })}
            </a>
          )}
          {page >= lastPage ? null : (
            <a
              href={pageHref(page + 1)}
              rel="next"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action no-underline hover:underline"
            >
              {t('page.next', { number: page + 1 })}
              <Icon name="arrow-end" size={16} />
            </a>
          )}
        </nav>

        <GoToPage locale={locale} lastPage={lastPage} t={t} />

        <ReadingForm
          locale={locale}
          action={path}
          context={context}
          languages={languages}
        />

        <AboutThisText
          locale={locale}
          availability={availability}
          translation={context.options.translations.length > 0}
        />
      </div>

      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? localeSchema.options : []}
        trail={trail}
      />
    </QuranFrame>
  );
}

/** A page number to open: a GET form to the reader entry, which checks it. */
function GoToPage({
  locale,
  lastPage,
  t,
  id = 'go-to-page',
}: {
  readonly locale: Locale;
  readonly lastPage: number;
  readonly t: QuranTranslator;
  readonly id?: string;
}) {
  return (
    <form
      method="get"
      action={quranPath(locale, 'read')}
      aria-label={t('page.goTo')}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex w-40 flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('page.number')}
        </label>
        <TextInput
          id={id}
          name="page"
          type="number"
          inputMode="numeric"
          min={1}
          max={lastPage}
          required
        />
      </div>
      <Button tone="secondary">{t('page.submit')}</Button>
    </form>
  );
}

/* ===========================================================================
 * /quran/surah/{surahNumber}/{ayahNumber} — the canonical citation
 * ========================================================================= */

export async function AyahPage({
  locale,
  availability,
  surah,
  ayah,
  request,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly surah: PublicSurah;
  readonly ayah: PublicAyah;
  readonly request: ReadingRequest;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const ref: QuranRef = { surah: ayah.surah, ayah: ayah.ayah };
  const path = ayahPath(locale, ref);

  const [context, languages, previousSurah, nextSurah] = await Promise.all([
    readingContext(request),
    contentLanguages(),
    ayah.ayah === 1 && surah.number > 1 ? readSurah(surah.number - 1) : null,
    ayah.ayah === surah.ayahCount && surah.number < QURAN_SURAH_MAX
      ? readSurah(surah.number + 1)
      : null,
  ]);
  const set = translationSet(context, request, locale);
  const [layers, segments] = await Promise.all([
    layersFor(context, set, languages, ref.surah, ref.ayah, ref.ayah, [ref.ayah]),
    context.chosen.reciter === null
      ? Promise.resolve([])
      : reader
          .recitationSegments(context.chosen.reciter.id, ref.surah)
          .then(playableSegments),
  ]);
  const { choice } = context;
  const segment = segmentCovering(segments, ref);
  const before = previousAyah(ref, previousSurah?.ayahCount ?? null);
  const after = nextAyah(ref, surah.ayahCount, nextSurah !== null);

  const heading = t('ayahName', { surah: ref.surah, ayah: ref.ayah });
  const surahHeading = t('surahName', { number: surah.number });
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: t('sections.surah'), path: quranPath(locale, 'surah') },
    { name: surahHeading, path: surahPath(locale, surah.number) },
    { name: heading, path },
  ];
  const transliteration = layers.transliteration?.texts.get(ref.ayah);
  const tafsirLayer = layers.tafsir;
  const tafsir = tafsirLayer?.placed.get(ref.ayah) ?? [];
  const chosenTranslation = context.chosen.translation;

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: heading },
      ]}
    >
      <article
        aria-labelledby="ayah-heading"
        className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8"
      >
        <header className="flex flex-col gap-2">
          <h1
            id="ayah-heading"
            className="text-title font-semibold tracking-[var(--tracking-display)] text-balance"
          >
            {heading}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 text-sm">
            <TextLink
              href={withWindow(
                withReading(
                  surahPath(locale, surah.number),
                  choice,
                  {},
                  ayahElementId(ref),
                ),
                windowStartOf(ref.ayah),
              )}
            >
              <SurahTitle surah={surah} locale={locale} t={t} />
            </TextLink>
            <ArabicName surah={surah} className="text-xl leading-loose" />
          </p>
        </header>

        <LayerNotices locale={locale} unavailable={context.unavailable} />

        <ReadingFrame
          locale={locale}
          availability={availability}
          title={
            <bdi dir="ltr" className="tabular-nums">
              {citationOf(ref)}
            </bdi>
          }
          request={request}
          set={set}
          languages={languages}
          initialJuz={ayah.juz}
          surahs={[surah]}
          remember
          modes={false}
          surah={null}
          defaultsHref={withReading(path, { ...choice, translation: null })}
        >
          <div
            data-ayah={citationOf(ref)}
            data-juz={ayah.juz}
            data-canonical={path}
            className="flex min-w-0 flex-col gap-5 pt-6"
          >
            <div className="flex justify-end">
              <AyahTools t={t} save={null} />
            </div>
            <ArabicText
              id="ayah-arabic"
              label={t('layer.arabic')}
              text={ayah.text}
              ayah={ayah.ayah}
            />
            {chosenTranslation !== null &&
            layers.translations[0]?.texts.get(ref.ayah) === undefined ? (
              <p className="text-sm text-foreground-muted">
                {t('layerMissing.translation', { name: chosenTranslation.name })}
              </p>
            ) : null}
            <div className="quran-translations">
              {layers.translations.map((layer) => {
                const text = layer.texts.get(ref.ayah);
                return text === undefined ? null : (
                  <TranslationText
                    key={layer.work.id}
                    id={
                      layer.index === 0
                        ? 'ayah-translation'
                        : `ayah-translation-${String(layer.index + 1)}`
                    }
                    label={t('layer.translation', { name: layer.work.name })}
                    name={layer.work.name}
                    text={text}
                    language={layer.language}
                    index={layer.index}
                  />
                );
              })}
            </div>
            {layers.transliteration === null ? null : transliteration === undefined ? (
              <p className="text-sm text-foreground-muted">
                {t('layerMissing.transliteration', { name: layers.transliteration.name })}
              </p>
            ) : (
              <div className="max-w-[var(--measure-prose)]">
                <LayerBlock
                  id="ayah-transliteration"
                  label={t('layer.transliteration', {
                    name: layers.transliteration.name,
                  })}
                  text={transliteration}
                  language={layers.transliteration.language}
                  size={choice.size}
                  muted
                />
              </div>
            )}
          </div>
        </ReadingFrame>

        {tafsirLayer === null ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="ayah-tafsir">
            <h2 id="ayah-tafsir" className="text-lg font-semibold">
              {t('layer.tafsir', { name: tafsirLayer.name })}
            </h2>
            {tafsir.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                {t('layerMissing.tafsir', { name: tafsirLayer.name })}
              </p>
            ) : (
              tafsir.map((entry) => (
                <TafsirEntry
                  key={entry.id}
                  entry={entry}
                  work={tafsirLayer}
                  language={tafsirLayer.language}
                  size={choice.size}
                  t={t}
                  open
                />
              ))
            )}
          </section>
        )}

        {context.chosen.reciter === null ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="ayah-recitation">
            <h2 id="ayah-recitation" className="text-lg font-semibold">
              {t('recitationOf', { name: context.chosen.reciter.name })}
            </h2>
            {segment === null ? (
              <Alert tone="info">{t('recitationNoneForAyah')}</Alert>
            ) : (
              <SegmentPlayer
                locale={locale}
                recitation={context.chosen.reciter}
                segment={segment}
              />
            )}
          </section>
        )}

        <nav
          aria-label={t('ayahNavigation')}
          className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-3"
        >
          {before === null ? (
            <span />
          ) : (
            <a
              href={withReading(ayahPath(locale, before), choice)}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action no-underline hover:underline"
            >
              <Icon name="arrow-start" size={16} />
              {t('previousAyah', { citation: citationOf(before) })}
            </a>
          )}
          {after === null ? null : (
            <a
              href={withReading(ayahPath(locale, after), choice)}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action no-underline hover:underline"
            >
              {t('nextAyah', { citation: citationOf(after) })}
              <Icon name="arrow-end" size={16} />
            </a>
          )}
        </nav>

        <section className="flex flex-col gap-3" aria-labelledby="ayah-facts">
          <h2 id="ayah-facts" className="text-lg font-semibold">
            {t('facts')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <DetailRow term={t('fact.citation')}>
              <span dir="ltr">{citationOf(ref)}</span>
            </DetailRow>
            <DetailRow term={t('fact.juz')}>
              <TextLink href={juzPath(locale, ayah.juz)}>
                {t('juzName', { number: ayah.juz })}
              </TextLink>
            </DetailRow>
            {ayah.hizb === null ? null : (
              <DetailRow term={t('fact.hizb')}>
                {t('reader.marks.hizb', { number: ayah.hizb })}
              </DetailRow>
            )}
            {ayah.page === null ? null : (
              <DetailRow term={t('fact.page')}>
                <TextLink href={mushafPagePath(locale, ayah.page)}>
                  {t('reader.marks.page', { number: ayah.page })}
                </TextLink>
              </DetailRow>
            )}
            {ayah.sajdah === null ? null : (
              <DetailRow term={t('fact.sajdah')}>{t(`sajdah.${ayah.sajdah}`)}</DetailRow>
            )}
          </dl>
        </section>

        <ReadingForm
          locale={locale}
          action={path}
          context={context}
          languages={languages}
        />
      </article>

      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? localeSchema.options : []}
        trail={trail}
      />
    </QuranFrame>
  );
}

/* ===========================================================================
 * /quran/juz and /quran/juz/{juzNumber}
 * ========================================================================= */

export async function JuzIndexPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const list = await quranReadRuntime().reader.juzList();
  const title = t('sections.juz');

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-foreground-muted">{t('sectionBody.juz')}</p>
      </div>
      <IndexTabs locale={locale} current="juz" />
      {list.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <JuzIndexList locale={locale} list={list} label={title} t={t} />
      )}
    </QuranFrame>
  );
}

/**
 * One Juz in bounded pages of `QURAN_JUZ_PAGE` ayat, in canonical order: a
 * Surah's opening wherever one begins, every Ayah linked to its citation, and
 * the rendered translations read once per Surah on the page.
 */
export async function JuzPage({
  locale,
  availability,
  juz,
  offset,
  request,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly juz: PublicJuz;
  readonly offset: number;
  readonly request: ReadingRequest;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const path = juzPath(locale, juz.number);
  const [page, surahs, context, languages] = await Promise.all([
    quranReadRuntime().reader.juzAyat(juz.number, offset),
    readSurahs(),
    readingContext(request),
    contentLanguages(),
  ]);
  const firstAyah = page.items[0];
  const before = firstAyah === undefined ? null : await readAyahBefore(firstAyah);
  const surahByNumber = new Map(surahs.map((surah) => [surah.number, surah]));
  const heading = t('juzName', { number: juz.number });
  const links = pageLinks(page.offset, QURAN_JUZ_PAGE, page.total);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: t('sections.juz'), path: quranPath(locale, 'juz') },
    { name: heading, path },
  ];

  // Consecutive ayat of one Surah are one group, so a heading marks each start.
  const groups: { surah: number; ayat: PublicAyah[] }[] = [];
  for (const ayah of page.items) {
    const last = groups.at(-1);
    if (last !== undefined && last.surah === ayah.surah) last.ayat.push(ayah);
    else groups.push({ surah: ayah.surah, ayat: [ayah] });
  }
  const set = translationSet(context, request, locale);
  // Only the translations ride along on a Juz: one read per work per Surah.
  const layered = await Promise.all(
    groups.map((group) => {
      const first = group.ayat[0]?.ayah ?? 1;
      const last = group.ayat.at(-1)?.ayah ?? first;
      return layersFor(
        {
          ...context,
          chosen: { ...context.chosen, transliteration: null, tafsir: null },
        },
        set,
        languages,
        group.surah,
        first,
        last,
        group.ayat.map((ayah) => ayah.ayah),
      );
    }),
  );
  const onPage = groups.flatMap((group) => {
    const surah = surahByNumber.get(group.surah);
    return surah === undefined ? [] : [surah];
  });

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: heading },
      ]}
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
        <Prose>
          <PageHeading>{heading}</PageHeading>
          <JuzRange juz={juz} t={t} />
        </Prose>

        <LayerNotices locale={locale} unavailable={context.unavailable} />

        {groups.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <ReadingFrame
            locale={locale}
            availability={availability}
            title={<span className="truncate">{heading}</span>}
            request={request}
            set={set}
            languages={languages}
            initialJuz={juz.number}
            surahs={onPage}
            remember
            modes
            surah={null}
            defaultsHref={withReading(path, { ...context.choice, translation: null })}
          >
            {groups.map((group, index) => {
              const surah = surahByNumber.get(group.surah);
              const id = `juz-surah-${String(group.surah)}`;
              const opens = group.ayat[0]?.ayah === 1;
              const previousOf =
                index === 0 ? before : (groups[index - 1]?.ayat.at(-1) ?? null);
              return (
                <section
                  key={group.surah}
                  className="flex flex-col pt-6"
                  aria-labelledby={id}
                >
                  <h2
                    id={id}
                    className={`flex flex-wrap items-baseline gap-x-3 text-heading font-semibold break-words ${
                      opens
                        ? 'justify-center border-b border-border pb-4 text-center'
                        : ''
                    }`}
                  >
                    <TextLink href={surahPath(locale, group.surah)}>
                      {surah === undefined ? (
                        t('surahName', { number: group.surah })
                      ) : (
                        <SurahTitle surah={surah} locale={locale} t={t} />
                      )}
                    </TextLink>
                    {surah === undefined ? null : (
                      <ArabicName
                        surah={surah}
                        className="text-2xl leading-loose font-normal"
                      />
                    )}
                  </h2>
                  {opens ? (
                    <Bismillah availability={availability} surah={group.surah} />
                  ) : null}
                  <AyahList
                    locale={locale}
                    ayat={group.ayat}
                    previous={previousOf}
                    layers={layered[index] ?? NO_LAYERS}
                    choice={context.choice}
                    labelledBy={id}
                    t={t}
                  />
                </section>
              );
            })}
          </ReadingFrame>
        )}

        <Pagination
          label={heading}
          previous={links.previous === null ? null : offsetPathOf(path, links.previous)}
          next={links.next === null ? null : offsetPathOf(path, links.next)}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />

        <AboutThisText
          locale={locale}
          availability={availability}
          translation={context.options.translations.length > 0}
        />
      </div>

      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? localeSchema.options : []}
        trail={trail}
      />
    </QuranFrame>
  );
}

/* ===========================================================================
 * /quran/read — where to begin
 * ========================================================================= */

/**
 * What the quick jump needs to know of the corpus: numbers, counts, and every
 * recorded name and meaning in every language with the source's Arabic name —
 * so "Kahf", "Al-Kahf", "The Cave" and "الكهف" all open the same Surah.
 */
export function jumpIndex(surahs: readonly PublicSurah[]): readonly JumpSurah[] {
  return surahs.map((surah) => ({
    number: surah.number,
    ayahCount: surah.ayahCount,
    names: [
      ...Object.values(surah.names),
      ...Object.values(surah.meanings),
      ...(surah.nameArabic === null ? [] : [surah.nameArabic]),
    ].filter((name): name is string => name !== undefined && name !== ''),
  }));
}

/** The quick jump's words, from the public catalogue. */
export async function quickJumpLabels(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return {
    label: t('jump.label'),
    help: t('jump.help'),
    submit: t('jump.submit'),
    opens: t.raw('jump.opens') as string,
    none: t('jump.none'),
    surah: t.raw('surahName') as string,
    ayah: t.raw('ayahName') as string,
    juz: t.raw('juzName') as string,
    page: t.raw('page.title') as string,
  };
}

/** The "Continue where you stopped" card's words and the corpus it checks against. */
export async function continueProps(locale: Locale, surahs: readonly PublicSurah[]) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return {
    locale,
    ayahCounts: surahs.map((surah) => [surah.number, surah.ayahCount] as const),
    surahNames: Object.fromEntries(
      surahs.map((surah) => [
        String(surah.number),
        surahName(surah, locale)?.text ?? null,
      ]),
    ),
    labels: {
      heading: t('continue.heading'),
      account: t('continue.account'),
      device: t('continue.device'),
      place: t.raw('ayahName') as string,
    },
  };
}

/**
 * WHERE TO BEGIN (Quran Part 1). A real start page, the same document for
 * every visitor: the "Continue where you stopped" card (a client island that
 * asks the signed-in person's own position after render, else this browser's
 * last place — absent when there is neither), the quick jump, the well-loved
 * places to begin — FIXED CITATIONS, shown with the corpus's own recorded
 * names and only where the corpus holds them — and the ways to browse the
 * whole text. The server reads no session and writes nothing.
 */
export async function ReaderEntryPage({
  locale,
  availability,
  problem,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly problem: 'surah' | 'ayah' | 'query' | 'page' | null;
  /** What was typed into the quick jump, when it matched nothing. */
  readonly query: string;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const [surahs, lastPage, kursi] = await Promise.all([
    readSurahs(),
    readLastPage(),
    readAyah(2, 255),
  ]);
  const title = t('sections.read');
  const first = surahs[0];
  const surahByNumber = new Map(surahs.map((surah) => [surah.number, surah]));
  const points = startingPointsIn(
    new Map(surahs.map((surah) => [surah.number, surah.ayahCount])),
  ).filter((point) => point.whole || kursi !== null);

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <Prose>
        <PageHeading>{title}</PageHeading>
        <p>{t('readIntro')}</p>
      </Prose>

      {problem === null ? null : (
        <Alert tone="warning">
          {problem === 'query'
            ? t('goTo.queryMissing', { query: query.slice(0, QUICK_JUMP_MAX_LENGTH) })
            : t(`goTo.${problem}Missing`)}
        </Alert>
      )}

      {surahs.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <>
          <ContinueReading {...await continueProps(locale, surahs)} card />
          <QuickJumpForm
            locale={locale}
            action={quranPath(locale, 'read')}
            index={jumpIndex(surahs)}
            lastPage={lastPage}
            labels={await quickJumpLabels(locale)}
          />

          {points.length === 0 ? null : (
            <section className="flex flex-col gap-4" aria-labelledby="read-start">
              <h2 id="read-start" className="text-heading font-semibold">
                {t('start.heading')}
              </h2>
              <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {points.map((point) => {
                  const surah = surahByNumber.get(point.ref.surah);
                  if (surah === undefined) return null;
                  const href = point.whole
                    ? surahPath(locale, surah.number)
                    : surahPlacePath(locale, point.ref);
                  return (
                    <li
                      key={point.key}
                      className="relative flex min-w-0 items-center justify-between gap-4 rounded-panel border border-border bg-surface-raised px-5 py-4 transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:bg-surface-sunken"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <a
                          href={href}
                          className="font-semibold text-foreground no-underline after:absolute after:inset-0 hover:text-action"
                        >
                          {point.whole ? (
                            <SurahTitle surah={surah} locale={locale} t={t} />
                          ) : (
                            t('start.kursi')
                          )}
                        </a>
                        <span className="text-caption text-foreground-muted">
                          {point.whole ? (
                            `${t('start.whole')} · ${t('ayahCount', { count: surah.ayahCount })}`
                          ) : (
                            <bdi dir="ltr">{citationOf(point.ref)}</bdi>
                          )}
                        </span>
                      </span>
                      <ArabicName
                        surah={surah}
                        className="max-w-[45%] text-end text-2xl leading-loose"
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <Panel>
            <form
              method="get"
              action={quranPath(locale, 'read')}
              aria-label={t('goTo.heading')}
              className="flex flex-col gap-4"
            >
              <h2 className="text-lg font-semibold">{t('goTo.heading')}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="read-surah" label={t('goTo.surah')}>
                  {(props) => (
                    <Select {...props} name="surah" required>
                      {surahs.map((surah) => {
                        const name = surahName(surah, locale);
                        return (
                          <option key={surah.number} value={String(surah.number)}>
                            {name === null
                              ? t('surahName', { number: surah.number })
                              : `${t('surahName', { number: surah.number })} · ${name.text}`}
                          </option>
                        );
                      })}
                    </Select>
                  )}
                </Field>
                <Field id="read-ayah" label={t('goTo.ayahOptional')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      name="ayah"
                      type="number"
                      inputMode="numeric"
                      min={1}
                    />
                  )}
                </Field>
              </div>
              <div>
                <Button>{t('goTo.submit')}</Button>
              </div>
            </form>
          </Panel>

          <section className="flex flex-col gap-4" aria-labelledby="read-browse">
            <h2 id="read-browse" className="text-heading font-semibold">
              {t('browse.heading')}
            </h2>
            <ul className="grid list-none grid-cols-1 gap-x-8 gap-y-4 p-0 sm:grid-cols-3">
              <li className="flex flex-col gap-1">
                <TextLink href={quranPath(locale, 'surah')}>
                  {t('sections.surah')}
                </TextLink>
                <span className="text-sm text-foreground-muted">
                  {t('sectionBody.surah')}
                </span>
              </li>
              <li className="flex flex-col gap-1">
                <TextLink href={quranPath(locale, 'juz')}>{t('sections.juz')}</TextLink>
                <span className="text-sm text-foreground-muted">
                  {t('sectionBody.juz')}
                </span>
              </li>
              {lastPage === 0 ? null : (
                <li className="flex flex-col gap-2">
                  <TextLink href={mushafPagePath(locale, 1)}>
                    {t('browse.pages')}
                  </TextLink>
                  <span className="text-sm text-foreground-muted">
                    {t('browse.pagesBody', { last: lastPage })}
                  </span>
                  <GoToPage locale={locale} lastPage={lastPage} t={t} id="read-page" />
                </li>
              )}
            </ul>
            {first === undefined ? null : (
              <p>
                <TextLink href={surahPath(locale, first.number)}>
                  {t('beginAt', { number: first.number })}
                </TextLink>
              </p>
            )}
          </section>
        </>
      )}
    </QuranFrame>
  );
}
