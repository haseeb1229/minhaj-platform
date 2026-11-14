import type { BooksScope } from '@/components/topic-hub/books-view';
import type { CoursesScope } from '@/components/topic-hub/courses-view';
import type { ResearchScope } from '@/components/topic-hub/research-view';
import type { VideosScope } from '@/components/topic-hub/videos-view';

/**
 * WHERE THE QURAN'S TOPIC HUBS STAND (Quran Parts 10–13; scopes since Hadith
 * Part 1). The Books and Videos hubs carry the Quran passage parts — the
 * shelves, a Surah and the Quran order — because Library's Works and Media's
 * Videos record the Quran passages they explain; Research and Courses have no
 * passage model.
 */
export const QURAN_BOOKS: BooksScope = Object.freeze({
  path: '/quran/books',
  passages: true,
});
export const QURAN_VIDEOS: VideosScope = Object.freeze({
  path: '/quran/videos',
  passages: true,
});
export const QURAN_RESEARCH: ResearchScope = Object.freeze({ path: '/quran/research' });
export const QURAN_COURSES: CoursesScope = Object.freeze({ path: '/quran/courses' });
