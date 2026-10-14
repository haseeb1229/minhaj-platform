import type { Metadata } from 'next';
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
  Container,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextInput,
  TextLink,
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
 * 22), and
 * Search for everything else
 * classified under it. Each later domain adds its own section when it ships; nothing here renders an empty frame for a domain that
 * has not, and a delivered section with nothing on this topic is not rendered
 * either (ROUTE_MAP.md §5.2).
 *
 * LIBRARY'S PUBLIC READS ARE THE AUTHORITY, never the search index: each section
 * is one bounded, topic-filtered page of that owner's own public listing.
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
  const labelLocale = topic.label.resolvedLocale;
  const labelDirection = directionOf(labelLocale);

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
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

        <Prose>
          <PageHeading>
            <span lang={labelLocale} dir={labelDirection}>
              {topic.label.name}
            </span>
          </PageHeading>
          {topic.label.fallback ? <Alert tone="info">{t('fallback')}</Alert> : null}
          {topic.label.description === null ? null : (
            <p lang={labelLocale} dir={labelDirection}>
              {topic.label.description}
            </p>
          )}
        </Prose>

        <Panel>
          <form
            method="get"
            action={`/${locale}/search`}
            role="search"
            aria-label={t('searchWithin')}
            className="flex flex-col gap-3"
          >
            <SectionHeading>{t('searchWithin')}</SectionHeading>
            <input type="hidden" name="topic" value={topic.slug} />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="topic-search" className="text-sm font-medium">
                  {t('searchLabel')}
                </label>
                <TextInput id="topic-search" type="search" name="q" maxLength={200} />
              </div>
              <Button>{t('searchSubmit')}</Button>
            </div>
          </form>
        </Panel>

        {children.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="topic-children">
            <h2 id="topic-children" className="text-lg font-semibold">
              {t('subtopics')}
            </h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {children.map((child) => (
                <li key={child.id}>
                  <TextLink href={`/${locale}/topics/${encodeURIComponent(child.slug)}`}>
                    {child.label.name}
                  </TextLink>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* PHASE 18 — the public ayat assigned to this topic, from Quran's own
            public reader, each linked to its canonical citation; nothing while
            no corpus is active or the topic has no public Ayah. Fixture text
            carries the fixture banner. */}
        <QuranTopicSection
          locale={locale}
          topic={topic}
          heading={t('quran')}
          headingId="topic-quran"
        />

        {/* PHASE 19 — the public Hadith citations assigned to this topic, from
            Hadith's own public reader, each linked to its short canonical
            citation; nothing while no collection is activated or the topic has
            no public citation. Fixture text carries the fixture banner. */}
        <HadithTopicSection
          locale={locale}
          topic={topic}
          heading={t('hadith')}
          headingId="topic-hadith"
        />

        {/* PHASE 20 — the published rulings on this topic, from Fatwa's own
            public reader, each linked to its canonical address; nothing while
            the service is not activated or no published ruling is on the
            topic. Fixture text carries the fixture banner. */}
        <FatwaTopicSection
          locale={locale}
          topic={topic}
          heading={t('fatwa')}
          headingId="topic-fatwa"
        />

        {/* PHASE 22 — the published Courses on this topic, from Learning's own
            public catalogue, each linked to its canonical page, with a link to
            the catalogue filtered by this topic; nothing when no published
            Course is on it. */}
        <CourseTopicSection
          locale={locale}
          topic={topic}
          heading={t('courses')}
          headingId="topic-courses"
          more={t('allCourses')}
        />

        {books.items.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="topic-books">
            <h2 id="topic-books" className="text-lg font-semibold">
              {t('books')}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {books.items.slice(0, BOOK_PREVIEW).map((work) => {
                const label = labelFor(work, locale);
                return (
                  <Panel as="li" key={work.id}>
                    <p
                      className="font-semibold break-words"
                      lang={label.locale}
                      dir={directionOf(label.locale)}
                    >
                      <TextLink href={workPath(locale, work.slug)}>
                        {label.title}
                      </TextLink>
                    </p>
                  </Panel>
                );
              })}
            </ul>
            <p>
              <TextLink
                href={`/${locale}/library/books?topic=${encodeURIComponent(topic.id)}`}
              >
                {t('allBooks')}
              </TextLink>
            </p>
          </section>
        )}

        {SCHOLARLY_SECTIONS.map((kind, index) => {
          const page = scholarly[index];
          if (page === undefined || page.items.length === 0) return null;
          const headingId = `topic-${kind}`;
          return (
            <section
              key={kind}
              className="flex flex-col gap-4"
              aria-labelledby={headingId}
            >
              <h2 id={headingId} className="text-lg font-semibold">
                {t(`sections.${kind}`)}
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {page.items.slice(0, BOOK_PREVIEW).map((row) => {
                  const label = scholarlyLabel(row, locale);
                  return (
                    <Panel as="li" key={row.id}>
                      <p
                        className="font-semibold break-words"
                        lang={label.locale}
                        dir={directionOf(label.locale)}
                      >
                        <TextLink href={listingHref(locale, row)}>{label.title}</TextLink>
                      </p>
                    </Panel>
                  );
                })}
              </ul>
              {kind === 'magazine-issue' ? null : (
                <p>
                  <TextLink
                    href={scholarlyQueryPath(scholarlyListPath(locale, kind), {
                      offset: 0,
                      language: null,
                      topic: topic.id,
                      from: null,
                      to: null,
                    })}
                  >
                    {t(`all.${kind}`)}
                  </TextLink>
                </p>
              )}
            </section>
          );
        })}

        {/* PHASE 10 — Media adds its own section, read from Media's public
            listing (never from the search index), and renders nothing when no
            published Video is on this topic. */}
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

        {/* PHASE 11 — the published non-Quran audio on this topic, from Media's
            public listing, likewise nothing when there is none. */}
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

        {/* PHASE 13 — the most recent published News of all four families on
            this topic, from Editorial's own public read, likewise nothing when
            there is none. The search form above reaches the rest. */}
        <NewsTopicSection
          locale={locale}
          topicId={topic.id}
          heading={t('news')}
          headingId="topic-news"
        />

        {/* PHASE 14 — the upcoming Events on this topic, or the most recent past
            ones when none is ahead, from Editorial's own public read; nothing
            when the topic has no Event. Events are not searchable yet. */}
        <EventTopicSection
          locale={locale}
          topicId={topic.id}
          heading={t('events')}
          headingId="topic-events"
        />

        {/* PHASE 15 — the most recently published Collections on this topic, a
            bounded preview from Editorial's own public read with a link to
            every Collection; nothing when the topic has none. Collections are
            not searchable. */}
        <CollectionTopicSection
          locale={locale}
          topicId={topic.id}
          heading={t('collections')}
          headingId="topic-collections"
        />
      </div>
    </Container>
  );
}
