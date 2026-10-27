import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  SEARCH_KINDS,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RESULT_CEILING,
  type SearchHit,
} from '@minhaj/contracts/search';
import type { SearchFormState, SearchOutcome } from '@minhaj/search';

import { searchReadRuntime } from '@/composition/search-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { Highlighted } from '@/components/search/highlighted';
import { hadithHitKey, type HadithHitDisplay } from '@/components/search/hadith-hit';
import { currentHadithHitText } from '@/components/search/hadith-hit-text';
import type { FatwaHitDisplay } from '@/components/search/fatwa-hit';
import { currentFatwaHitText } from '@/components/search/fatwa-hit-text';
import { quranHitKey, type QuranHitDisplay } from '@/components/search/quran-hit';
import { currentQuranHitText } from '@/components/search/quran-hit-text';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  EmptyState,
  Field,
  LinkCard,
  MetaRow,
  PageHeading,
  SectionHeader,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import { publicIndexingEnabled } from '@/config/indexing';
import { directionOf, isSupportedLocale } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * `/{locale}/search` — unified public search (ROUTE_MAP.md §3.1, DELIVERY_PLAN.md
 * Phase 17).
 *
 * SIGNED OUT, ALWAYS. Nothing in this module's graph reaches a session, an
 * authorisation service or an authentication library; the same query returns the
 * same results to everyone, and no search history is kept (ARCHITECTURE.md §8.1).
 *
 * A PLAIN GET FORM. Every control works without JavaScript and every result page
 * has a shareable address — which is also why the page is `noindex`: a results
 * page is a view of a query, not a resource (ROUTE_MAP.md §9.5).
 *
 * DYNAMIC, NEVER CACHED. Visibility can change between two requests, and a
 * cached results page is exactly the stale disclosure the Search foundation
 * exists to prevent (ARCHITECTURE.md §8.5).
 *
 * EVERY STATE IS HONEST. Nothing typed, something to correct, a temporary fault
 * and no matches are four different messages — and too many searches is a fifth,
 * decided before this page renders (`search-admission.ts`, `search/limited`).
 * None is disguised as another, and none shows an infrastructure detail.
 *
 * NO HEADER, NO SECRET, NO SESSION in this graph — the public content-route
 * contract (ARCHITECTURE.md §8.1, §8.3.1.1), proven by the Phase-4 boundary
 * test.
 */
export const dynamic = 'force-dynamic';

interface SearchParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: SearchParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'search' });

  return {
    title: t('title'),
    description: t('description'),
    // NOINDEX ALWAYS; FOLLOW only once the platform is indexable at all — the
    // pre-adoption posture keeps the whole site `nofollow` until launch.
    robots: { index: false, follow: publicIndexingEnabled() },
  };
}

/** The address of a results view, from a form state and overrides. */
function searchHref(
  locale: string,
  form: SearchFormState,
  overrides: Partial<SearchFormState> & { readonly page?: number } = {},
): string {
  const merged = { ...form, ...overrides };
  const query = new URLSearchParams();
  for (const key of ['q', 'type', 'topic', 'language', 'from', 'to'] as const) {
    if (merged[key] !== '') query.set(key, merged[key]);
  }
  if (overrides.page !== undefined && overrides.page > 1) {
    query.set('page', String(overrides.page));
  }
  const text = query.toString();
  return `/${locale}/search${text === '' ? '' : `?${text}`}`;
}

function hasFilters(form: SearchFormState): boolean {
  return (
    form.type !== '' ||
    form.topic !== '' ||
    form.language !== '' ||
    form.from !== '' ||
    form.to !== ''
  );
}

export default async function SearchPage({ params, searchParams }: SearchParams) {
  const locale = await requireLocale(params);
  const raw = await searchParams;

  const t = await getTranslations({ locale, namespace: 'search' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const [outcome, topics, languages] = await Promise.all([
    searchReadRuntime().search(raw, { locale }),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    taxonomyRuntime().taxonomy.listLanguages({ includeRetired: false }),
  ]);

  const { form } = outcome;
  // A Quran, Hadith or Fatwa result shows its CURRENT text, read once per
  // owner for the whole page — never its indexed summary, which may lag a
  // withdrawn or corrected text.
  const [quranText, hadithText, fatwaText] =
    outcome.state === 'results'
      ? await Promise.all([
          currentQuranHitText(outcome.results.hits),
          currentHadithHitText(outcome.results.hits),
          currentFatwaHitText(outcome.results.hits),
        ])
      : [
          new Map<string, QuranHitDisplay>(),
          new Map<string, HadithHitDisplay>(),
          new Map<string, FatwaHitDisplay>(),
        ];
  const issues =
    outcome.state === 'invalid' ? new Set(outcome.issues) : new Set<string>();
  /** A field's error, passed only when it has one. */
  const errorFor = (...keys: readonly string[]) => {
    const key = keys.find((candidate) => issues.has(candidate));
    return key === undefined ? {} : { error: t(`issues.${key}` as 'issues.type') };
  };
  const languageNames = new Map(
    languages.map((language) => [
      language.code,
      { name: language.nativeName, direction: language.direction },
    ]),
  );

  return (
    <>
      {/*
       * A COMPACT TOOL HEADER, NOT A HERO. The page's job is the form and the
       * results under it, so the band holds the heading, one line of
       * orientation and the form — and the results start within the first
       * screen on a phone.
       */}
      <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)]">
        <Container>
          <div className="flex flex-col gap-5 py-[var(--space-page)]">
            <Breadcrumbs
              label={shell('nav.breadcrumbs')}
              trail={[
                { href: `/${locale}`, text: shell('nav.home') },
                { text: t('title') },
              ]}
            />
            <div className="flex max-w-3xl flex-col gap-2">
              <PageHeading>{t('title')}</PageHeading>
              <p className="text-lede max-w-[var(--measure-prose)] text-[color:var(--color-foreground-muted)]">
                {t('intro')}
              </p>
            </div>

            <form
              method="get"
              action={`/${locale}/search`}
              role="search"
              aria-label={t('title')}
              className="flex w-full max-w-3xl flex-col gap-4"
            >
              <Field
                id="search-q"
                label={t('queryLabel')}
                help={t('queryHelp')}
                {...errorFor(
                  'query-too-long',
                  'too-many-terms',
                  'term-too-long',
                  'no-terms',
                )}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    type="search"
                    name="q"
                    defaultValue={form.q}
                    maxLength={SEARCH_QUERY_MAX_LENGTH}
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                )}
              </Field>

              <details
                className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4"
                open={hasFilters(form) || issues.size > 0}
              >
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
                  {t('refine')}
                </summary>

                <div className="grid gap-4 pb-4 pt-2 sm:grid-cols-2">
                  <Field id="search-type" label={t('type')} {...errorFor('type')}>
                    {(props) => (
                      <Select {...props} name="type" defaultValue={form.type}>
                        <option value="">{t('typeAny')}</option>
                        {SEARCH_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {t(`kinds.${kind}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field id="search-topic" label={t('topic')} {...errorFor('topic')}>
                    {(props) => (
                      <Select {...props} name="topic" defaultValue={form.topic}>
                        <option value="">{t('topicAny')}</option>
                        {topics.map((topic) => (
                          <option key={topic.id} value={topic.slug}>
                            {`${'— '.repeat(Math.max(0, topic.depth - 1))}${topic.label.name}`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field
                    id="search-language"
                    label={t('language')}
                    help={t('languageHelp')}
                    {...errorFor('language')}
                  >
                    {(props) => (
                      <Select {...props} name="language" defaultValue={form.language}>
                        <option value="">{t('languageAny')}</option>
                        {languages.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.nativeName}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      id="search-from"
                      label={t('from')}
                      {...errorFor('year', 'year-range')}
                    >
                      {(props) => (
                        <TextInput
                          {...props}
                          name="from"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={9999}
                          defaultValue={form.from}
                        />
                      )}
                    </Field>
                    <Field id="search-to" label={t('to')}>
                      {(props) => (
                        <TextInput
                          {...props}
                          name="to"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={9999}
                          defaultValue={form.to}
                        />
                      )}
                    </Field>
                  </div>
                  <p className="text-xs text-[color:var(--color-foreground-muted)] sm:col-span-2">
                    {t('yearHelp')}
                  </p>
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Button>{t('submit')}</Button>
                {form.q === '' && !hasFilters(form) ? null : (
                  <QuietLink href={`/${locale}/search`}>{t('clear')}</QuietLink>
                )}
                {hasFilters(form) && form.q !== '' ? (
                  <QuietLink
                    href={searchHref(locale, form, {
                      type: '',
                      topic: '',
                      language: '',
                      from: '',
                      to: '',
                    })}
                  >
                    {t('clearFilters')}
                  </QuietLink>
                ) : null}
              </div>
            </form>
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex flex-col gap-6 py-[var(--space-page)]">
          <SearchResults
            outcome={outcome}
            locale={locale}
            languageNames={languageNames}
            quranText={quranText}
            hadithText={hadithText}
            fatwaText={fatwaText}
            t={t}
            href={(overrides) => searchHref(locale, form, overrides)}
          />
        </div>
      </Container>
    </>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations<'search'>>>;

/** A secondary text link with a 44-pixel target. */
function QuietLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--color-action)] underline underline-offset-2 hover:text-[color:var(--color-action-hover)]"
    >
      {children}
    </a>
  );
}

/** The two delivered places to browse instead of search, named by where they go. */
function BrowseLinks({ locale, t }: { readonly locale: Locale; readonly t: Translate }) {
  return (
    <span className="mt-3 flex flex-wrap justify-center gap-x-6">
      <QuietLink href={pathFor(locale, requireRoute('topics'))}>
        {t('browseTopics')}
      </QuietLink>
      <QuietLink href={pathFor(locale, requireRoute('library'))}>
        {t('browseLibrary')}
      </QuietLink>
    </span>
  );
}

function SearchResults({
  outcome,
  locale,
  languageNames,
  quranText,
  hadithText,
  fatwaText,
  t,
  href,
}: {
  readonly outcome: SearchOutcome;
  readonly locale: Locale;
  readonly languageNames: ReadonlyMap<string, { name: string; direction: 'ltr' | 'rtl' }>;
  readonly quranText: ReadonlyMap<string, QuranHitDisplay>;
  readonly hadithText: ReadonlyMap<string, HadithHitDisplay>;
  readonly fatwaText: ReadonlyMap<string, FatwaHitDisplay>;
  readonly t: Translate;
  readonly href: (overrides: Partial<SearchFormState> & { page?: number }) => string;
}) {
  switch (outcome.state) {
    case 'initial':
      return (
        <section className="flex flex-col gap-5" aria-labelledby="search-initial">
          <SectionHeader
            id="search-initial"
            heading={t('initialTitle')}
            intro={t('initialBody')}
          />
          <CardGrid columns={3}>
            <LinkCard
              href={pathFor(locale, requireRoute('topics'))}
              title={t('browseTopics')}
              description={t('start.topics')}
            />
            <LinkCard
              href={pathFor(locale, requireRoute('library'))}
              title={t('browseLibrary')}
              description={t('start.library')}
            />
            <LinkCard
              href={pathFor(locale, requireRoute('explore'))}
              title={t('start.exploreTitle')}
              description={t('start.explore')}
            />
          </CardGrid>
        </section>
      );

    case 'invalid':
      return (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-error)] bg-[color:var(--color-error-surface)] px-4 py-3 text-sm text-[color:var(--color-error)]"
        >
          <p className="font-semibold">{t('invalidTitle')}</p>
          <ul className="list-disc ps-5">
            {outcome.issues.map((key) => (
              <li key={key}>{t(`issues.${key}` as 'issues.type')}</li>
            ))}
          </ul>
        </div>
      );

    case 'unavailable':
      return <Alert tone="error">{t('unavailable')}</Alert>;

    case 'results': {
      const { results, form, topic } = outcome;
      const query = form.q.trim();

      return (
        <section className="flex flex-col gap-5" aria-labelledby="search-results">
          <h2 id="search-results" className="sr-only">
            {t('resultsLabel')}
          </h2>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[color:var(--color-border)] pb-3">
            <p role="status" className="text-sm font-medium">
              {results.capped
                ? t('resultsCapped', { count: SEARCH_RESULT_CEILING, query })
                : results.total > 0
                  ? t('results', { count: results.total, query })
                  : null}
            </p>
            {topic === null ? null : (
              <p className="flex flex-wrap items-center gap-x-3 text-sm">
                <span className="rounded-full border border-[color:var(--color-accent)] bg-[color:var(--color-accent-surface)] px-3 py-1">
                  {t('topicActive', { name: topic.name })}
                </span>
                <QuietLink href={href({ topic: '' })}>{t('removeTopic')}</QuietLink>
              </p>
            )}
          </div>

          {results.hits.length === 0 ? (
            results.page > 1 ? (
              <EmptyState>
                {t('pastEnd')} <TextLink href={href({})}>{t('firstPage')}</TextLink>
              </EmptyState>
            ) : (
              <EmptyState>
                <span className="block font-medium text-[color:var(--color-foreground)]">
                  {t('noResults', { query })}
                </span>
                <span className="mt-1 block">{t('noResultsHelp')}</span>
                <BrowseLinks locale={locale} t={t} />
              </EmptyState>
            )
          ) : (
            <ol
              aria-label={t('resultsLabel')}
              className="flex max-w-3xl list-none flex-col p-0"
            >
              {results.hits.map((hit) => (
                <ResultItem
                  key={`${hit.kind}:${hit.resourceId}`}
                  hit={hit}
                  locale={locale}
                  query={query}
                  languageNames={languageNames}
                  quranText={quranText}
                  hadithText={hadithText}
                  fatwaText={fatwaText}
                  t={t}
                />
              ))}
            </ol>
          )}

          {results.pageCount > 1 && results.hits.length > 0 ? (
            <nav
              aria-label={t('pagination')}
              className="flex max-w-3xl flex-wrap items-center justify-between gap-4 border-t border-[color:var(--color-border)] pt-5"
            >
              <span className="min-w-0">
                {results.page > 1 ? (
                  <ActionLink href={href({ page: results.page - 1 })} tone="secondary">
                    {t('previous')}
                  </ActionLink>
                ) : null}
              </span>
              <span
                aria-current="page"
                className="text-sm text-[color:var(--color-foreground-muted)]"
              >
                {t('pageStatus', { page: results.page, pages: results.pageCount })}
              </span>
              <span className="min-w-0">
                {results.page < results.pageCount ? (
                  <ActionLink href={href({ page: results.page + 1 })} tone="secondary">
                    {t('next')}
                  </ActionLink>
                ) : null}
              </span>
            </nav>
          ) : null}
        </section>
      );
    }
  }
}

/**
 * One result.
 *
 * THE TEXT CARRIES ITS OWN LANGUAGE AND DIRECTION. An Urdu title inside an
 * English page is announced in Urdu and shaped right-to-left (WCAG 3.1.2), and a
 * long unbroken word wraps rather than widening the page.
 *
 * NO IDENTIFIER IS SHOWN. The kind, the language and a genuine year are the
 * metadata; the address is the owner's current public one.
 */
function ResultItem({
  hit,
  locale,
  query,
  languageNames,
  quranText,
  hadithText,
  fatwaText,
  t,
}: {
  readonly hit: SearchHit;
  readonly locale: Locale;
  readonly query: string;
  readonly languageNames: ReadonlyMap<string, { name: string; direction: 'ltr' | 'rtl' }>;
  readonly quranText: ReadonlyMap<string, QuranHitDisplay>;
  readonly hadithText: ReadonlyMap<string, HadithHitDisplay>;
  readonly fatwaText: ReadonlyMap<string, FatwaHitDisplay>;
  readonly t: Translate;
}) {
  // A Quran result shows its Ayah's CURRENT text in the language that text is
  // in — never the indexed summary. One with no current record is not public
  // now and is not shown at all.
  const quran = hit.kind === 'quran-ayah' ? quranText.get(quranHitKey(hit)) : undefined;
  if (hit.kind === 'quran-ayah' && quran === undefined) return null;
  // A Hadith result likewise shows its citation's CURRENT original or public
  // translation, labelled as which it is; one not public now is not shown.
  const hadith = hit.kind === 'hadith' ? hadithText.get(hadithHitKey(hit)) : undefined;
  if (hit.kind === 'hadith' && hadith === undefined) return null;
  // A Fatwa result shows its CURRENT published revision's title and public
  // question; a ruling withdrawn since it was indexed is not shown.
  const fatwa = hit.kind === 'fatwa' ? fatwaText.get(hit.resourceId) : undefined;
  if (hit.kind === 'fatwa' && fatwa === undefined) return null;
  const current = quran ?? hadith ?? fatwa;
  const title = fatwa?.title ?? hit.title;

  const textLanguage = current?.language ?? hit.textLanguage;
  const summary = current?.text ?? hit.summary;
  const language = languageNames.get(textLanguage);
  const direction =
    language?.direction ??
    (isSupportedLocale(textLanguage) ? directionOf(textLanguage) : 'ltr');
  const contentLanguageCode =
    current === undefined ? hit.contentLanguage : current.language;
  const contentLanguage =
    contentLanguageCode === null
      ? null
      : (languageNames.get(contentLanguageCode) ?? null);

  return (
    <li className="min-w-0 border-b border-[color:var(--color-border)] py-5 first:pt-0 last:border-b-0">
      <article className="flex min-w-0 flex-col gap-2">
        <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
          {t(`kinds.${hit.kind}`)}
        </p>
        <h3
          className="text-subheading font-semibold break-words"
          lang={textLanguage}
          dir={direction}
        >
          <a
            href={`/${locale}${hit.href}`}
            className="text-[color:var(--color-foreground)] underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:decoration-[color:var(--color-action)] active:text-[color:var(--color-action)]"
          >
            <Highlighted text={title} query={query} />
          </a>
        </h3>
        {summary === '' ? null : (
          <p
            className="max-w-[var(--measure-prose)] text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={textLanguage}
            dir={direction}
          >
            <Highlighted text={summary} query={query} />
          </p>
        )}
        <MetaRow
          items={[
            // A translation's words are never presented as the Arabic: only the
            // canonical text is labelled as it (Phase 18 §4).
            quran === undefined
              ? null
              : quran.layer === 'arabic'
                ? t('quranArabic')
                : t('quranLayer', { language: language?.name ?? textLanguage }),
            // A translation is never presented as the original text.
            hadith === undefined
              ? null
              : hadith.layer === 'original'
                ? t('hadithOriginal')
                : t('hadithTranslation', { language: language?.name ?? textLanguage }),
            contentLanguage === null ? null : (
              <span lang={contentLanguageCode ?? undefined}>{contentLanguage.name}</span>
            ),
            hit.year === null ? null : t('published', { year: String(hit.year) }),
          ]}
        />
      </article>
    </li>
  );
}
