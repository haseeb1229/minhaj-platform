import { describe, expect, it } from 'vitest';

import { TOPIC_COURSES_PAGE, topicCourseQuerySchema } from '@minhaj/contracts/learning';

import {
  COURSES_MAX_PAGE,
  DEFAULT_COURSES_QUERY,
  byLevel,
  coursesCanonicalRedirect,
  coursesFiltered,
  coursesHref,
  coursesPageCount,
  coursesRange,
  coursesReadQuery,
  levelSteps,
  readCoursesQuery,
} from '../../apps/web/src/components/topic-hub/courses-view.ts';
import { QURAN_COURSES as QURAN } from '../../apps/web/src/components/quran/hubs.ts';
import { HADITH_COURSES as HADITH } from '../../apps/web/src/components/hadith/hubs.ts';

/**
 * Quran Part 13 and Hadith Part 1 — a Courses hub's address rules (the Quran's
 * scope and Hadith's): the view a URL
 * names, the address each control and link builds, the query Learning is
 * asked and the level grouping. Tolerant of anything a visitor or a crawler
 * types; never widening.
 */

const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';
const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('readCoursesQuery', () => {
  it('reads the neutral view from an empty address', () => {
    expect(readCoursesQuery({})).toEqual(DEFAULT_COURSES_QUERY);
    expect(coursesFiltered(readCoursesQuery({}))).toBe(false);
  });

  it('reads every parameter it knows', () => {
    expect(
      readCoursesQuery({
        format: 'live',
        level: 'intermediate',
        language: 'ur',
        teacher: PERSON,
        sort: 'title',
        page: '3',
      }),
    ).toEqual({
      format: 'live',
      level: 'intermediate',
      language: 'ur',
      teacher: PERSON,
      sort: 'title',
      page: 3,
    });
    expect(readCoursesQuery({ format: 'self-paced' }).format).toBe('self-paced');
    expect(readCoursesQuery({ sort: 'newest' }).sort).toBe('newest');
    expect(coursesFiltered(readCoursesQuery({ format: 'live' }))).toBe(true);
    expect(coursesFiltered(readCoursesQuery({ level: 'advanced' }))).toBe(true);
    expect(coursesFiltered(readCoursesQuery({ sort: 'title', page: '2' }))).toBe(false);
  });

  it('drops what is malformed, out of range or repeated, rather than failing', () => {
    expect(
      readCoursesQuery({
        format: 'in-person',
        level: 'expert',
        language: '<script>',
        teacher: 'not-a-uuid',
        sort: 'popular',
        page: '0',
      }),
    ).toEqual(DEFAULT_COURSES_QUERY);
    expect(readCoursesQuery({ format: 'Live' }).format).toBeNull();
    expect(readCoursesQuery({ format: ['live', 'self-paced'] }).format).toBeNull();
    expect(readCoursesQuery({ level: ['beginner', 'advanced'] }).level).toBeNull();
    // The neutral order is not a value an address spells, but it reads.
    expect(readCoursesQuery({ sort: 'level' }).sort).toBe('level');
    expect(readCoursesQuery({ language: 'x'.repeat(17) }).language).toBeNull();
    expect(readCoursesQuery({ teacher: `${PERSON}0` }).teacher).toBeNull();
    expect(readCoursesQuery({ page: String(COURSES_MAX_PAGE + 1) }).page).toBe(1);
    expect(readCoursesQuery({ page: String(COURSES_MAX_PAGE) }).page).toBe(
      COURSES_MAX_PAGE,
    );
    expect(readCoursesQuery({ page: '1e3' }).page).toBe(1);
  });

  it('accepts a regional language and folds an identifier', () => {
    expect(readCoursesQuery({ language: 'ur-PK' }).language).toBe('ur-PK');
    expect(readCoursesQuery({ teacher: PERSON.toUpperCase() }).teacher).toBe(PERSON);
  });

  it('always reads a query Learning’s own schema accepts, up to its offset bound', () => {
    for (const raw of [
      {},
      { format: 'live', level: 'beginner', teacher: PERSON, sort: 'title' },
      { page: String(COURSES_MAX_PAGE), language: 'ar', sort: 'newest' },
    ])
      expect(
        topicCourseQuerySchema.safeParse(
          coursesReadQuery(readCoursesQuery(raw), TOPIC, 'en'),
        ).success,
      ).toBe(true);
  });
});

describe('coursesHref', () => {
  const view = readCoursesQuery({
    format: 'self-paced',
    level: 'beginner',
    language: 'ur',
    teacher: PERSON,
    sort: 'newest',
    page: '4',
  });

  it('gives the unfiltered hub exactly one address, in every locale', () => {
    expect(coursesHref(QURAN, 'en', DEFAULT_COURSES_QUERY)).toBe('/quran/courses');
    expect(coursesHref(QURAN, 'ur', DEFAULT_COURSES_QUERY)).toBe('/ur/quran/courses');
    expect(coursesHref(QURAN, 'ar', DEFAULT_COURSES_QUERY)).toBe('/ar/quran/courses');
  });

  it('writes every narrowing value in one fixed order, and the page last', () => {
    expect(coursesHref(QURAN, 'en', view)).toBe(
      `/quran/courses?format=self-paced&level=beginner&language=ur&teacher=${PERSON}&sort=newest&page=4`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    expect(coursesHref(QURAN, 'en', view, { level: null })).toBe(
      `/quran/courses?format=self-paced&language=ur&teacher=${PERSON}&sort=newest`,
    );
    expect(coursesHref(QURAN, 'en', view, { format: 'live' })).toBe(
      `/quran/courses?format=live&level=beginner&language=ur&teacher=${PERSON}&sort=newest`,
    );
    expect(coursesHref(QURAN, 'en', view, { sort: 'level' })).not.toContain('sort=');
    expect(coursesHref(QURAN, 'en', view, { page: 5 })).toContain('&page=5');
    expect(coursesHref(QURAN, 'en', view, { page: 1 })).not.toContain('page=');
  });

  it('round-trips: the address it builds reads back as the same view', () => {
    const href = coursesHref(QURAN, 'en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(readCoursesQuery(params)).toEqual(view);
  });
});

describe('coursesCanonicalRedirect', () => {
  it('leaves a canonical address, and the bare hub, alone', () => {
    expect(coursesCanonicalRedirect(QURAN, 'en', {})).toBeNull();
    expect(
      coursesCanonicalRedirect(QURAN, 'ur', {
        format: 'live',
        level: 'advanced',
        page: '2',
      }),
    ).toBeNull();
    // A parameter the hub does not read — the former related view's offset
    // among them — is not its business.
    expect(coursesCanonicalRedirect(QURAN, 'en', { utm_source: 'x' })).toBeNull();
    expect(coursesCanonicalRedirect(QURAN, 'en', { offset: '24' })).toBeNull();
  });

  it('sends what a filter form submits — every control, empty ones included — to one address', () => {
    expect(
      coursesCanonicalRedirect(QURAN, 'en', {
        level: '',
        language: '',
        teacher: PERSON,
        sort: 'level',
      }),
    ).toBe(`/quran/courses?teacher=${PERSON}`);
    expect(
      coursesCanonicalRedirect(QURAN, 'ar', {
        format: 'live',
        level: 'beginner',
        language: '',
        sort: 'level',
      }),
    ).toBe('/ar/quran/courses?format=live&level=beginner');
  });

  it('sends another order, a malformed or repeated value to the parsed view', () => {
    expect(coursesCanonicalRedirect(QURAN, 'en', { sort: 'title', format: 'live' })).toBe(
      '/quran/courses?format=live&sort=title',
    );
    expect(
      coursesCanonicalRedirect(QURAN, 'en', {
        level: 'expert',
        page: '-1',
        format: 'drafts',
      }),
    ).toBe('/quran/courses');
    expect(coursesCanonicalRedirect(QURAN, 'en', { language: ['ur', 'en'] })).toBe(
      '/quran/courses',
    );
    expect(coursesCanonicalRedirect(QURAN, 'en', { page: '1' })).toBe('/quran/courses');
    expect(coursesCanonicalRedirect(QURAN, 'en', { sort: 'level' })).toBe(
      '/quran/courses',
    );
    // Built from the parsed view, never from the typed text.
    expect(
      coursesCanonicalRedirect(QURAN, 'en', { teacher: 'https://evil.example/' }),
    ).toBe('/quran/courses');
  });

  it('never redirects an address it built itself', () => {
    const view = readCoursesQuery({
      format: 'self-paced',
      level: 'advanced',
      language: 'ur-PK',
      teacher: PERSON,
      sort: 'title',
      page: '7',
    });
    const href = coursesHref(QURAN, 'en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(coursesCanonicalRedirect(QURAN, 'en', params)).toBeNull();
  });
});

describe('coursesReadQuery and paging', () => {
  it('asks Learning for one page by offset, with the Topic and the reader’s title locale', () => {
    expect(
      coursesReadQuery(readCoursesQuery({ page: '3', format: 'live' }), TOPIC, 'ur'),
    ).toEqual({
      topic: TOPIC,
      format: 'live',
      level: null,
      language: null,
      teacher: null,
      sort: 'level',
      titleLocale: 'ur',
      offset: 2 * TOPIC_COURSES_PAGE,
      limit: TOPIC_COURSES_PAGE,
    });
    expect(coursesReadQuery(DEFAULT_COURSES_QUERY, null, 'en').topic).toBeNull();
  });

  it('counts pages and states the range a page shows', () => {
    expect(coursesPageCount(0)).toBe(1);
    expect(coursesPageCount(TOPIC_COURSES_PAGE)).toBe(1);
    expect(coursesPageCount(TOPIC_COURSES_PAGE + 1)).toBe(2);
    expect(coursesRange(1, 0)).toBeNull();
    expect(coursesRange(2, 3)).toEqual({
      from: TOPIC_COURSES_PAGE + 1,
      to: TOPIC_COURSES_PAGE + 3,
    });
  });
});

describe('the level grouping', () => {
  it('groups a page by level in the order given, never re-sorting it', () => {
    const items = [
      { id: 'a', level: 'beginner' as const },
      { id: 'b', level: 'beginner' as const },
      { id: 'c', level: 'advanced' as const },
      { id: 'd', level: null },
      { id: 'e', level: null },
    ];
    expect(byLevel(items)).toEqual([
      { level: 'beginner', items: [items[0], items[1]] },
      { level: 'advanced', items: [items[2]] },
      { level: null, items: [items[3], items[4]] },
    ]);
    expect(byLevel([])).toEqual([]);
    // Not re-sorted: a level met again starts a new group where it stands.
    const unsorted = [
      { id: 'x', level: 'advanced' as const },
      { id: 'y', level: 'beginner' as const },
      { id: 'z', level: 'advanced' as const },
    ];
    expect(byLevel(unsorted).map((group) => group.level)).toEqual([
      'advanced',
      'beginner',
      'advanced',
    ]);
  });

  it('fills one, two or three steps for the three levels', () => {
    expect(levelSteps('beginner')).toBe(1);
    expect(levelSteps('intermediate')).toBe(2);
    expect(levelSteps('advanced')).toBe(3);
  });
});

describe('the Hadith Courses hub’s address', () => {
  it('is its own, in every locale, under the same rules', () => {
    expect(coursesHref(HADITH, 'en', DEFAULT_COURSES_QUERY)).toBe('/hadith/courses');
    expect(coursesHref(HADITH, 'ar', DEFAULT_COURSES_QUERY)).toBe('/ar/hadith/courses');
    expect(coursesCanonicalRedirect(HADITH, 'en', {})).toBeNull();
    expect(coursesCanonicalRedirect(HADITH, 'ur', { level: '', format: 'live' })).toBe(
      '/ur/hadith/courses?format=live',
    );
  });
});
