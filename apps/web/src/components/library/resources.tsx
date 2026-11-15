import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { LibraryBrowseKind, LibraryHoldings } from '@minhaj/contracts/library';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { ExploreHero } from '@/components/topic-hub/parts';
import { CardGrid, LinkCard, MetaRow, SectionHeader } from '@/components/ui';
import { BrowseFrame, ClosingNote } from './browse-parts';

/**
 * `/library/resources` — EVERY KIND OF RECORD THE LIBRARY PUBLISHES (Library
 * Part 2; ROUTE_MAP.md §3.6): a directory, grouped as the Library's own menu
 * is, of Books, Articles, Research, Research papers, Publications,
 * Encyclopedias and Magazines, then the ways in — Downloads, Sale points,
 * Topics, Languages and Authors — each with how many public records it holds
 * and what it holds. One Library read (`holdings`) states every Library
 * figure; Articles are Editorial's, composed here at Layer 4 from its own
 * public count (Library Part 3; until then Editorial offered none and the
 * card said only whether any was published, historical). A kind with nothing yet says so and still
 * leads to its listing, whose own empty state explains.
 *
 * Signed out, always: nothing here reaches Identity or a cookie.
 */

type LibraryTranslator = Awaited<ReturnType<typeof getTranslations<'library'>>>;

interface Entry {
  readonly key: string;
  readonly title: string;
  readonly href: string;
  readonly body: string;
  /** The count line ("12 books"), or null when the kind holds none. */
  readonly count: string | null;
  readonly facts?: readonly string[];
}

export async function LibraryResourcesPage({ locale }: { readonly locale: Locale }) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const [holdings, articles] = await Promise.all([
    libraryReadRuntime().holdings(),
    editorialReadRuntime().articleCount(),
  ]);

  const path = (segment: string) => localizedPath(locale, `/library/${segment}`);
  const counted = (value: number, line: string) => (value === 0 ? null : line);
  const kind = (key: LibraryBrowseKind, value: number) =>
    counted(value, t(`browse.kind.${key}`, { count: value }));

  const records =
    holdings.works +
    holdings.research +
    holdings.researchPapers +
    holdings.publications +
    holdings.encyclopedias +
    holdings.magazines;

  const groups: readonly {
    readonly key: string;
    readonly heading: string;
    readonly intro: string;
    readonly entries: readonly Entry[];
  }[] = [
    {
      key: 'books',
      heading: t('landing.groups.books.heading'),
      intro: t('landing.groups.books.intro'),
      entries: [
        {
          key: 'books',
          title: t('section.books'),
          href: path('books'),
          body: t('sectionBody.books'),
          count: kind('work', holdings.works),
          facts: bookFacts(t, holdings),
        },
      ],
    },
    {
      key: 'scholarly',
      heading: t('landing.groups.scholarly.heading'),
      intro: t('landing.groups.scholarly.intro'),
      entries: [
        {
          key: 'research',
          title: t('section.research'),
          href: path('research'),
          body: t('sectionBody.research'),
          count: kind('research', holdings.research),
        },
        {
          key: 'research-papers',
          title: t('section.research-papers'),
          href: path('research-papers'),
          body: t('sectionBody.research-papers'),
          count: kind('research-paper', holdings.researchPapers),
        },
        {
          key: 'publications',
          title: t('section.publications'),
          href: path('publications'),
          body: t('sectionBody.publications'),
          count: kind('publication', holdings.publications),
        },
        {
          key: 'encyclopedias',
          title: t('section.encyclopedias'),
          href: path('encyclopedias'),
          body: t('sectionBody.encyclopedias'),
          count: kind('encyclopedia', holdings.encyclopedias),
        },
      ],
    },
    {
      key: 'periodicals',
      heading: t('landing.groups.periodicals.heading'),
      intro: t('landing.groups.periodicals.intro'),
      entries: [
        {
          key: 'magazines',
          title: t('section.magazines'),
          href: path('magazines'),
          body: t('sectionBody.magazines'),
          count: kind('magazine', holdings.magazines),
          facts:
            holdings.magazineIssues === 0
              ? []
              : [t('browse.resources.issues', { count: holdings.magazineIssues })],
        },
        {
          key: 'articles',
          title: t('section.articles'),
          href: path('articles'),
          body: t('sectionBody.articles'),
          count:
            articles === 0 ? null : t('browse.resources.articles', { count: articles }),
        },
      ],
    },
    {
      key: 'access',
      heading: t('landing.groups.access.heading'),
      intro: t('landing.groups.access.intro'),
      entries: [
        {
          key: 'downloads',
          title: t('section.downloads'),
          href: path('downloads'),
          body: t('sectionBody.downloads'),
          count: counted(
            holdings.downloadableEditions,
            t('browse.resources.downloads', { count: holdings.downloadableEditions }),
          ),
        },
        {
          key: 'sale-points',
          title: t('section.sale-points'),
          href: path('sale-points'),
          body: t('sectionBody.sale-points'),
          count: counted(
            holdings.salePoints,
            t('browse.resources.salePoints', { count: holdings.salePoints }),
          ),
        },
      ],
    },
    {
      key: 'browse',
      heading: t('browse.resources.browseHeading'),
      intro: t('browse.resources.browseIntro'),
      entries: [
        {
          key: 'topics',
          title: t('section.topics'),
          href: path('topics'),
          body: t('sectionBody.topics'),
          count: counted(
            holdings.topics,
            t('browse.resources.topics', { count: holdings.topics }),
          ),
        },
        {
          key: 'languages',
          title: t('section.languages'),
          href: path('languages'),
          body: t('sectionBody.languages'),
          count: counted(
            holdings.languages,
            t('browse.resources.languages', { count: holdings.languages }),
          ),
        },
        {
          key: 'authors',
          title: t('section.authors'),
          href: path('authors'),
          body: t('sectionBody.authors'),
          count: counted(
            holdings.contributors,
            t('browse.resources.contributors', { count: holdings.contributors }),
          ),
        },
      ],
    },
  ];

  const stats = [
    ...(records === 0
      ? []
      : [{ value: records, label: t('browse.resources.stat', { count: records }) }]),
    ...(holdings.languages === 0
      ? []
      : [
          {
            value: holdings.languages,
            label: t('browse.resources.statLanguages', { count: holdings.languages }),
            href: path('languages'),
          },
        ]),
    ...(holdings.topics === 0
      ? []
      : [
          {
            value: holdings.topics,
            label: t('browse.resources.statTopics', { count: holdings.topics }),
            href: path('topics'),
          },
        ]),
  ];

  return (
    <BrowseFrame
      locale={locale}
      breadcrumbLabel={shell('nav.breadcrumbs')}
      home={shell('nav.home')}
      library={t('title')}
      title={t('section.resources')}
    >
      <ExploreHero
        eyebrow={t('title')}
        title={t('section.resources')}
        lede={t('browse.resources.lede')}
        notice={t('metadataNotice')}
        stats={stats}
        actions={[
          { href: path('books'), text: t('landing.browseBooks') },
          { href: localizedPath(locale, '/library'), text: t('booksPage.libraryHome') },
        ]}
      />

      {groups.map((group) => {
        const id = `resources-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={id} className="flex flex-col gap-5">
            <SectionHeader id={id} heading={group.heading} intro={group.intro} />
            <CardGrid label={group.heading} columns={3}>
              {group.entries.map((entry) => (
                <LinkCard
                  key={entry.key}
                  href={entry.href}
                  title={entry.title}
                  description={entry.body}
                  meta={
                    <div className="flex flex-col gap-1.5">
                      <p
                        className={
                          entry.count === null
                            ? 'text-sm text-foreground-muted'
                            : 'text-sm font-semibold text-accent tabular-nums'
                        }
                      >
                        {entry.count ?? t('browse.resources.none')}
                      </p>
                      {entry.facts === undefined || entry.facts.length === 0 ? null : (
                        <MetaRow items={entry.facts} />
                      )}
                    </div>
                  }
                />
              ))}
            </CardGrid>
          </section>
        );
      })}

      <ClosingNote
        text={t('browse.resources.about')}
        links={[
          { href: path('books'), text: t('landing.browseBooks') },
          { href: localizedPath(locale, '/topics'), text: t('browse.topics.allTopics') },
        ]}
      />
    </BrowseFrame>
  );
}

/** What the Books figure leaves out: editions, reading online and downloads. */
function bookFacts(t: LibraryTranslator, holdings: LibraryHoldings): string[] {
  return [
    ...(holdings.editions === 0
      ? []
      : [t('browse.resources.editions', { count: holdings.editions })]),
    ...(holdings.readableWorks === 0
      ? []
      : [t('browse.resources.readable', { count: holdings.readableWorks })]),
    ...(holdings.downloadableWorks === 0
      ? []
      : [t('browse.resources.downloadable', { count: holdings.downloadableWorks })]),
  ];
}
