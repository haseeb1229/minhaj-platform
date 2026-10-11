import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { QuranAvailability } from '@minhaj/contracts/quran';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RESULT_CEILING,
  type SearchHit,
} from '@minhaj/contracts/search';
import type { SearchOutcome } from '@minhaj/search';

import { contentLanguages, type ContentLanguage } from '@/composition/public-references';
import { searchReadRuntime } from '@/composition/search-read';
import { Highlighted } from '@/components/search/highlighted';
import {
  citationOfResource,
  quranHitKey,
  type QuranHitDisplay,
} from '@/components/search/quran-hit';
import { currentQuranHitText } from '@/components/search/quran-hit-text';
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
import { QuranFrame, languageOf, quranTrail } from './parts';
import { quranPath, quranSearchRequest } from './presentation';

/**
 * `/quran/search` — Quran search over the shared Search Foundation
 * (ROUTE_MAP.md §3.3, §9.5; Phase 18 §4).
 *
 * THE SAME SERVICE AS `/search`, RESTRICTED TO ONE KIND. The page hands the
 * visitor's `q` and `page` to the unified search service with the type fixed to
 * `quran-ayah`; no other parameter is passed through, so nothing a URL carries
 * can widen the search to another kind. Throttling happens before this page
 * renders, in the request proxy, exactly as for `/search`.
 *
 * THE CITATION IS THE RESULT. Each hit is one Ayah, linked to its canonical
 * address. Its text is labelled with the layer it is — the Arabic, or a
 * translation or transliteration in a named language — and marked with that
 * language and direction. A translation is never presented as the Arabic.
 *
 * SIGNED OUT, NOINDEX, NEVER CACHED — a results page is a view of a query.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type SearchTranslator = Awaited<ReturnType<typeof getTranslations<'search'>>>;
type Query = Record<string, string | string[] | undefined>;

function resultsHref(locale: string, q: string, page: number): string {
  const search = new URLSearchParams();
  if (q !== '') search.set('q', q);
  if (page > 1) search.set('page', String(page));
  const text = search.toString();
  return `${quranPath(locale, 'search')}${text === '' ? '' : `?${text}`}`;
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
  const [outcome, languages] = await Promise.all([
    searchReadRuntime().search(quranSearchRequest(query), { locale }),
    contentLanguages(),
  ]);
  const title = t('sections.search');
  const q = outcome.form.q;
  // ONE read of the current text for every Quran result on this page.
  const quranText =
    outcome.state === 'results'
      ? await currentQuranHitText(outcome.results.hits)
      : new Map<string, QuranHitDisplay>();

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">{t('search.intro')}</p>
      </div>

      <Panel>
        <form
          method="get"
          action={quranPath(locale, 'search')}
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
          <div className="flex flex-wrap items-center gap-4">
            <Button>{t('search.submit')}</Button>
            {q === '' ? null : (
              <TextLink href={quranPath(locale, 'search')}>{t('search.clear')}</TextLink>
            )}
          </div>
        </form>
      </Panel>

      <QuranResults
        outcome={outcome}
        locale={locale}
        languages={languages}
        t={t}
        searchT={searchT}
        q={q}
        quranText={quranText}
      />
    </QuranFrame>
  );
}

function QuranResults({
  outcome,
  locale,
  languages,
  t,
  searchT,
  q,
  quranText,
}: {
  readonly outcome: SearchOutcome;
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: QuranTranslator;
  readonly searchT: SearchTranslator;
  readonly q: string;
  readonly quranText: ReadonlyMap<string, QuranHitDisplay>;
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
        <section className="flex flex-col gap-5" aria-labelledby="quran-results">
          <h2 id="quran-results" className="sr-only">
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
            <ol aria-labelledby="quran-results" className="flex flex-col gap-4">
              {results.hits.map((hit) => {
                // The CURRENT text, never the indexed summary; an Ayah with no
                // current record is not public now and is not shown.
                const display = quranText.get(quranHitKey(hit));
                return display === undefined ? null : (
                  <QuranHit
                    key={`${hit.resourceId}:${hit.textLanguage}`}
                    hit={hit}
                    display={display}
                    locale={locale}
                    languages={languages}
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
 * One Ayah result: its citation as the link, then its matching text in a group
 * labelled with the layer it is and marked with its own language. The Arabic is
 * `lang="ar" dir="rtl"`; a layer carries its own content language.
 */
function QuranHit({
  hit,
  display,
  locale,
  languages,
  t,
  query,
}: {
  readonly hit: SearchHit;
  readonly display: QuranHitDisplay;
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: QuranTranslator;
  readonly query: string;
}) {
  const ref = citationOfResource(hit.resourceId);
  const arabic = display.layer === 'arabic';
  const language = arabic
    ? { code: 'ar', name: '', direction: 'rtl' as const }
    : languageOf(languages, display.language);
  const label = arabic
    ? t('layer.arabic')
    : t('search.layer', { language: language.name });
  const id = `hit-${hit.resourceId.replace(':', '-')}-${hit.textLanguage}`;

  return (
    <Panel as="li">
      <article className="flex min-w-0 flex-col gap-2">
        <h3 className="text-lg font-semibold">
          <a
            href={`/${locale}${hit.href}`}
            className="text-[color:var(--color-action)] underline underline-offset-2"
          >
            {ref === null
              ? hit.title
              : t('ayahName', { surah: ref.surah, ayah: ref.ayah })}
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
              className={`break-words ${arabic ? 'text-xl leading-loose' : 'text-sm'}`}
            >
              <Highlighted text={display.text} query={query} />
            </p>
          </div>
        )}
      </article>
    </Panel>
  );
}
