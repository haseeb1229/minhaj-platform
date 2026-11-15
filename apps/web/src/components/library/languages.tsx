import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { LibraryKindCount } from '@minhaj/contracts/library';

import { libraryContentLanguages, libraryReadRuntime } from '@/composition/library-read';
import { ExploreHero, languageName } from '@/components/topic-hub/parts';
import { EmptyState } from '@/components/ui';
import { BrowseFrame, ClosingNote, KindLinks } from './browse-parts';

/**
 * `/library/languages` — THE LIBRARY BY CONTENT LANGUAGE (Library Part 2;
 * ROUTE_MAP.md §3.6): the languages the Library's records are WRITTEN in —
 * never the interface language, which filters nothing (§1.5). Library counts
 * its public records per content language and kind (`languageHoldings`, one
 * grouped read: a Work once per language one of its published Editions is
 * in, a dated record in its own); Taxonomy names each language in its own
 * script and says its direction, and the interface names it too. Every count
 * leads to that kind's listing in the language (`kindHref`). Most-held first.
 * One address: the page takes no parameter.
 */
export async function LibraryLanguagesPage({ locale }: { readonly locale: Locale }) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const [holdings, vocabulary] = await Promise.all([
    libraryReadRuntime().languageHoldings(),
    libraryContentLanguages(),
  ]);

  const sum = (kinds: readonly LibraryKindCount[]) =>
    kinds.reduce((total, entry) => total + entry.count, 0);
  const rows = holdings
    .map((entry) => {
      const known = vocabulary.get(entry.language);
      const own = known?.name ?? entry.language;
      const named = languageName(entry.language, locale);
      return {
        code: entry.language,
        // The language's OWN name, from Taxonomy, in its own script and
        // direction; a code when Taxonomy has none (a truthful answer).
        own,
        direction: known?.direction ?? null,
        // …and its name in the interface language, when that says more.
        named: named === own || named === entry.language ? null : named,
        kinds: entry.kinds,
        total: sum(entry.kinds),
      };
    })
    .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  const records = rows.reduce((total, row) => total + row.total, 0);
  const title = t('section.languages');

  return (
    <BrowseFrame
      locale={locale}
      breadcrumbLabel={shell('nav.breadcrumbs')}
      home={shell('nav.home')}
      library={t('title')}
      title={title}
    >
      <ExploreHero
        eyebrow={t('title')}
        title={title}
        lede={t('browse.languages.lede')}
        stats={
          rows.length === 0
            ? []
            : [
                {
                  value: rows.length,
                  label: t('browse.languages.stat', { count: rows.length }),
                },
                {
                  value: records,
                  label: t('browse.languages.statRecords', { count: records }),
                },
              ]
        }
        actions={[
          { href: localizedPath(locale, '/library/topics'), text: t('section.topics') },
          { href: localizedPath(locale, '/library/authors'), text: t('section.authors') },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="globe"
          title={t('browse.languages.emptyTitle')}
          action={{
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          }}
        >
          {t('browse.languages.empty')}
        </EmptyState>
      ) : (
        <ul
          aria-label={title}
          className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 md:grid-cols-2 xl:grid-cols-3"
        >
          {rows.map((row) => (
            <li
              key={row.code}
              className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <h2
                  className="text-heading font-semibold wrap-anywhere"
                  lang={row.code}
                  {...(row.direction === null ? {} : { dir: row.direction })}
                >
                  {row.own}
                </h2>
                <p className="text-sm text-foreground-muted">
                  {row.named === null ? null : <span>{row.named} · </span>}
                  <span className="tabular-nums">
                    {t('browse.records', { count: row.total })}
                  </span>
                </p>
              </div>
              <KindLinks
                locale={locale}
                label={t('browse.inLanguage', { name: row.named ?? row.own })}
                kinds={row.kinds}
                filter={{ language: row.code }}
                text={(entry) => t(`browse.kind.${entry.kind}`, { count: entry.count })}
              />
            </li>
          ))}
        </ul>
      )}

      <ClosingNote
        text={t('browse.languages.about')}
        links={[
          {
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          },
          {
            href: localizedPath(locale, '/library/resources'),
            text: t('landing.allResources'),
          },
        ]}
      />
    </BrowseFrame>
  );
}
