import type { BooksScope } from '@/components/topic-hub/books-view';
import type { CoursesScope } from '@/components/topic-hub/courses-view';
import type { ResearchScope } from '@/components/topic-hub/research-view';
import type { VideosScope } from '@/components/topic-hub/videos-view';

/**
 * WHERE HADITH'S TOPIC HUBS STAND (Hadith Part 1). None carries passage
 * parts: there is no Hadith corpus (OPEN_DECISIONS.md §1.3) and no hadith
 * reference model for a Work or a Video, so no shelf, no reference chip and no
 * reference order is offered — nothing is invented. Each hub is the owner's
 * public material on Taxonomy's `hadith` Topic alone.
 */
export const HADITH_BOOKS: BooksScope = Object.freeze({
  path: '/hadith/books',
  passages: false,
});
export const HADITH_VIDEOS: VideosScope = Object.freeze({
  path: '/hadith/videos',
  passages: false,
});
export const HADITH_RESEARCH: ResearchScope = Object.freeze({ path: '/hadith/research' });
export const HADITH_COURSES: CoursesScope = Object.freeze({ path: '/hadith/courses' });

/** The four hubs, in the menu's order — Explore's three, then Learn's one. */
export const HADITH_HUBS = Object.freeze([
  'books',
  'videos',
  'research',
  'courses',
] as const);
export type HadithHub = (typeof HADITH_HUBS)[number];
