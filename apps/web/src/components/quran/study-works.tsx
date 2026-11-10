import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  ayahWords,
  citationOf,
  type PublicAyah,
  type PublicLayerCoverage,
  type PublicLayerWork,
  type PublicSurah,
  type PublicTransliteration,
  type QuranAvailability,
  type WordGloss,
} from '@minhaj/contracts/quran';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { quranReadRuntime } from '@/composition/quran-read';
import { ActionLink, PageHeading, Panel } from '@/components/ui';
import { arabicIndic } from './citation';
import { coverageSummary, type CoverageSummary } from './compare';
import { AboutThisText, QuranFrame, languageOf, quranTrail } from './parts';
import { NO_READING_CHOICE, surahPath, withReading } from './presentation';
import { readAyah, readSurahs, readTransliterations, readWordByWords } from './read';
import { ArabicText, TransliterationText, WordByWordText } from './scripture';
import { Contributors, LanguageName } from './works';

/**
 * TRANSLITERATION AND WORD BY WORD — the two study layers' listings (Quran
 * Part 7; ROUTE_MAP.md §3.3), `/quran/transliteration` and
 * `/quran/word-by-word`, in the translations listing's pattern.
 *
 * HIDDEN UNTIL PUBLISHED (OPEN_DECISIONS.md §1.2 item 3). No lawful source of
 * either is recorded, so nothing of either is imported, generated or scraped:
 * a page exists only while at least one work of its kind is PUBLIC — its route
 * is a 404 otherwise (`studyWorks`), and the navigation, the Quran landing, the
 * reader's settings and its reading form leave the feature out the same way.
 *
 * EACH WORK IS ITS OWN, AND NONE IS PRIVILEGED. A card says what the reader
 * records of a work — name, language, scheme, People credited, the source's
 * attribution — and what it COUNTS: the Surahs it covers in full, and for a
 * word-by-word work the words it glosses. A sample is the work's own first
 * text beside the stored Arabic, both exactly as stored; nothing is derived.
 * There is no work page: everything recorded of a work fits its card, and
 * reading the Quran with it is a reader preference, never a second address.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;

/** The study layers with a listing of their own. */
export type StudyKind = 'transliteration' | 'words';

/** The public works of a kind — empty means the route does not exist. */
export function studyWorks(kind: StudyKind): Promise<readonly PublicLayerWork[]> {
  return kind === 'transliteration' ? readTransliterations() : readWordByWords();
}

/** How far into a covered Surah a sample is looked for: one bounded read. */
const SAMPLE_REACH = 10;

/** A work's sample: one Ayah's stored Arabic, and the work's own text of it. */
type Sample =
  | { readonly kind: 'transliteration'; readonly ayah: PublicAyah; readonly text: string }
  | {
      readonly kind: 'words';
      readonly ayah: PublicAyah;
      readonly glosses: readonly WordGloss[];
    };

/**
 * The coverage as the translations' counting rule reads it: a word-by-word
 * work's glossed words in the place a translation's notes are counted.
 */
function summaryOf(
  coverage: PublicLayerCoverage | undefined,
  surahs: readonly PublicSurah[],
): CoverageSummary {
  return coverageSummary(
    coverage === undefined
      ? undefined
      : {
          workId: coverage.workId,
          surahs: coverage.surahs.map((entry) => ({
            surah: entry.surah,
            ayat: entry.ayat,
            notes: entry.words,
          })),
        },
    surahs,
  );
}

/** The first Ayah of the first Surah a work covers that carries its text, near the start. */
async function sampleOf(
  kind: StudyKind,
  work: PublicLayerWork,
  coverage: PublicLayerCoverage | undefined,
): Promise<Sample | null> {
  const surah = coverage?.surahs[0]?.surah;
  if (surah === undefined) return null;
  const reader = quranReadRuntime().reader;
  if (kind === 'transliteration') {
    const [first] = await reader.transliterationTexts(work.id, surah, 1, SAMPLE_REACH);
    const ayah = first === undefined ? null : await readAyah(surah, first.ayah);
    return first === undefined || ayah === null ? null : { kind, ayah, text: first.text };
  }
  const [first] = await reader.wordByWordGlosses(work.id, surah, 1, SAMPLE_REACH);
  const ayah = first === undefined ? null : await readAyah(surah, first.ayah);
  return first === undefined || ayah === null
    ? null
    : { kind, ayah, glosses: first.glosses };
}

function SampleView({
  sample,
  work,
  language,
  t,
}: {
  readonly sample: Sample;
  readonly work: PublicLayerWork;
  readonly language: ReturnType<typeof languageOf>;
  readonly t: QuranTranslator;
}) {
  const ref = { surah: sample.ayah.surah, ayah: sample.ayah.ayah };
  const id = `sample-${work.slug}`;
  return (
    <figure className="flex min-w-0 flex-col gap-3 rounded-control border border-border bg-surface p-3 sm:p-4">
      <figcaption className="text-caption text-foreground-muted">
        {t('study.sample', { citation: citationOf(ref) })}
      </figcaption>
      {sample.kind === 'transliteration' ? (
        <>
          <ArabicText
            id={`${id}-arabic`}
            label={t('layer.arabic')}
            text={sample.ayah.text}
            ayah={sample.ayah.ayah}
          />
          <TransliterationText
            id={`${id}-text`}
            label={t('layer.transliteration', { name: work.name })}
            name={work.name}
            text={sample.text}
            language={language}
            index={0}
          />
        </>
      ) : (
        <WordByWordText
          id={`${id}-words`}
          label={t('layer.words', { name: work.name })}
          name={work.name}
          words={ayahWords(sample.ayah.text)}
          glosses={sample.glosses}
          language={language}
          index={0}
          mark={`۝${arabicIndic(sample.ayah.ayah)}`}
        />
      )}
    </figure>
  );
}

function StudyCard({
  locale,
  kind,
  work,
  summary,
  sample,
  start,
  languages,
  names,
  t,
}: {
  readonly locale: Locale;
  readonly kind: StudyKind;
  readonly work: PublicLayerWork;
  readonly summary: CoverageSummary;
  readonly sample: Sample | null;
  /** The first Surah the work covers — where "Read with it" opens. */
  readonly start: number | null;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly names: Awaited<ReturnType<typeof referenceNames>>;
  readonly t: QuranTranslator;
}) {
  const headingId = `${kind}-${work.slug}`;
  const scheme =
    kind === 'transliteration' ? (work as PublicTransliteration).scheme : null;
  const coverage = t('translations.coverage', {
    complete: summary.complete,
    total: summary.surahs,
  });
  return (
    <Panel as="li">
      <article aria-labelledby={headingId} className="flex h-full min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={headingId} className="text-lg font-semibold break-words" dir="auto">
            {work.name}
          </h2>
          <p className="text-sm text-foreground-muted">
            <LanguageName languages={languages} code={work.languageCode} />
          </p>
        </div>
        <Contributors locale={locale} work={work} names={names} t={t} />
        {work.description === null ? null : (
          <p className="line-clamp-3 text-sm break-words" dir="auto">
            {work.description}
          </p>
        )}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm min-[26rem]:grid-cols-2">
          <div className="flex min-w-0 flex-col">
            <dt className="text-caption text-foreground-muted">
              {t('study.coverageTerm')}
            </dt>
            <dd className="font-medium tabular-nums">
              {summary.partial === 0
                ? coverage
                : `${coverage} · ${t('translations.partial', { count: summary.partial })}`}
            </dd>
          </div>
          {kind === 'words' ? (
            <div className="flex min-w-0 flex-col">
              <dt className="text-caption text-foreground-muted">
                {t('study.wordsTerm')}
              </dt>
              <dd className="font-medium tabular-nums">
                {t('study.words', { count: summary.notes })}
              </dd>
            </div>
          ) : null}
          {scheme === null ? null : (
            <div className="flex min-w-0 flex-col min-[26rem]:col-span-2">
              <dt className="text-caption text-foreground-muted">{t('work.scheme')}</dt>
              <dd className="break-words" dir="auto">
                {scheme}
              </dd>
            </div>
          )}
        </dl>
        {sample === null ? null : (
          <SampleView
            sample={sample}
            work={work}
            language={languageOf(languages, work.languageCode)}
            t={t}
          />
        )}
        {work.attribution === null ? null : (
          <p className="text-xs break-words text-foreground-muted" dir="auto">
            {work.attribution}
          </p>
        )}
        {start === null ? null : (
          <div className="mt-auto flex flex-wrap gap-3 pt-1">
            <ActionLink
              href={withReading(surahPath(locale, start), {
                ...NO_READING_CHOICE,
                [kind]: work.slug,
              })}
            >
              {t(
                kind === 'transliteration'
                  ? 'study.readTransliteration'
                  : 'study.readWords',
              )}
            </ActionLink>
          </div>
        )}
      </article>
    </Panel>
  );
}

/**
 * `/quran/transliteration` or `/quran/word-by-word`: every public work of the
 * kind, each counted and sampled. The route has already found at least one.
 */
export async function StudyListingPage({
  locale,
  availability,
  kind,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly kind: StudyKind;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const [works, languages, surahs] = await Promise.all([
    studyWorks(kind),
    contentLanguages(),
    readSurahs(),
  ]);
  const ids = works.map((work) => work.id);
  const [names, coverage] = await Promise.all([
    referenceNames(
      {
        personIds: works.flatMap((work) => work.contributors.map((c) => c.personId)),
        topicIds: [],
      },
      locale,
    ),
    kind === 'transliteration'
      ? reader.transliterationCoverage(ids)
      : reader.wordByWordCoverage(ids),
  ]);
  const coverageOf = new Map(coverage.map((entry) => [entry.workId, entry]));
  const samples = await Promise.all(
    works.map((work) => sampleOf(kind, work, coverageOf.get(work.id))),
  );
  const title = t(
    kind === 'transliteration' ? 'sections.transliteration' : 'sections.wordByWord',
  );

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="max-w-[var(--measure-prose)] text-foreground-muted">
          {t(
            kind === 'transliteration'
              ? 'sectionBody.transliteration'
              : 'sectionBody.wordByWord',
          )}
        </p>
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {t(kind === 'transliteration' ? 'study.howTransliteration' : 'study.howWords')}
        </p>
      </div>
      <ul aria-label={title} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {works.map((work, index) => {
          const covered = coverageOf.get(work.id);
          return (
            <StudyCard
              key={work.id}
              locale={locale}
              kind={kind}
              work={work}
              summary={summaryOf(covered, surahs)}
              sample={samples[index] ?? null}
              start={covered?.surahs[0]?.surah ?? null}
              languages={languages}
              names={names}
              t={t}
            />
          );
        })}
      </ul>
      <AboutThisText locale={locale} availability={availability} translation={false} />
    </QuranFrame>
  );
}
