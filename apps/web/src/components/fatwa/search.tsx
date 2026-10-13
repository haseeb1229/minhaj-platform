import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability } from '@minhaj/contracts/fatwa';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_RESULT_CEILING } from '@minhaj/contracts/search';
import type { SearchOutcome } from '@minhaj/search';

import { searchReadRuntime } from '@/composition/search-read';
import { Highlighted } from '@/components/search/highlighted';
import type { FatwaHitDisplay } from '@/components/search/fatwa-hit';
import { currentFatwaHitText } from '@/components/search/fatwa-hit-text';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  TextInput,
  TextLink,
} from '@/components/ui';
import { FatwaFrame, fatwaTrail } from './parts';
import {
  fatwaSearchRequest,
  fatwaSectionPath,
  fatwaTextDirection,
  rulingHref,
} from './presentation';

/**
 * `/fatwa/search` — Fatwa search over the shared Search Foundation
 * (ROUTE_MAP.md §3.8, §9.5).
 *
 * THE SAME SERVICE AS `/search`, RESTRICTED TO ONE KIND. The page hands the
 * visitor's `q` and `page` to the unified search service with the type fixed to
 * `fatwa`; no other parameter is passed through, so nothing a URL carries can
 * widen the search. Throttling happens before this page renders, in the
 * request proxy, exactly as for `/search`.
 *
 * THE CURRENT RULING IS THE RESULT. Each hit shows the current published
 * title and the opening of the anonymised public question, read fresh from
 * Fatwa's reader; a ruling withdrawn since it was indexed is not shown.
 *
 * SIGNED OUT, NOINDEX, NEVER CACHED — a results page is a view of a query.
 */

type SearchTranslator = Awaited<ReturnType<typeof getTranslations<'search'>>>;
type Query = Record<string, string | string[] | undefined>;

function resultsHref(locale: string, q: string, page: number): string {
  const search = new URLSearchParams();
  if (q !== '') search.set('q', q);
  if (page > 1) search.set('page', String(page));
  const text = search.toString();
  return `${fatwaSectionPath(locale, 'search')}${text === '' ? '' : `?${text}`}`;
}

export async function FatwaSearchPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const searchT = await getTranslations({ locale, namespace: 'search' });
  const parts = await fatwaTrail(locale);
  const outcome = await searchReadRuntime().search(fatwaSearchRequest(query), { locale });
  const title = t('sections.search');
  const q = outcome.form.q;
  // ONE read of the current text for every Fatwa result on this page.
  const fatwaText =
    outcome.state === 'results'
      ? await currentFatwaHitText(outcome.results.hits)
      : new Map<string, FatwaHitDisplay>();

  return (
    <FatwaFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.fatwa, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">{t('search.intro')}</p>
      </div>

      <Panel>
        <form
          method="get"
          action={fatwaSectionPath(locale, 'search')}
          role="search"
          aria-label={title}
          className="flex flex-col gap-4"
        >
          <Field
            id="fatwa-search-q"
            label={searchT('queryLabel')}
            help={searchT('queryHelp')}
          >
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
          <div className="flex flex-wrap items-center gap-4">
            <Button>{searchT('submit')}</Button>
            {q === '' ? null : (
              <TextLink href={fatwaSectionPath(locale, 'search')}>
                {searchT('clear')}
              </TextLink>
            )}
          </div>
        </form>
      </Panel>

      <FatwaResults
        outcome={outcome}
        locale={locale}
        searchT={searchT}
        q={q}
        fatwaText={fatwaText}
      />
    </FatwaFrame>
  );
}

function FatwaResults({
  outcome,
  locale,
  searchT,
  q,
  fatwaText,
}: {
  readonly outcome: SearchOutcome;
  readonly locale: Locale;
  readonly searchT: SearchTranslator;
  readonly q: string;
  readonly fatwaText: ReadonlyMap<string, FatwaHitDisplay>;
}) {
  switch (outcome.state) {
    case 'initial':
      return null;
    case 'invalid':
      // The unified page's own wording for each refusal, so the two searches
      // explain a malformed query identically.
      return (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <p className="font-medium text-[color:var(--color-error)]">
            {searchT('invalidTitle')}
          </p>
          <ul className="list-disc ps-5 text-[color:var(--color-error)]">
            {outcome.issues.map((key) => (
              <li key={key}>{searchT(`issues.${key}` as 'issues.type')}</li>
            ))}
          </ul>
        </div>
      );
    case 'unavailable':
      return <Alert tone="error">{searchT('unavailable')}</Alert>;
    case 'results': {
      const { results } = outcome;
      const words = q.trim();
      return (
        <section className="flex flex-col gap-5" aria-labelledby="fatwa-results">
          <h2 id="fatwa-results" className="sr-only">
            {searchT('resultsLabel')}
          </h2>
          <p role="status" className="text-sm text-[color:var(--color-foreground-muted)]">
            {results.capped
              ? searchT('resultsCapped', { count: SEARCH_RESULT_CEILING, query: words })
              : results.total > 0
                ? searchT('results', { count: results.total, query: words })
                : null}
          </p>
          {results.hits.length === 0 ? (
            <EmptyState>{searchT('noResults', { query: words })}</EmptyState>
          ) : (
            <ol aria-labelledby="fatwa-results" className="flex flex-col gap-4">
              {results.hits.map((hit) => {
                // The CURRENT revision, never the indexed words; a ruling that
                // is no longer public is not shown.
                const display = fatwaText.get(hit.resourceId);
                if (display === undefined) return null;
                const direction = fatwaTextDirection(display.language);
                return (
                  <Panel key={hit.resourceId} as="li">
                    <article className="flex min-w-0 flex-col gap-2">
                      <h3
                        className="text-lg font-semibold wrap-anywhere"
                        lang={display.language}
                        dir={direction}
                      >
                        <a
                          href={rulingHref(locale, display.slug)}
                          className="text-[color:var(--color-action)] underline underline-offset-2"
                        >
                          <Highlighted text={display.title} query={words} />
                        </a>
                      </h3>
                      {display.text === '' ? null : (
                        <p
                          className="text-sm whitespace-pre-wrap wrap-anywhere text-[color:var(--color-foreground-muted)]"
                          lang={display.language}
                          dir={direction}
                        >
                          <Highlighted text={display.text} query={words} />
                        </p>
                      )}
                    </article>
                  </Panel>
                );
              })}
            </ol>
          )}
          {results.pageCount > 1 && results.hits.length > 0 ? (
            <nav
              aria-label={searchT('pagination')}
              className="flex flex-wrap items-center gap-6"
            >
              {results.page > 1 ? (
                <TextLink href={resultsHref(locale, q, results.page - 1)}>
                  {searchT('previous')}
                </TextLink>
              ) : null}
              <span aria-current="page" className="text-sm">
                {searchT('pageStatus', { page: results.page, pages: results.pageCount })}
              </span>
              {results.page < results.pageCount ? (
                <TextLink href={resultsHref(locale, q, results.page + 1)}>
                  {searchT('next')}
                </TextLink>
              ) : null}
            </nav>
          ) : null}
        </section>
      );
    }
  }
}
