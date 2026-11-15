import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import type { TopicWorkFacets } from '@minhaj/contracts/library';

import { libraryReadRuntime, libraryReferenceNames } from '@/composition/library-read';
import { PeriodicalCard, WorkCard } from '@/components/library/cards';
import {
  BrowseWays,
  CoverStack,
  LibraryDirectory,
  LibraryFigures,
  LibraryShelf,
  SubjectHubs,
} from '@/components/library/landing';
import { libraryBooksHref } from '@/components/topic-hub/books-view';
import { languageName } from '@/components/topic-hub/parts';
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
 * LIBRARY PART 1 adds, from ONE read of the whole Library's figures and
 * facets (`topicWorkFacets` with `scope: 'library'`, the very aggregates
 * `/library/books` opens with): the Library at a glance (books, content
 * languages, readable online, downloadable and the span of publication years,
 * each linked to the view it counts); the editors' featured books; the ways
 * in by Topic, content language and author (chips with counts) and by kind;
 * and the Quran's and Hadith's own Books hubs. The topic shelves follow the
 * same facet's largest Topics.
 *
 * THE ONE ENTRY THIS PAGE DOES NOT OWN is Articles. `/library/articles` is
 * Editorial's content at a Library address; this page links to it and knows
 * nothing else about it.
 *
 * DATA-BACKED, SESSION-FREE AND DYNAMIC. Every read is the Library's public
 * reader (`@/composition/library-read`) — the first page of its own listings,
 * bounded — so the page renders per request and a withdrawn book leaves it at
 * once. Nothing here can reach Identity, a session or a cookie.
 *
 * FAIL CLOSED, SHELF BY SHELF. The directory and the hero are code, so a read
 * that fails withholds only its own shelf — never the whole front door behind
 * the error page.
 *
 * SAID ON THE PAGE, not only in a document: titles and descriptions are this
 * platform's descriptive metadata, while a translated EDITION is domain data
 * recorded against a Work (DOMAIN_MODEL.md §10.1) — the hero says so.
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

/**
 * One content read, failing closed: a runtime that cannot be composed (it
 * throws before any promise exists) and a read that rejects both answer
 * `empty`, so only that shelf is withheld.
 */
async function orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch {
    return empty;
  }
}

/** How many topic shelves the landing offers, largest topic first. */
const TOPIC_SHELVES = 3;
/** How many records one shelf holds before linking to the whole set. */
const SHELF = 12;
/** How many chips one way in offers before linking to its whole browse. */
const WAY_CHIPS = 10;
/** The kinds of resource the Library holds, as the "by kind" way in names them. */
const KINDS = [
  'books',
  'research',
  'research-papers',
  'publications',
  'magazines',
  'encyclopedias',
  'articles',
] as const;

type DirectoryKey =
  | 'books'
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
  { key: 'books', sections: ['books', 'authors', 'topics', 'languages'] },
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

  const whole = { scope: 'library', titleLocale: locale } as const;
  const [newest, facets, featured, issues] = await Promise.all([
    orEmpty(
      async () =>
        (await libraryReadRuntime().works({ sort: 'newest', titleLocale: locale })).items,
      [],
    ),
    orEmpty<TopicWorkFacets | null>(
      () => libraryReadRuntime().topicWorkFacets(whole),
      null,
    ),
    orEmpty(
      async () =>
        (
          await libraryReadRuntime().topicWorks({
            ...whole,
            featured: true,
            limit: SHELF,
          })
        ).items,
      [],
    ),
    orEmpty(
      async () => (await libraryReadRuntime().scholarlyList('magazine-issue', {})).items,
      [],
    ),
  ]);
  const topicFacets = facets?.topics.items ?? [];
  const topicIds = topicFacets.slice(0, WAY_CHIPS).map((facet) => facet.id);
  const personFacets = facets?.contributors.items.slice(0, WAY_CHIPS) ?? [];
  const [references, ...byTopic] = await Promise.all([
    orEmpty(
      () =>
        libraryReferenceNames(
          { personIds: personFacets.map((facet) => facet.id), topicIds },
          locale,
        ),
      null,
    ),
    ...topicIds.slice(0, TOPIC_SHELVES).map((topic) =>
      orEmpty(
        async () =>
          (
            await libraryReadRuntime().works({
              topic,
              sort: 'title',
              titleLocale: locale,
            })
          ).items,
        [],
      ),
    ),
  ]);
  const topicShelves = topicIds.slice(0, TOPIC_SHELVES).flatMap((id, index) => {
    const topic = references?.topics.get(id);
    const works = byTopic[index] ?? [];
    return topic === undefined || works.length === 0 ? [] : [{ id, topic, works }];
  });

  // Covers first on every shelf, each group in the listing's own order.
  const coversFirst = <T extends { readonly cover: unknown }>(items: readonly T[]) => [
    ...items.filter((item) => item.cover !== null),
    ...items.filter((item) => item.cover === null),
  ];
  const books = coversFirst(newest).slice(0, SHELF);
  const shelfLabels = {
    previousLabel: t('landing.showPrevious'),
    nextLabel: t('landing.showNext'),
  };

  // THE LIBRARY AT A GLANCE — each figure the count `/library/books` opens
  // with, linked to the view it counts; a zero is not stated.
  const hub = facets?.hub ?? null;
  const year = (value: number) =>
    new Intl.NumberFormat(locale, { useGrouping: false }).format(value);
  const stats =
    hub === null || hub.works === 0
      ? []
      : [
          {
            value: hub.works,
            label: t('landing.stats.books', { count: hub.works }),
            href: localizedPath(locale, '/library/books'),
          },
          ...(hub.languages < 2
            ? []
            : [
                {
                  value: hub.languages,
                  label: t('landing.stats.languages', { count: hub.languages }),
                  href: localizedPath(locale, '/library/languages'),
                },
              ]),
          ...(hub.readable === 0
            ? []
            : [
                {
                  value: hub.readable,
                  label: t('landing.stats.readable', { count: hub.readable }),
                  href: libraryBooksHref(locale, { library: { readable: true } }),
                },
              ]),
          ...(hub.downloadable === 0
            ? []
            : [
                {
                  value: hub.downloadable,
                  label: t('landing.stats.downloadable', { count: hub.downloadable }),
                  href: libraryBooksHref(locale, { library: { downloadable: true } }),
                },
              ]),
          ...(hub.earliest === null || hub.latest === null || hub.earliest === hub.latest
            ? []
            : [
                {
                  value: `${year(hub.earliest)}–${year(hub.latest)}`,
                  label: t('landing.stats.years'),
                },
              ]),
        ];

  // THE WAYS IN, each chip the number of books choosing it would show.
  const ways = [
    {
      key: 'topics',
      heading: t('landing.find.topics'),
      chips: topicIds.flatMap((id) => {
        const topic = references?.topics.get(id);
        const facet = topicFacets.find((entry) => entry.id === id);
        return topic === undefined || facet === undefined
          ? []
          : [
              {
                href: libraryBooksHref(locale, { library: { topic: id } }),
                text: topic.name,
                count: facet.works,
              },
            ];
      }),
      all: {
        href: localizedPath(locale, '/library/topics'),
        text: t('landing.find.allTopics'),
      },
    },
    {
      key: 'languages',
      heading: t('landing.find.languages'),
      chips: (facets?.languages.items ?? []).slice(0, WAY_CHIPS).map((facet) => ({
        href: libraryBooksHref(locale, { language: facet.id }),
        text: languageName(facet.id, locale),
        count: facet.works,
      })),
      all: {
        href: localizedPath(locale, '/library/languages'),
        text: t('landing.find.allLanguages'),
      },
    },
    {
      key: 'authors',
      heading: t('landing.find.authors'),
      chips: personFacets.flatMap((facet) => {
        const person = references?.people.get(facet.id);
        return person === undefined
          ? []
          : [
              {
                href: libraryBooksHref(locale, { contributor: facet.id }),
                text: person.name,
                count: facet.works,
              },
            ];
      }),
      all: {
        href: localizedPath(locale, '/library/authors'),
        text: t('landing.find.allAuthors'),
      },
    },
    {
      key: 'kinds',
      heading: t('landing.find.kinds'),
      chips: KINDS.map((kind) => ({
        href: localizedPath(locale, `/library/${kind}`),
        text: t(`section.${kind}`),
      })),
      all: {
        href: localizedPath(locale, '/library/resources'),
        text: t('landing.allResources'),
      },
    },
  ];

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
            <ActionLink
              href={localizedPath(locale, '/library/resources')}
              tone="secondary"
            >
              {t('landing.allResources')}
            </ActionLink>
          </>
        }
        aside={<CoverStack works={books} />}
      >
        <p className="max-w-[var(--measure-prose)] border-s-2 border-accent-rule ps-3 text-sm text-foreground-muted">
          {t('metadataNotice')}
        </p>
      </Hero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-page)]">
          <LibraryFigures
            id="library-figures"
            heading={t('landing.stats.heading')}
            stats={stats}
          />

          {featured.length === 0 ? null : (
            <LibraryShelf
              id="library-featured"
              heading={t('landing.featured')}
              action={{
                href: localizedPath(locale, '/library/books'),
                text: t('allBooks'),
              }}
              {...shelfLabels}
            >
              {coversFirst(featured).map((work) => (
                <WorkCard key={work.id} locale={locale} work={work} />
              ))}
            </LibraryShelf>
          )}

          {books.length === 0 ? null : (
            <LibraryShelf
              id="library-newest"
              heading={t('landing.newest')}
              action={{
                href: libraryBooksHref(locale, { sort: 'newest' }),
                text: t('allBooks'),
              }}
              {...shelfLabels}
            >
              {books.map((work) => (
                <WorkCard key={work.id} locale={locale} work={work} />
              ))}
            </LibraryShelf>
          )}

          <BrowseWays
            id="library-find"
            heading={t('landing.find.heading')}
            intro={t('landing.find.intro')}
            ways={ways}
          />

          {topicShelves.map(({ id, topic, works }) => (
            <LibraryShelf
              key={id}
              id={`library-topic-${id}`}
              heading={topic.name}
              action={{
                href: libraryBooksHref(locale, { library: { topic: id } }),
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

          <SubjectHubs
            id="library-subjects"
            heading={t('landing.subjects.heading')}
            intro={t('landing.subjects.intro')}
            hubs={[
              {
                href: localizedPath(locale, '/quran/books'),
                title: t('landing.subjects.quran.title'),
                body: t('landing.subjects.quran.body'),
              },
              {
                href: localizedPath(locale, '/hadith/books'),
                title: t('landing.subjects.hadith.title'),
                body: t('landing.subjects.hadith.body'),
              },
            ]}
          />

          {issues.length === 0 ? null : (
            <LibraryShelf
              id="library-issues"
              heading={t('landing.latestIssues')}
              action={{
                href: localizedPath(locale, '/library/magazines'),
                text: t('scholarly.viewAll.magazine'),
              }}
              {...shelfLabels}
            >
              {issues.slice(0, SHELF).map((row) => (
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
                intro: t(`landing.groups.${group.key}.intro`),
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
