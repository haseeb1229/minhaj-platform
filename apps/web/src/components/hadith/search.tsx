import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RESULT_CEILING,
  type SearchHit,
} from '@minhaj/contracts/search';
import type { SearchOutcome } from '@minhaj/search';

import { contentLanguages, type ContentLanguage } from '@/composition/public-references';
import { searchReadRuntime } from '@/composition/search-read';
import { Highlighted } from '@/components/search/highlighted';
import { hadithHitKey, type HadithHitDisplay } from '@/components/search/hadith-hit';
import { currentHadithHitText } from '@/components/search/hadith-hit-text';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import {
  HadithFrame,
  collectionLabels,
  hadithTrail,
  languageOf,
  type HadithTranslator,
} from './parts';
import { citationHref, hadithPath, hadithSearchRequest } from './presentation';

/**
 * `/hadith/search` — Hadith search over the shared Search Foundation
 * (ROUTE_MAP.md §3.4, §9.5).
 *
 * THE SAME SERVICE AS `/search`, RESTRICTED TO ONE KIND. The page hands the
 * visitor's `q` and `page` to the unified search service with the type fixed to
 * `hadith`; no other parameter is passed through, so nothing a URL carries can
 * widen the search to another kind. Throttling happens before this page
 * renders, in the request proxy, exactly as for `/search`.
 *
 * THE CITATION IS THE RESULT. Each hit is one public citation, linked to its
 * short canonical address. Its text is labelled as the original or as a
 * translation in a named language, and marked with that language and
 * direction. A translation is never presented as the original.
 *
 * SIGNED OUT, NOINDEX, NEVER CACHED — a results page is a view of a query.
 */

type SearchTranslator = Awaited<ReturnType<typeof getTranslations<'search'>>>;
type Query = Record<string, string | string[] | undefined>;
type Labels = Awaited<ReturnType<typeof collectionLabels>>;

function resultsHref(locale: string, q: string, page: number): string {
  const search = new URLSearchParams();
  if (q !== '') search.set('q', q);
  if (page > 1) search.set('page', String(page));
  const text = search.toString();
  return `${hadithPath(locale, 'search')}${text === '' ? '' : `?${text}`}`;
}

export async function HadithSearchPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const searchT = await getTranslations({ locale, namespace: 'search' });
  const parts = await hadithTrail(locale);
  const [outcome, languages, labels] = await Promise.all([
    searchReadRuntime().search(hadithSearchRequest(query), { locale }),
    contentLanguages(),
    collectionLabels(locale),
  ]);
  const title = t('sections.search');
  const q = outcome.form.q;
  // ONE read of the current text for every Hadith result on this page.
  const hadithText =
    outcome.state === 'results'
      ? await currentHadithHitText(outcome.results.hits)
      : new Map<string, HadithHitDisplay>();

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">{t('search.intro')}</p>
      </div>

      <Panel>
        <form
          method="get"
          action={hadithPath(locale, 'search')}
          role="search"
          aria-label={title}
          className="flex flex-col gap-4"
        >
          <Field id="hadith-search-q" label={t('search.label')} help={t('search.help')}>
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
            <Button>{t('search.submit')}</Button>
            {q === '' ? null : (
              <TextLink href={hadithPath(locale, 'search')}>{t('search.clear')}</TextLink>
            )}
          </div>
        </form>
      </Panel>

      <HadithResults
        outcome={outcome}
        locale={locale}
        languages={languages}
        labels={labels}
        t={t}
        searchT={searchT}
        q={q}
        hadithText={hadithText}
      />
    </HadithFrame>
  );
}

function HadithResults({
  outcome,
  locale,
  languages,
  labels,
  t,
  searchT,
  q,
  hadithText,
}: {
  readonly outcome: SearchOutcome;
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly labels: Labels;
  readonly t: HadithTranslator;
  readonly searchT: SearchTranslator;
  readonly q: string;
  readonly hadithText: ReadonlyMap<string, HadithHitDisplay>;
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
        <section className="flex flex-col gap-5" aria-labelledby="hadith-results">
          <h2 id="hadith-results" className="sr-only">
            {t('search.results')}
          </h2>
          <p role="status" className="text-sm text-[color:var(--color-foreground-muted)]">
            {results.capped
              ? t('search.capped', { count: SEARCH_RESULT_CEILING, query: words })
              : results.total > 0
                ? t('search.count', { count: results.total, query: words })
                : null}
          </p>
          {results.hits.length === 0 ? (
            <EmptyState>{t('search.none', { query: words })}</EmptyState>
          ) : (
            <ol aria-labelledby="hadith-results" className="flex flex-col gap-4">
              {results.hits.map((hit) => {
                // The CURRENT text, never the indexed summary; a citation with
                // no current public record is not public now and is not shown.
                const display = hadithText.get(hadithHitKey(hit));
                return display === undefined ? null : (
                  <HadithHit
                    key={`${hit.resourceId}:${hit.textLanguage}`}
                    hit={hit}
                    display={display}
                    locale={locale}
                    languages={languages}
                    labels={labels}
                    t={t}
                    query={words}
                  />
                );
              })}
            </ol>
          )}
          {results.pageCount > 1 && results.hits.length > 0 ? (
            <nav
              aria-label={t('search.pages')}
              className="flex flex-wrap items-center gap-6"
            >
              {results.page > 1 ? (
                <TextLink href={resultsHref(locale, q, results.page - 1)}>
                  {t('previous')}
                </TextLink>
              ) : null}
              <span aria-current="page" className="text-sm">
                {t('search.pageStatus', { page: results.page, pages: results.pageCount })}
              </span>
              {results.page < results.pageCount ? (
                <TextLink href={resultsHref(locale, q, results.page + 1)}>
                  {t('next')}
                </TextLink>
              ) : null}
            </nav>
          ) : null}
        </section>
      );
    }
  }
}

/**
 * One citation result: its collection and number as the link to its canonical
 * address, then its matching text in a group labelled as the original or as a
 * translation, marked with its own language.
 */
function HadithHit({
  hit,
  display,
  locale,
  languages,
  labels,
  t,
  query,
}: {
  readonly hit: SearchHit;
  readonly display: HadithHitDisplay;
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly labels: Labels;
  readonly t: HadithTranslator;
  readonly query: string;
}) {
  const language = languageOf(languages, display.language);
  const label =
    display.layer === 'original'
      ? t('original')
      : t('translations.item', { language: language.name });
  const name = labels.get(display.collectionSlug) ?? {
    text: display.collectionSlug,
    locale: 'en',
  };
  const id = `hit-${hit.resourceId}-${hit.textLanguage}`;

  return (
    <Panel as="li">
      <article className="flex min-w-0 flex-col gap-2">
        <h3 className="text-lg font-semibold wrap-anywhere">
          <a
            href={citationHref(locale, display.collectionSlug, display.number)}
            className="text-[color:var(--color-action)] underline underline-offset-2"
          >
            <span lang={name.locale}>{name.text}</span>{' '}
            {t('number', { number: display.number })}
          </a>
        </h3>
        {display.text === '' ? null : (
          <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
            <p id={id}>
              <StatusBadge tone="neutral">{label}</StatusBadge>
            </p>
            <p
              lang={language.code}
              dir={language.direction}
              className={`whitespace-pre-wrap wrap-anywhere ${
                display.layer === 'original' ? 'text-xl leading-loose' : 'text-sm'
              }`}
            >
              <Highlighted text={display.text} query={query} />
            </p>
          </div>
        )}
      </article>
    </Panel>
  );
}
