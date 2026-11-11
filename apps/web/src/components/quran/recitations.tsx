import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  PublicRecitation,
  PublicRecitationSegment,
  PublicSurah,
  QuranAvailability,
} from '@minhaj/contracts/quran';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { playableSegments } from '@/composition/quran-assets';
import { quranReadRuntime } from '@/composition/quran-read';
import { BreadcrumbData } from '@/components/media/parts';
import {
  Badge,
  Breadcrumbs,
  Container,
  EmptyState,
  Icon,
  PageHeading,
  Panel,
  Prose,
  TextLink,
} from '@/components/ui';
import {
  CorpusNotice,
  QuranFrame,
  SegmentPlayer,
  quranTrail,
  segmentRange,
} from './parts';
import {
  NO_READING_CHOICE,
  quranPath,
  reciterPath,
  surahName,
  surahPath,
  withReading,
} from './presentation';
import { quranIndexable, readRecitations, readSurahs } from './read';
import { recitationGroups } from './recitation-plan';

/**
 * Recitations — OWNED BY QURAN (DOMAIN_MODEL.md §8.1; ROUTE_MAP.md §3.3, §3.7).
 *
 * A Recitation is a reciter's work: a People Person (being one grants nothing)
 * and segments of audio over same-Surah ranges — first-party files, or, since
 * Quran Part 5, an allowlisted stream of whole Surahs, timed Ayah by Ayah where
 * its source supplies the timing. Everything here is Quran's public reader and
 * People's public names — never Media: an AudioTrack can neither fill nor
 * appear in this catalogue.
 *
 * `/listen/recitations` is the SAME catalogue projected into Listen at Layer 4,
 * canonical to `/quran/recitations`, so the two never compete.
 *
 * PLAYED BY THE QURAN SECTION'S PLAYER. With JavaScript, a Play control hands
 * the recitation to the player the Quran layout keeps (shown only where that
 * player exists — never on the Listen projection, which is outside the Quran
 * layout). Without it, every recitation still has a way to be heard: its
 * reciter's page lists the browser's own `<audio controls>`, and each Surah
 * opens with the recitation chosen. No autoplay, nothing fetched until asked,
 * and no download link.
 *
 * AN ALIGNED NARRATION SAYS WHAT ITS ARABIC WAS MATCHED AGAINST (translation
 * audio). Where a narration's Arabic was aligned against a public timed
 * recitation, its card names that recitation's reciter as the IDENTIFIED
 * Arabic, by audio comparison and not confirmed — evidence about a recording,
 * never a credit: the reciter is not added as the narration's contributor.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

/** The filter a catalogue address asks for: a style and a language, each optional. */
export interface RecitationFilter {
  readonly style: string | null;
  readonly language: string | null;
}

const NO_FILTER: RecitationFilter = { style: null, language: null };

function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 100
    ? value
    : null;
}

/** A catalogue query as a filter. A value no recitation carries simply matches none. */
export function recitationFilter(
  query: Readonly<Record<string, string | string[] | undefined>>,
): RecitationFilter {
  return { style: one(query['style']), language: one(query['language']) };
}

function matches(recitation: PublicRecitation, filter: RecitationFilter): boolean {
  return (
    (filter.style === null || recitation.style === filter.style) &&
    (filter.language === null || recitation.languageCode === filter.language)
  );
}

/** What the language heard is called, in its own words where Taxonomy records them. */
function languageName(
  languages: ReadonlyMap<string, ContentLanguage>,
  code: string,
): { readonly name: string; readonly code: string } {
  return { name: languages.get(code)?.name ?? code, code };
}

/** The facts a recitation is chosen by, as badges. */
function RecitationFacts({
  recitation,
  languages,
  t,
}: {
  readonly recitation: PublicRecitation;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: QuranTranslator;
}) {
  const language =
    recitation.languageCode === null
      ? null
      : languageName(languages, recitation.languageCode);
  return (
    <p className="flex flex-wrap items-center gap-2">
      {language === null ? null : (
        <Badge kind="language" lang={language.code}>
          {language.name}
        </Badge>
      )}
      {recitation.style === null ? null : (
        <Badge kind="type">
          <span dir="auto">{recitation.style}</span>
        </Badge>
      )}
      <Badge kind="status" tone={recitation.timed ? 'positive' : 'neutral'}>
        {recitation.timed ? t('recitations.timed') : t('recitations.untimed')}
      </Badge>
      <Badge kind="status">
        {t('recitations.surahs', { count: recitation.surahCount })}
      </Badge>
      {recitation.translatedSurahs.length === 0 ? null : (
        <Badge kind="status" tone="positive">
          {t('recitations.byPassage', { count: recitation.translatedSurahs.length })}
        </Badge>
      )}
    </p>
  );
}

/**
 * An aligned narration's Arabic, as identified: the reciter of each PUBLIC
 * timed recitation it was matched against, and in how many Surahs. Nothing is
 * said for a recitation that was not aligned, or whose reference is not
 * public now.
 */
async function ArabicIdentified({
  locale,
  recitation,
  t,
}: {
  readonly locale: Locale;
  readonly recitation: PublicRecitation;
  readonly t: QuranTranslator;
}) {
  if (recitation.translatedSurahs.length === 0) return null;
  const [alignments, all] = await Promise.all([
    quranReadRuntime().reader.recitationAlignments(recitation.id),
    readRecitations(),
  ]);
  const matched = alignments.flatMap((alignment) => {
    const reference = all.find((entry) => entry.id === alignment.referenceRecitationId);
    return reference === undefined ? [] : [{ reference, count: alignment.surahCount }];
  });
  if (matched.length === 0) return null;
  const names = await referenceNames(
    { personIds: matched.map((entry) => entry.reference.reciterId), topicIds: [] },
    locale,
  );
  return (
    <>
      {matched.map(({ reference, count }) => (
        <p key={reference.id} className="text-sm break-words" dir="auto">
          {t('recitations.arabicIdentified', {
            reciter: names.people.get(reference.reciterId)?.name ?? reference.name,
            count,
          })}
        </p>
      ))}
    </>
  );
}

/** A JS-only Play control: the Quran layout's player answers it by delegation. */
function PlayControl({
  recitation,
  surah,
  label,
  compact = false,
}: {
  readonly recitation: string;
  readonly surah: number;
  readonly label: string;
  readonly compact?: boolean;
}) {
  return (
    <button
      type="button"
      data-quran-play=""
      data-recitation={recitation}
      data-surah={surah}
      aria-label={compact ? label : undefined}
      className={
        compact
          ? 'quran-play-control inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border-strong text-action hover:bg-surface-sunken'
          : 'quran-play-control inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover'
      }
    >
      <Icon name="play" size={20} />
      {compact ? null : label}
    </button>
  );
}

/** One recitation as a catalogue card. */
function RecitationCard({
  locale,
  recitation,
  names,
  languages,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly recitation: PublicRecitation;
  readonly names: Names;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: QuranTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const reciter = names.people.get(recitation.reciterId);
  // Play and the reader begin at the first Surah THIS recitation has audio for.
  const first = recitation.firstSurah;
  const Heading = headingLevel;
  return (
    <Panel as="li">
      <div className="flex h-full min-w-0 flex-col gap-3">
        <Heading className="text-lg font-semibold break-words" dir="auto">
          {recitation.name}
        </Heading>
        {reciter === undefined ? null : (
          <p className="text-sm break-words" dir="auto">
            <span className="text-foreground-muted">{t('reciter')}: </span>
            <TextLink href={reciterPath(locale, reciter.slug)}>{reciter.name}</TextLink>
          </p>
        )}
        <RecitationFacts recitation={recitation} languages={languages} t={t} />
        <ArabicIdentified locale={locale} recitation={recitation} t={t} />
        {recitation.attribution === null ? null : (
          <p className="text-xs break-words text-foreground-muted" dir="auto">
            {recitation.attribution}
          </p>
        )}
        {first === null ? null : (
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
            <PlayControl
              recitation={recitation.slug}
              surah={first}
              label={t('recitations.play')}
            />
            <TextLink
              href={withReading(surahPath(locale, first), {
                ...NO_READING_CHOICE,
                reciter: recitation.slug,
              })}
            >
              {t('listenWithReader')}
            </TextLink>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** The recitations in the catalogue's one order (`recitationGroups`), grouped by style. */
function grouped(recitations: readonly PublicRecitation[], names: Names, locale: Locale) {
  return recitationGroups(
    recitations.map((recitation) => ({
      recitation,
      style: recitation.style,
      reciter: names.people.get(recitation.reciterId)?.name ?? null,
      name: recitation.name,
    })),
    locale,
  ).map((group) => ({
    style: group.style,
    recitations: group.entries.map((entry) => entry.recitation),
  }));
}

/**
 * Every public recitation, with each reciter's name resolved in ONE People
 * call, in the catalogue's order — and, once two or more styles are listed,
 * under a heading per style (the source's own word for it), the recitations
 * naming no style last under "other recitations".
 */
async function RecitationList({
  locale,
  recitations,
  label,
}: {
  readonly locale: Locale;
  readonly recitations: readonly PublicRecitation[];
  readonly label: string;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const [names, languages] = await Promise.all([
    referenceNames(
      { personIds: recitations.map((recitation) => recitation.reciterId), topicIds: [] },
      locale,
    ),
    contentLanguages(),
  ]);
  const groups = grouped(recitations, names, locale);
  const grid = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
  const cards = (list: readonly PublicRecitation[], headingLevel: 'h2' | 'h3') =>
    list.map((recitation) => (
      <RecitationCard
        key={recitation.id}
        locale={locale}
        recitation={recitation}
        names={names}
        languages={languages}
        t={t}
        headingLevel={headingLevel}
      />
    ));
  if (groups.filter((group) => group.style !== null).length < 2)
    return (
      <ul aria-label={label} className={grid}>
        {cards(
          groups.flatMap((group) => group.recitations),
          'h2',
        )}
      </ul>
    );
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group, index) => {
        const id = `recitation-style-${String(index)}`;
        return (
          <section key={id} aria-labelledby={id} className="flex flex-col gap-4">
            <h2 id={id} className="text-xl font-semibold break-words" dir="auto">
              {group.style ?? t('recitations.otherStyles')}{' '}
              <span className="text-base font-normal text-foreground-muted">
                ({t('recitations.count', { count: group.recitations.length })})
              </span>
            </h2>
            <ul aria-labelledby={id} className={grid}>
              {cards(group.recitations, 'h3')}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The catalogue's filter: style and language, the values the PUBLIC recitations
 * carry and nothing else. A GET form, so it works without JavaScript and every
 * filtered view is an address.
 */
async function RecitationFilterForm({
  locale,
  recitations,
  filter,
}: {
  readonly locale: Locale;
  readonly recitations: readonly PublicRecitation[];
  readonly filter: RecitationFilter;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const languages = await contentLanguages();
  const styles = [
    ...new Set(recitations.flatMap((each) => (each.style === null ? [] : [each.style]))),
  ].sort();
  const codes = [
    ...new Set(
      recitations.flatMap((each) =>
        each.languageCode === null ? [] : [each.languageCode],
      ),
    ),
  ].sort();
  if (styles.length < 2 && codes.length < 2) return null;
  const select =
    'min-h-11 w-full min-w-0 rounded-control border border-border-strong bg-surface px-3 text-sm text-foreground';
  return (
    <form
      method="get"
      action={quranPath(locale, 'recitations')}
      aria-label={t('recitations.filterLabel')}
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      {styles.length < 2 ? null : (
        <label className="flex min-w-0 flex-col gap-1 text-caption font-medium sm:w-64">
          {t('recitations.filterStyle')}
          <select name="style" defaultValue={filter.style ?? ''} className={select}>
            <option value="">{t('recitations.filterAll')}</option>
            {styles.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>
        </label>
      )}
      {codes.length < 2 ? null : (
        <label className="flex min-w-0 flex-col gap-1 text-caption font-medium sm:w-64">
          {t('recitations.filterLanguage')}
          <select name="language" defaultValue={filter.language ?? ''} className={select}>
            <option value="">{t('recitations.filterAll')}</option>
            {codes.map((code) => (
              <option key={code} value={code}>
                {languageName(languages, code).name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="submit"
        className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong px-5 text-sm font-semibold hover:bg-surface-sunken"
      >
        {t('recitations.filterApply')}
      </button>
    </form>
  );
}

/* ===========================================================================
 * /quran/recitations
 * ========================================================================= */

export async function RecitationsPage({
  locale,
  availability,
  filter = NO_FILTER,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly filter?: RecitationFilter;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const recitations = await quranReadRuntime().reader.recitations();
  const shown = recitations.filter((recitation) => matches(recitation, filter));
  const title = t('sections.recitations');

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-foreground-muted">{t('sectionBody.recitations')}</p>
      </div>
      {recitations.length === 0 ? (
        <EmptyState>{t('worksEmpty.recitations')}</EmptyState>
      ) : (
        <>
          <RecitationFilterForm
            locale={locale}
            recitations={recitations}
            filter={filter}
          />
          <p role="status" className="text-sm text-foreground-muted">
            {t('recitations.count', { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <EmptyState>{t('recitations.filterNone')}</EmptyState>
          ) : (
            <RecitationList locale={locale} recitations={shown} label={title} />
          )}
        </>
      )}
    </QuranFrame>
  );
}

/* ===========================================================================
 * /listen/recitations — the Listen projection of the same catalogue
 * ========================================================================= */

/**
 * The recitation catalogue as Listen shows it: Listen's trail, Quran's data.
 * The page passes the reader's own list in, so this projection cannot be filled
 * from anywhere else.
 */
export async function ListenRecitationsPage({
  locale,
  availability,
  recitations,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly recitations: readonly PublicRecitation[];
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const listen = await getTranslations({ locale, namespace: 'listen' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const title = t('sections.recitations');

  return (
    <Container>
      <div className="flex flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <CorpusNotice locale={locale} availability={availability} />
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: localizedPath(locale, ''), text: shell('nav.home') },
            { href: localizedPath(locale, '/listen'), text: listen('title') },
            { text: title },
          ]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('sectionBody.recitations')}</p>
          <p>
            <TextLink href={quranPath(locale, 'recitations')}>
              {t('recitationsHome')}
            </TextLink>
          </p>
        </Prose>
        {recitations.length === 0 ? (
          <EmptyState>{t('worksEmpty.recitations')}</EmptyState>
        ) : (
          <RecitationList locale={locale} recitations={recitations} label={title} />
        )}
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /quran/recitations/{reciter}
 * ========================================================================= */

/**
 * One recitation's Surahs: each with Play (the Quran player, by delegation)
 * and the Surah opened with this recitation chosen — which, without
 * JavaScript, is where its native player is.
 */
function SurahList({
  locale,
  recitation,
  segments,
  surahs,
  t,
}: {
  readonly locale: Locale;
  readonly recitation: PublicRecitation;
  readonly segments: readonly PublicRecitationSegment[];
  readonly surahs: ReadonlyMap<number, PublicSurah>;
  readonly t: QuranTranslator;
}) {
  const numbers = [...new Set(segments.map((segment) => segment.surah))].sort(
    (a, b) => a - b,
  );
  const headingId = `surahs-${recitation.slug}`;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className="text-base font-semibold">
        {t('recitations.surahList')}
      </h3>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {numbers.map((number) => {
          const surah = surahs.get(number);
          const name =
            surah === undefined
              ? t('surahName', { number })
              : (surahName(surah, locale)?.text ?? t('surahName', { number }));
          return (
            <li
              key={number}
              className="flex min-w-0 items-center gap-3 rounded-control border border-border bg-surface px-3 py-2"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-accent-rule bg-accent-surface text-caption font-semibold text-accent tabular-nums">
                {number}
              </span>
              <a
                href={withReading(surahPath(locale, number), {
                  ...NO_READING_CHOICE,
                  reciter: recitation.slug,
                })}
                className="flex min-w-0 flex-1 flex-col no-underline hover:underline"
              >
                <span className="truncate text-sm font-semibold" dir="auto">
                  {name}
                </span>
                <span className="truncate text-caption text-foreground-muted">
                  {t('recitations.readSurah')}
                </span>
              </a>
              <PlayControl
                recitation={recitation.slug}
                surah={number}
                label={t('recitations.playSurah', { name })}
                compact
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The no-script fallback: each segment's native player, collapsed. */
async function NativeSegments({
  locale,
  recitation,
  segments,
  t,
}: {
  readonly locale: Locale;
  readonly recitation: PublicRecitation;
  readonly segments: readonly PublicRecitationSegment[];
  readonly t: QuranTranslator;
}) {
  return (
    <details className="quran-audio-fallback rounded-control border border-border px-4 py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
        {t('segmentsShow', { count: segments.length })}
      </summary>
      <ol className="flex flex-col gap-4 pb-2">
        {segments.map((segment) => (
          <li key={segment.id} className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              <TextLink
                href={withReading(surahPath(locale, segment.surah), {
                  ...NO_READING_CHOICE,
                  reciter: recitation.slug,
                })}
              >
                {segmentRange(t, segment)}
              </TextLink>
            </p>
            <SegmentPlayer locale={locale} recitation={recitation} segment={segment} />
          </li>
        ))}
      </ol>
    </details>
  );
}

export async function ReciterPage({
  locale,
  availability,
  reciter,
  recitations,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly reciter: {
    readonly slug: string;
    readonly name: string;
    readonly locales: readonly Locale[];
  };
  readonly recitations: readonly PublicRecitation[];
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  // One reciter's recitations in the WHOLE catalogue's order, so their styles
  // come as the catalogue ranks them (Murattal before the mujawwad editions).
  const rank = new Map(
    recitationGroups(
      (await readRecitations()).map((recitation) => ({
        id: recitation.id,
        style: recitation.style,
        reciter: null,
        name: recitation.name,
      })),
      locale,
    )
      .flatMap((group) => group.entries)
      .map((entry, index) => [entry.id, index] as const),
  );
  const ordered = [...recitations].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const [segments, surahs, languages] = await Promise.all([
    Promise.all(
      ordered.map((recitation) =>
        reader.recitationSegments(recitation.id, null).then(playableSegments),
      ),
    ),
    readSurahs(),
    contentLanguages(),
  ]);
  const surahIndex = new Map(surahs.map((surah) => [surah.number, surah]));
  const path = reciterPath(locale, reciter.slug);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: t('sections.recitations'), path: quranPath(locale, 'recitations') },
    { name: reciter.name, path },
  ];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: reciter.name },
      ]}
    >
      <Prose>
        <h1 className="text-3xl font-semibold tracking-tight break-words" dir="auto">
          {reciter.name}
        </h1>
        <p>
          <TextLink
            href={localizedPath(locale, `/people/${encodeURIComponent(reciter.slug)}`)}
          >
            {t('reciterProfile')}
          </TextLink>
        </p>
      </Prose>
      <ul aria-label={t('sections.recitations')} className="flex flex-col gap-6">
        {ordered.map((recitation, index) => {
          const own = segments[index] ?? [];
          return (
            <Panel key={recitation.id} as="li">
              <div className="flex min-w-0 flex-col gap-4">
                <h2 className="text-lg font-semibold break-words" dir="auto">
                  {recitation.name}
                </h2>
                <RecitationFacts recitation={recitation} languages={languages} t={t} />
                <ArabicIdentified locale={locale} recitation={recitation} t={t} />
                {recitation.timed || recitation.translatedSurahs.length > 0 ? null : (
                  <p className="text-sm text-foreground-muted">{t('listen.untimed')}</p>
                )}
                {recitation.attribution === null ? null : (
                  <p className="text-xs break-words text-foreground-muted" dir="auto">
                    {recitation.attribution}
                  </p>
                )}
                {own.length === 0 ? (
                  <EmptyState>{t('recitationEmpty')}</EmptyState>
                ) : (
                  <>
                    <SurahList
                      locale={locale}
                      recitation={recitation}
                      segments={own}
                      surahs={surahIndex}
                      t={t}
                    />
                    <NativeSegments
                      locale={locale}
                      recitation={recitation}
                      segments={own}
                      t={t}
                    />
                  </>
                )}
              </div>
            </Panel>
          );
        })}
      </ul>
      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? [...reciter.locales] : []}
        trail={trail}
      />
    </QuranFrame>
  );
}
