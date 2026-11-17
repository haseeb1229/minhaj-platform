import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { TopicView } from '@minhaj/contracts/taxonomy';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import type { ScholarlyKind } from '@minhaj/contracts/library';

import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { listingHref } from '@/components/library/scholarly';
import { CollectionTopicSection } from '@/components/editorial/collections';
import { EventTopicSection } from '@/components/editorial/events';
import { NewsTopicSection } from '@/components/editorial/news';
import { AudioPreview } from '@/components/media/listen';
import { FatwaTopicSection } from '@/components/fatwa/topics';
import { HadithTopicSection } from '@/components/hadith/topics';
import { courseBrowseHref } from '@/components/learning/presentation';
import { QuranTopicSection } from '@/components/quran/topics';
import { kindHref } from '@/components/library/browse-view';
import { scholarlyLabel } from '@/components/library/scholarly-presentation';
import { BookShelf } from '@/components/topic-hub/books';
import { CourseShelf } from '@/components/topic-hub/courses';
import { ResearchShelf } from '@/components/topic-hub/research';
import { VideoShelf } from '@/components/topic-hub/videos';
import { watchVideosHref } from '@/components/topic-hub/videos-view';
import {
  Alert,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  Icon,
  LinkCard,
  MetaRow,
  PageHero,
  SectionHeader,
  Stat,
  TextInput,
  TopicChips,
  type IconName,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { topicBreadcrumb } from '@/contexts/taxonomy';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/topics/{slug}` — the canonical topic hub (ROUTE_MAP.md §3.1).
 *
 * DELIVERED BY PHASE 17 and made a cross-domain hub by Learn Part 2. It is
 * Layer-4 composition over owners that EXIST: Taxonomy for the topic and its
 * place in the hierarchy; Learning for the published Courses on it, Library
 * for the books and the research (and, since Phase 9, the publications,
 * encyclopedias, magazines and magazine issues), Media for the published
 * Videos and audio, Editorial for the published News, Events and Collections,
 * Quran for the public ayat, Hadith for the public citations, Fatwa for the
 * published rulings, and Search for everything else classified under it.
 * Nothing here renders an empty frame for a domain with nothing on this topic
 * (ROUTE_MAP.md §5.2).
 *
 * THE SHARED TOPIC READS, AS SHELVES (Learn Part 2). Courses, books, videos and
 * research are each ONE bounded page of the very read the Quran and Hadith
 * hubs are built on — Learning's `topicCourses`, Library's `topicWorks` and
 * `topicResearch`, Media's `topicVideos` — on this Topic, unfiltered; the
 * hero's figures are those reads' own totals, which are also what `/topics`
 * states beside this Topic. Each shelf leads to its owner's own listing
 * filtered by this Topic — or, for the `quran` and `hadith` Topics, to that
 * subject's own hub.
 *
 * A MAP OF ONE NODE. The page reads as the topic's place in a knowledge graph:
 * its position in the taxonomy (broader, narrower and neighbouring topics, all
 * from the one tree read), then each owner's material in a labelled band. A
 * band whose owners render nothing is not displayed — the sections decide for
 * themselves whether they have anything, so the band follows them
 * (`has-[section]`) rather than guessing.
 *
 * THE OWNERS' PUBLIC READS ARE THE AUTHORITY, never the search index.
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
    pathFor: (target) =>
      localizedPath(target, `/topics/${encodeURIComponent(topic.slug)}`),
    title: topic.label.name,
    ...(topic.label.description === null
      ? {}
      : { description: topic.label.description.slice(0, 160) }),
  });
}

/** How many of each owner's records a shelf previews before linking on. */
const SHELF = { courses: 6, books: 6, videos: 6, research: 4 } as const;

/** How many records of the other Library kinds a section previews. */
const SCHOLARLY_PREVIEW = 6;

/** How many neighbouring topics the map names before "All topics" takes over. */
const NEIGHBOUR_PREVIEW = 12;

/**
 * The Library's other Phase-9 kinds, in its order — research and research
 * papers are the Research shelf's. An issue has no listing of its own, so its
 * section previews and the topic search covers the rest.
 */
const SCHOLARLY_SECTIONS: readonly Exclude<
  ScholarlyKind,
  'research' | 'research-paper'
>[] = ['publication', 'encyclopedia', 'magazine', 'magazine-issue'];

/** The subjects whose Topic has a section of its own, with its four hubs. */
const SUBJECTS = ['quran', 'hadith'] as const;
type Subject = (typeof SUBJECTS)[number];
const SUBJECT_HUBS = ['courses', 'books', 'videos', 'research'] as const;
type SubjectHub = (typeof SUBJECT_HUBS)[number];
const HUB_ICONS: Readonly<Record<SubjectHub, IconName>> = {
  courses: 'calendar',
  books: 'book',
  videos: 'video',
  research: 'news',
};

function subjectOf(slug: string): Subject | null {
  return SUBJECTS.find((subject) => subject === slug) ?? null;
}

/** A topic as a chip: its hub, its name, and its language when it fell back. */
function chipOf(locale: Locale, topic: TopicView) {
  return {
    href: localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`),
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
  const subject = subjectOf(topic.slug);

  const library = libraryReadRuntime();
  const [tree, courses, books, videos, research, ...scholarly] = await Promise.all([
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    learningReadRuntime().topicCourses({
      topic: topic.id,
      titleLocale: locale,
      limit: SHELF.courses,
    }),
    library.topicWorks({ topic: topic.id, titleLocale: locale, limit: SHELF.books }),
    mediaReadRuntime().topicVideos({
      topic: topic.id,
      titleLocale: locale,
      limit: SHELF.videos,
    }),
    library.topicResearch({
      topic: topic.id,
      titleLocale: locale,
      limit: SHELF.research,
    }),
    ...SCHOLARLY_SECTIONS.map((kind) => library.scholarlyList(kind, { topic: topic.id })),
  ]);

  const ancestors = topicBreadcrumb(topic, tree);
  const children = tree.filter((entry) => entry.parentId === topic.id);
  const neighbours = tree
    .filter((entry) => entry.parentId === topic.parentId && entry.id !== topic.id)
    .slice(0, NEIGHBOUR_PREVIEW);
  const labelLocale = topic.label.resolvedLocale;
  const labelDirection = directionOf(labelLocale);
  const topicParam = encodeURIComponent(topic.id);

  const scholarlyPages = SCHOLARLY_SECTIONS.flatMap((kind, index) => {
    const page = scholarly[index];
    return page === undefined || page.items.length === 0 ? [] : [{ kind, page }];
  });

  // Where each shelf leads: the subject's own hub for `quran` and `hadith`, the
  // owner's listing filtered by this Topic for every other.
  const subjectHub = (hub: SubjectHub) =>
    subject === null ? null : localizedPath(locale, `/${subject}/${hub}`);
  const onward: Readonly<Record<SubjectHub, string>> = {
    courses: subjectHub('courses') ?? courseBrowseHref(locale, { topic: topic.slug }),
    books:
      subjectHub('books') ?? localizedPath(locale, `/library/books?topic=${topicParam}`),
    videos: subjectHub('videos') ?? watchVideosHref(locale, { topic: topic.id }),
    research: subjectHub('research') ?? kindHref(locale, 'research', { topic: topic.id }),
  };
  const totals: Readonly<Record<SubjectHub, number>> = {
    courses: courses.total,
    books: books.total,
    videos: videos.total,
    research: research.total,
  };
  const figures = SUBJECT_HUBS.filter((key) => totals[key] > 0);

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
              { href: localizedPath(locale, ''), text: shell('nav.home') },
              { href: localizedPath(locale, '/topics'), text: t('title') },
              ...ancestors.map((ancestor) => ({
                href: localizedPath(
                  locale,
                  `/topics/${encodeURIComponent(ancestor.slug)}`,
                ),
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

        {figures.length === 0 ? null : (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {figures.map((key) => (
              <Stat
                key={key}
                value={totals[key]}
                label={t(`hub.stat.${key}`, { count: totals[key] })}
                href={`#topic-${key}`}
              />
            ))}
          </div>
        )}

        <form
          method="get"
          action={localizedPath(locale, '/search')}
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
          {subject === null ? null : (
            <section aria-labelledby="topic-subject" className="flex flex-col gap-5">
              <SectionHeader
                id="topic-subject"
                heading={t(`hub.subject.${subject}.heading`)}
                intro={t(`hub.subject.${subject}.intro`)}
                action={{
                  href: localizedPath(locale, `/${subject}`),
                  text: t(`hub.subject.${subject}.open`),
                }}
              />
              <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-4">
                {SUBJECT_HUBS.map((hub) => (
                  <li
                    key={hub}
                    className="card-surface relative flex min-w-0 flex-col gap-3 rounded-panel border border-accent-rule bg-accent-surface p-5 hover:border-accent"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accent-rule bg-surface-raised text-accent"
                    >
                      <Icon name={HUB_ICONS[hub]} size={20} />
                    </span>
                    <h3 className="text-subheading font-semibold">
                      <a
                        href={localizedPath(locale, `/${subject}/${hub}`)}
                        className="card-link text-foreground no-underline"
                      >
                        {t(`hub.subject.${subject}.hubs.${hub}`)}
                      </a>
                    </h3>
                    <p className="text-sm text-foreground-muted">
                      {t(`hub.subject.hubBody.${hub}`)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {map.length === 0 ? null : (
            <section aria-labelledby="topic-map" className="flex flex-col gap-5">
              <SectionHeader
                id="topic-map"
                heading={t('hub.map')}
                intro={t('hub.mapIntro')}
                action={{
                  href: localizedPath(locale, '/topics'),
                  text: t('hub.allTopics'),
                }}
              />
              <div className="flex flex-col gap-5">
                {map.map((group) => (
                  <div
                    key={group.key}
                    className="grid gap-2 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6"
                  >
                    <h3 className="text-caption pt-2.5 font-semibold tracking-[var(--tracking-eyebrow)] text-foreground-muted uppercase">
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

          {/* LEARN PART 2 — the shared topic reads as shelves: Learning's
              Courses, Library's books and research. Each shelf is the first
              page of its owner's read on this Topic, with the read's own total
              and the way to everything. */}
          <Band label={t('hub.bands.study')}>
            {courses.items.length === 0 ? null : (
              <TopicShelf
                id="topic-courses"
                heading={t('courses')}
                count={t('hub.total.courses', { count: courses.total })}
                more={{ href: onward.courses, text: t('allCourses') }}
              >
                <CourseShelf
                  locale={locale}
                  courses={courses.items}
                  label={t('courses')}
                />
              </TopicShelf>
            )}
            {books.items.length === 0 ? null : (
              <TopicShelf
                id="topic-books"
                heading={t('books')}
                count={t('hub.total.books', { count: books.total })}
                more={{ href: onward.books, text: t('allBooks') }}
              >
                <BookShelf locale={locale} works={books.items} label={t('books')} />
              </TopicShelf>
            )}
            {research.items.length === 0 ? null : (
              <TopicShelf
                id="topic-research"
                heading={t('sections.research')}
                count={t('hub.total.research', { count: research.total })}
                more={{ href: onward.research, text: t('all.research') }}
              >
                <ResearchShelf
                  locale={locale}
                  items={research.items}
                  label={t('sections.research')}
                />
              </TopicShelf>
            )}
          </Band>

          {/* PHASE 20 — the published rulings on this topic, from Fatwa's own
              public reader (nothing while the service is not activated;
              fixture text carries the banner). */}
          <Band label={t('hub.bands.guidance')}>
            <FatwaTopicSection
              locale={locale}
              topic={topic}
              heading={t('fatwa')}
              headingId="topic-fatwa"
            />
          </Band>

          {/* PHASES 10 AND 11 — Media's own reads: the published Videos on
              this topic as a shelf (the shared topic read), and the published
              non-Quran audio; each nothing when there is none. */}
          <Band label={t('hub.bands.media')}>
            {videos.items.length === 0 ? null : (
              <TopicShelf
                id="topic-videos"
                heading={t('videos')}
                count={t('hub.total.videos', { count: videos.total })}
                more={{ href: onward.videos, text: t('allVideos') }}
              >
                <VideoShelf locale={locale} videos={videos.items} label={t('videos')} />
              </TopicShelf>
            )}
            <AudioPreview
              locale={locale}
              filter={{ topic: topic.id }}
              heading={t('audio')}
              headingId="topic-audio"
              more={{
                href: localizedPath(locale, `/listen/lectures?topic=${topicParam}`),
                text: t('allAudio'),
              }}
            />
          </Band>

          {/* PHASE 9 — the Library's other kinds on this topic: one bounded
              page of each kind's own public listing. */}
          {scholarlyPages.length === 0 ? null : (
            <Band
              label={t('hub.bands.library')}
              summary={
                <MetaRow
                  items={scholarlyPages.map(({ kind, page }) =>
                    t(`hub.count.${kind}`, { count: countOf(page) }),
                  )}
                />
              }
            >
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
                              href: kindHref(locale, kind, { topic: topic.id }),
                              text: t(`all.${kind}`),
                            },
                          })}
                    />
                    <CardGrid>
                      {page.items.slice(0, SCHOLARLY_PREVIEW).map((row) => {
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
 * One owner's shelf on this topic: its heading, the read's own total, the way
 * to everything — and the cards the owner's shared component draws. The
 * section's heading carries the identifier the hero's figures link to.
 */
function TopicShelf({
  id,
  heading,
  count,
  more,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly count: string;
  readonly more: { readonly href: string; readonly text: string };
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby={id}>
      <SectionHeader id={id} heading={heading} intro={count} action={more} />
      {children}
    </section>
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
        <p className="text-caption flex items-center gap-3 font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase after:h-px after:flex-1 after:bg-accent-rule">
          {label}
        </p>
        {summary}
      </div>
      <div className="flex flex-col gap-[var(--space-section)]">{children}</div>
    </div>
  );
}
