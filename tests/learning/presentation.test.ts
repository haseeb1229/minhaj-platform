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
  filterValue,
  isFilteredCourseBrowse,
  isInvalidCourseBrowse,
  learnPageLinks,
  learnPath,
  learningDescription,
  learningLocales,
  learningPathHref,
  learningPathPathOf,
  offsetHref,
  outlineLabel,
  readCourseBrowse,
  readLearnOffset,
} from '../../apps/web/src/components/learning/presentation.ts';

/**
 * Phase 22 — the public Learn surfaces' pure presentation decisions.
 *
 * The rule these exist to hold: A FILTER NEVER BROADENS. A value a visitor
 * typed that does not parse is INVALID — the catalogue then lists nothing and
 * says why — never silently dropped into the unfiltered catalogue. And one view
 * has one spelling, so a filtered address cannot multiply.
 */

describe('Learn addresses', () => {
  it('spells the section, a Course and a LearningPath one way', () => {
    expect(learnPath('en')).toBe('/en/learn');
    expect(learnPath('ur', 'trial')).toBe('/ur/learn/trial');
    expect(coursePathOf('fiqh-basics')).toBe('/learn/courses/fiqh-basics');
    expect(courseHref('ar', 'fiqh-basics')).toBe('/ar/learn/courses/fiqh-basics');
    expect(learningPathPathOf('first-year')).toBe('/learn/paths/first-year');
    expect(learningPathHref('en', 'first-year')).toBe('/en/learn/paths/first-year');
  });

  it('encodes a slug rather than letting it add a segment', () => {
    expect(courseHref('en', '../admin')).toBe('/en/learn/courses/..%2Fadmin');
  });

  it('gives the first page of a listing the bare address', () => {
    expect(offsetHref('/en/learn/paths', 0)).toBe('/en/learn/paths');
    expect(offsetHref('/en/learn/paths', 24)).toBe('/en/learn/paths?offset=24');
  });
});

describe('the catalogue query', () => {
  it('reads an empty query as the unfiltered first page', () => {
    const browse = readCourseBrowse({});
    expect(browse).toEqual({
      topic: { state: 'none' },
      level: { state: 'none' },
      language: { state: 'none' },
      format: { state: 'none' },
      teacher: { state: 'none' },
      offset: 0,
    });
    expect(isInvalidCourseBrowse(browse)).toBe(false);
    expect(isFilteredCourseBrowse(browse)).toBe(false);
  });

  it('treats an empty parameter as absent, as a submitted "Any" choice is', () => {
    const browse = readCourseBrowse({
      topic: '',
      level: '',
      language: '',
      format: '',
      teacher: '',
    });
    expect(isFilteredCourseBrowse(browse)).toBe(false);
    expect(isInvalidCourseBrowse(browse)).toBe(false);
  });

  it('reads every well-formed filter, and they combine', () => {
    const browse = readCourseBrowse({
      topic: 'fiqh',
      level: 'beginner',
      language: 'ur',
      format: 'live',
      teacher: 'a-teacher',
      offset: '24',
    });
    expect(filterValue(browse.topic)).toBe('fiqh');
    expect(filterValue(browse.level)).toBe('beginner');
    expect(filterValue(browse.language)).toBe('ur');
    expect(filterValue(browse.format)).toBe('live');
    expect(filterValue(browse.teacher)).toBe('a-teacher');
    expect(browse.offset).toBe(24);
    expect(isInvalidCourseBrowse(browse)).toBe(false);
    expect(isFilteredCourseBrowse(browse)).toBe(true);
  });

  it('accepts a regional content-language code', () => {
    expect(filterValue(readCourseBrowse({ language: 'ur-PK' }).language)).toBe('ur-PK');
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
    const browse = readCourseBrowse({ [name]: value });
    expect(isInvalidCourseBrowse(browse)).toBe(true);
    // Still a filtered view: the empty state is the explained one.
    expect(isFilteredCourseBrowse(browse)).toBe(true);
    expect(browse[name as 'topic']).toEqual({ state: 'invalid' });
  });

  it('keeps one malformed filter invalid even beside good ones', () => {
    const browse = readCourseBrowse({ topic: 'fiqh', level: 'master', format: 'live' });
    expect(isInvalidCourseBrowse(browse)).toBe(true);
  });

  it('reads a repeated parameter as its first value', () => {
    expect(filterValue(readCourseBrowse({ level: ['advanced', 'beginner'] }).level)).toBe(
      'advanced',
    );
    expect(readCourseBrowse({ level: ['nonsense', 'beginner'] }).level).toEqual({
      state: 'invalid',
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
    expect(courseBrowseHref('en')).toBe('/en/learn/courses');
    expect(courseBrowseHref('en', { topic: null, offset: 0 })).toBe('/en/learn/courses');
  });

  it('writes every filter in one fixed order, whatever order it is given in', () => {
    expect(
      courseBrowseHref('ur', {
        offset: 48,
        teacher: 'a-teacher',
        format: 'self-paced',
        language: 'ar',
        level: 'advanced',
        topic: 'hadith',
      }),
    ).toBe(
      '/ur/learn/courses?topic=hadith&level=advanced&language=ar&format=self-paced&teacher=a-teacher&offset=48',
    );
  });

  it('round-trips a view through the query reader', () => {
    const href = courseBrowseHref('en', { topic: 'quran', format: 'live', offset: 24 });
    const query = Object.fromEntries(new URL(href, 'https://example.test').searchParams);
    const browse = readCourseBrowse(query);
    expect(filterValue(browse.topic)).toBe('quran');
    expect(filterValue(browse.format)).toBe('live');
    expect(browse.offset).toBe(24);
    expect(isInvalidCourseBrowse(browse)).toBe(false);
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
