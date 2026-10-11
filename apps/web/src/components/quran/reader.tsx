import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  QURAN_JUZ_PAGE,
  QURAN_SURAH_MAX,
  citationOf,
  type LayerText,
  type PublicAyah,
  type PublicJuz,
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
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import {
  ArabicText,
  LAYER_SIZE,
  LayerBlock,
  LayerNotices,
  QuranFrame,
  ReadingForm,
  SegmentPlayer,
  languageOf,
  segmentRange,
  quranTrail,
} from './parts';
import {
  NO_READING_CHOICE,
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
import { quranIndexable, readSurah, readSurahs, readingContext } from './read';

/**
 * The public Quran reader — the Surah index, a Surah, a canonical Ayah
 * citation, the Juz index and a Juz (ROUTE_MAP.md §3.3; Phase 18).
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read is Quran's public
 * reader, Taxonomy's content languages and nothing else: no session, no
 * progress, no cookie. A signed-in reader sees exactly what an anonymous one
 * does, and nothing about a visit is recorded.
 *
 * BATCHED. A Surah page is ONE read for its ayat and ONE per chosen layer —
 * never a read per Ayah — and a Juz is read in bounded pages.
 *
 * NOTHING INVENTED. Every name, count, boundary and text shown comes from the
 * reader; where a source recorded no name, the page says "Surah {number}" and
 * nothing more.
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

/** The source's Arabic name of a Surah, when it supplied one. */
function ArabicName({ surah }: { readonly surah: PublicSurah }) {
  if (surah.nameArabic === null) return null;
  return (
    <span lang="ar" dir="rtl" className="text-xl">
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
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.surah')}
        </p>
      </div>
      {surahs.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ol
          aria-label={title}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {surahs.map((surah) => (
            <Panel key={surah.number} as="li">
              <div className="flex min-w-0 flex-col gap-2">
                <h2 className="text-lg font-semibold break-words">
                  <TextLink href={surahPath(locale, surah.number)}>
                    <SurahTitle surah={surah} locale={locale} t={t} />
                  </TextLink>
                </h2>
                <ArabicName surah={surah} />
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {surahFacts(surah, t)}
                </p>
              </div>
            </Panel>
          ))}
        </ol>
      )}
    </QuranFrame>
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
    <details
      open={open}
      className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] px-4 py-2"
    >
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

interface AyahLayers {
  readonly translation: {
    readonly name: string;
    readonly language: ReturnType<typeof languageOf>;
    readonly texts: ReadonlyMap<number, string>;
  } | null;
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

const NO_LAYERS: AyahLayers = { translation: null, transliteration: null, tafsir: null };

/**
 * One Ayah as a list item: an `<article>` NAMED "Surah 2, Ayah 3" so a screen
 * reader announces the verse it is in, an `id="ayah-3"` anchor, the citation
 * link (keyboard-reachable, and the way to its canonical page), the Arabic, and
 * each chosen layer in its own labelled group.
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
  const translation = layers.translation?.texts.get(ayah.ayah);
  const transliteration = layers.transliteration?.texts.get(ayah.ayah);
  const tafsirLayer = layers.tafsir;
  const tafsir = tafsirLayer?.placed.get(ayah.ayah) ?? [];

  return (
    <li id={withSurah ? `ayah-${key}` : ayahAnchor(ayah.ayah)} className="scroll-mt-4">
      <article
        aria-label={t('ayahName', { surah: ayah.surah, ayah: ayah.ayah })}
        className="flex min-w-0 flex-col gap-3 border-b border-[color:var(--color-border)] py-5"
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <TextLink href={withReading(ayahPath(locale, ref), choice)}>
            <span dir="ltr">{citationOf(ref)}</span>
          </TextLink>
          {ayah.sajdah === null ? null : (
            <StatusBadge tone="neutral">{t(`sajdah.${ayah.sajdah}`)}</StatusBadge>
          )}
        </div>
        <div className="max-w-[var(--measure-prose)] min-w-0">
          <ArabicText
            id={`arabic-${key}`}
            label={t('layer.arabic')}
            text={ayah.text}
            size={choice.size}
          />
        </div>
        {layers.translation === null || translation === undefined ? null : (
          <div className="max-w-[var(--measure-prose)]">
            <LayerBlock
              id={`translation-${key}`}
              label={t('layer.translation', { name: layers.translation.name })}
              text={translation}
              language={layers.translation.language}
              size={choice.size}
            />
          </div>
        )}
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
 * /quran/surah/{surahNumber}
 * ========================================================================= */

/** Builds the chosen layers for a range of one Surah — one read per layer. */
async function layersFor(
  context: Awaited<ReturnType<typeof readingContext>>,
  languages: ReadonlyMap<string, ContentLanguage>,
  surah: number,
  from: number,
  to: number,
  shown: readonly number[],
): Promise<AyahLayers> {
  const reader = quranReadRuntime().reader;
  const { translation, transliteration, tafsir } = context.chosen;
  const [translationTexts, transliterationTexts, tafsirEntries] = await Promise.all([
    translation === null
      ? Promise.resolve([])
      : reader.translationTexts(translation.id, surah, from, to),
    transliteration === null
      ? Promise.resolve([])
      : reader.transliterationTexts(transliteration.id, surah, from, to),
    tafsir === null
      ? Promise.resolve([])
      : reader.tafsirEntries(tafsir.id, surah, from, to),
  ]);
  return {
    translation:
      translation === null
        ? null
        : {
            name: translation.name,
            language: languageOf(languages, translation.languageCode),
            texts: byAyah(translationTexts),
          },
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
  const [layers, segments] = await Promise.all([
    layersFor(context, languages, surah.number, 1, surah.ayahCount, shown),
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
      <Prose>
        <h1 className="text-3xl font-semibold tracking-tight break-words">
          <SurahTitle surah={surah} locale={locale} t={t} />
        </h1>
        <ArabicName surah={surah} />
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {surahFacts(surah, t)}
        </p>
      </Prose>

      <LayerNotices locale={locale} unavailable={context.unavailable} />
      <ReadingForm
        locale={locale}
        action={path}
        context={context}
        languages={languages}
      />

      {reciter === null ? null : (
        <section className="flex flex-col gap-4" aria-labelledby="surah-recitation">
          <SectionHeading>
            <span id="surah-recitation">{t('recitationOf', { name: reciter.name })}</span>
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
                  <SegmentPlayer locale={locale} recitation={reciter} segment={segment} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="surah-ayat">
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

      <GoToAyah locale={locale} surah={surah} t={t} />

      <nav aria-label={t('surahNavigation')} className="flex flex-wrap gap-6">
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
      </nav>

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
  const [layers, segments] = await Promise.all([
    layersFor(context, languages, ref.surah, ref.ayah, ref.ayah, [ref.ayah]),
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
  const translation = layers.translation?.texts.get(ref.ayah);
  const transliteration = layers.transliteration?.texts.get(ref.ayah);
  const tafsirLayer = layers.tafsir;
  const tafsir = tafsirLayer?.placed.get(ref.ayah) ?? [];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: heading },
      ]}
    >
      <article aria-labelledby="ayah-heading" className="flex min-w-0 flex-col gap-8">
        <Prose>
          <h1 id="ayah-heading" className="text-3xl font-semibold tracking-tight">
            {heading}
          </h1>
          <p className="text-sm">
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
          </p>
        </Prose>

        <LayerNotices locale={locale} unavailable={context.unavailable} />

        <div className="flex max-w-[var(--measure-prose)] min-w-0 flex-col gap-4">
          <ArabicText
            id="ayah-arabic"
            label={t('layer.arabic')}
            text={ayah.text}
            size={choice.size}
          />
          {layers.translation === null ? null : translation === undefined ? (
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('layerMissing.translation', { name: layers.translation.name })}
            </p>
          ) : (
            <LayerBlock
              id="ayah-translation"
              label={t('layer.translation', { name: layers.translation.name })}
              text={translation}
              language={layers.translation.language}
              size={choice.size}
            />
          )}
          {layers.transliteration === null ? null : transliteration === undefined ? (
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('layerMissing.transliteration', { name: layers.transliteration.name })}
            </p>
          ) : (
            <LayerBlock
              id="ayah-transliteration"
              label={t('layer.transliteration', { name: layers.transliteration.name })}
              text={transliteration}
              language={layers.transliteration.language}
              size={choice.size}
              muted
            />
          )}
        </div>

        {tafsirLayer === null ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="ayah-tafsir">
            <h2 id="ayah-tafsir" className="text-lg font-semibold">
              {t('layer.tafsir', { name: tafsirLayer.name })}
            </h2>
            {tafsir.length === 0 ? (
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
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

        <nav aria-label={t('ayahNavigation')} className="flex flex-wrap gap-6">
          {before === null ? null : (
            <TextLink href={withReading(ayahPath(locale, before), choice)}>
              {t('previousAyah', { citation: citationOf(before) })}
            </TextLink>
          )}
          {after === null ? null : (
            <TextLink href={withReading(ayahPath(locale, after), choice)}>
              {t('nextAyah', { citation: citationOf(after) })}
            </TextLink>
          )}
        </nav>
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
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.juz')}
        </p>
      </div>
      {list.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ol
          aria-label={title}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {list.map((juz) => (
            <Panel key={juz.number} as="li">
              <div className="flex min-w-0 flex-col gap-2">
                <h2 className="text-lg font-semibold">
                  <TextLink href={juzPath(locale, juz.number)}>
                    {t('juzName', { number: juz.number })}
                  </TextLink>
                </h2>
                <JuzRange juz={juz} t={t} />
              </div>
            </Panel>
          ))}
        </ol>
      )}
    </QuranFrame>
  );
}

/** "From 2:142 to 2:252 · 111 ayat" — the reader's own derived range. */
function JuzRange({ juz, t }: { readonly juz: PublicJuz; readonly t: QuranTranslator }) {
  return (
    <p className="text-sm text-[color:var(--color-foreground-muted)]">
      {t('juzRange', {
        start: citationOf(juz.start),
        end: citationOf(juz.end),
      })}
      {' · '}
      {t('ayahCount', { count: juz.ayahCount })}
    </p>
  );
}

/**
 * One Juz in bounded pages of `QURAN_JUZ_PAGE` ayat, in canonical order, a
 * heading wherever a Surah begins, and every Ayah linked to its citation.
 */
export async function JuzPage({
  locale,
  availability,
  juz,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly juz: PublicJuz;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const path = juzPath(locale, juz.number);
  const [page, surahs] = await Promise.all([
    quranReadRuntime().reader.juzAyat(juz.number, offset),
    readSurahs(),
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

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: heading },
      ]}
    >
      <Prose>
        <PageHeading>{heading}</PageHeading>
        <JuzRange juz={juz} t={t} />
      </Prose>

      {groups.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        groups.map((group) => {
          const surah = surahByNumber.get(group.surah);
          const id = `juz-surah-${String(group.surah)}`;
          return (
            <section
              key={group.surah}
              className="flex flex-col gap-2"
              aria-labelledby={id}
            >
              <h2 id={id} className="text-lg font-semibold break-words">
                <TextLink href={surahPath(locale, group.surah)}>
                  {surah === undefined ? (
                    t('surahName', { number: group.surah })
                  ) : (
                    <SurahTitle surah={surah} locale={locale} t={t} />
                  )}
                </TextLink>
              </h2>
              <ol aria-labelledby={id} className="flex flex-col">
                {group.ayat.map((ayah) => (
                  <AyahItem
                    key={ayah.ayah}
                    locale={locale}
                    ayah={ayah}
                    layers={NO_LAYERS}
                    choice={NO_READING_CHOICE}
                    t={t}
                    withSurah
                  />
                ))}
              </ol>
            </section>
          );
        })
      )}

      <Pagination
        label={heading}
        previous={links.previous === null ? null : offsetPathOf(path, links.previous)}
        next={links.next === null ? null : offsetPathOf(path, links.next)}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />

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

/**
 * Where to begin reading. SIGNED OUT AND STATELESS: no progress is read or
 * written and no cookie is set — resuming belongs to an authenticated island a
 * later phase owns. A visitor chooses a Surah (and, if they like, an Ayah) and
 * is sent to its canonical address; a choice the reader cannot honour is said
 * so in words.
 */
export async function ReaderEntryPage({
  locale,
  availability,
  problem,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly problem: 'surah' | 'ayah' | null;
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
        <Alert tone="warning">{t(`goTo.${problem}Missing`)}</Alert>
      )}

      {surahs.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
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
