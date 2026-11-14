import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';

import { BooksHub } from '@/components/topic-hub/books';
import type { BooksQuery } from '@/components/topic-hub/books-view';
import { CoursesHub } from '@/components/topic-hub/courses';
import type { CoursesQuery } from '@/components/topic-hub/courses-view';
import type { HubDomain, HubLink } from '@/components/topic-hub/domain';
import { ResearchHub } from '@/components/topic-hub/research';
import type { ResearchQuery } from '@/components/topic-hub/research-view';
import { VideosHub } from '@/components/topic-hub/videos';
import type { VideosQuery } from '@/components/topic-hub/videos-view';
import {
  HADITH_BOOKS,
  HADITH_COURSES,
  HADITH_HUBS,
  HADITH_RESEARCH,
  HADITH_VIDEOS,
  type HadithHub,
} from './hubs';
import { HadithFrame, hadithTrail } from './parts';
import { hadithPath } from './presentation';
import { readHadithTopic } from './read';

/**
 * HADITH'S TOPIC HUBS (Hadith Part 1) — `/hadith/books`, `/hadith/videos`,
 * `/hadith/research` and `/hadith/courses`: the shared hubs
 * (`@/components/topic-hub`) on Taxonomy's `hadith` Topic, WITHOUT passage
 * parts.
 *
 * LAYER-4 COMPOSITION, NEVER A HADITH READ. There is no Hadith corpus
 * (OPEN_DECISIONS.md §1.3): the owner declined external hadith corpora, no
 * hadith text or grading is shown, and a grading is never invented. What the
 * section offers is Minhaj-ul-Quran's own material ON Hadith — Library's
 * Works and Research, Media's Videos and Learning's Courses on the `hadith`
 * Topic — each read through its owner's public read and linking to its
 * owner's canonical page. Nothing here reads the Hadith context, so the hubs
 * stand whether or not a collection is activated; the frame still carries the
 * fixture banner while an activation is fixture text. Without the Topic
 * nothing is on Hadith: each hub says so as its empty state, never a 404.
 *
 * EACH HUB LEADS TO THE OTHERS: the header offers the other Explore hubs and
 * the Courses hub reads them alongside; the trail leads back to the landing.
 */

interface HubPageProps<Q> {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly query: Q;
}

/** What every Hadith hub shares: its frame, Topic, title and the ways to the others. */
async function hadithHub(
  locale: Locale,
  availability: HadithAvailability,
  hub: HadithHub,
): Promise<{
  readonly domain: HubDomain;
  readonly others: readonly HubLink[];
  readonly t: Awaited<ReturnType<typeof getTranslations<'hadith'>>>;
}> {
  const [t, parts, topic] = await Promise.all([
    getTranslations({ locale, namespace: 'hadith' }),
    hadithTrail(locale),
    readHadithTopic(locale),
  ]);
  const title = t(`sections.${hub}`);
  return {
    t,
    domain: {
      key: 'hadith',
      locale,
      topicId: topic?.id ?? null,
      title,
      frame: (children: ReactNode) => (
        <HadithFrame
          locale={locale}
          availability={availability}
          trail={[parts.home, parts.hadith, { text: title }]}
        >
          {children}
        </HadithFrame>
      ),
      previous: t('previous'),
      next: t('next'),
    },
    others: HADITH_HUBS.filter((other) => other !== hub).map((other) => ({
      href: hadithPath(locale, other),
      text: t(`sections.${other}`),
    })),
  };
}

export async function HadithBooksPage({
  locale,
  availability,
  query,
}: HubPageProps<BooksQuery>) {
  const { domain, others, t } = await hadithHub(locale, availability, 'books');
  return (
    <BooksHub
      domain={domain}
      scope={HADITH_BOOKS}
      query={query}
      copy={{
        lede: t('booksHub.lede'),
        stat: (count) => t('booksHub.statBooks', { count }),
        listIntro: t('booksHub.listIntro'),
        emptyTitle: t('booksHub.emptyTitle'),
        empty: t('booksHub.empty'),
        noResults: t('booksHub.noResults'),
        about: t('booksHub.about'),
      }}
      actions={others}
      passages={null}
    />
  );
}

export async function HadithVideosPage({
  locale,
  availability,
  query,
}: HubPageProps<VideosQuery>) {
  const { domain, others, t } = await hadithHub(locale, availability, 'videos');
  return (
    <VideosHub
      domain={domain}
      scope={HADITH_VIDEOS}
      query={query}
      copy={{
        lede: t('videosHub.lede'),
        stat: (count) => t('videosHub.statVideos', { count }),
        listIntro: t('videosHub.listIntro'),
        emptyTitle: t('videosHub.emptyTitle'),
        empty: t('videosHub.empty'),
        noResults: t('videosHub.noResults'),
        about: t('videosHub.about'),
      }}
      actions={others}
      passages={null}
    />
  );
}

export async function HadithResearchPage({
  locale,
  availability,
  query,
}: HubPageProps<ResearchQuery>) {
  const { domain, others, t } = await hadithHub(locale, availability, 'research');
  return (
    <ResearchHub
      domain={domain}
      scope={HADITH_RESEARCH}
      query={query}
      copy={{
        lede: t('researchHub.lede'),
        stat: (count) => t('researchHub.statRecords', { count }),
        listIntro: t('researchHub.listIntro'),
        emptyTitle: t('researchHub.emptyTitle'),
        empty: t('researchHub.empty'),
        noResults: t('researchHub.noResults'),
      }}
      actions={others}
    />
  );
}

export async function HadithCoursesPage({
  locale,
  availability,
  query,
}: HubPageProps<CoursesQuery>) {
  const { domain, t } = await hadithHub(locale, availability, 'courses');
  return (
    <CoursesHub
      domain={domain}
      scope={HADITH_COURSES}
      query={query}
      copy={{
        lede: t('coursesHub.lede'),
        stat: (count) => t('coursesHub.statCourses', { count }),
        listIntro: t('coursesHub.listIntro'),
        emptyTitle: t('coursesHub.emptyTitle'),
        empty: t('coursesHub.empty'),
        noResults: t('coursesHub.noResults'),
        pathsIntro: t('coursesHub.pathsIntro'),
        alongsideIntro: t('coursesHub.alongsideIntro'),
      }}
      alongside={(['books', 'videos', 'research'] as const).map((key) => ({
        key,
        href: hadithPath(locale, key),
        title: t(`sections.${key}`),
        body: t(`sectionBody.${key}`),
      }))}
    />
  );
}
