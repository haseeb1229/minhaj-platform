import { describe, expect, it } from 'vitest';

import {
  applyPathChange,
  courseCompleted,
  courseInputSchema,
  courseQuerySchema,
  LEARNING_LIMITS,
  LEARNING_RESERVED_SLUGS,
  learningSlugSchema,
  lessonChangeSchema,
  moduleChangeSchema,
  pathInputSchema,
} from '../../packages/contracts/src/learning/index.ts';

/**
 * Phase 22 — Learning's contract: the vocabulary, the input schemas and the
 * pure rules, proved without a database. The SQL half is
 * `persistence.integration.test.ts`.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const course = (overrides: Record<string, unknown> = {}) => ({
  slug: 'non-learning-fixture-course',
  primaryLocale: 'en',
  level: null,
  format: 'self-paced',
  languageCode: 'en',
  labels: [
    { locale: 'en', title: 'NON_LEARNING_FIXTURE_TITLE', summary: '', description: '' },
  ],
  topicIds: [],
  teacherIds: [],
  ...overrides,
});

describe('slugs', () => {
  it('refuses every word the Learn routes use beside a slug', () => {
    for (const word of LEARNING_RESERVED_SLUGS)
      expect(learningSlugSchema.safeParse(word).success, word).toBe(false);
    expect(LEARNING_RESERVED_SLUGS).toEqual(
      expect.arrayContaining([
        'courses',
        'paths',
        'live',
        'trial',
        'training',
        'resources',
        'teachers',
      ]),
    );
  });

  it('accepts a kebab-case slug and refuses anything else', () => {
    expect(learningSlugSchema.safeParse('quran-for-beginners').success).toBe(true);
    for (const bad of [
      'Quran',
      'a',
      'two--dashes',
      '-lead',
      'trail-',
      'space here',
      'ﺍﻟﻘﺮﺁﻥ',
    ])
      expect(learningSlugSchema.safeParse(bad).success, bad).toBe(false);
  });
});

describe('a Course', () => {
  it('accepts the catalogue facts and nothing more', () => {
    expect(courseInputSchema.safeParse(course()).success).toBe(true);
    // The lifecycle is its own act, never a field of the save.
    expect(courseInputSchema.safeParse(course({ state: 'published' })).success).toBe(
      false,
    );
    // Nothing that schedules, books, prices or certifies exists to be saved.
    for (const field of [
      'meetingUrl',
      'meetingProvider',
      'price',
      'certificate',
      'teacherAccountId',
    ])
      expect(courseInputSchema.safeParse(course({ [field]: 'x' })).success, field).toBe(
        false,
      );
  });

  it('needs a label in its primary locale, each locale once', () => {
    expect(courseInputSchema.safeParse(course({ primaryLocale: 'ur' })).success).toBe(
      false,
    );
    const label = { locale: 'en', title: 'A', summary: '', description: '' };
    expect(courseInputSchema.safeParse(course({ labels: [label, label] })).success).toBe(
      false,
    );
  });

  it('holds only the controlled level and format vocabularies', () => {
    expect(
      courseInputSchema.safeParse(course({ level: 'beginner', format: 'live' })).success,
    ).toBe(true);
    expect(courseInputSchema.safeParse(course({ level: 'expert' })).success).toBe(false);
    expect(courseInputSchema.safeParse(course({ format: 'blended' })).success).toBe(
      false,
    );
  });

  it('bounds teachers and topics and refuses a duplicate', () => {
    const many = Array.from({ length: LEARNING_LIMITS.teachers + 1 }, (_, i) =>
      ID(i + 1),
    );
    expect(courseInputSchema.safeParse(course({ teacherIds: many })).success).toBe(false);
    expect(
      courseInputSchema.safeParse(course({ topicIds: [ID(1), ID(1)] })).success,
    ).toBe(false);
  });
});

describe('syllabus changes', () => {
  it('are named acts on identified modules and lessons', () => {
    const labels = [{ locale: 'en', title: 'M', summary: '' }];
    expect(moduleChangeSchema.safeParse({ op: 'add', labels }).success).toBe(true);
    expect(
      moduleChangeSchema.safeParse({ op: 'move', moduleId: ID(1), direction: 'up' })
        .success,
    ).toBe(false);
    expect(moduleChangeSchema.safeParse({ op: 'replace', modules: [] }).success).toBe(
      false,
    );
    expect(
      lessonChangeSchema.safeParse({
        op: 'add',
        moduleId: ID(1),
        labels: [{ locale: 'en', title: 'L', summary: '', body: 'Plain text.' }],
      }).success,
    ).toBe(true);
    // A lesson never changes module through an edit.
    expect(
      lessonChangeSchema.safeParse({
        op: 'edit',
        lessonId: ID(2),
        moduleId: ID(3),
        labels: [{ locale: 'en', title: 'L', summary: '', body: '' }],
      }).success,
    ).toBe(false);
  });

  it('bounds a lesson body', () => {
    const body = 'x'.repeat(LEARNING_LIMITS.lessonBody + 1);
    expect(
      lessonChangeSchema.safeParse({
        op: 'edit',
        lessonId: ID(2),
        labels: [{ locale: 'en', title: 'L', summary: '', body }],
      }).success,
    ).toBe(false);
  });
});

describe('the public catalogue query', () => {
  it('narrows by validated values and refuses anything else', () => {
    expect(courseQuerySchema.parse({}).topic).toBeNull();
    expect(
      courseQuerySchema.safeParse({ level: 'beginner', format: 'live', language: 'ur' })
        .success,
    ).toBe(true);
    expect(courseQuerySchema.safeParse({ teacher: 'some-slug' }).success).toBe(false);
    expect(courseQuerySchema.safeParse({ level: 'any' }).success).toBe(false);
    expect(courseQuerySchema.safeParse({ popular: true }).success).toBe(false);
  });
});

describe('a LearningPath', () => {
  it('saves its own words only — membership is a named change', () => {
    const value = {
      slug: 'non-learning-fixture-path',
      primaryLocale: 'en',
      labels: [{ locale: 'en', title: 'P', summary: '', description: '' }],
    };
    expect(pathInputSchema.safeParse(value).success).toBe(true);
    expect(pathInputSchema.safeParse({ ...value, courseIds: [ID(1)] }).success).toBe(
      false,
    );
  });

  it('applies one change to the order it was shown', () => {
    const order = [ID(1), ID(2), ID(3)];
    expect(applyPathChange(order, { op: 'add', courseId: ID(4) })).toEqual({
      courseIds: [ID(1), ID(2), ID(3), ID(4)],
    });
    expect(applyPathChange(order, { op: 'add', courseId: ID(2) })).toEqual({
      refusal: 'duplicate-member',
    });
    expect(applyPathChange(order, { op: 'remove', courseId: ID(9) })).toEqual({
      refusal: 'invalid',
    });
    expect(
      applyPathChange(order, { op: 'move', courseId: ID(3), direction: 'earlier' }),
    ).toEqual({
      courseIds: [ID(1), ID(3), ID(2)],
    });
    expect(
      applyPathChange(order, { op: 'move', courseId: ID(1), direction: 'earlier' }),
    ).toEqual({
      refusal: 'invalid',
    });
    const full = Array.from({ length: LEARNING_LIMITS.pathCourses }, (_, i) =>
      ID(i + 10),
    );
    expect(applyPathChange(full, { op: 'add', courseId: ID(1) })).toEqual({
      refusal: 'limit',
    });
  });
});

describe('course completion', () => {
  it('is every current lesson completed, and never an empty course', () => {
    expect(courseCompleted(3, 3)).toBe(true);
    expect(courseCompleted(2, 3)).toBe(false);
    expect(courseCompleted(0, 0)).toBe(false);
  });
});
