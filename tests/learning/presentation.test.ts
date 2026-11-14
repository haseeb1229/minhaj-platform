import { describe, expect, it } from 'vitest';

import type {
  CourseLabel,
  OutlineLabel,
} from '../../packages/contracts/src/learning/index.ts';
import {
  LEARNING_MAX_OFFSET,
  courseBrowseHref,
  courseHref,
  courseLabel,
  coursePathOf,
  learnPageLinks,
  learnPath,
  learningDescription,
  learningLocales,
  learningPathHref,
  learningPathPathOf,
  offsetHref,
  outlineLabel,
  readLearnOffset,
} from '../../apps/web/src/components/learning/presentation.ts';
import {
  DEFAULT_COURSES_QUERY,
  LEARN_COURSES,
  coursesCanonicalRedirect,
  coursesFiltered,
  readCatalogueQuery,
} from '../../apps/web/src/components/topic-hub/courses-view.ts';

/**
 * Phase 22 — the public Learn surfaces' pure presentation decisions; since
 * Learn Part 1 the catalogue's address is the shared Courses listing's
 * (`readCatalogueQuery`, `LEARN_COURSES`), proved here for what the catalogue
 * has always promised.
 *
 * The rule these exist to hold: A FILTER NEVER BROADENS. A value a visitor
 * typed that does not parse is INVALID — the catalogue then lists nothing and
 * says why — never silently dropped into the unfiltered catalogue. And one view
 * has one spelling, so a filtered address cannot multiply.
 */

describe('Learn addresses', () => {
  it('spells the section, a Course and a LearningPath one way', () => {
    expect(learnPath('en')).toBe('/learn');
    expect(learnPath('ur', 'trial')).toBe('/ur/learn/trial');
    expect(coursePathOf('fiqh-basics')).toBe('/learn/courses/fiqh-basics');
    expect(courseHref('ar', 'fiqh-basics')).toBe('/ar/learn/courses/fiqh-basics');
    expect(learningPathPathOf('first-year')).toBe('/learn/paths/first-year');
    expect(learningPathHref('en', 'first-year')).toBe('/learn/paths/first-year');
  });

  it('encodes a slug rather than letting it add a segment', () => {
    expect(courseHref('en', '../admin')).toBe('/learn/courses/..%2Fadmin');
  });

  it('gives the first page of a listing the bare address', () => {
    expect(offsetHref('/learn/paths', 0)).toBe('/learn/paths');
    expect(offsetHref('/learn/paths', 24)).toBe('/learn/paths?offset=24');
  });
});

describe('the catalogue query', () => {
  it('reads an empty query as the unfiltered first page', () => {
    const read = readCatalogueQuery({});
    expect(read).toEqual({ query: DEFAULT_COURSES_QUERY, invalid: false });
    expect(coursesFiltered(read.query)).toBe(false);
  });

  it('treats an empty parameter as absent, as a submitted "Any" choice is', () => {
    const read = readCatalogueQuery({
      topic: '',
      level: '',
      language: '',
      format: '',
      teacher: '',
    });
    expect(read.invalid).toBe(false);
    expect(coursesFiltered(read.query)).toBe(false);
  });

  it('reads every well-formed filter — a Topic and a teacher by slug — and they combine', () => {
    const read = readCatalogueQuery({
      topic: 'fiqh',
      level: 'beginner',
      language: 'ur',
      format: 'live',
      teacher: 'a-teacher',
      sort: 'title',
      page: '3',
    });
    expect(read).toEqual({
      query: {
        format: 'live',
        topic: 'fiqh',
        level: 'beginner',
        language: 'ur',
        teacher: 'a-teacher',
        sort: 'title',
        page: 3,
      },
      invalid: false,
    });
    expect(coursesFiltered(read.query)).toBe(true);
  });

  it('accepts a regional content-language code', () => {
    expect(readCatalogueQuery({ language: 'ur-PK' }).query.language).toBe('ur-PK');
  });

  it.each([
    ['level', 'expert'],
    ['level', 'BEGINNER'],
    ['format', 'in-person'],
    ['format', 'Live'],
    ['language', 'Urdu'],
    ['language', 'u'],
    ['language', 'ur_PK'],
    ['topic', 'Fiqh'],
    ['topic', 'fiqh--basics'],
    ['topic', ' fiqh'],
    ['topic', 'f'],
    ['teacher', 'A-Teacher'],
    ['teacher', 'a_teacher'],
    ['teacher', 'a teacher'],
  ])('reports a malformed %s (%j) as invalid, never as absent', (name, value) => {
    const read = readCatalogueQuery({ [name]: value });
    expect(read.invalid).toBe(true);
    expect(read.query[name as 'topic']).toBeNull();
    // Never redirected away into a broader view: it stays, and says why.
    expect(coursesCanonicalRedirect(LEARN_COURSES, 'en', { [name]: value })).toBeNull();
  });

  it('keeps one malformed filter invalid even beside good ones', () => {
    expect(
      readCatalogueQuery({ topic: 'fiqh', level: 'master', format: 'live' }).invalid,
    ).toBe(true);
  });

  it('reads a repeated filter as invalid — two values are no one view', () => {
    // Until Learn Part 1 the first value was read; an address no control can
    // produce is now explained rather than guessed at.
    expect(readCatalogueQuery({ level: ['advanced', 'beginner'] }).invalid).toBe(true);
    expect(readCatalogueQuery({ level: ['nonsense', 'beginner'] }).invalid).toBe(true);
  });

  it('keeps the order and the page tolerant: a wrong one is the neutral one', () => {
    expect(readCatalogueQuery({ sort: 'popular', page: '0' })).toEqual({
      query: DEFAULT_COURSES_QUERY,
      invalid: false,
    });
  });

  it('bounds the offset by the reader’s ceiling, and reads anything else as 0', () => {
    expect(readLearnOffset({ offset: String(LEARNING_MAX_OFFSET) })).toBe(
      LEARNING_MAX_OFFSET,
    );
    for (const raw of [
      String(LEARNING_MAX_OFFSET + 1),
      '-24',
      '2.5',
      '1e3',
      'abc',
      '',
      '9999999',
    ])
      expect(readLearnOffset({ offset: raw }), raw).toBe(0);
    expect(readLearnOffset({})).toBe(0);
  });
});

describe('catalogue addresses', () => {
  it('is the bare catalogue with no view', () => {
    expect(courseBrowseHref('en')).toBe('/learn/courses');
    expect(courseBrowseHref('en', { topic: null, page: 1 })).toBe('/learn/courses');
  });

  it('writes every filter in one fixed order, whatever order it is given in', () => {
    expect(
      courseBrowseHref('ur', {
        page: 3,
        teacher: 'a-teacher',
        format: 'self-paced',
        language: 'ar',
        level: 'advanced',
        topic: 'hadith',
        sort: 'newest',
      }),
    ).toBe(
      '/ur/learn/courses?format=self-paced&topic=hadith&level=advanced&language=ar&teacher=a-teacher&sort=newest&page=3',
    );
  });

  it('round-trips a view through the query reader', () => {
    const href = courseBrowseHref('en', { topic: 'quran', format: 'live', page: 2 });
    const query = Object.fromEntries(new URL(href, 'https://example.test').searchParams);
    const read = readCatalogueQuery(query);
    expect(read.invalid).toBe(false);
    expect(read.query).toMatchObject({ topic: 'quran', format: 'live', page: 2 });
    expect(coursesCanonicalRedirect(LEARN_COURSES, 'en', query)).toBeNull();
  });

  it('answers the address the catalogue had until Learn Part 1 with ONE redirect to its view', () => {
    // The former filter order …
    expect(
      coursesCanonicalRedirect(LEARN_COURSES, 'en', {
        topic: 'quran',
        level: 'beginner',
        language: 'ur',
        format: 'live',
        teacher: 'a-teacher',
      }),
    ).toBe(
      '/learn/courses?format=live&topic=quran&level=beginner&language=ur&teacher=a-teacher',
    );
    // … a form's empty controls …
    expect(
      coursesCanonicalRedirect(LEARN_COURSES, 'ar', {
        topic: '',
        level: 'advanced',
        language: '',
        teacher: '',
        sort: 'level',
      }),
    ).toBe('/ar/learn/courses?level=advanced');
    // … and a former offset of 24 a page: the page holding its first Course.
    expect(coursesCanonicalRedirect(LEARN_COURSES, 'en', { offset: '24' })).toBe(
      '/learn/courses?page=3',
    );
    expect(coursesCanonicalRedirect(LEARN_COURSES, 'en', { offset: '0' })).toBe(
      '/learn/courses',
    );
    expect(
      coursesCanonicalRedirect(LEARN_COURSES, 'ur', { topic: 'quran', offset: '48' }),
    ).toBe('/ur/learn/courses?topic=quran&page=5');
    expect(coursesCanonicalRedirect(LEARN_COURSES, 'en', { offset: 'abc' })).toBe(
      '/learn/courses',
    );
    // A parameter the catalogue does not read is not its business.
    expect(coursesCanonicalRedirect(LEARN_COURSES, 'en', { utm_source: 'x' })).toBeNull();
  });

  it('pages within the reader’s ceiling', () => {
    expect(learnPageLinks(0, 24, false)).toEqual({ previous: null, next: null });
    expect(learnPageLinks(0, 24, true)).toEqual({ previous: null, next: 24 });
    expect(learnPageLinks(10, 24, false)).toEqual({ previous: 0, next: null });
    expect(learnPageLinks(48, 24, true)).toEqual({ previous: 24, next: 72 });
    // A next page past the ceiling would be read as the first page; none is offered.
    expect(learnPageLinks(LEARNING_MAX_OFFSET, 24, true).next).toBeNull();
  });
});

describe('labels', () => {
  const outline: OutlineLabel[] = [
    { locale: 'ur', title: 'اردو', summary: '' },
    { locale: 'en', title: 'English', summary: 'Summary' },
  ];

  it('prefers the reader’s locale, then the primary, then the first', () => {
    expect(outlineLabel(outline, 'en', 'ur').title).toBe('English');
    expect(outlineLabel(outline, 'ar', 'ur').title).toBe('اردو');
    expect(outlineLabel(outline, 'ar', 'en').title).toBe('English');
    expect(outlineLabel([outline[0]!], 'ar', 'en').locale).toBe('ur');
  });

  it('carries the locale the words are actually in', () => {
    expect(outlineLabel(outline, 'ar', 'ur').locale).toBe('ur');
  });

  it('renders nothing rather than inventing words when none exist', () => {
    expect(outlineLabel([], 'en', 'ur')).toEqual({
      locale: 'ur',
      title: '',
      summary: '',
    });
  });

  it('does the same for a Course’s full words', () => {
    const labels: CourseLabel[] = [
      { locale: 'ar', title: 'عربي', summary: '', description: 'وصف' },
    ];
    expect(courseLabel({ labels, primaryLocale: 'ar' }, 'en')).toEqual(labels[0]);
    expect(courseLabel({ labels: [], primaryLocale: 'en' }, 'ur')).toEqual({
      locale: 'en',
      title: '',
      summary: '',
      description: '',
    });
  });

  it('lists only the locales a record genuinely has words in', () => {
    expect(learningLocales({ labels: outline })).toEqual(['ur', 'en']);
    expect(learningLocales({ labels: [] })).toEqual([]);
  });
});

describe('descriptions', () => {
  it('folds whitespace and is absent when there are no words', () => {
    expect(learningDescription('  one\n\ntwo  ')).toBe('one two');
    expect(learningDescription('   ')).toBeUndefined();
  });

  it('cuts by code point, so a cut never splits a character', () => {
    const urdu = 'ا'.repeat(200);
    const cut = learningDescription(urdu, 10);
    expect(cut).toBe(`${'ا'.repeat(10)}…`);
  });
});
