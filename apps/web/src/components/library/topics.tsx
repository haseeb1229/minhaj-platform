import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { LibraryKindCount } from '@minhaj/contracts/library';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { libraryReadRuntime } from '@/composition/library-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { directionOf } from '@/config/locale';
import { ExploreHero } from '@/components/topic-hub/parts';
import { EmptyState, SectionHeader } from '@/components/ui';
import { BrowseFrame, ClosingNote, KindLinks } from './browse-parts';

/**
 * `/library/topics` — THE LIBRARY BY SUBJECT (Library Part 2; ROUTE_MAP.md
 * §3.6). Taxonomy owns the Topics and their tree: the page asks it for the
 * active tree in the reader's locale, then asks Library how many public
 * records of each kind are filed under each of them (`topicHoldings`, one
 * grouped read) — composition at Layer 4, so Library holds only Topic
 * identifiers and Taxonomy never reads a Library table.
 *
 * Grouped by subject area (each root of the tree), each Topic with its
 * holdings by kind; every count leads to that kind's listing narrowed to the
 * Topic (`kindHref` — `libraryBooksHref` for books), and every Topic to its
 * Topic page. A Topic with nothing in the Library is not listed; an area with
 * none is not either. One address: the page takes no parameter.
 */
export async function LibraryTopicsPage({ locale }: { readonly locale: Locale }) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const tree = await taxonomyRuntime().taxonomy.listTree({
    locale,
    includeArchived: false,
  });
  const holdings = new Map(
    (await libraryReadRuntime().topicHoldings(tree.map((topic) => topic.id))).map(
      (entry) => [entry.topic, entry.kinds],
    ),
  );

  const byId = new Map(tree.map((topic) => [topic.id, topic]));
  const rootOf = (topic: TopicView): TopicView => {
    let current = topic;
    for (let guard = 0; current.parentId !== null && guard < 16; guard += 1) {
      const parent = byId.get(current.parentId);
      if (parent === undefined) break;
      current = parent;
    }
    return current;
  };
  const trailOf = (topic: TopicView): string[] => {
    const names: string[] = [];
    let parentId = topic.parentId;
    for (let guard = 0; parentId !== null && guard < 16; guard += 1) {
      const parent = byId.get(parentId);
      if (parent === undefined) break;
      names.unshift(parent.label.name);
      parentId = parent.parentId;
    }
    return names;
  };

  // The tree's own order (roots by position, each subtree depth-first) is kept.
  const areas: { root: TopicView; topics: TopicView[] }[] = [];
  for (const topic of tree) {
    if (!holdings.has(topic.id)) continue;
    const root = rootOf(topic);
    const area = areas.find((entry) => entry.root.id === root.id);
    if (area === undefined) areas.push({ root, topics: [topic] });
    else area.topics.push(topic);
  }

  const sum = (kinds: readonly LibraryKindCount[]) =>
    kinds.reduce((total, entry) => total + entry.count, 0);
  const topicsWith = areas.reduce((total, area) => total + area.topics.length, 0);
  const filed = [...holdings.values()].reduce((total, kinds) => total + sum(kinds), 0);
  const title = t('section.topics');
  const topicPath = (topic: TopicView) =>
    localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`);

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
        lede={t('browse.topics.lede')}
        stats={
          topicsWith === 0
            ? []
            : [
                {
                  value: topicsWith,
                  label: t('browse.topics.stat', { count: topicsWith }),
                },
                { value: filed, label: t('browse.topics.statRecords', { count: filed }) },
              ]
        }
        actions={[
          { href: localizedPath(locale, '/topics'), text: t('browse.topics.allTopics') },
          {
            href: localizedPath(locale, '/library/languages'),
            text: t('section.languages'),
          },
          { href: localizedPath(locale, '/library/authors'), text: t('section.authors') },
        ]}
      />

      {areas.length === 0 ? (
        <EmptyState
          icon="book"
          title={t('browse.topics.emptyTitle')}
          action={{
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          }}
        >
          {t('browse.topics.empty')}
        </EmptyState>
      ) : (
        <>
          {areas.length < 2 ? null : (
            <nav aria-labelledby="library-topics-jump" className="flex flex-col gap-2">
              <h2 id="library-topics-jump" className="text-sm font-semibold">
                {t('browse.topics.jump')}
              </h2>
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {areas.map((area) => (
                  <li key={area.root.id} className="min-w-0">
                    <a
                      href={`#topic-area-${area.root.slug}`}
                      lang={area.root.label.resolvedLocale}
                      dir={directionOf(area.root.label.resolvedLocale)}
                      className="inline-flex min-h-11 max-w-full items-center rounded-control border border-border px-3 text-sm font-medium wrap-anywhere text-action no-underline hover:border-action"
                    >
                      {area.root.label.name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {areas.map((area) => {
            const id = `topic-area-${area.root.slug}`;
            return (
              <section
                key={area.root.id}
                aria-labelledby={`${id}-heading`}
                id={id}
                className="flex scroll-mt-24 flex-col gap-5"
              >
                <SectionHeader
                  id={`${id}-heading`}
                  heading={
                    <span
                      lang={area.root.label.resolvedLocale}
                      dir={directionOf(area.root.label.resolvedLocale)}
                    >
                      {area.root.label.name}
                    </span>
                  }
                  action={{ href: topicPath(area.root), text: t('browse.topics.open') }}
                />
                <ul className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 md:grid-cols-2">
                  {area.topics.map((topic) => {
                    const kinds = holdings.get(topic.id) ?? [];
                    const trail = trailOf(topic);
                    const own = {
                      lang: topic.label.resolvedLocale,
                      dir: directionOf(topic.label.resolvedLocale),
                    };
                    return (
                      <li
                        key={topic.id}
                        className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          {trail.length === 0 ? null : (
                            <p
                              className="text-caption wrap-anywhere text-foreground-muted"
                              {...own}
                            >
                              {trail.join(' › ')}
                            </p>
                          )}
                          <h3
                            className="text-subheading font-semibold wrap-anywhere"
                            {...own}
                          >
                            <a
                              href={topicPath(topic)}
                              className="text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
                            >
                              {topic.label.name}
                            </a>
                          </h3>
                          <p className="text-sm text-foreground-muted tabular-nums">
                            {t('browse.records', { count: sum(kinds) })}
                          </p>
                        </div>
                        <KindLinks
                          locale={locale}
                          label={t('browse.holds', { name: topic.label.name })}
                          kinds={kinds}
                          filter={{ topic: topic.id }}
                          text={(entry) =>
                            t(`browse.kind.${entry.kind}`, { count: entry.count })
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}

      <ClosingNote
        text={t('browse.topics.about')}
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
