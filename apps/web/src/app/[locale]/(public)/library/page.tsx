import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { libraryReadRuntime, libraryReferenceNames } from '@/composition/library-read';
import { PeriodicalCard, WorkCard } from '@/components/library/cards';
import { CoverStack, LibraryDirectory, LibraryShelf } from '@/components/library/landing';
import { ActionLink, Breadcrumbs, Container, Hero } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library` — the Library landing page (ROUTE_MAP.md §5).
 *
 * COVER-LED (R2, audit F12). The front door shows the books: the newest
 * publications as a shelf, a shelf for each of the Library's largest topics,
 * and the latest magazine issues — then a quiet directory of every other way
 * in (research, reference, periodicals, authors, languages, availability). It
 * lists what exists and nothing else: a shelf with nothing on it is absent,
 * and a deferred capability is never linked (§5.2).
 *
 * THE ONE ENTRY THIS PAGE DOES NOT OWN is Articles. `/library/articles` is
 * Editorial's content at a Library address; this page links to it and knows
 * nothing else about it.
 *
 * DATA-BACKED, SESSION-FREE AND DYNAMIC. Every read is the Library's public
 * reader (`@/composition/library-read`) — the first page of its own listings,
 * bounded — so the page renders per request and a withdrawn book leaves it at
 * once. Nothing here can reach Identity, a session or a cookie.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library'),
    title: t('title'),
    description: t('description'),
  });
}

/** How many topic shelves the landing offers, largest topic first. */
const TOPIC_SHELVES = 3;
/** How many records one shelf holds before linking to the whole set. */
const SHELF = 12;

type DirectoryKey =
  | 'research'
  | 'research-papers'
  | 'publications'
  | 'encyclopedias'
  | 'magazines'
  | 'articles'
  | 'authors'
  | 'topics'
  | 'languages'
  | 'resources'
  | 'downloads'
  | 'sale-points';

/** Every other way in, grouped by what a reader is looking for. */
const DIRECTORY: readonly {
  readonly key: 'books' | 'scholarly' | 'periodicals' | 'access';
  readonly sections: readonly DirectoryKey[];
}[] = [
  { key: 'books', sections: ['authors', 'topics', 'languages'] },
  {
    key: 'scholarly',
    sections: ['research', 'research-papers', 'publications', 'encyclopedias'],
  },
  { key: 'periodicals', sections: ['magazines', 'articles'] },
  { key: 'access', sections: ['resources', 'downloads', 'sale-points'] },
];

export default async function LibraryLandingPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);

  const reads = libraryReadRuntime();
  const [newest, facets, issues] = await Promise.all([
    reads.works({ sort: 'newest', titleLocale: locale }),
    reads.topicFacets(0),
    reads.scholarlyList('magazine-issue', {}),
  ]);
  const topicIds = facets.items.slice(0, TOPIC_SHELVES).map((facet) => facet.id);
  const [references, ...byTopic] = await Promise.all([
    libraryReferenceNames({ personIds: [], topicIds }, locale),
    ...topicIds.map((topic) =>
      reads.works({ topic, sort: 'title', titleLocale: locale }),
    ),
  ]);
  const topicShelves = topicIds.flatMap((id, index) => {
    const topic = references.topics.get(id);
    const works = byTopic[index]?.items ?? [];
    return topic === undefined || works.length === 0 ? [] : [{ id, topic, works }];
  });

  // Covers first on every shelf, each group in the listing's own order.
  const coversFirst = <T extends { readonly cover: unknown }>(items: readonly T[]) => [
    ...items.filter((item) => item.cover !== null),
    ...items.filter((item) => item.cover === null),
  ];
  const books = coversFirst(newest.items).slice(0, SHELF);
  const shelfLabels = {
    previousLabel: t('landing.showPrevious'),
    nextLabel: t('landing.showNext'),
  };

  return (
    <>
      <Container>
        <div className="pt-5">
          <Breadcrumbs
            label={shell('nav.breadcrumbs')}
            trail={[
              { href: localizedPath(locale, ''), text: shell('nav.home') },
              { text: t('title') },
            ]}
          />
        </div>
      </Container>

      <Hero
        variant="split"
        title={t('title')}
        lede={t('description')}
        actions={
          <>
            <ActionLink href={localizedPath(locale, '/library/books')}>
              {t('landing.browseBooks')}
            </ActionLink>
            <ActionLink
              href={localizedPath(locale, '/library/magazines')}
              tone="secondary"
            >
              {t('scholarly.viewAll.magazine')}
            </ActionLink>
          </>
        }
        aside={<CoverStack works={books} />}
      />

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-page)]">
          {books.length === 0 ? null : (
            <LibraryShelf
              id="library-newest"
              heading={t('landing.newest')}
              action={{
                href: localizedPath(locale, '/library/books?sort=newest'),
                text: t('allBooks'),
              }}
              {...shelfLabels}
            >
              {books.map((work) => (
                <WorkCard key={work.id} locale={locale} work={work} />
              ))}
            </LibraryShelf>
          )}

          {topicShelves.map(({ id, topic, works }) => (
            <LibraryShelf
              key={id}
              id={`library-topic-${id}`}
              heading={topic.name}
              action={{
                href: localizedPath(
                  locale,
                  `/library/books?topic=${encodeURIComponent(id)}`,
                ),
                text: t('related.all', { topic: topic.name }),
              }}
              {...shelfLabels}
            >
              {coversFirst(works)
                .slice(0, SHELF)
                .map((work) => (
                  <WorkCard key={work.id} locale={locale} work={work} />
                ))}
            </LibraryShelf>
          ))}

          {issues.items.length === 0 ? null : (
            <LibraryShelf
              id="library-issues"
              heading={t('landing.latestIssues')}
              action={{
                href: localizedPath(locale, '/library/magazines'),
                text: t('scholarly.viewAll.magazine'),
              }}
              {...shelfLabels}
            >
              {issues.items.slice(0, SHELF).map((row) => (
                <PeriodicalCard key={row.id} locale={locale} row={row} t={t} />
              ))}
            </LibraryShelf>
          )}

          <section aria-labelledby="library-directory" className="flex flex-col gap-6">
            <h2 id="library-directory" className="text-heading font-semibold">
              {t('landing.directory')}
            </h2>
            <LibraryDirectory
              groups={DIRECTORY.map((group) => ({
                id: `library-${group.key}`,
                heading: t(`landing.groups.${group.key}.heading`),
                links: group.sections.map((section) => ({
                  href: localizedPath(locale, `/library/${section}`),
                  title: t(`section.${section}`),
                  description: t(`sectionBody.${section}`),
                })),
              }))}
            />
          </section>
        </div>
      </Container>
    </>
  );
}
