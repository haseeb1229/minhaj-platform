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
import { QuickJumpForm } from './landing-islands';
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
  ayahAnchor,
  ayahPath,
  juzPath,
  nextAyah,
  offsetPathOf,
  pageLinks,
  previousAyah,
  quranPath,
  segmentCovering,
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
import {
  corpusNotice,
  quranIndexable,
  readOpening,
  readSurah,
  readSurahs,
  readingContext,
} from './read';
import { QuranReaderControls, type ReaderControlLabels } from './reader-controls';
import {
  TRANSLATION_LANGUAGES,
  defaultShow,
  type TranslationLanguage,
} from './reader-preferences';

/**
 * The public Quran reader — the Surah index, a Surah, a canonical Ayah
 * citation, the Juz index and a Juz (ROUTE_MAP.md §3.3; Phase 18; R2).
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read is Quran's public
 * reader, Taxonomy's content languages and nothing else: no session, no
 * progress, no cookie. A signed-in reader sees exactly what an anonymous one
 * does; the one client island (`./reader-controls`) keeps its preferences and
 * the last Ayah read in this browser only.
 *
 * BATCHED. A Surah page is ONE read for its ayat and ONE per shown layer —
 * never a read per Ayah — and a Juz is read in bounded pages.
 *
 * NOTHING INVENTED. Every name, count, boundary and text shown comes from the
 * reader; where a source recorded no name, the page says "Surah {number}" and
 * nothing more.
 *
 * R2 — THE READING VIEW (benchmark §F, patterns 1–6, 25). One centred reading
 * column; each Ayah a row separated by a hairline, never a card: its citation
 * chip, its quiet actions, the Arabic at reading size with a presentational
 * end mark, and each shown translation beneath it with its attribution. A
 * sticky context bar carries the place (Surah, Juz, a position line) and the
 * settings. With no JavaScript the page is complete: the default translations
 * for the interface language are server-rendered, every choice is a GET form,
 * and only Copy and Share wait for script.
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
          <span lang={name.locale} dir={directionOf(name.locale)}>
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
 * Every Surah as one row of a grid: its number, its title (the link, named
 * "Surah {n} · {name}"), its facts, and its Arabic name in the Quran face at
 * the inline end. The whole row is the link's target; only the title names it.
 */
export function SurahIndexList({
  locale,
  surahs,
  label,
  t,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly surahs: readonly PublicSurah[];
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
      {surahs.map((surah) => (
        <li
          key={surah.number}
          className="relative flex min-w-0 items-center gap-4 border-b border-border py-4 transition-colors duration-[var(--duration-fast)] hover:bg-surface-raised"
        >
          <span
            aria-hidden="true"
            className="w-9 shrink-0 text-center text-sm font-semibold text-accent tabular-nums"
          >
            {surah.number}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Heading className="text-base font-semibold break-words">
              <a
                href={surahPath(locale, surah.number)}
                className="text-foreground no-underline after:absolute after:inset-0 hover:text-action"
              >
                <SurahTitle surah={surah} locale={locale} t={t} />
              </a>
            </Heading>
            <p className="text-caption text-foreground-muted">{surahFacts(surah, t)}</p>
          </div>
          <ArabicName surah={surah} className="shrink-0 text-2xl leading-loose" />
        </li>
      ))}
    </ol>
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

export async function SurahIndexPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const surahs = await readSurahs();
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
        <SurahIndexList locale={locale} surahs={surahs} label={title} t={t} />
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
  /** The quick choice's language, for a default translation; null when chosen. */
  readonly quick: TranslationLanguage | null;
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

/** The primary subtag of a content-language code: `ur-PK` → `ur`. */
const primaryOf = (code: string) => code.split('-')[0] ?? code;

/**
 * WHICH TRANSLATIONS A PAGE SHOWS.
 *
 * A translation the ADDRESS chose (`?translation=`) is shown alone, exactly as
 * before. One it asked for that is not public is shown as NOTHING — the page
 * says so (`LayerNotices`) and never substitutes another work. With no choice
 * in the address, the page shows its DEFAULTS (benchmark pattern 3): the first
 * public translation in Urdu and the first in English — Irfan-ul-Quran on the
 * reference preview — the interface language's first. The quick choice in the
 * reader then shows either, both or neither without another request.
 */
function translationSet(
  context: Awaited<ReturnType<typeof readingContext>>,
  request: ReadingRequest,
  locale: Locale,
): readonly {
  readonly work: PublicLayerWork;
  readonly quick: TranslationLanguage | null;
}[] {
  const chosen = context.chosen.translation;
  if (chosen !== null) return [{ work: chosen, quick: null }];
  if (request.translation.state !== 'none') return [];
  const order: readonly TranslationLanguage[] =
    locale === 'en' ? ['en', 'ur'] : [...TRANSLATION_LANGUAGES];
  return order.flatMap((language) => {
    const work = context.options.translations.find(
      (candidate) => primaryOf(candidate.languageCode) === language,
    );
    return work === undefined ? [] : [{ work, quick: language }];
  });
}

/** Builds the shown layers for a range of one Surah — one read per layer. */
async function layersFor(
  context: Awaited<ReturnType<typeof readingContext>>,
  translations: ReturnType<typeof translationSet>,
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
      translations.map(({ work }) => reader.translationTexts(work.id, surah, from, to)),
    ),
    transliteration === null
      ? Promise.resolve([])
      : reader.transliterationTexts(transliteration.id, surah, from, to),
    tafsir === null
      ? Promise.resolve([])
      : reader.tafsirEntries(tafsir.id, surah, from, to),
  ]);
  return {
    translations: translations.map(({ work, quick }, index) => ({
      work,
      quick,
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

/** The languages of the default translations a page rendered, in quick-choice order. */
function quickLanguages(
  translations: ReturnType<typeof translationSet>,
): readonly TranslationLanguage[] {
  return TRANSLATION_LANGUAGES.filter((language) =>
    translations.some((entry) => entry.quick === language),
  );
}

/* ===========================================================================
 * One Ayah, as a Surah, a Juz or a citation shows it
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
 * Share are buttons the reader island serves, hidden until it has mounted;
 * Save is a link to the citation page, whose signed-in controls save it or set
 * it as the reading position (Phase 21) — or offer sign-in.
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
        <a href={save} aria-label={t('reader.actions.save')} className={TOOL}>
          <Icon name="bookmark" size={20} />
        </a>
      )}
    </div>
  );
}

/**
 * One Ayah as a list item: an `<article>` NAMED "Surah 2, Ayah 3" so a screen
 * reader announces the verse it is in, an `id="ayah-3"` anchor, the citation
 * chip (keyboard-reachable, and the way to its canonical page), the Arabic,
 * and each shown layer in its own labelled group. `data-*` carries what the
 * reader island needs: the citation, the Juz and the canonical address.
 */
function AyahItem({
  locale,
  ayah,
  layers,
  choice,
  t,
  withSurah = false,
}: {
  readonly locale: Locale;
  readonly ayah: PublicAyah;
  readonly layers: AyahLayers;
  readonly choice: ReadingChoice;
  readonly t: QuranTranslator;
  readonly withSurah?: boolean;
}) {
  const ref = { surah: ayah.surah, ayah: ayah.ayah };
  const key = `${String(ayah.surah)}-${String(ayah.ayah)}`;
  const canonical = ayahPath(locale, ref);
  const transliteration = layers.transliteration?.texts.get(ayah.ayah);
  const tafsirLayer = layers.tafsir;
  const tafsir = tafsirLayer?.placed.get(ayah.ayah) ?? [];

  return (
    <li
      id={withSurah ? `ayah-${key}` : ayahAnchor(ayah.ayah)}
      data-ayah={citationOf(ref)}
      data-juz={ayah.juz}
      data-canonical={canonical}
      className="scroll-mt-20"
    >
      <article
        aria-label={t('ayahName', { surah: ayah.surah, ayah: ayah.ayah })}
        className="flex min-w-0 flex-col gap-4 border-b border-border py-7"
      >
        <div className="flex items-center justify-between gap-3">
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
        />
        {layers.translations.map((layer, index) => {
          const text = layer.texts.get(ayah.ayah);
          return text === undefined ? null : (
            <div key={layer.work.id} className="max-w-[68ch]">
              <TranslationText
                id={`translation-${key}${index === 0 ? '' : `-${String(index + 1)}`}`}
                label={t('layer.translation', { name: layer.work.name })}
                name={layer.work.name}
                text={text}
                language={layer.language}
                quickChoice={layer.quick}
              />
            </div>
          );
        })}
        {layers.transliteration === null || transliteration === undefined ? null : (
          <div className="max-w-[var(--measure-prose)]">
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
        {tafsirLayer === null
          ? null
          : tafsir.map((entry) => (
              <TafsirEntry
                key={entry.id}
                entry={entry}
                work={tafsirLayer}
                language={tafsirLayer.language}
                size={choice.size}
                t={t}
              />
            ))}
      </article>
    </li>
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

/** The island's words, from the public catalogue. */
async function controlLabels(
  locale: Locale,
  languages: ReadonlyMap<string, ContentLanguage>,
): Promise<ReaderControlLabels> {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return {
    translationSwitch: t('reader.translationSwitch'),
    settings: t('reader.settings'),
    settingsTitle: t('reader.settingsTitle'),
    close: t('reader.close'),
    translationHeading: t('reader.translationHeading'),
    shows: {
      ur: languageOf(languages, 'ur').name,
      en: languageOf(languages, 'en').name,
      both: t('reader.both'),
      none: t('reader.none'),
    },
    arabicSize: t('reader.arabicSize'),
    translationSize: t('reader.translationSize'),
    decrease: t('reader.decrease'),
    increase: t('reader.increase'),
    reset: t('reader.reset'),
    kept: t('reader.kept'),
    moreOptions: t('reader.moreOptions'),
    useDefault: t('reader.useDefault'),
    position: t.raw('juzName') as string,
    copied: t('reader.status.copied'),
    linkCopied: t('reader.status.linkCopied'),
    copyFailed: t('reader.status.failed'),
  };
}

/**
 * The reader element and its sticky context bar. The bar names the place on
 * its inline start and carries the island at its inline end; the island
 * draws the position line along the bar's lower edge.
 */
async function ReadingFrame({
  locale,
  availability,
  title,
  request,
  translations,
  languages,
  initialJuz,
  surahs,
  remember,
  defaultsHref,
  children,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly title: ReactNode;
  readonly request: ReadingRequest;
  readonly translations: ReturnType<typeof translationSet>;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly initialJuz: number;
  readonly surahs: readonly PublicSurah[];
  readonly remember: boolean;
  /** This page with its default translations: the address chose none. */
  readonly defaultsHref: string;
  readonly children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const quick = quickLanguages(translations);
  const fallback = defaultShow(locale, quick);
  const chosen = translations.find((entry) => entry.quick === null);
  const explicitSize = request.size !== DEFAULT_TEXT_SIZE;

  return (
    <div
      id={READER_ID}
      data-translations={fallback}
      className={`quran-reader quran-size-${request.size} flex min-w-0 flex-col`}
    >
      <div className="sticky top-0 z-[var(--layer-header)] border-b border-border bg-surface">
        {/* Wraps rather than widens the page when a long Surah name and the
            controls cannot share the narrowest row. */}
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5 sm:gap-x-3">
          <p className="flex min-w-0 items-center gap-3 truncate text-sm font-semibold">
            {title}
          </p>
          <QuranReaderControls
            readerId={READER_ID}
            labels={await controlLabels(locale, languages)}
            languages={quick}
            fallbackShow={fallback}
            fixedTranslation={
              chosen === undefined
                ? null
                : {
                    text: t('reader.fixed', { name: chosen.work.name }),
                    resetHref: defaultsHref,
                  }
            }
            explicitSize={explicitSize}
            initialJuz={initialJuz}
            arabicSources={
              corpusNotice(availability) === 'reference' ? [t('reader.arabicSource')] : []
            }
            surahLabels={Object.fromEntries(
              surahs.map((surah) => [String(surah.number), citationLabel(surah, locale)]),
            )}
            remember={remember}
            moreOptionsHref={`#${READING_OPTIONS_ID}`}
          />
        </div>
      </div>
      {children}
    </div>
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

export async function SurahPage({
  locale,
  availability,
  surah,
  request,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly surah: PublicSurah;
  readonly request: ReadingRequest;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const path = surahPath(locale, surah.number);

  const [context, languages, ayat, neighbours] = await Promise.all([
    readingContext(request),
    contentLanguages(),
    reader.ayat(surah.number, 1, surah.ayahCount),
    Promise.all([
      surah.number > 1 ? readSurah(surah.number - 1) : Promise.resolve(null),
      surah.number < QURAN_SURAH_MAX
        ? readSurah(surah.number + 1)
        : Promise.resolve(null),
    ]),
  ]);
  const shown = ayat.map((ayah) => ayah.ayah);
  const translations = translationSet(context, request, locale);
  const [layers, segments] = await Promise.all([
    layersFor(context, translations, languages, surah.number, 1, surah.ayahCount, shown),
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
  const firstJuz = ayat[0]?.juz ?? null;
  const lastJuz = ayat.at(-1)?.juz ?? null;
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
        <header className="flex flex-col items-center gap-2 border-b border-border pb-8 text-center">
          {/* A centred flex item sizes to its content, so a long source word
              must be breakable at any point (`wrap-anywhere`) to keep the
              heading within the narrowest viewport. */}
          <h1 className="max-w-full text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
            <SurahTitle surah={surah} locale={locale} t={t} />
          </h1>
          <ArabicName surah={surah} className="order-first text-5xl leading-loose" />
          <p className="text-sm text-foreground-muted">
            {surahFacts(surah, t)}
            {firstJuz === null || lastJuz === null
              ? null
              : ` · ${
                  firstJuz === lastJuz
                    ? t('juzName', { number: firstJuz })
                    : t('reader.juzSpan', { start: firstJuz, end: lastJuz })
                }`}
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
                      <TextLink href={`#${ayahAnchor(segment.startAyah)}`}>
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
          translations={translations}
          languages={languages}
          initialJuz={firstJuz ?? 1}
          surahs={[surah]}
          remember
          defaultsHref={withReading(path, { ...choice, translation: null })}
        >
          <Bismillah availability={availability} surah={surah.number} />
          <section className="flex flex-col" aria-labelledby="surah-ayat">
            <h2 id="surah-ayat" className="sr-only">
              {t('ayatOf', { number: surah.number })}
            </h2>
            {ayat.length === 0 ? (
              <EmptyState>{t('empty')}</EmptyState>
            ) : (
              <ol aria-labelledby="surah-ayat" className="flex flex-col">
                {ayat.map((ayah) => (
                  <AyahItem
                    key={ayah.ayah}
                    locale={locale}
                    ayah={ayah}
                    layers={layers}
                    choice={choice}
                    t={t}
                  />
                ))}
              </ol>
            )}
          </section>
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
        />

        <GoToAyah locale={locale} surah={surah} t={t} />

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
 * the reader entry, which validates the number against the reader and sends
 * the visitor to its canonical citation.
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
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="surah" value={String(surah.number)} />
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
  const translations = translationSet(context, request, locale);
  const [layers, segments] = await Promise.all([
    layersFor(context, translations, languages, ref.surah, ref.ayah, ref.ayah, [
      ref.ayah,
    ]),
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
              href={withReading(
                surahPath(locale, surah.number),
                choice,
                {},
                ayahAnchor(ref.ayah),
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
          translations={translations}
          languages={languages}
          initialJuz={ayah.juz}
          surahs={[surah]}
          remember
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
            {layers.translations.map((layer, index) => {
              const text = layer.texts.get(ref.ayah);
              return text === undefined ? null : (
                <div key={layer.work.id} className="max-w-[68ch]">
                  <TranslationText
                    id={
                      index === 0
                        ? 'ayah-translation'
                        : `ayah-translation-${String(index + 1)}`
                    }
                    label={t('layer.translation', { name: layer.work.name })}
                    name={layer.work.name}
                    text={text}
                    language={layer.language}
                    quickChoice={layer.quick}
                  />
                </div>
              );
            })}
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
 * the default translations read once per Surah on the page.
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
  const translations = translationSet(context, request, locale);
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
        translations,
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
            translations={translations}
            languages={languages}
            initialJuz={juz.number}
            surahs={onPage}
            remember
            defaultsHref={withReading(path, { ...context.choice, translation: null })}
          >
            {groups.map((group, index) => {
              const surah = surahByNumber.get(group.surah);
              const id = `juz-surah-${String(group.surah)}`;
              const opens = group.ayat[0]?.ayah === 1;
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
                  <ol aria-labelledby={id} className="flex flex-col">
                    {group.ayat.map((ayah) => (
                      <AyahItem
                        key={ayah.ayah}
                        locale={locale}
                        ayah={ayah}
                        layers={layered[index] ?? NO_LAYERS}
                        choice={context.choice}
                        t={t}
                        withSurah
                      />
                    ))}
                  </ol>
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
 * /quran/read — the anonymous reader entry
 * ========================================================================= */

/** What the quick jump needs to know of the corpus: numbers, counts and names. */
export function jumpIndex(surahs: readonly PublicSurah[]): readonly JumpSurah[] {
  return surahs.map((surah) => ({
    number: surah.number,
    ayahCount: surah.ayahCount,
    names: [
      ...Object.values(surah.names).filter((name): name is string => name !== undefined),
      ...(surah.nameArabic === null ? [] : [surah.nameArabic]),
    ],
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
  };
}

/**
 * Where to begin. SIGNED OUT AND STATELESS on the server: no progress is read
 * or written and no cookie is set. A visitor types a place ("18:10", a name),
 * or chooses a Surah (and, if they like, an Ayah), and is sent to its
 * canonical address; a choice the reader cannot honour is said so in words.
 */
export async function ReaderEntryPage({
  locale,
  availability,
  problem,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly problem: 'surah' | 'ayah' | 'query' | null;
  /** What was typed into the quick jump, when it matched nothing. */
  readonly query: string;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const surahs = await readSurahs();
  const title = t('sections.read');
  const first = surahs[0];

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
          <QuickJumpForm
            locale={locale}
            action={quranPath(locale, 'read')}
            index={jumpIndex(surahs)}
            labels={await quickJumpLabels(locale)}
          />
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
        </>
      )}

      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {first === undefined ? null : (
          <li>
            <TextLink href={surahPath(locale, first.number)}>
              {t('beginAt', { number: first.number })}
            </TextLink>
          </li>
        )}
        <li>
          <TextLink href={quranPath(locale, 'surah')}>{t('sections.surah')}</TextLink>
        </li>
        <li>
          <TextLink href={quranPath(locale, 'juz')}>{t('sections.juz')}</TextLink>
        </li>
      </ul>
    </QuranFrame>
  );
}
