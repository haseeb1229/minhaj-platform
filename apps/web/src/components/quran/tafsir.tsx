import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { formatDuration } from '@minhaj/contracts/media';
import { surahAyahCount } from '@minhaj/contracts/passage';
import type {
  PublicAyah,
  PublicLayerWork,
  PublicSurah,
  QuranAvailability,
  TranslationLayerText,
} from '@minhaj/contracts/quran';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { quranReadRuntime } from '@/composition/quran-read';
import { contentLanguageBadge } from '@/components/content-language';
import { editionCoverPath } from '@/components/library/cover';
import { workPath } from '@/components/library/presentation';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData, Duration } from '@/components/media/parts';
import { mediaLabel, videoPath, videoPosterPath } from '@/components/media/presentation';
import {
  ActionLink,
  Alert,
  Button,
  EmptyState,
  Icon,
  MediaCard,
  Select,
  Stat,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { inReadingOrder } from './compare';
import { QuranFrame, languageOf, noteLabelsFor, quranTrail } from './parts';
import {
  NO_READING_CHOICE,
  ayahPath,
  quranPath,
  surahMeaning,
  surahName,
  surahPath,
  tafsirPath,
  withReading,
} from './presentation';
import { quranIndexable, readSurahs } from './read';
import { ArabicText, TranslationText } from './scripture';
import {
  bookTitle,
  bySurah,
  citationsIn,
  lectureHref,
  passageCitation,
  surahCounts,
  surahTafsirLayout,
  tafsirAyahId,
  tafsirSurahPath,
  type AyahResources,
  type PassageGroup,
  type TafsirTextEntry,
} from './tafsir-layout';
import {
  readTafsirHub,
  readTafsirResources,
  worksById,
  type HubBook,
  type HubLecture,
} from './tafsir-read';

/**
 * THE TAFSIR HUB (Quran Part 8; owner decision OPEN_DECISIONS.md §1.2 item 2:
 * "a Minhaj-ul-Quran hub: Shaykh-ul-Islam's tafsir books and Minhaj TV lectures
 * linked per Ayah, with per-Ayah text slots for tafsir text Minhaj-ul-Quran
 * supplies — no external tafsir").
 *
 *   /quran/tafsir                 the hub: tafsir texts (only when one is
 *                                 public), the Surah grid, the books and the
 *                                 lectures, each shelved by Surah;
 *   /quran/tafsir/surah/{n}       one Surah's tafsir: what explains the whole
 *                                 Surah first, then each group of overlapping
 *                                 passages with its ayat, its tafsir text, its
 *                                 books and its lectures.
 *
 * LAYER-4 COMPOSITION (DOMAIN_MODEL.md §8.8). The books are Library's, the
 * lectures Media's, the texts and the ayat Quran's — each read through its
 * owner's PUBLIC read (`./tafsir-read`) and arranged by the one pure layout
 * (`./tafsir-layout`). Nothing is said that an owner did not answer: no count
 * is invented, and a kind with nothing public is simply absent.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

const SURAH_GRID_ID = 'tafsir-surahs';

/** "Al-Kahf" as the interface reads it, with its language. */
function SurahTitle({
  surah,
  locale,
  number,
  t,
}: {
  readonly surah: PublicSurah | undefined;
  readonly locale: Locale;
  readonly number: number;
  readonly t: QuranTranslator;
}) {
  const name = surah === undefined ? null : surahName(surah, locale);
  return (
    <>
      {t('surahName', { number })}
      {name === null ? null : (
        <span
          lang={name.locale}
          className={name.locale === 'ar' ? 'quran-name' : undefined}
        >{` · ${name.text}`}</span>
      )}
    </>
  );
}

/** The People credited on a book or lecture, as one plain line. */
function creditLine(ids: readonly string[], names: Names): string {
  return ids
    .flatMap((id) => {
      const person = names.people.get(id);
      return person === undefined ? [] : [person.name];
    })
    .join(' · ');
}

/** One tafsir book as a cover-led card: its title, who wrote it, what it explains. */
function BookCard({
  locale,
  book,
  surah,
  names,
  t,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly book: HubBook;
  /** Name only the passages in this Surah; null names every passage. */
  readonly surah: number | null;
  readonly names: Names;
  readonly t: QuranTranslator;
  readonly headingLevel?: 'h3' | 'h4';
}) {
  const label = bookTitle(book, locale);
  const language = contentLanguageBadge(label.locale, locale);
  const credits = creditLine(
    book.contributors.map((entry) => entry.personId),
    names,
  );
  return (
    <MediaCard
      href={workPath(locale, book.slug)}
      title={label.title}
      lang={label.locale}
      dir={directionOf(label.locale)}
      aspect="book"
      sizes="11rem"
      headingLevel={headingLevel}
      type={t('tafsirHub.bookType')}
      {...(language === undefined ? {} : { language })}
      image={
        book.cover === null
          ? null
          : {
              path: editionCoverPath(book.cover.editionId, book.cover.assetId),
              width: book.cover.width,
              height: book.cover.height,
            }
      }
      meta={[
        <bdi key="cites" dir="ltr" className="font-semibold text-accent tabular-nums">
          {citationsIn(book.passages, surah).join(' · ')}
        </bdi>,
        credits === '' ? null : <span dir="auto">{credits}</span>,
        book.year === null ? null : <span className="tabular-nums">{book.year}</span>,
      ]}
    />
  );
}

/** One lecture as a poster card, opened at its passage where a start is recorded. */
function LectureCard({
  locale,
  lecture,
  surah,
  names,
  t,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly lecture: HubLecture;
  readonly surah: number | null;
  readonly names: Names;
  readonly t: QuranTranslator;
  readonly headingLevel?: 'h3' | 'h4';
}) {
  const label = mediaLabel(lecture, locale);
  const language = contentLanguageBadge(lecture.languageCode, locale);
  const shown =
    surah === null
      ? lecture.passages
      : lecture.passages.filter((passage) => passage.surah === surah);
  const first = shown[0] ?? lecture.passages[0];
  const credits = creditLine(lecture.speakerIds, names);
  return (
    <MediaCard
      href={
        first === undefined
          ? videoPath(locale, lecture.slug)
          : lectureHref(videoPath(locale, lecture.slug), first)
      }
      title={label.title}
      lang={label.locale}
      dir={directionOf(label.locale)}
      aspect="poster"
      sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
      headingLevel={headingLevel}
      type={t('tafsirHub.lectureType')}
      {...(language === undefined ? {} : { language })}
      image={
        lecture.poster === null
          ? null
          : {
              path: videoPosterPath(lecture.id, lecture.poster.assetId),
              width: lecture.poster.width,
              height: lecture.poster.height,
            }
      }
      {...(lecture.durationSeconds === null
        ? {}
        : { overlay: <Duration seconds={lecture.durationSeconds} /> })}
      meta={[
        <bdi key="cites" dir="ltr" className="font-semibold text-accent tabular-nums">
          {citationsIn(lecture.passages, surah).join(' · ')}
        </bdi>,
        first === undefined || first.startSeconds === null ? null : (
          <span key="start">
            {t('tafsirHub.startsAt', { time: formatDuration(first.startSeconds) })}
          </span>
        ),
        credits === '' ? null : <span dir="auto">{credits}</span>,
      ]}
    />
  );
}

/* ===========================================================================
 * /quran/tafsir — the hub
 * ========================================================================= */

/** One public Tafsir text work, with what it covers. */
function TextWorkCard({
  locale,
  work,
  surahs,
  entries,
  first,
  languages,
  t,
}: {
  readonly locale: Locale;
  readonly work: PublicLayerWork;
  readonly surahs: number;
  readonly entries: number;
  readonly first: number | null;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: QuranTranslator;
}) {
  const language = languageOf(languages, work.languageCode);
  const headingId = `tafsir-work-${work.slug}`;
  return (
    <li className="card-surface flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={headingId} className="text-subheading font-semibold wrap-anywhere">
          <span lang={language.code} dir={language.direction}>
            <TextLink href={tafsirPath(locale, work.slug)}>{work.name}</TextLink>
          </span>
        </h3>
        <p className="text-sm text-foreground-muted">
          <span lang={language.code} dir={language.direction}>
            {language.name}
          </span>
          {' · '}
          {t('tafsirHub.workCoverage', { surahs, entries })}
        </p>
      </div>
      {work.description === null ? null : (
        <p
          className="line-clamp-3 text-sm wrap-anywhere"
          lang={language.code}
          dir={language.direction}
        >
          {work.description}
        </p>
      )}
      {first === null ? null : (
        <div className="mt-auto flex flex-wrap gap-3">
          <ActionLink
            href={withReading(surahPath(locale, first), {
              ...NO_READING_CHOICE,
              tafsir: work.slug,
            })}
          >
            {t('tafsirHub.readWith')}
          </ActionLink>
        </div>
      )}
    </li>
  );
}

/** One Surah in the grid: a link when anything explains it, quiet when nothing does. */
function SurahCell({
  locale,
  surah,
  counts,
  t,
}: {
  readonly locale: Locale;
  readonly surah: PublicSurah | undefined;
  readonly counts: { surah: number; texts: number; books: number; lectures: number };
  readonly t: QuranTranslator;
}) {
  const total = counts.texts + counts.books + counts.lectures;
  const name = surah === undefined ? null : surahName(surah, locale);
  const tallies = [
    counts.texts === 0
      ? null
      : { icon: 'list' as const, text: t('tafsirHub.texts', { count: counts.texts }) },
    counts.books === 0
      ? null
      : { icon: 'book' as const, text: t('tafsirHub.books', { count: counts.books }) },
    counts.lectures === 0
      ? null
      : {
          icon: 'video' as const,
          text: t('tafsirHub.lectures', { count: counts.lectures }),
        },
  ].filter((entry) => entry !== null);
  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span className="inline-flex min-w-8 justify-center rounded-full border border-accent-rule bg-accent-surface px-1.5 text-caption font-semibold text-accent tabular-nums">
          {counts.surah}
        </span>
        <span
          className={`min-w-0 font-semibold wrap-anywhere ${name?.locale === 'ar' ? 'quran-name' : ''}`}
          {...(name === null ? {} : { lang: name.locale })}
        >
          {name?.text ?? t('surahName', { number: counts.surah })}
        </span>
      </span>
      {total === 0 ? (
        <span className="text-caption text-foreground-muted">
          {t('tafsirHub.nothingYet')}
        </span>
      ) : (
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-foreground-muted">
          {tallies.map((tally) => (
            <span key={tally.icon} className="inline-flex items-center gap-1">
              <Icon name={tally.icon} size={16} className="text-accent" />
              {tally.text}
            </span>
          ))}
        </span>
      )}
    </>
  );
  return (
    <li className="min-w-0">
      {total === 0 ? (
        <div className="flex h-full min-h-11 flex-col gap-1.5 rounded-control border border-dashed border-border p-3">
          {body}
        </div>
      ) : (
        <a
          href={tafsirSurahPath(locale, counts.surah)}
          className="flex h-full min-h-11 flex-col gap-1.5 rounded-control border border-border bg-surface-raised p-3 text-foreground no-underline shadow-panel transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface"
        >
          {body}
        </a>
      )}
    </li>
  );
}

/** The no-script way in: a Surah and, optionally, an Ayah. */
async function FindForm({
  locale,
  surahs,
  surah = null,
}: {
  readonly locale: Locale;
  readonly surahs: readonly PublicSurah[];
  readonly surah?: number | null;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return (
    <form
      method="get"
      action={quranPath(locale, 'tafsir')}
      className="flex flex-wrap items-end gap-3"
      role="search"
      aria-label={t('tafsirHub.find')}
    >
      <label className="flex min-w-0 flex-[2_1_14rem] flex-col gap-1.5 text-sm font-medium">
        {t('tafsirHub.findSurah')}
        <Select name="surah" required defaultValue={surah === null ? '' : String(surah)}>
          <option value="">{t('tafsirHub.chooseSurah')}</option>
          {surahs.map((entry) => (
            <option key={entry.number} value={String(entry.number)}>
              {`${String(entry.number)}. ${surahName(entry, locale)?.text ?? ''}`}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex min-w-0 flex-[1_1_7rem] flex-col gap-1.5 text-sm font-medium">
        {t('tafsirHub.findAyah')}
        <input
          name="ayah"
          type="number"
          inputMode="numeric"
          min={1}
          max={286}
          dir="ltr"
          className="min-h-11 w-full rounded-control border border-border-strong bg-surface-raised px-3 py-2 text-base"
        />
      </label>
      <Button type="submit">{t('tafsirHub.findSubmit')}</Button>
    </form>
  );
}

export async function TafsirHubPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const [hub, surahs, languages] = await Promise.all([
    readTafsirHub(),
    readSurahs(),
    contentLanguages(),
  ]);
  const names = await referenceNames(
    {
      personIds: [
        ...hub.books.flatMap((book) => book.contributors.map((entry) => entry.personId)),
        ...hub.lectures.flatMap((lecture) => lecture.speakerIds),
      ],
      topicIds: [],
    },
    locale,
  );
  const surahOf = new Map(surahs.map((surah) => [surah.number, surah]));
  const counts = surahCounts({
    texts: hub.texts,
    books: hub.bookCounts,
    lectures: hub.lectureCounts,
  });
  const covered = counts.filter((row) => row.texts + row.books + row.lectures > 0).length;
  const coverageOf = new Map(hub.coverage.map((entry) => [entry.workId, entry]));
  const textWorks = hub.works.filter((work) => coverageOf.has(work.id));
  const bookShelves = bySurah(hub.books);
  const lectureShelves = bySurah(hub.lectures);
  const title = t('sections.tafsir');
  const nothing =
    hub.books.length === 0 && hub.lectures.length === 0 && textWorks.length === 0;
  const booksTotal = hub.books.length;

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <header className="tafsir-hero flex flex-col gap-6 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-8">
        <div className="flex max-w-3xl min-w-0 flex-col gap-3">
          <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
            {t('tafsirHub.eyebrow')}
          </p>
          <h1 className="text-display font-semibold tracking-[var(--tracking-display)] text-balance">
            {title}
          </h1>
          <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {t('tafsirHub.lede')}
          </p>
        </div>
        {nothing ? null : (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {textWorks.length === 0 ? null : (
              <Stat
                value={textWorks.length}
                label={t('tafsirHub.statTexts', { count: textWorks.length })}
                href="#tafsir-texts"
              />
            )}
            {booksTotal === 0 ? null : (
              <Stat
                value={booksTotal}
                label={t('tafsirHub.statBooks', { count: booksTotal })}
                href="#tafsir-books"
              />
            )}
            {hub.lectures.length === 0 ? null : (
              <Stat
                value={hub.lectures.length}
                label={t('tafsirHub.statLectures', { count: hub.lectures.length })}
                href="#tafsir-lectures"
              />
            )}
            <Stat
              value={covered}
              label={t('tafsirHub.statSurahs', { count: covered })}
              href={`#${SURAH_GRID_ID}`}
            />
          </div>
        )}
        {surahs.length === 0 ? null : <FindForm locale={locale} surahs={surahs} />}
      </header>

      {nothing ? <EmptyState>{t('tafsirHub.empty')}</EmptyState> : null}

      {textWorks.length === 0 ? null : (
        <section aria-labelledby="tafsir-texts" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 border-b border-border pb-3">
            <h2 id="tafsir-texts" className="text-heading font-semibold">
              {t('tafsirHub.textsHeading')}
            </h2>
            <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
              {t('tafsirHub.textsHelp')}
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {textWorks.map((work) => {
              const coverage = coverageOf.get(work.id);
              return (
                <TextWorkCard
                  key={work.id}
                  locale={locale}
                  work={work}
                  surahs={coverage?.surahs.length ?? 0}
                  entries={
                    coverage?.surahs.reduce((sum, row) => sum + row.entries, 0) ?? 0
                  }
                  first={coverage?.surahs[0]?.surah ?? null}
                  languages={languages}
                  t={t}
                />
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby={SURAH_GRID_ID} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 border-b border-border pb-3">
          <h2 id={SURAH_GRID_ID} className="text-heading font-semibold">
            {t('tafsirHub.gridHeading')}
          </h2>
          <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
            {t('tafsirHub.gridHelp')}
          </p>
        </div>
        <ol
          aria-labelledby={SURAH_GRID_ID}
          className="grid grid-cols-1 gap-2 min-[24rem]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        >
          {counts.map((row) => (
            <SurahCell
              key={row.surah}
              locale={locale}
              surah={surahOf.get(row.surah)}
              counts={row}
              t={t}
            />
          ))}
        </ol>
      </section>

      {bookShelves.length === 0 ? null : (
        <section aria-labelledby="tafsir-books" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5 border-b border-border pb-3">
            <h2 id="tafsir-books" className="text-heading font-semibold">
              {t('tafsirHub.booksHeading')}
            </h2>
            <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
              {t('tafsirHub.booksHelp')}
            </p>
          </div>
          {bookShelves.map((shelf) => (
            <div key={shelf.surah} className="flex flex-col gap-3">
              <h3 className="text-subheading font-semibold">
                <TextLink href={tafsirSurahPath(locale, shelf.surah)}>
                  <SurahTitle
                    surah={surahOf.get(shelf.surah)}
                    locale={locale}
                    number={shelf.surah}
                    t={t}
                  />
                </TextLink>
              </h3>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {shelf.items.map((book) => (
                  <BookCard
                    key={book.id}
                    locale={locale}
                    book={book}
                    surah={null}
                    names={names}
                    t={t}
                    headingLevel="h4"
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {lectureShelves.length === 0 ? null : (
        <section aria-labelledby="tafsir-lectures" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5 border-b border-border pb-3">
            <h2 id="tafsir-lectures" className="text-heading font-semibold">
              {t('tafsirHub.lecturesHeading')}
            </h2>
            <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
              {t('tafsirHub.lecturesHelp')}
            </p>
          </div>
          {lectureShelves.map((shelf) => (
            <div key={shelf.surah} className="flex flex-col gap-3">
              <h3 className="text-subheading font-semibold">
                <TextLink href={tafsirSurahPath(locale, shelf.surah)}>
                  <SurahTitle
                    surah={surahOf.get(shelf.surah)}
                    locale={locale}
                    number={shelf.surah}
                    t={t}
                  />
                </TextLink>
              </h3>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shelf.items.map((lecture) => (
                  <LectureCard
                    key={lecture.id}
                    locale={locale}
                    lecture={lecture}
                    surah={null}
                    names={names}
                    t={t}
                    headingLevel="h4"
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <p className="max-w-[var(--measure-prose)] border-t border-border pt-4 text-sm text-foreground-muted">
        {t('tafsirHub.about')}
      </p>
    </QuranFrame>
  );
}

/* ===========================================================================
 * /quran/tafsir/surah/{n} — one Surah's tafsir
 * ========================================================================= */

/** One Tafsir entry, for long reading: the work, the range, the text. */
function TextEntry({
  entry,
  work,
  languages,
  t,
}: {
  readonly entry: TafsirTextEntry;
  readonly work: PublicLayerWork | undefined;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: QuranTranslator;
}) {
  if (work === undefined) return null;
  const language = languageOf(languages, work.languageCode);
  const range = passageCitation({
    surah: entry.entry.surah,
    ayahFrom: entry.entry.startAyah,
    ayahTo: entry.entry.endAyah,
  });
  return (
    <article
      className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel"
      aria-label={t('tafsirSurah.entryLabel', { name: work.name, range })}
    >
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold" lang={language.code} dir={language.direction}>
          {work.name}
        </span>
        <bdi dir="ltr" className="font-semibold text-accent tabular-nums">
          {range}
        </bdi>
      </p>
      <div
        lang={language.code}
        dir={language.direction}
        className="editorial-prose long-form tafsir-text text-start"
      >
        {paragraphsOf(entry.entry.text).map((paragraph, index) => (
          <p key={index} className="break-words">
            {paragraph}
          </p>
        ))}
      </div>
      {work.attribution === null ? null : (
        <p className="text-caption text-foreground-muted" dir="auto">
          {work.attribution}
        </p>
      )}
    </article>
  );
}

/** What explains a group, by kind, each under a small heading. */
function GroupResources({
  locale,
  surah,
  found,
  works,
  languages,
  names,
  t,
  idBase,
}: {
  readonly locale: Locale;
  readonly surah: number;
  readonly found: AyahResources<HubBook, HubLecture>;
  readonly works: ReadonlyMap<string, PublicLayerWork>;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly names: Names;
  readonly t: QuranTranslator;
  readonly idBase: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {found.texts.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <h4 id={`${idBase}-texts`} className="flex items-center gap-2 font-semibold">
            <Icon name="list" size={20} className="text-accent" />
            {t('tafsirSurah.textsLabel')}
          </h4>
          {found.texts.map((entry) => (
            <TextEntry
              key={entry.entry.id}
              entry={entry}
              work={works.get(entry.workId)}
              languages={languages}
              t={t}
            />
          ))}
        </div>
      )}
      {found.books.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <h4 id={`${idBase}-books`} className="flex items-center gap-2 font-semibold">
            <Icon name="book" size={20} className="text-accent" />
            {t('tafsirSurah.booksLabel')}
          </h4>
          <ul
            aria-labelledby={`${idBase}-books`}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            {found.books.map((book) => (
              <BookCard
                key={book.id}
                locale={locale}
                book={book}
                surah={surah}
                names={names}
                t={t}
                headingLevel="h4"
              />
            ))}
          </ul>
        </div>
      )}
      {found.lectures.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <h4 id={`${idBase}-lectures`} className="flex items-center gap-2 font-semibold">
            <Icon name="video" size={20} className="text-accent" />
            {t('tafsirSurah.lecturesLabel')}
          </h4>
          <ul
            aria-labelledby={`${idBase}-lectures`}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {found.lectures.map(({ video, passage }) => (
              <LectureCard
                key={video.id}
                locale={locale}
                lecture={{
                  ...video,
                  // The passage this group shows it for opens first.
                  passages: [
                    passage,
                    ...video.passages.filter((entry) => entry !== passage),
                  ],
                }}
                surah={surah}
                names={names}
                t={t}
                headingLevel="h4"
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A group's ayat — the Arabic and the chosen translation — each with its own anchor. */
function GroupAyat({
  locale,
  group,
  ayat,
  translation,
  t,
}: {
  readonly locale: Locale;
  readonly group: PassageGroup<HubBook, HubLecture>;
  readonly ayat: ReadonlyMap<number, PublicAyah>;
  readonly translation: {
    readonly work: PublicLayerWork;
    readonly language: { readonly code: string; readonly direction: 'ltr' | 'rtl' };
    readonly texts: ReadonlyMap<number, TranslationLayerText>;
  } | null;
  readonly t: QuranTranslator;
}) {
  const shown = Array.from(
    { length: group.to - group.from + 1 },
    (_, index) => group.from + index,
  ).flatMap((number) => {
    const ayah = ayat.get(number);
    return ayah === undefined ? [] : [ayah];
  });
  if (shown.length === 0) return null;
  return (
    <details
      open={shown.length <= 7}
      className="tafsir-ayat rounded-panel border border-border"
    >
      <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 text-sm font-semibold">
        {t('tafsirSurah.showAyat', { count: shown.length })}
      </summary>
      <ol className="flex flex-col">
        {shown.map((ayah) => {
          const text = translation?.texts.get(ayah.ayah);
          const key = `${String(ayah.surah)}-${String(ayah.ayah)}`;
          return (
            <li
              key={key}
              id={tafsirAyahId(ayah.surah, ayah.ayah)}
              className="flex scroll-mt-28 flex-col gap-3 border-t border-border px-4 py-5"
            >
              <a
                href={ayahPath(locale, { surah: ayah.surah, ayah: ayah.ayah })}
                className="inline-flex min-h-11 w-fit items-center no-underline"
              >
                <span className="inline-flex min-w-12 items-center justify-center rounded-full border border-accent-rule bg-accent-surface px-2.5 py-0.5 text-caption font-semibold text-accent tabular-nums">
                  <bdi dir="ltr">{`${String(ayah.surah)}:${String(ayah.ayah)}`}</bdi>
                </span>
              </a>
              <ArabicText
                id={`tafsir-arabic-${key}`}
                label={t('layer.arabic')}
                text={ayah.text}
                ayah={ayah.ayah}
              />
              {translation === null || text === undefined ? null : (
                <TranslationText
                  id={`tafsir-translation-${key}`}
                  label={t('layer.translation', { name: translation.work.name })}
                  name={translation.work.name}
                  text={text.text}
                  language={translation.language}
                  index={0}
                  notes={text.notes}
                  noteLabels={noteLabelsFor(locale, t, text.notes.length)}
                />
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export async function SurahTafsirPage({
  locale,
  availability,
  surah,
  translationSlug,
  missingAyah,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly surah: PublicSurah;
  /** `?translation=` — a public translation shown under the Arabic; null for the default. */
  readonly translationSlug: string | null;
  /** `?ayah=` that nothing explains yet — said once at the top. */
  readonly missingAyah: number | null;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const count = surah.ayahCount;
  const [resources, ayat, translations, languages, hub] = await Promise.all([
    readTafsirResources(surah.number, 1, count),
    reader.ayat(surah.number, 1, count),
    reader.translations(),
    contentLanguages(),
    readTafsirHub(),
  ]);
  const ordered = inReadingOrder(translations, locale);
  const chosen =
    translationSlug === 'none'
      ? null
      : (ordered.find((work) => work.slug === translationSlug) ?? ordered[0] ?? null);
  const [texts, names] = await Promise.all([
    chosen === null
      ? Promise.resolve([])
      : reader.translationTexts(chosen.id, surah.number, 1, count),
    referenceNames(
      {
        personIds: [
          ...resources.books.flatMap((book) =>
            book.contributors.map((entry) => entry.personId),
          ),
          ...resources.lectures.flatMap((lecture) => lecture.speakerIds),
        ],
        topicIds: [],
      },
      locale,
    ),
  ]);
  const layout = surahTafsirLayout(resources, surah.number);
  const works = worksById(hub.works);
  const ayahOf = new Map(ayat.map((ayah) => [ayah.ayah, ayah]));
  const translation =
    chosen === null
      ? null
      : {
          work: chosen,
          language: languageOf(languages, chosen.languageCode),
          texts: new Map(texts.map((entry) => [entry.ayah, entry])),
        };
  const name = surahName(surah, locale);
  const meaning = surahMeaning(surah, name);
  const nameText = name?.text ?? t('surahName', { number: surah.number });
  const title = t('tafsirSurah.title', { name: nameText });
  const path = tafsirSurahPath(locale, surah.number);
  const wholeCount =
    layout.whole.texts.length + layout.whole.books.length + layout.whole.lectures.length;
  const nothing = wholeCount === 0 && layout.groups.length === 0;
  const sectionTitle = t('sections.tafsir');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: sectionTitle, path: quranPath(locale, 'tafsir') },
    { name: title, path },
  ];
  const previous = surah.number > 1 ? surah.number - 1 : null;
  const next = surah.number < 114 ? surah.number + 1 : null;

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: title },
      ]}
    >
      <header className="tafsir-hero flex flex-col gap-4 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-8">
        <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
          {t('surahName', { number: surah.number })}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-display font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
              <span {...(name === null ? {} : { lang: name.locale })}>{title}</span>
            </h1>
            {meaning === null ? null : (
              <p className="text-lede text-foreground-muted" lang={meaning.locale}>
                {meaning.text}
              </p>
            )}
          </div>
          {surah.nameArabic === null ? null : (
            <p
              lang="ar"
              dir="rtl"
              className="quran-name min-w-0 max-w-full text-title text-accent wrap-anywhere sm:text-display"
            >
              {surah.nameArabic}
            </p>
          )}
        </div>
        <p className="max-w-[var(--measure-prose)] text-foreground-muted">
          {t('tafsirSurah.intro', { count: surah.ayahCount })}
        </p>
        <div className="flex flex-wrap gap-3">
          <ActionLink href={surahPath(locale, surah.number)}>
            {t('tafsirSurah.readSurah')}
          </ActionLink>
          <ActionLink tone="secondary" href={quranPath(locale, 'tafsir')}>
            {t('tafsirSurah.allTafsir')}
          </ActionLink>
        </div>
      </header>

      {missingAyah === null ? null : (
        <Alert tone="info">
          {t('tafsirSurah.notLinked', { ayah: missingAyah })}{' '}
          <TextLink href={ayahPath(locale, { surah: surah.number, ayah: missingAyah })}>
            {t('tafsirSurah.readAyah', { ayah: missingAyah })}
          </TextLink>
        </Alert>
      )}

      {nothing ? (
        <EmptyState>{t('tafsirSurah.empty')}</EmptyState>
      ) : (
        <>
          <nav
            aria-label={t('tafsirSurah.inThisSurah')}
            className="tafsir-nav sticky top-16 z-10 flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface/95 p-3 shadow-panel backdrop-blur"
          >
            <ol className="flex min-w-0 gap-2 overflow-x-auto pb-1">
              {wholeCount === 0 ? null : (
                <li className="shrink-0">
                  <a
                    href="#tafsir-whole"
                    className="inline-flex min-h-11 items-center rounded-full border border-border-strong px-4 text-sm font-medium text-foreground no-underline hover:bg-surface-sunken"
                  >
                    {t('tafsirSurah.wholeShort')}
                  </a>
                </li>
              )}
              {layout.groups.map((group) => (
                <li key={group.from} className="shrink-0">
                  <a
                    href={`#${tafsirAyahId(surah.number, group.from)}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-border-strong px-4 text-sm font-medium text-foreground no-underline tabular-nums hover:bg-surface-sunken"
                  >
                    <bdi dir="ltr">
                      {group.from === group.to
                        ? String(group.from)
                        : `${String(group.from)}–${String(group.to)}`}
                    </bdi>
                  </a>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-end gap-3">
              <form method="get" action={path} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {t('tafsirSurah.jumpLabel')}
                  <input
                    name="ayah"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={count}
                    required
                    dir="ltr"
                    className="min-h-11 w-24 rounded-control border border-border-strong bg-surface-raised px-3 py-2"
                  />
                </label>
                <Button type="submit" tone="secondary">
                  {t('tafsirSurah.jumpSubmit')}
                </Button>
              </form>
              {ordered.length === 0 ? null : (
                <form
                  method="get"
                  action={path}
                  className="flex flex-wrap items-end gap-2"
                >
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t('tafsirSurah.translationLabel')}
                    <Select
                      name="translation"
                      defaultValue={chosen === null ? 'none' : chosen.slug}
                    >
                      <option value="none">{t('tafsirSurah.translationNone')}</option>
                      {ordered.map((work) => (
                        <option key={work.slug} value={work.slug}>
                          {work.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Button type="submit" tone="secondary">
                    {t('tafsirSurah.translationSubmit')}
                  </Button>
                </form>
              )}
            </div>
          </nav>

          {wholeCount === 0 ? null : (
            <section
              id="tafsir-whole"
              aria-labelledby="tafsir-whole-heading"
              className="flex scroll-mt-40 flex-col gap-4"
            >
              <h2 id="tafsir-whole-heading" className="text-heading font-semibold">
                {t('tafsirSurah.wholeHeading')}
              </h2>
              <GroupResources
                locale={locale}
                surah={surah.number}
                found={layout.whole}
                works={works}
                languages={languages}
                names={names}
                t={t}
                idBase="tafsir-whole"
              />
            </section>
          )}

          {layout.groups.map((group) => {
            const headingId = `tafsir-group-${String(group.from)}`;
            return (
              <section
                key={group.from}
                aria-labelledby={headingId}
                className="flex scroll-mt-40 flex-col gap-5 border-t border-border pt-8"
              >
                <h2 id={headingId} className="text-heading font-semibold">
                  {group.from === group.to
                    ? t('tafsirSurah.groupOne', { ayah: group.from })
                    : t('tafsirSurah.groupRange', { from: group.from, to: group.to })}
                </h2>
                <GroupAyat
                  locale={locale}
                  group={group}
                  ayat={ayahOf}
                  translation={translation}
                  t={t}
                />
                <GroupResources
                  locale={locale}
                  surah={surah.number}
                  found={group}
                  works={works}
                  languages={languages}
                  names={names}
                  t={t}
                  idBase={headingId}
                />
              </section>
            );
          })}
        </>
      )}

      <nav
        aria-label={t('surahNavigation')}
        className="flex flex-wrap justify-between gap-3 border-t border-border pt-6"
      >
        {previous === null ? (
          <span />
        ) : (
          <TextLink href={tafsirSurahPath(locale, previous)}>
            {t('tafsirSurah.previous', { number: previous })}
          </TextLink>
        )}
        {next === null ? null : (
          <TextLink href={tafsirSurahPath(locale, next)}>
            {t('tafsirSurah.next', { number: next })}
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

/** Whether an Ayah number is one of this Surah's. */
export function inSurah(surah: number, ayah: number): boolean {
  const count = surahAyahCount(surah);
  return count !== null && Number.isInteger(ayah) && ayah >= 1 && ayah <= count;
}
