import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { TopicView } from '@minhaj/contracts/taxonomy';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import type { ScholarlyKind } from '@minhaj/contracts/library';

import { libraryReadRuntime } from '@/composition/library-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { labelFor, workPath } from '@/components/library/presentation';
import { listingHref } from '@/components/library/scholarly';
import { CollectionTopicSection } from '@/components/editorial/collections';
import { EventTopicSection } from '@/components/editorial/events';
import { NewsTopicSection } from '@/components/editorial/news';
import { AudioPreview } from '@/components/media/listen';
import { VideoPreview } from '@/components/media/watch';
import { FatwaTopicSection } from '@/components/fatwa/topics';
import { HadithTopicSection } from '@/components/hadith/topics';
import { CourseTopicSection } from '@/components/learning/landing';
import { QuranTopicSection } from '@/components/quran/topics';
import {
  scholarlyLabel,
  scholarlyListPath,
  scholarlyQueryPath,
} from '@/components/library/scholarly-presentation';
import {
  Alert,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  LinkCard,
  MetaRow,
  PageHero,
  SectionHeader,
  TextInput,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { topicBreadcrumb } from '@/contexts/taxonomy';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/topics/{slug}` — the canonical topic hub (ROUTE_MAP.md §3.1).
 *
 * DELIVERED BY PHASE 17, MINIMALLY AND HONESTLY. Topic search results must be
 * "navigable results into `/topics/{slug}`" (DELIVERY_PLAN.md Phase 17), and no
 * earlier phase delivered the route. It is Layer-4 composition over owners that
 * EXIST: Taxonomy for the topic and its place in the hierarchy, Library for the
 * books — and, since Phase 9, the research, research papers, publications,
 * encyclopedias, magazines and magazine issues — classified under it, Media for
 * the published Videos on it (Phase 10), Editorial for the published News of
 * every family on it (Phase 13), Quran for the public ayat on it (Phase 18),
 * Hadith for the public citations on it (Phase 19), Fatwa for the published
 * rulings on it (Phase 20), Learning for the published Courses on it (Phase
 * 22), and Search for everything else classified under it. Each later domain
 * adds its own section when it ships; nothing here renders an empty frame for a
 * domain that has not, and a delivered section with nothing on this topic is
 * not rendered either (ROUTE_MAP.md §5.2).
 *
 * A MAP OF ONE NODE. The page reads as the topic's place in a knowledge graph:
 * its position in the taxonomy (broader, narrower and neighbouring topics, all
 * from the one tree read), then each owner's material in a labelled band. A
 * band whose owners render nothing is not displayed — the domain sections
 * decide for themselves whether they have anything, so the band follows them
 * (`has-[section]`) rather than guessing.
 *
 * LIBRARY'S PUBLIC READS ARE THE AUTHORITY, never the search index: each section
 * is one bounded, topic-filtered page of that owner's own public listing. The
 * counts shown are of those pages — "25+" when the owner says there is more.
 *
 * TAXONOMY OWNS THE TOPIC. This page decides nothing about it: an archived topic
 * is a 404, and the slug is immutable, so there is no history to redirect.
 *
 * SIGNED OUT, DYNAMIC. The hub reads mutable published data through public
 * readers only, and a cached copy would keep offering books since withdrawn.
 */
export const dynamic = 'force-dynamic';

interface TopicParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

async function loadTopic(locale: Locale, slug: string): Promise<TopicView | null> {
  if (!topicSlugSchema.safeParse(slug).success) return null;
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({ slug, locale });
  return topic !== null && topic.status === 'active' ? topic : null;
}

export async function generateMetadata({ params }: TopicParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const topic = await loadTopic(locale, slug);
  if (topic === null) return {};

  return contentMetadata({
    locale,
    contentLocales: topic.translatedLocales,
    primaryLocale: 'en',
    pathFor: (target) => `/${target}/topics/${encodeURIComponent(topic.slug)}`,
    title: topic.label.name,
    ...(topic.label.description === null
      ? {}
      : { description: topic.label.description.slice(0, 160) }),
  });
}

/** How many books the hub previews before linking to the full filtered list. */
const BOOK_PREVIEW = 6;

/** How many neighbouring topics the map names before "All topics" takes over. */
const NEIGHBOUR_PREVIEW = 12;

/**
 * Phase 9's sections, in the Library's order. An issue has no listing of its
 * own, so its section previews and the topic search below covers the rest.
 */
const SCHOLARLY_SECTIONS: readonly ScholarlyKind[] = [
  'research',
  'research-paper',
  'publication',
  'encyclopedia',
  'magazine',
  'magazine-issue',
];

/** A topic as a chip: its hub, its name, and its language when it fell back. */
function chipOf(locale: Locale, topic: TopicView) {
  return {
    href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
    text: topic.label.name,
    ...(topic.label.resolvedLocale === locale
      ? {}
      : { lang: topic.label.resolvedLocale }),
  };
}

/** A page's size as a reader should read it: exact, or "at least" when more exist. */
function countOf(page: {
  readonly items: readonly unknown[];
  readonly hasMore: boolean;
}) {
  return `${String(page.items.length)}${page.hasMore ? '+' : ''}`;
}

export default async function TopicPage({ params }: TopicParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;

  const topic = await loadTopic(locale, slug);
  if (topic === null) notFound();

  const t = await getTranslations({ locale, namespace: 'topics' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const [tree, books, ...scholarly] = await Promise.all([
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    libraryReadRuntime().works({ topic: topic.id }),
    ...SCHOLARLY_SECTIONS.map((kind) =>
      libraryReadRuntime().scholarlyList(kind, { topic: topic.id }),
    ),
  ]);

  const ancestors = topicBreadcrumb(topic, tree);
  const children = tree.filter((entry) => entry.parentId === topic.id);
  const neighbours = tree
    .filter((entry) => entry.parentId === topic.parentId && entry.id !== topic.id)
    .slice(0, NEIGHBOUR_PREVIEW);
  const labelLocale = topic.label.resolvedLocale;
  const labelDirection = directionOf(labelLocale);

  const scholarlyPages = SCHOLARLY_SECTIONS.flatMap((kind, index) => {
    const page = scholarly[index];
    return page === undefined || page.items.length === 0 ? [] : [{ kind, page }];
  });
  const libraryCounts = [
    ...(books.items.length === 0
      ? []
      : [t('hub.count.books', { count: countOf(books) })]),
    ...scholarlyPages.map(({ kind, page }) =>
      t(`hub.count.${kind}`, { count: countOf(page) }),
    ),
  ];

  const map = [
    { key: 'broader', label: t('hub.broader'), topics: ancestors },
    { key: 'narrower', label: t('subtopics'), topics: children },
    { key: 'alongside', label: t('hub.alongside'), topics: neighbours },
  ].filter((group) => group.topics.length > 0);

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs
            label={shell('nav.breadcrumbs')}
            trail={[
              { href: `/${locale}`, text: shell('nav.home') },
              { href: `/${locale}/topics`, text: t('title') },
              ...ancestors.map((ancestor) => ({
                href: `/${locale}/topics/${encodeURIComponent(ancestor.slug)}`,
                text: ancestor.label.name,
              })),
              { text: topic.label.name },
            ]}
          />
        </div>
      </Container>

      <PageHero
        eyebrow={t('hub.eyebrow')}
        title={
          <span lang={labelLocale} dir={labelDirection}>
            {topic.label.name}
          </span>
        }
        {...(topic.label.description === null
          ? {}
          : {
              lede: (
                <span lang={labelLocale} dir={labelDirection}>
                  {topic.label.description}
                </span>
              ),
            })}
      >
        {topic.label.fallback ? <Alert tone="info">{t('fallback')}</Alert> : null}

        <form
          method="get"
          action={`/${locale}/search`}
          role="search"
          aria-label={t('searchWithin')}
          className="flex w-full max-w-2xl flex-col gap-2 pt-1"
        >
          <input type="hidden" name="topic" value={topic.slug} />
          <label htmlFor="topic-search" className="text-sm font-medium">
            {t('searchLabel')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <TextInput id="topic-search" type="search" name="q" maxLength={200} />
            </div>
            <Button>{t('searchSubmit')}</Button>
          </div>
        </form>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {map.length === 0 ? null : (
            <section aria-labelledby="topic-map" className="flex flex-col gap-5">
              <SectionHeader
                id="topic-map"
                heading={t('hub.map')}
                intro={t('hub.mapIntro')}
                action={{ href: `/${locale}/topics`, text: t('hub.allTopics') }}
              />
              <div className="flex flex-col gap-5">
                {map.map((group) => (
                  <div
                    key={group.key}
                    className="grid gap-2 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6"
                  >
                    <h3 className="text-caption pt-2.5 font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-foreground-muted)] uppercase">
                      {group.label}
                    </h3>
                    <TopicChips
                      label={group.label}
                      topics={group.topics.map((entry) => chipOf(locale, entry))}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* PHASES 18 AND 19 — the public ayat and Hadith citations assigned
              to this topic, from each owner's own public reader and each
              linked to its canonical citation; nothing while no corpus is
              active or the topic has nothing public. Fixture text carries the
              fixture banner. Two owners, two sections: the band only groups
              them visually. */}
          <Band label={t('hub.bands.sources')}>
            <QuranTopicSection
              locale={locale}
              topic={topic}
              heading={t('quran')}
              headingId="topic-quran"
            />
            <HadithTopicSection
              locale={locale}
              topic={topic}
              heading={t('hadith')}
              headingId="topic-hadith"
            />
          </Band>

          {/* PHASES 20 AND 22 — the published rulings on this topic, from
              Fatwa's own public reader (nothing while the service is not
              activated; fixture text carries the banner), and the published
              Courses on it, from Learning's own public catalogue with a link to
              the catalogue filtered by this topic. */}
          <Band label={t('hub.bands.guidance')}>
            <FatwaTopicSection
              locale={locale}
              topic={topic}
              heading={t('fatwa')}
              headingId="topic-fatwa"
            />
            <CourseTopicSection
              locale={locale}
              topic={topic}
              heading={t('courses')}
              headingId="topic-courses"
              more={t('allCourses')}
            />
          </Band>

          {libraryCounts.length === 0 ? null : (
            <Band
              label={t('hub.bands.library')}
              summary={<MetaRow items={libraryCounts} />}
            >
              {books.items.length === 0 ? null : (
                <section className="flex flex-col gap-5" aria-labelledby="topic-books">
                  <SectionHeader
                    id="topic-books"
                    heading={t('books')}
                    action={{
                      href: `/${locale}/library/books?topic=${encodeURIComponent(topic.id)}`,
                      text: t('allBooks'),
                    }}
                  />
                  <CardGrid>
                    {books.items.slice(0, BOOK_PREVIEW).map((work) => {
                      const label = labelFor(work, locale);
                      return (
                        <LinkCard
                          key={work.id}
                          href={workPath(locale, work.slug)}
                          title={label.title}
                          description={label.description}
                          lang={label.locale}
                          dir={directionOf(label.locale)}
                        />
                      );
                    })}
                  </CardGrid>
                </section>
              )}

              {scholarlyPages.map(({ kind, page }) => {
                const headingId = `topic-${kind}`;
                return (
                  <section
                    key={kind}
                    className="flex flex-col gap-5"
                    aria-labelledby={headingId}
                  >
                    <SectionHeader
                      id={headingId}
                      heading={t(`sections.${kind}`)}
                      {...(kind === 'magazine-issue'
                        ? {}
                        : {
                            action: {
                              href: scholarlyQueryPath(scholarlyListPath(locale, kind), {
                                offset: 0,
                                language: null,
                                topic: topic.id,
                                from: null,
                                to: null,
                              }),
                              text: t(`all.${kind}`),
                            },
                          })}
                    />
                    <CardGrid>
                      {page.items.slice(0, BOOK_PREVIEW).map((row) => {
                        const label = scholarlyLabel(row, locale);
                        return (
                          <LinkCard
                            key={row.id}
                            href={listingHref(locale, row)}
                            title={label.title}
                            description={label.summary}
                            lang={label.locale}
                            dir={directionOf(label.locale)}
                          />
                        );
                      })}
                    </CardGrid>
                  </section>
                );
              })}
            </Band>
          )}

          {/* PHASES 10 AND 11 — Media's own sections, read from Media's public
              listing (never from the search index): the published Videos and
              the published non-Quran audio on this topic, each nothing when
              there is none. */}
          <Band label={t('hub.bands.media')}>
            <VideoPreview
              locale={locale}
              filter={{ topic: topic.id }}
              heading={t('videos')}
              headingId="topic-videos"
              more={{
                href: `/${locale}/watch/topics/${encodeURIComponent(topic.slug)}`,
                text: t('allVideos'),
              }}
            />
            <AudioPreview
              locale={locale}
              filter={{ topic: topic.id }}
              heading={t('audio')}
              headingId="topic-audio"
              more={{
                href: `/${locale}/listen/lectures?topic=${encodeURIComponent(topic.id)}`,
                text: t('allAudio'),
              }}
            />
          </Band>

          {/* PHASES 13, 14 AND 15 — Editorial's own public reads: the most
              recent published News of all four families on this topic, its
              upcoming Events (or the most recent past ones when none is ahead),
              and its most recently published Collections; each nothing when
              there is none. The search form above reaches the rest of the News;
              Events and Collections are not searchable. */}
          <Band label={t('hub.bands.editorial')}>
            <NewsTopicSection
              locale={locale}
              topicId={topic.id}
              heading={t('news')}
              headingId="topic-news"
            />
            <EventTopicSection
              locale={locale}
              topicId={topic.id}
              heading={t('events')}
              headingId="topic-events"
            />
            <CollectionTopicSection
              locale={locale}
              topicId={topic.id}
              heading={t('collections')}
              headingId="topic-collections"
            />
          </Band>
        </div>
      </Container>
    </>
  );
}

/**
 * One stratum of the hub: a quiet label over the owners' sections it groups.
 *
 * The owners decide whether they have anything on this topic, and render
 * nothing when they do not — so the band is displayed only while it holds a
 * `section` (`has-[section]`). An empty band is neither seen nor announced;
 * its label is not a heading, so the outline stays the owners' own `h2`s.
 */
function Band({
  label,
  summary,
  children,
}: {
  readonly label: string;
  readonly summary?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="hidden flex-col gap-[var(--space-stack)] has-[section]:flex">
      <div className="flex flex-col gap-1.5">
        <p className="text-caption flex items-center gap-3 font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase after:h-px after:flex-1 after:bg-[color:var(--color-accent-rule)]">
          {label}
        </p>
        {summary}
      </div>
      <div className="flex flex-col gap-[var(--space-section)]">{children}</div>
    </div>
  );
}
