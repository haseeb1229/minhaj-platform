import type { Metadata } from 'next';
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
import { highlightSegments } from '@/components/search/highlight';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { publicIndexingEnabled } from '@/config/indexing';
import { directionOf, isSupportedLocale } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';

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
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[{ href: `/${locale}`, text: shell('nav.home') }, { text: t('title') }]}
        />

        <div className="flex flex-col gap-2">
          <PageHeading>{t('title')}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">{t('intro')}</p>
        </div>

        <Panel>
          <form
            method="get"
            action={`/${locale}/search`}
            role="search"
            aria-label={t('title')}
            className="flex flex-col gap-5"
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
              className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] px-4 py-3"
              open={hasFilters(form) || issues.size > 0}
            >
              <summary className="cursor-pointer text-sm font-medium">
                {t('refine')}
              </summary>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
              </div>
              <p className="mt-3 text-xs text-[color:var(--color-foreground-muted)]">
                {t('yearHelp')}
              </p>
            </details>

            <div className="flex flex-wrap items-center gap-4">
              <Button>{t('submit')}</Button>
              {form.q === '' && !hasFilters(form) ? null : (
                <TextLink href={`/${locale}/search`}>{t('clear')}</TextLink>
              )}
              {hasFilters(form) && form.q !== '' ? (
                <TextLink
                  href={searchHref(locale, form, {
                    type: '',
                    topic: '',
                    language: '',
                    from: '',
                    to: '',
                  })}
                >
                  {t('clearFilters')}
                </TextLink>
              ) : null}
            </div>
          </form>
        </Panel>

        <SearchResults
          outcome={outcome}
          locale={locale}
          languageNames={languageNames}
          t={t}
          href={(overrides) => searchHref(locale, form, overrides)}
        />
      </div>
    </Container>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations<'search'>>>;

function SearchResults({
  outcome,
  locale,
  languageNames,
  t,
  href,
}: {
  readonly outcome: SearchOutcome;
  readonly locale: Locale;
  readonly languageNames: ReadonlyMap<string, { name: string; direction: 'ltr' | 'rtl' }>;
  readonly t: Translate;
  readonly href: (overrides: Partial<SearchFormState> & { page?: number }) => string;
}) {
  switch (outcome.state) {
    case 'initial':
      return (
        <section className="flex flex-col gap-3" aria-labelledby="search-initial">
          <h2 id="search-initial" className="text-lg font-semibold">
            {t('initialTitle')}
          </h2>
          <p className="text-[color:var(--color-foreground-muted)]">{t('initialBody')}</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <li>
              <TextLink href={`/${locale}/topics`}>{t('browseTopics')}</TextLink>
            </li>
            <li>
              <TextLink href={`/${locale}/library`}>{t('browseLibrary')}</TextLink>
            </li>
          </ul>
        </section>
      );

    case 'invalid':
      return (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <p className="font-medium text-[color:var(--color-error)]">
            {t('invalidTitle')}
          </p>
          <ul className="list-disc ps-5 text-[color:var(--color-error)]">
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

          {topic === null ? null : (
            <p className="text-sm">
              {t('topicActive', { name: topic.name })}{' '}
              <TextLink href={href({ topic: '' })}>{t('removeTopic')}</TextLink>
            </p>
          )}

          <p role="status" className="text-sm text-[color:var(--color-foreground-muted)]">
            {results.capped
              ? t('resultsCapped', { count: SEARCH_RESULT_CEILING, query })
              : results.total > 0
                ? t('results', { count: results.total, query })
                : null}
          </p>

          {results.hits.length === 0 ? (
            results.page > 1 ? (
              <EmptyState>
                {t('pastEnd')} <TextLink href={href({})}>{t('firstPage')}</TextLink>
              </EmptyState>
            ) : (
              <EmptyState>
                <span className="block font-medium">{t('noResults', { query })}</span>
                <span className="mt-1 block">{t('noResultsHelp')}</span>
                <span className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-2">
                  <TextLink href={`/${locale}/topics`}>{t('browseTopics')}</TextLink>
                  <TextLink href={`/${locale}/library`}>{t('browseLibrary')}</TextLink>
                </span>
              </EmptyState>
            )
          ) : (
            <ol aria-label={t('resultsLabel')} className="flex flex-col gap-4">
              {results.hits.map((hit) => (
                <ResultItem
                  key={`${hit.kind}:${hit.resourceId}`}
                  hit={hit}
                  locale={locale}
                  query={query}
                  languageNames={languageNames}
                  t={t}
                />
              ))}
            </ol>
          )}

          {results.pageCount > 1 && results.hits.length > 0 ? (
            <nav
              aria-label={t('pagination')}
              className="flex flex-wrap items-center gap-6"
            >
              {results.page > 1 ? (
                <TextLink href={href({ page: results.page - 1 })}>
                  {t('previous')}
                </TextLink>
              ) : null}
              <span aria-current="page" className="text-sm">
                {t('pageStatus', { page: results.page, pages: results.pageCount })}
              </span>
              {results.page < results.pageCount ? (
                <TextLink href={href({ page: results.page + 1 })}>{t('next')}</TextLink>
              ) : null}
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
  t,
}: {
  readonly hit: SearchHit;
  readonly locale: Locale;
  readonly query: string;
  readonly languageNames: ReadonlyMap<string, { name: string; direction: 'ltr' | 'rtl' }>;
  readonly t: Translate;
}) {
  const language = languageNames.get(hit.textLanguage);
  const direction =
    language?.direction ??
    (isSupportedLocale(hit.textLanguage) ? directionOf(hit.textLanguage) : 'ltr');
  const contentLanguage =
    hit.contentLanguage === null
      ? null
      : (languageNames.get(hit.contentLanguage) ?? null);

  return (
    <Panel as="li">
      <article className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-foreground-muted)]">
          <StatusBadge tone="neutral">{t(`kinds.${hit.kind}`)}</StatusBadge>
          {contentLanguage === null ? null : (
            <span lang={hit.contentLanguage ?? undefined}>{contentLanguage.name}</span>
          )}
          {hit.year === null ? null : (
            <span>{t('published', { year: String(hit.year) })}</span>
          )}
        </div>
        <h3
          className="text-lg font-semibold break-words"
          lang={hit.textLanguage}
          dir={direction}
        >
          <a
            href={`/${locale}${hit.href}`}
            className="text-[color:var(--color-action)] underline underline-offset-2"
          >
            <Highlighted text={hit.title} query={query} />
          </a>
        </h3>
        {hit.summary === '' ? null : (
          <p
            className="text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={hit.textLanguage}
            dir={direction}
          >
            <Highlighted text={hit.summary} query={query} />
          </p>
        )}
      </article>
    </Panel>
  );
}

function Highlighted({ text, query }: { readonly text: string; readonly query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-sm bg-[color:var(--color-highlight)] px-0.5 text-inherit"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
