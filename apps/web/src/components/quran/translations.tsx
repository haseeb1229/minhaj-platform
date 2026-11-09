import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  QURAN_AYAH_NUMBER_MAX,
  citationOf,
  type PublicLayerWork,
  type PublicSurah,
  type QuranAvailability,
  type QuranRef,
  type TranslationLayerText,
} from '@minhaj/contracts/quran';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { quranReadRuntime } from '@/composition/quran-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData, formatDate } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  Button,
  DetailRow,
  EmptyState,
  Icon,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import {
  comparePath,
  coverageSummary,
  inReadingOrder,
  type CompareRequest,
  type CoverageSummary,
} from './compare';
import {
  AboutThisText,
  QuranFrame,
  languageOf,
  noteLabelsFor,
  quranTrail,
} from './parts';
import {
  NO_READING_CHOICE,
  ayahPath,
  nextAyah,
  previousAyah,
  quranPath,
  surahName,
  surahPath,
  translationPath,
  withReading,
} from './presentation';
import { quranIndexable, readSurahs } from './read';
import { ArabicText, TranslationText } from './scripture';
import { Contributors, LanguageName } from './works';

/**
 * THE TRANSLATIONS (Quran Part 6; ROUTE_MAP.md §3.3) — the listing, one
 * work's page and the compare view.
 *
 * EACH TRANSLATION IS ITS OWN WORK, AND NONE IS PRIVILEGED. A page shows what
 * the reader records of a work — its name, language, description, the People
 * credited, the attribution its source supplied — and what it COUNTS of it:
 * how many Surahs carry text in full, how many ayat, how many translator's
 * notes. Nothing else is said: no biography, no claim of approval, no number
 * the corpus did not give.
 *
 * ONLY WHAT IS PUBLIC NOW. Every work and count is the public reader's, which
 * holds no draft, no archived work and none without a registered source.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

/** "Surah 2 · Al-Baqarah", the name in the language it is recorded in. */
function SurahLabel({
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
        <span
          lang={name.locale}
          className={name.locale === 'ar' ? 'quran-name' : undefined}
        >{` · ${name.text}`}</span>
      )}
    </>
  );
}

/** What a coverage summary counts, as the listing and a work's facts say it. */
function coverageLine(summary: CoverageSummary, t: QuranTranslator): string {
  const surahs = t('translations.coverage', {
    complete: summary.complete,
    total: summary.surahs,
  });
  return summary.partial === 0
    ? surahs
    : `${surahs} · ${t('translations.partial', { count: summary.partial })}`;
}

/* ===========================================================================
 * /quran/translations
 * ========================================================================= */

function TranslationCard({
  locale,
  work,
  summary,
  languages,
  names,
  first,
  t,
}: {
  readonly locale: Locale;
  readonly work: PublicLayerWork;
  readonly summary: CoverageSummary;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly names: Names;
  readonly first: PublicSurah | undefined;
  readonly t: QuranTranslator;
}) {
  const headingId = `translation-${work.slug}`;
  return (
    <Panel as="li">
      <article aria-labelledby={headingId} className="flex h-full min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={headingId} className="text-lg font-semibold break-words" dir="auto">
            <TextLink href={translationPath(locale, work.slug)}>{work.name}</TextLink>
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
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm min-[26rem]:grid-cols-2">
          <div className="flex min-w-0 flex-col">
            <dt className="text-caption text-foreground-muted">
              {t('translations.coverageTerm')}
            </dt>
            <dd className="font-medium tabular-nums">{coverageLine(summary, t)}</dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-caption text-foreground-muted">
              {t('translations.notesTerm')}
            </dt>
            <dd className="font-medium tabular-nums">
              {t('translations.notes', { count: summary.notes })}
            </dd>
          </div>
        </dl>
        {work.attribution === null ? null : (
          <p className="text-xs break-words text-foreground-muted" dir="auto">
            {work.attribution}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-3 pt-1">
          {first === undefined ? null : (
            <ActionLink
              href={withReading(surahPath(locale, first.number), {
                ...NO_READING_CHOICE,
                translation: work.slug,
              })}
            >
              {t('translations.read')}
            </ActionLink>
          )}
          {first === undefined ? null : (
            <ActionLink
              tone="secondary"
              href={comparePath(locale, { surah: first.number, ayah: 1 })}
            >
              {t('translations.compare')}
            </ActionLink>
          )}
        </div>
      </article>
    </Panel>
  );
}

export async function TranslationListingPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const [listed, languages, surahs] = await Promise.all([
    reader.translations(),
    contentLanguages(),
    readSurahs(),
  ]);
  const works = inReadingOrder(listed, locale);
  const [names, coverage] = await Promise.all([
    referenceNames(
      {
        personIds: works.flatMap((work) => work.contributors.map((c) => c.personId)),
        topicIds: [],
      },
      locale,
    ),
    reader.translationCoverage(works.map((work) => work.id)),
  ]);
  const coverageOf = new Map(coverage.map((entry) => [entry.workId, entry]));
  const title = t('sections.translations');
  const first = surahs[0];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="max-w-[var(--measure-prose)] text-foreground-muted">
          {t('sectionBody.translations')}
        </p>
      </div>
      {works.length === 0 ? (
        <EmptyState>{t('worksEmpty.translations')}</EmptyState>
      ) : (
        <>
          {first === undefined || works.length < 2 ? null : (
            <p>
              <TextLink href={comparePath(locale, { surah: first.number, ayah: 1 })}>
                {t('translations.compareAll')}
              </TextLink>
            </p>
          )}
          <ul aria-label={title} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {works.map((work) => (
              <TranslationCard
                key={work.id}
                locale={locale}
                work={work}
                summary={coverageSummary(coverageOf.get(work.id), surahs)}
                languages={languages}
                names={names}
                first={first}
                t={t}
              />
            ))}
          </ul>
        </>
      )}
      <AboutThisText
        locale={locale}
        availability={availability}
        translation={works.length > 0}
      />
    </QuranFrame>
  );
}

/* ===========================================================================
 * /quran/translations/{slug}
 * ========================================================================= */

/** Every Surah: how much of it this work carries, linked to read it with the work. */
function CoverageBySurah({
  locale,
  work,
  surahs,
  summary,
  t,
}: {
  readonly locale: Locale;
  readonly work: PublicLayerWork;
  readonly surahs: readonly PublicSurah[];
  readonly summary: CoverageSummary;
  readonly t: QuranTranslator;
}) {
  if (surahs.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="work-coverage">
      <SectionHeading>
        <span id="work-coverage">{t('translations.bySurah')}</span>
      </SectionHeading>
      <p className="text-sm text-foreground-muted">{t('translations.bySurahHelp')}</p>
      <ol
        aria-labelledby="work-coverage"
        className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3"
      >
        {surahs.map((surah) => {
          const held = summary.bySurah.get(surah.number) ?? { ayat: 0, notes: 0 };
          const status =
            held.ayat === surah.ayahCount
              ? t('translations.surahComplete')
              : held.ayat === 0
                ? t('translations.surahNone')
                : t('translations.surahPartial', {
                    count: held.ayat,
                    total: surah.ayahCount,
                  });
          return (
            <li
              key={surah.number}
              className="flex min-h-11 min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-2"
            >
              {held.ayat === 0 ? (
                <span className="min-w-0 break-words text-foreground-muted">
                  <SurahLabel surah={surah} locale={locale} t={t} />
                </span>
              ) : (
                <TextLink
                  href={withReading(surahPath(locale, surah.number), {
                    ...NO_READING_CHOICE,
                    translation: work.slug,
                  })}
                >
                  <SurahLabel surah={surah} locale={locale} t={t} />
                </TextLink>
              )}
              <span className="text-caption text-foreground-muted tabular-nums">
                {status}
                {held.notes === 0
                  ? null
                  : ` · ${t('translations.notes', { count: held.notes })}`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export async function TranslationDetailPage({
  locale,
  availability,
  work,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly work: PublicLayerWork;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const [languages, names, surahs, coverage] = await Promise.all([
    contentLanguages(),
    referenceNames(
      { personIds: work.contributors.map((c) => c.personId), topicIds: [] },
      locale,
    ),
    readSurahs(),
    reader.translationCoverage([work.id]),
  ]);
  const summary = coverageSummary(coverage[0], surahs);
  const sectionTitle = t('sections.translations');
  const path = translationPath(locale, work.slug);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: sectionTitle, path: quranPath(locale, 'translations') },
    { name: work.name, path },
  ];
  const first = surahs[0];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: work.name },
      ]}
    >
      <article aria-labelledby="work-heading" className="flex min-w-0 flex-col gap-8">
        <Prose>
          <h1
            id="work-heading"
            className="text-3xl font-semibold tracking-tight break-words"
            dir="auto"
          >
            {work.name}
          </h1>
          {work.description === null
            ? null
            : paragraphsOf(work.description).map((paragraph, index) => (
                <p key={index} dir="auto">
                  {paragraph}
                </p>
              ))}
        </Prose>

        {first === undefined ? null : (
          <div className="flex flex-wrap gap-3">
            <ActionLink
              href={withReading(surahPath(locale, first.number), {
                ...NO_READING_CHOICE,
                translation: work.slug,
              })}
            >
              {t('translations.read')}
            </ActionLink>
            <ActionLink
              tone="secondary"
              href={comparePath(locale, { surah: first.number, ayah: 1 })}
            >
              {t('translations.compare')}
            </ActionLink>
          </div>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="work-facts">
          <h2 id="work-facts" className="text-lg font-semibold">
            {t('translations.about')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <DetailRow term={t('work.language')}>
              <LanguageName languages={languages} code={work.languageCode} />
            </DetailRow>
            <DetailRow term={t('work.published')}>
              <time dateTime={work.publishedAt.toISOString().slice(0, 10)}>
                {formatDate(work.publishedAt.toISOString().slice(0, 10), locale)}
              </time>
            </DetailRow>
            <DetailRow term={t('translations.coverageTerm')}>
              <span className="tabular-nums">{coverageLine(summary, t)}</span>
            </DetailRow>
            <DetailRow term={t('translations.ayatTerm')}>
              <span className="tabular-nums">
                {t('translations.ayat', {
                  count: summary.ayat,
                  total: summary.totalAyat,
                })}
              </span>
            </DetailRow>
            <DetailRow term={t('translations.notesTerm')}>
              <span className="tabular-nums">
                {t('translations.notes', { count: summary.notes })}
              </span>
            </DetailRow>
            {work.attribution === null ? null : (
              <DetailRow term={t('work.attribution')}>
                <span dir="auto">{work.attribution}</span>
              </DetailRow>
            )}
          </dl>
          {work.contributors.length === 0 ? null : (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">{t('translations.contributors')}</h3>
              <Contributors locale={locale} work={work} names={names} t={t} />
            </div>
          )}
        </section>

        <CoverageBySurah
          locale={locale}
          work={work}
          surahs={surahs}
          summary={summary}
          t={t}
        />
      </article>

      <AboutThisText locale={locale} availability={availability} translation />
      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? localeSchema.options : []}
        trail={trail}
      />
    </QuranFrame>
  );
}

/* ===========================================================================
 * /quran/translations/compare?surah=&ayah=
 * ========================================================================= */

/** The GET form that chooses the Ayah — complete with no script at all. */
function ChooseAyah({
  locale,
  surahs,
  shown,
  t,
}: {
  readonly locale: Locale;
  readonly surahs: readonly PublicSurah[];
  readonly shown: QuranRef | null;
  readonly t: QuranTranslator;
}) {
  return (
    <form
      method="get"
      action={quranPath(locale, 'translations/compare')}
      aria-label={t('translations.choose')}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex min-w-0 grow flex-col gap-1.5 sm:max-w-sm">
        <label htmlFor="compare-surah" className="text-sm font-medium">
          {t('translations.surahLabel')}
        </label>
        <Select
          id="compare-surah"
          name="surah"
          defaultValue={shown === null ? undefined : String(shown.surah)}
        >
          {surahs.map((surah) => {
            const name = surahName(surah, locale);
            return (
              <option key={surah.number} value={String(surah.number)}>
                {name === null
                  ? t('surahName', { number: surah.number })
                  : `${String(surah.number)} · ${name.text}`}
              </option>
            );
          })}
        </Select>
      </div>
      <div className="flex w-32 flex-col gap-1.5">
        <label htmlFor="compare-ayah" className="text-sm font-medium">
          {t('translations.ayahLabel')}
        </label>
        <TextInput
          id="compare-ayah"
          name="ayah"
          type="number"
          inputMode="numeric"
          min={1}
          max={QURAN_AYAH_NUMBER_MAX}
          required
          defaultValue={shown === null ? '1' : String(shown.ayah)}
        />
      </div>
      <Button tone="secondary">{t('translations.show')}</Button>
    </form>
  );
}

export async function ComparePage({
  locale,
  availability,
  request,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly request: CompareRequest;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const [listed, languages, surahs] = await Promise.all([
    reader.translations(),
    contentLanguages(),
    readSurahs(),
  ]);
  const works = inReadingOrder(listed, locale);
  const ref = request.kind === 'shown' ? request.ref : null;
  const [ayah, texts] = await Promise.all([
    ref === null ? Promise.resolve(null) : reader.ayah(ref),
    ref === null
      ? Promise.resolve([] as readonly (readonly TranslationLayerText[])[])
      : Promise.all(
          works.map((work) =>
            reader.translationTexts(work.id, ref.surah, ref.ayah, ref.ayah),
          ),
        ),
  ]);
  const title = t('translations.compareTitle');
  const index =
    ref === null ? -1 : surahs.findIndex((surah) => surah.number === ref.surah);
  const surah = surahs[index];
  const previous =
    ref === null ? null : previousAyah(ref, surahs[index - 1]?.ayahCount ?? null);
  const next =
    ref === null || surah === undefined
      ? null
      : nextAyah(ref, surah.ayahCount, surahs[index + 1] !== undefined);
  const ayahTitle =
    ref === null ? null : t('ayahName', { surah: ref.surah, ayah: ref.ayah });

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        parts.home,
        parts.quran,
        { href: quranPath(locale, 'translations'), text: t('sections.translations') },
        { text: title },
      ]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="max-w-[var(--measure-prose)] text-foreground-muted">
          {t('translations.compareIntro')}
        </p>
      </div>

      <ChooseAyah locale={locale} surahs={surahs} shown={ref} t={t} />

      {request.kind === 'missing' ? (
        <Alert tone="warning">
          {t('translations.missingAyah', { asked: request.asked })}
        </Alert>
      ) : null}

      {ref === null ||
      ayah === null ||
      surah === undefined ||
      ayahTitle === null ? null : (
        <article
          aria-labelledby="compare-heading"
          className="flex min-w-0 flex-col gap-6"
          data-ayah={`${String(ref.surah)}:${String(ref.ayah)}`}
        >
          <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
            <h2
              id="compare-heading"
              className="text-subheading font-semibold break-words"
            >
              <SurahLabel surah={surah} locale={locale} t={t} />
              <span className="text-foreground-muted">{` — ${ayahTitle}`}</span>
            </h2>
            <TextLink href={ayahPath(locale, ref)}>{t('translations.openAyah')}</TextLink>
          </header>

          <div className="rounded-panel border border-border bg-surface-raised p-4 sm:p-6">
            <ArabicText
              id="compare-arabic"
              label={t('layer.arabic')}
              text={ayah.text}
              ayah={ayah.ayah}
            />
          </div>

          {works.length === 0 ? (
            <EmptyState>{t('worksEmpty.translations')}</EmptyState>
          ) : (
            <ul
              aria-label={t('sections.translations')}
              className="grid grid-cols-1 gap-4 lg:grid-cols-2"
            >
              {works.map((work, position) => {
                const entry = texts[position]?.[0];
                const language = languageOf(languages, work.languageCode);
                return (
                  <li
                    key={work.id}
                    className="flex min-w-0 flex-col gap-3 rounded-panel border border-border p-4 sm:p-5"
                  >
                    <h3 className="text-sm font-semibold break-words" dir="auto">
                      <TextLink href={translationPath(locale, work.slug)}>
                        {work.name}
                      </TextLink>{' '}
                      <span className="font-normal text-foreground-muted">
                        · <LanguageName languages={languages} code={work.languageCode} />
                      </span>
                    </h3>
                    {entry === undefined ? (
                      <p className="text-sm text-foreground-muted">
                        {t('layerMissing.translation', { name: work.name })}
                      </p>
                    ) : (
                      <TranslationText
                        id={`compare-${work.slug}`}
                        label={t('layer.translation', { name: work.name })}
                        name={work.name}
                        text={entry.text}
                        language={language}
                        index={position}
                        notes={entry.notes}
                        noteLabels={noteLabelsFor(locale, t, entry.notes.length)}
                        open
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <nav
            aria-label={t('ayahNavigation')}
            className="flex flex-wrap justify-between gap-3 border-t border-border pt-4"
          >
            {previous === null ? (
              <span />
            ) : (
              <TextLink href={comparePath(locale, previous)}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="arrow-start" size={16} />
                  {t('previousAyah', { citation: citationOf(previous) })}
                </span>
              </TextLink>
            )}
            {next === null ? null : (
              <TextLink href={comparePath(locale, next)}>
                <span className="inline-flex items-center gap-1.5">
                  {t('nextAyah', { citation: citationOf(next) })}
                  <Icon name="arrow-end" size={16} />
                </span>
              </TextLink>
            )}
          </nav>
        </article>
      )}

      <AboutThisText
        locale={locale}
        availability={availability}
        translation={works.length > 0}
      />
    </QuranFrame>
  );
}
