import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  citationOf,
  type AyahSearchRecord,
  type PublicSurah,
  type QuranAvailability,
} from '@minhaj/contracts/quran';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RESULT_CEILING,
  type SearchHit,
} from '@minhaj/contracts/search';
import type { SearchOutcome } from '@minhaj/search';

import { contentLanguages, type ContentLanguage } from '@/composition/public-references';
import { quranReadRuntime } from '@/composition/quran-read';
import { searchReadRuntime } from '@/composition/search-read';
import { Highlighted } from '@/components/search/highlighted';
import { citationOfResource, quranHitRefs } from '@/components/search/quran-hit';
import {
  Alert,
  Button,
  Field,
  Icon,
  PageHeading,
  Panel,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import { QuranFrame, languageOf, quranTrail } from './parts';
import { quranPath, quranSearchRequest, surahMeaning, surahName } from './presentation';
import { hizbJuzOf, parseQuickJump, quickJumpPathOf, type QuickJump } from './quick-jump';
import { readAyah, readJuzList, readLastPage, readSurahs } from './read';
import { jumpIndex } from './reader';
import { STARTING_POINTS, surahPlacePath } from './reading-layout';
import { ArabicText } from './scripture';
import {
  citationsWithin,
  hasArabicScript,
  hasQuranFilters,
  layersShown,
  quranSearchHref,
  readQuranSearch,
  snippetOf,
  type QuranFilterIssue,
  type QuranSearchFilters,
  type QuranSearchForm,
} from './search-view';
import { resourceCount, resourcesForAyah, tafsirSurahPath } from './tafsir-layout';
import { readTafsirResources } from './tafsir-read';

/**
 * `/quran/search` — Quran search over the shared Search Foundation
 * (ROUTE_MAP.md §3.3, §9.5; Phase 18 §4; Quran Part 4).
 *
 * THE SAME SERVICE AS `/search`, RESTRICTED TO ONE KIND. The page hands the
 * visitor's `q` and `page` to the unified search service with the type fixed to
 * `quran-ayah`. Its filters are the reader's own structure: `?surah=` and
 * `?juz=` are confirmed against the reader's Surahs and Juz and become a
 * restriction to those citations, built from the reader's counts and ranges;
 * `?language=` is one of the languages the public texts are written in. A
 * filter the reader cannot confirm is refused in words, never widened.
 * Throttling happens before this page renders, in the request proxy, exactly
 * as for `/search`.
 *
 * ARABIC IS FOUND HOWEVER IT IS TYPED. Matching folds the indexed copy and the
 * query alike — harakat, letter forms and the Uthmani orthography's long
 * vowels written as marks (`@minhaj/contracts/search`, `fold.ts`) — and the
 * stored canonical text is never touched: what a result SHOWS is the current
 * text exactly as stored, with the typed words marked.
 *
 * A CITATION OR A NAME GOES STRAIGHT THERE. "2:255", "۲:۲۵۵", "Al-Baqarah 255",
 * a Surah's recorded name, "Juz 15", "Hizb 30" or "page 50" is parsed against
 * the reader's own index (`./quick-jump`, whole names only) and offered first
 * as the place it names — the text matches still follow.
 *
 * THE CITATION IS THE RESULT. Each hit is one Ayah: its Surah's display name
 * and canonical citation, its Arabic in the Quran face, and the public
 * translation snippets that match, each labelled with its work and marked with
 * its own language — a translation is never presented as the Arabic.
 *
 * SIGNED OUT, NOINDEX, NEVER CACHED — a results page is a view of a query.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type SearchTranslator = Awaited<ReturnType<typeof getTranslations<'search'>>>;
type Query = Record<string, string | string[] | undefined>;

/** One choice of the text-language filter: a language and its public works. */
interface LanguageChoice {
  readonly code: string;
  readonly label: string;
}

export async function QuranSearchPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const searchT = await getTranslations({ locale, namespace: 'search' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const [surahs, juzList, lastPage, translations, transliterations, languages] =
    await Promise.all([
      readSurahs(),
      readJuzList(),
      readLastPage(),
      reader.translations(),
      reader.transliterations(),
      contentLanguages(),
    ]);

  // The text-language choices: the Arabic, then each language a public layer is
  // written in, with the works written in it.
  const works = new Map<string, string[]>();
  for (const work of [...translations, ...transliterations]) {
    const code = work.languageCode.toLowerCase();
    if (code === 'ar') continue;
    works.set(code, [...(works.get(code) ?? []), work.name]);
  }
  const choices: LanguageChoice[] = [
    { code: 'ar', label: t('search.languageArabic') },
    ...[...works.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, names]) => ({
        code,
        label: t('search.languageOption', {
          language: languageOf(languages, code).name,
          works: names.join(', '),
        }),
      })),
  ];

  const catalogue = {
    surahs,
    juz: juzList,
    languages: choices.map((choice) => choice.code),
  };
  const { form, filters, issues } = readQuranSearch(query, catalogue);
  const within = issues.length === 0 ? citationsWithin(filters, catalogue) : null;
  const disjoint = within !== null && within.length === 0;

  const outcome: SearchOutcome | null =
    issues.length > 0 || disjoint
      ? null
      : await searchReadRuntime().search(quranSearchRequest(query, filters.language), {
          locale,
          ...(within === null ? {} : { within }),
        });
  const q = outcome?.form.q ?? form.q;
  const title = t('sections.search');

  const jump =
    q.trim() === ''
      ? null
      : parseQuickJump(q, jumpIndex(surahs), lastPage, hizbJuzOf(juzList), 'whole');

  const path = quranPath(locale, 'search');
  const filtersOpen = hasQuranFilters(filters) || issues.length > 0;

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="max-w-[var(--measure-prose)] text-foreground-muted">
          {t('search.intro')}
        </p>
      </div>

      <Panel>
        <form
          method="get"
          action={path}
          role="search"
          aria-label={title}
          className="flex flex-col gap-4"
        >
          <Field id="quran-search-q" label={t('search.label')} help={t('search.help')}>
            {(props) => (
              <TextInput
                {...props}
                type="search"
                name="q"
                defaultValue={q}
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                autoComplete="off"
                enterKeyHint="search"
              />
            )}
          </Field>

          <details
            className="rounded-control border border-border bg-surface px-4"
            open={filtersOpen}
          >
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
              <Icon name="filter" size={16} />
              {t('search.filters')}
            </summary>
            <div className="grid gap-4 pt-2 pb-4 sm:grid-cols-3">
              <Field id="quran-search-surah" label={t('search.surah')}>
                {(props) => (
                  <Select {...props} name="surah" defaultValue={form.surah}>
                    <option value="">{t('search.surahAny')}</option>
                    {surahs.map((surah) => (
                      <option key={surah.number} value={String(surah.number)}>
                        {t('search.surahOption', {
                          number: surah.number,
                          name: surahLabel(surah, locale, t),
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="quran-search-juz" label={t('search.juz')}>
                {(props) => (
                  <Select {...props} name="juz" defaultValue={form.juz}>
                    <option value="">{t('search.juzAny')}</option>
                    {juzList.map((juz) => (
                      <option key={juz.number} value={String(juz.number)}>
                        {t('juzName', { number: juz.number })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="quran-search-language" label={t('search.language')}>
                {(props) => (
                  <Select
                    {...props}
                    name="language"
                    defaultValue={filters.language ?? form.language}
                  >
                    <option value="">{t('search.languageAny')}</option>
                    {choices.map((choice) => (
                      <option key={choice.code} value={choice.code}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button>{t('search.submit')}</Button>
            {q === '' && !hasQuranFilters(filters) ? null : (
              <TextLink href={path}>{t('search.clear')}</TextLink>
            )}
          </div>
        </form>
      </Panel>

      {issues.length === 0 ? null : (
        <Alert tone="error">
          {[
            t('search.invalidFilters'),
            ...issues.map((issue) => issueText(issue, form, t)),
          ].join(' ')}
        </Alert>
      )}

      {disjoint ? (
        <Alert tone="info">
          {t('search.noOverlap', {
            surah: filters.surah ?? 0,
            juz: filters.juz ?? 0,
          })}
        </Alert>
      ) : null}

      {jump === null || jump.kind === 'unknown' ? null : (
        <JumpCard jump={jump} surahs={surahs} locale={locale} t={t} />
      )}

      {outcome === null ? null : (
        <QuranResults
          outcome={outcome}
          locale={locale}
          languages={languages}
          choices={choices}
          filters={filters}
          path={path}
          jumped={jump !== null && jump.kind !== 'unknown'}
          surahs={surahs}
          t={t}
          searchT={searchT}
          q={q}
        />
      )}
    </QuranFrame>
  );
}

/** The sentence a refused filter is explained by, naming what was asked for. */
function issueText(issue: QuranFilterIssue, form: QuranSearchForm, t: QuranTranslator) {
  switch (issue) {
    case 'surah':
      return t('search.issues.surah', { value: form.surah });
    case 'juz':
      return t('search.issues.juz', { value: form.juz });
    case 'language':
      return t('search.issues.language', { value: form.language });
  }
}

/** A Surah's name as an option or a chip shows it: its display name, else its number. */
function surahLabel(
  surah: Pick<PublicSurah, 'number' | 'names' | 'nameArabic'>,
  locale: Locale,
  t: QuranTranslator,
): string {
  return surahName(surah, locale)?.text ?? t('surahName', { number: surah.number });
}

/**
 * THE PLACE A QUERY NAMES, offered first: a Surah, an Ayah (with its Arabic,
 * exactly as stored, and its place in the Surah), a Juz, a hizb or a page.
 * Built from the numbers the reader confirmed — never from the text typed.
 */
async function JumpCard({
  jump,
  surahs,
  locale,
  t,
}: {
  readonly jump: Exclude<QuickJump, { readonly kind: 'unknown' }>;
  readonly surahs: readonly PublicSurah[];
  readonly locale: Locale;
  readonly t: QuranTranslator;
}) {
  const target = quickJumpPathOf(jump);
  if (target === null) return null;
  const href = localizedPath(locale, target);

  const surah =
    jump.kind === 'surah' || jump.kind === 'ayah'
      ? (surahs.find((entry) => entry.number === jump.surah) ?? null)
      : null;
  const name = surah === null ? null : surahName(surah, locale);
  const ayah = jump.kind === 'ayah' ? await readAyah(jump.surah, jump.ayah) : null;
  // Quran Part 8: what explains the place named — the Tafsir hub's own read.
  const explained =
    jump.kind === 'ayah'
      ? resourceCount(
          resourcesForAyah(
            await readTafsirResources(jump.surah, jump.ayah, jump.ayah),
            jump.surah,
            jump.ayah,
          ),
        )
      : jump.kind === 'surah' && surah !== null
        ? await readTafsirResources(surah.number, 1, surah.ayahCount).then(
            (found) => found.texts.length + found.books.length + found.lectures.length,
          )
        : 0;
  const ref = jump.kind === 'ayah' ? { surah: jump.surah, ayah: jump.ayah } : null;
  // The one Ayah the catalogue names on its own (Ayat al-Kursi) — a fixed
  // citation from the reader's starting points, never a name written here.
  const kursi =
    ref !== null &&
    STARTING_POINTS.some(
      (point) =>
        point.key === 'kursi' &&
        point.ref.surah === ref.surah &&
        point.ref.ayah === ref.ayah,
    );

  let label: string;
  let facts: string | null = null;
  switch (jump.kind) {
    case 'surah':
      label = name?.text ?? t('surahName', { number: jump.surah });
      facts =
        surah === null
          ? null
          : [
              t('search.jump.surahFacts', {
                number: surah.number,
                count: surah.ayahCount,
              }),
              surahMeaning(surah, name)?.text,
            ]
              .filter((part): part is string => part !== undefined && part !== '')
              .join(' · ');
      break;
    case 'ayah':
      label = t('ayahName', { surah: jump.surah, ayah: jump.ayah });
      break;
    case 'juz':
      label = t('juzName', { number: jump.juz });
      break;
    case 'hizb':
      label = t('jump.hizb', { hizb: jump.hizb, juz: jump.juz });
      break;
    case 'page':
      label = t('page.title', { number: jump.page });
      break;
  }

  return (
    <section
      aria-labelledby="quran-jump"
      className="flex min-w-0 flex-col gap-3 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-6"
    >
      <h2 id="quran-jump" className="text-caption font-semibold text-accent">
        {t('search.jump.heading')}
      </h2>
      <p className="font-serif text-subheading font-semibold min-w-0 text-balance wrap-anywhere">
        <a
          href={href}
          className="inline-flex min-h-11 flex-wrap items-center gap-x-2 min-w-0 max-w-full text-action underline underline-offset-4"
        >
          {jump.kind === 'ayah' && name !== null ? (
            <span lang={name.locale}>{name.text}</span>
          ) : null}
          <span lang={jump.kind === 'surah' && name !== null ? name.locale : undefined}>
            {label}
          </span>
          {kursi ? (
            <span className="text-foreground-muted">· {t('start.kursi')}</span>
          ) : null}
          <Icon name="arrow-end" size={16} />
        </a>
      </p>
      {facts === null || facts === '' ? null : (
        <p className="text-sm text-foreground-muted">{facts}</p>
      )}
      {ayah === null || ref === null ? null : (
        <>
          <ArabicText
            id="quran-jump-arabic"
            label={t('layer.arabic')}
            text={ayah.text}
            ayah={ayah.ayah}
          />
          <p className="text-sm">
            <TextLink href={surahPlacePath(locale, ref)}>
              {t('search.jump.inSurah')}
            </TextLink>
          </p>
        </>
      )}
      {explained === 0 || (jump.kind !== 'ayah' && jump.kind !== 'surah') ? null : (
        <p className="text-sm">
          <TextLink
            href={
              jump.kind === 'ayah'
                ? `${tafsirSurahPath(locale, jump.surah)}?ayah=${String(jump.ayah)}`
                : tafsirSurahPath(locale, jump.surah)
            }
          >
            {t(
              jump.kind === 'ayah' ? 'search.jump.tafsirAyah' : 'search.jump.tafsirSurah',
              {
                count: explained,
              },
            )}
          </TextLink>
        </p>
      )}
    </section>
  );
}

function QuranResults({
  outcome,
  locale,
  languages,
  choices,
  filters,
  path,
  jumped,
  surahs,
  t,
  searchT,
  q,
}: {
  readonly outcome: SearchOutcome;
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly choices: readonly LanguageChoice[];
  readonly filters: QuranSearchFilters;
  readonly path: string;
  readonly jumped: boolean;
  readonly surahs: readonly PublicSurah[];
  readonly t: QuranTranslator;
  readonly searchT: SearchTranslator;
  readonly q: string;
}) {
  switch (outcome.state) {
    case 'initial':
      return null;
    case 'invalid':
      // The unified page's own wording for each refusal, so the two searches
      // explain a malformed query identically.
      return (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <p className="font-medium text-error">{searchT('invalidTitle')}</p>
          <ul className="list-disc ps-5 text-error">
            {outcome.issues.map((key) => (
              <li key={key}>{searchT(`issues.${key}` as 'issues.type')}</li>
            ))}
          </ul>
        </div>
      );
    case 'unavailable':
      return <Alert tone="error">{searchT('unavailable')}</Alert>;
    case 'results':
      return (
        <ResultList
          results={outcome.results}
          locale={locale}
          languages={languages}
          choices={choices}
          filters={filters}
          path={path}
          jumped={jumped}
          surahs={surahs}
          t={t}
          q={q}
        />
      );
  }
}

async function ResultList({
  results,
  locale,
  languages,
  choices,
  filters,
  path,
  jumped,
  surahs,
  t,
  q,
}: {
  readonly results: Extract<SearchOutcome, { state: 'results' }>['results'];
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly choices: readonly LanguageChoice[];
  readonly filters: QuranSearchFilters;
  readonly path: string;
  readonly jumped: boolean;
  readonly surahs: readonly PublicSurah[];
  readonly t: QuranTranslator;
  readonly q: string;
}) {
  const words = q.trim();
  // ONE read of the CURRENT records for every result on this page — never the
  // index's summary, which can lag a withdrawn layer or a corrected text. A
  // hit whose Ayah has no current record is not public now and is not shown.
  const refs = quranHitRefs(results.hits);
  const records =
    refs.length === 0 ? [] : await quranReadRuntime().reader.searchAyahRecords(refs);
  const current = new Map(
    records.map((record) => [`${record.surah}:${record.ayah}`, record]),
  );
  const shown = results.hits.flatMap((hit) => {
    const record = current.get(hit.resourceId);
    return record === undefined ? [] : [{ hit, record }];
  });

  const href = (change: Partial<QuranSearchFilters> & { readonly page?: number }) =>
    quranSearchHref(path, { q, ...filters, ...change });

  const status = results.capped
    ? t('search.capped', { count: SEARCH_RESULT_CEILING, query: words })
    : results.total > 0
      ? t('search.count', { count: results.total, query: words })
      : jumped
        ? t('search.noneText', { query: words })
        : t('search.none', { query: words });

  const chips = [
    ...(filters.surah === null
      ? []
      : [
          {
            key: 'surah',
            text: t('search.chipSurah', {
              number: filters.surah,
              name: surahLabel(
                surahs.find((surah) => surah.number === filters.surah) ?? {
                  number: filters.surah,
                  names: {},
                  nameArabic: null,
                },
                locale,
                t,
              ),
            }),
            href: href({ surah: null }),
          },
        ]),
    ...(filters.juz === null
      ? []
      : [
          {
            key: 'juz',
            text: t('juzName', { number: filters.juz }),
            href: href({ juz: null }),
          },
        ]),
    ...(filters.language === null
      ? []
      : [
          {
            key: 'language',
            text:
              choices.find((choice) => choice.code === filters.language)?.label ??
              filters.language,
            href: href({ language: null }),
          },
        ]),
  ];

  return (
    <section className="flex flex-col gap-5" aria-labelledby="quran-results">
      <div className="flex flex-col gap-3">
        <h2 id="quran-results" className="font-serif text-subheading font-semibold">
          {t('search.results')}
        </h2>
        <p role="status" className="text-sm text-foreground-muted">
          {status}
        </p>
        {chips.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <span id="quran-search-active" className="sr-only">
              {t('search.active')}
            </span>
            <ul aria-labelledby="quran-search-active" className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li key={chip.key}>
                  <a
                    href={chip.href}
                    aria-label={t('search.remove', { filter: chip.text })}
                    className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-accent-rule bg-accent-surface px-3.5 text-sm font-medium text-foreground hover:border-accent"
                  >
                    <bdi className="min-w-0 wrap-anywhere">{chip.text}</bdi>
                    <Icon name="close" size={16} />
                  </a>
                </li>
              ))}
            </ul>
            {chips.length > 1 ? (
              <a
                href={quranSearchHref(path, { q })}
                className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-action underline underline-offset-2"
              >
                {t('search.clearFilters')}
              </a>
            ) : null}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        jumped || results.total > 0 ? null : (
          <NoResults
            query={words}
            filtered={hasQuranFilters(filters)}
            withoutFilters={quranSearchHref(path, { q })}
            t={t}
          />
        )
      ) : (
        <ol aria-labelledby="quran-results" className="flex flex-col gap-4">
          {shown.map(({ hit, record }) => (
            <QuranResult
              key={`${hit.resourceId}:${hit.textLanguage}`}
              hit={hit}
              record={record}
              surah={surahs.find((surah) => surah.number === record.surah) ?? null}
              locale={locale}
              languages={languages}
              language={filters.language}
              t={t}
              query={words}
            />
          ))}
        </ol>
      )}

      {results.pageCount > 1 && results.hits.length > 0 ? (
        <nav
          aria-label={t('search.pages')}
          className="flex flex-wrap items-center gap-6 border-t border-border pt-5"
        >
          {results.page > 1 ? (
            <TextLink href={href({ page: results.page - 1 })}>{t('previous')}</TextLink>
          ) : null}
          <span aria-current="page" className="text-sm">
            {t('search.pageStatus', { page: results.page, pages: results.pageCount })}
          </span>
          {results.page < results.pageCount ? (
            <TextLink href={href({ page: results.page + 1 })}>{t('next')}</TextLink>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}

/** Nothing matched: what to try instead — said, never just "nothing". */
function NoResults({
  query,
  filtered,
  withoutFilters,
  t,
}: {
  readonly query: string;
  readonly filtered: boolean;
  readonly withoutFilters: string;
  readonly t: QuranTranslator;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-dashed border-border-strong px-5 py-6">
      <h3 className="text-sm font-semibold">{t('search.suggestions')}</h3>
      <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-foreground-muted">
        {hasArabicScript(query) ? <li>{t('search.arabicHint')}</li> : null}
        <li>{t('search.translationHint')}</li>
        {filtered ? (
          <li>
            <TextLink href={withoutFilters}>{t('search.withoutFilters')}</TextLink>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * One Ayah result: its Surah's display name and citation as the heading link,
 * its Arabic in the Quran face with the typed words marked, the public layer
 * snippets that match — each in its own labelled group, marked with its own
 * language — and the ways on: the Ayah itself, and its place in the Surah.
 */
function QuranResult({
  hit,
  record,
  surah,
  locale,
  languages,
  language,
  t,
  query,
}: {
  readonly hit: SearchHit;
  readonly record: AyahSearchRecord;
  readonly surah: PublicSurah | null;
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly language: string | null;
  readonly t: QuranTranslator;
  readonly query: string;
}) {
  const ref = citationOfResource(hit.resourceId) ?? {
    surah: record.surah,
    ayah: record.ayah,
  };
  const key = `${String(ref.surah)}-${String(ref.ayah)}`;
  const name = surah === null ? null : surahName(surah, locale);
  const layers = layersShown(record, {
    hitLanguage: hit.textLanguage,
    language,
    locale,
    query,
  });
  // The address the owner resolved for this hit NOW — never one recorded at indexing.
  const canonical = localizedPath(locale, hit.href);

  return (
    <li>
      <article
        aria-labelledby={`hit-${key}`}
        className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-5 sm:p-6"
      >
        <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span
            aria-hidden="true"
            className="inline-flex min-w-12 items-center justify-center rounded-full border border-accent-rule bg-accent-surface px-2.5 py-0.5 text-caption font-semibold text-accent tabular-nums"
          >
            <bdi dir="ltr">{citationOf(ref)}</bdi>
          </span>
          <h3 id={`hit-${key}`} className="min-w-0 text-lg font-semibold wrap-anywhere">
            <a
              href={canonical}
              className="inline-flex min-h-11 flex-wrap items-baseline gap-x-2 min-w-0 max-w-full text-action underline-offset-4 hover:underline"
            >
              {name === null ? null : (
                <span
                  lang={name.locale}
                  className={name.locale === 'ar' ? 'quran-name' : undefined}
                >
                  {name.text}
                </span>
              )}
              <span className="text-sm font-normal text-foreground-muted">
                {t('ayahName', { surah: ref.surah, ayah: ref.ayah })}
              </span>
            </a>
          </h3>
        </header>

        <div role="group" aria-labelledby={`hit-${key}-arabic`} className="min-w-0">
          <span id={`hit-${key}-arabic`} className="sr-only">
            {t('layer.arabic')}
          </span>
          <p
            lang="ar"
            dir="rtl"
            translate="no"
            className="quran-text quran-ayah-text break-words text-start"
          >
            <Highlighted text={record.text} query={query} />
          </p>
        </div>

        {layers.length === 0 ? null : (
          <div className="flex flex-col gap-4">
            {layers.map((layer, index) => {
              const written = languageOf(languages, layer.languageCode);
              const snippet = snippetOf(layer.text, query);
              const id = `hit-${key}-layer-${String(index + 1)}`;
              return (
                <div
                  key={`${layer.kind}:${layer.slug}:${String(index)}`}
                  role="group"
                  aria-labelledby={id}
                  dir={written.direction}
                  className="flex min-w-0 max-w-[68ch] flex-col gap-1.5"
                >
                  <p
                    lang={written.code}
                    dir={written.direction}
                    className="quran-translation reading-face break-words"
                  >
                    {snippet.before ? <span aria-hidden="true">… </span> : null}
                    <Highlighted text={snippet.text} query={query} />
                    {snippet.after ? <span aria-hidden="true"> …</span> : null}
                  </p>
                  <p id={id} className="text-caption text-foreground-muted">
                    <span className="sr-only">
                      {t(`layer.${layer.kind}`, { name: layer.name })}
                    </span>
                    <span aria-hidden="true">
                      — <bdi>{layer.name}</bdi>
                      {layer.kind === 'note' ? ` · ${t('notes.title')}` : null}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a
            href={canonical}
            className="inline-flex min-h-11 items-center font-medium text-action underline underline-offset-2"
          >
            {t('search.openAyah')}
          </a>
          <a
            href={surahPlacePath(locale, ref)}
            className="inline-flex min-h-11 items-center font-medium text-action underline underline-offset-2"
          >
            {t('search.readInSurah')}
          </a>
        </p>
      </article>
    </li>
  );
}
