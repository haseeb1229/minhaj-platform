import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
} from '@/composition/library-read';
import { EmptyState, LinkCard, MetaRow, TextLink } from '@/components/ui';
import { ListingFrame, Pager } from './frame';
import { booksPath, readLibraryQuery } from './presentation';

/**
 * `/library/authors`, `/library/topics` and `/library/languages` — the three
 * navigational browses, in ONE implementation.
 *
 * THEY ARE PROJECTIONS, NOT NEW RESOURCES (§32, §33). Library counts its own
 * published Works by contributor, by Topic and by content language, and then asks
 * the OWNER of each vocabulary for the name. It creates no `LibraryAuthor`, no
 * duplicate biography, no Library-owned Topic and no Library-owned Language —
 * "Library no longer owns Author" (DOMAIN_MODEL.md §10.1), and Taxonomy owns
 * Topic and Language.
 *
 * WHY ONE COMPONENT RATHER THAN THREE PAGES. The three differ in exactly two
 * respects: which facet read they call, and where a row links. Written three times
 * they would drift — and the one that drifted would be the one whose pagination
 * stopped carrying an offset, or whose empty state stopped appearing.
 *
 * TWO QUERIES PER PAGE, NOT ONE PER ROW. The facet read aggregates in SQL and the
 * names for the whole page are resolved in a single call to the owning context.
 * That is the difference between two round trips and fifty-one (§49).
 *
 * A CONTRIBUTOR ROW LINKS TO PEOPLE'S CANONICAL ADDRESS, not to the Library alias.
 * `/library/authors/{slug}` exists and 301s to `/people/{slug}`; it is there for
 * links already in the world, and sending a visitor through a redirect this page
 * could have skipped would be a hop for nothing (ROUTE_MAP.md §9.1 rule 3).
 *
 * AN UNRESOLVED IDENTIFIER IS OMITTED. If the owning context does not return a
 * published record for it, there is no name to render, and a bare identifier in a
 * browse list would be worse than a shorter list.
 */

type FacetKind = 'authors' | 'topics' | 'languages';

/** How many facet rows one page shows. Mirrors the reader's own facet page size. */
const FACET_PAGE = 50;

export async function FacetBrowse({
  locale,
  kind,
  query,
}: {
  readonly locale: Locale;
  readonly kind: FacetKind;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const { offset } = readLibraryQuery(query);
  const reader = libraryReadRuntime();

  const page =
    kind === 'authors'
      ? await reader.contributorFacets(offset)
      : kind === 'topics'
        ? await reader.topicFacets(offset)
        : await reader.languageFacets(offset);

  // Resolved from the OWNER, for the whole page at once. Languages come from
  // Taxonomy's vocabulary; contributors and Topics from their own contexts.
  const [references, languages] = await Promise.all([
    kind === 'languages'
      ? Promise.resolve({
          people: new Map<string, { slug: string; name: string }>(),
          topics: new Map<string, { slug: string; name: string }>(),
        })
      : libraryReferenceNames(
          {
            personIds: kind === 'authors' ? page.items.map((facet) => facet.id) : [],
            topicIds: kind === 'topics' ? page.items.map((facet) => facet.id) : [],
          },
          locale,
        ),
    kind === 'languages'
      ? libraryContentLanguages()
      : Promise.resolve(new Map<string, { name: string; direction: 'ltr' | 'rtl' }>()),
  ]);

  const rows = page.items
    .map((facet) => {
      if (kind === 'authors') {
        const person = references.people.get(facet.id);
        return person === undefined
          ? null
          : {
              key: facet.id,
              name: person.name,
              works: facet.works,
              browse: booksPath(locale, readLibraryQuery({}), {
                contributor: facet.id,
              }),
              canonical: `/${locale}/people/${encodeURIComponent(person.slug)}`,
              lang: null,
              dir: null,
            };
      }

      if (kind === 'topics') {
        const topic = references.topics.get(facet.id);
        return topic === undefined
          ? null
          : {
              key: facet.id,
              name: topic.name,
              works: facet.works,
              browse: booksPath(locale, readLibraryQuery({}), { topic: facet.id }),
              canonical: null,
              lang: null,
              dir: null,
            };
      }

      const language = languages.get(facet.id);
      return {
        key: facet.id,
        // The language's OWN name, from Taxonomy, falling back to the code. A
        // code is a truthful answer; an invented English name would not be.
        name: language?.name ?? facet.id,
        works: facet.works,
        browse: booksPath(locale, readLibraryQuery({}), { language: facet.id }),
        canonical: null,
        lang: facet.id,
        dir: language?.direction ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const title = t(`section.${kind}`);

  return (
    <ListingFrame
      breadcrumbLabel={shell('nav.breadcrumbs')}
      trail={[
        { href: `/${locale}`, text: shell('nav.home') },
        { href: `/${locale}/library`, text: t('title') },
        { text: title },
      ]}
      title={title}
      lede={t(`sectionBody.${kind}`)}
    >
      {rows.length === 0 ? (
        <EmptyState>{t('emptyFacet')}</EmptyState>
      ) : (
        <ul
          aria-label={title}
          className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3"
        >
          {rows.map((row) =>
            row.canonical === null ? (
              /*
               * A Topic or a language is ONE destination — its filtered book
               * listing — so the whole card is that one link.
               */
              <LinkCard
                key={row.key}
                href={row.browse}
                title={row.name}
                headingLevel="h2"
                {...(row.lang === null ? {} : { lang: row.lang })}
                {...(row.dir === null ? {} : { dir: row.dir })}
                meta={<MetaRow items={[t('facetWorks', { count: String(row.works) })]} />}
              />
            ) : (
              /*
               * A contributor has TWO destinations — their canonical People
               * profile and their books — so this card holds two ordinary
               * links rather than one stretched one.
               */
              <li
                key={row.key}
                className="flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
              >
                <h2 className="text-subheading font-semibold wrap-anywhere">
                  <TextLink href={row.canonical}>{row.name}</TextLink>
                </h2>
                <p className="mt-auto pt-1 text-sm">
                  <TextLink href={row.browse}>
                    {t('facetWorks', { count: String(row.works) })}
                  </TextLink>
                </p>
              </li>
            ),
          )}
        </ul>
      )}

      <Pager
        label={title}
        previous={
          offset > 0
            ? `/${locale}/library/${kind}?offset=${String(Math.max(0, offset - FACET_PAGE))}`
            : null
        }
        next={
          page.hasMore
            ? `/${locale}/library/${kind}?offset=${String(offset + FACET_PAGE)}`
            : null
        }
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
    </ListingFrame>
  );
}
