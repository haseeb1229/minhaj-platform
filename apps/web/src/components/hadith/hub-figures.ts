import 'server-only';

import { cache } from 'react';

import type { Locale } from '@minhaj/contracts';

import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { booksReadQuery, readBooksQuery } from '@/components/topic-hub/books-view';
import { coursesReadQuery, readCoursesQuery } from '@/components/topic-hub/courses-view';
import {
  readResearchQuery,
  researchReadQuery,
} from '@/components/topic-hub/research-view';
import { readVideosQuery, videosReadQuery } from '@/components/topic-hub/videos-view';
import { HADITH_BOOKS, HADITH_VIDEOS, type HadithHub } from './hubs';
import { readHadithTopic } from './read';

/**
 * HOW MUCH EACH HADITH HUB HOLDS (Hadith Part 2) — the figures the landing,
 * the introduction and the awaiting pages state beside their links to the
 * hubs.
 *
 * THE HUB'S OWN READ, NOT A SECOND COUNT. Each figure is the `total` of the
 * very read its hub makes for its unfiltered first page — Library's
 * `topicWorks` and `topicResearch`, Media's `topicVideos`, Learning's
 * `topicCourses` on Taxonomy's `hadith` Topic, without the Quran passage parts
 * — asked for ONE item, so the number beside a link is exactly what the hub
 * behind it opens with. Nothing of Hadith's is read: there is no Hadith corpus
 * (OPEN_DECISIONS.md §1.3).
 *
 * `null` without the Topic: nothing can be on Hadith, and no figure is stated.
 * Read once per request.
 */
export type HadithHubFigures = Readonly<Record<HadithHub, number>>;

/** The default view of each hub, as the address `/hadith/{hub}` reads it. */
const NO_QUERY = Object.freeze({});

export const readHadithHubFigures = cache(
  async (locale: Locale): Promise<HadithHubFigures | null> => {
    const topic = await readHadithTopic(locale);
    if (topic === null) return null;
    const one = { limit: 1 } as const;
    const [books, videos, research, courses] = await Promise.all([
      libraryReadRuntime().topicWorks({
        ...booksReadQuery(
          HADITH_BOOKS,
          readBooksQuery(HADITH_BOOKS, NO_QUERY),
          topic.id,
          locale,
        ),
        ...one,
      }),
      mediaReadRuntime().topicVideos({
        ...videosReadQuery(
          HADITH_VIDEOS,
          readVideosQuery(HADITH_VIDEOS, NO_QUERY),
          topic.id,
          locale,
        ),
        ...one,
      }),
      libraryReadRuntime().topicResearch({
        ...researchReadQuery(readResearchQuery(NO_QUERY), topic.id, locale),
        ...one,
      }),
      learningReadRuntime().topicCourses({
        ...coursesReadQuery(readCoursesQuery(NO_QUERY), topic.id, locale),
        ...one,
      }),
    ]);
    return {
      books: books.total,
      videos: videos.total,
      research: research.total,
      courses: courses.total,
    };
  },
);
