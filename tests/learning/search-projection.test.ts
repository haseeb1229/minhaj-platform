import { describe, expect, it } from 'vitest';

import type {
  CourseSearchRecord,
  LearningPublicReaderPort,
  PathSearchRecord,
} from '../../packages/contracts/src/learning/index.ts';
import {
  SEARCH_SUMMARY_MAX_LENGTH,
  searchDocumentSourceSchema,
} from '../../packages/contracts/src/search/index.ts';
import { createLearningSearchProjection } from '../../apps/web/src/contexts/learning/index.ts';

/**
 * Phase 22 — Learning's search projection, over a fake public reader.
 *
 * WHAT IS PROVED: a public Course is one result with one document per labelled
 * locale holding its words and its PUBLIC syllabus in that locale — and never a
 * lesson body, which the record does not even carry; a path holds its own
 * words; every document satisfies the Search contract; nothing is projected for
 * a Course the reader withholds; a foreign cursor is refused; and only records
 * the reader says are public now resolve, at their `/learn` addresses.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const course: CourseSearchRecord = {
  id: ID(1),
  stamp: '3:2026-10-15T00:00:00.000Z',
  primaryLocale: 'en',
  languageCode: 'ur',
  topicIds: [ID(9)],
  labels: [
    {
      locale: 'en',
      title: 'NON_LEARNING_FIXTURE_COURSE',
      summary: 's'.repeat(SEARCH_SUMMARY_MAX_LENGTH + 50),
      description: 'NON_LEARNING_FIXTURE_DESCRIPTION',
    },
    { locale: 'ur', title: 'NON_LEARNING_FIXTURE_UR', summary: '', description: '' },
  ],
  outline: [
    {
      id: ID(2),
      position: 0,
      labels: [{ locale: 'en', title: 'NON_LEARNING_FIXTURE_MODULE', summary: 'modsum' }],
      lessons: [
        {
          id: ID(3),
          position: 0,
          labels: [
            { locale: 'en', title: 'NON_LEARNING_FIXTURE_LESSON', summary: 'lessum' },
          ],
        },
      ],
    },
  ],
};

const path: PathSearchRecord = {
  id: ID(4),
  stamp: '1:2026-10-15T00:00:00.000Z',
  primaryLocale: 'en',
  labels: [
    { locale: 'en', title: 'NON_LEARNING_FIXTURE_PATH', summary: 'p', description: 'd' },
  ],
};

function reader(): LearningPublicReaderPort {
  return {
    searchCourse: async (id: string) => (id === ID(1) ? course : null),
    searchPath: async (id: string) => (id === ID(4) ? path : null),
    searchCourses: async () => [{ id: ID(1), stamp: course.stamp }],
    searchPaths: async () => [{ id: ID(4), stamp: path.stamp }],
    publicCourseTargets: async (ids: readonly string[]) =>
      ids.filter((id) => id === ID(1)).map((id) => ({ id, slug: 'renamed-course' })),
    publicPathTargets: async (ids: readonly string[]) =>
      ids.filter((id) => id === ID(4)).map((id) => ({ id, slug: 'a-path' })),
  } as unknown as LearningPublicReaderPort;
}

describe('project', () => {
  it('projects a public Course per labelled locale with its public syllabus', async () => {
    const projection = await createLearningSearchProjection(
      reader(),
    ).course.source.project(ID(1));
    expect(projection?.stamp).toBe(course.stamp);
    const [english, urdu] = projection?.documents ?? [];
    expect(english).toMatchObject({
      kind: 'course',
      resourceId: ID(1),
      textLanguage: 'en',
      contentLanguage: 'ur',
      title: 'NON_LEARNING_FIXTURE_COURSE',
      topicIds: [ID(9)],
    });
    expect(english?.summary).toHaveLength(SEARCH_SUMMARY_MAX_LENGTH);
    expect(english?.body).toBe(
      'NON_LEARNING_FIXTURE_DESCRIPTION\nNON_LEARNING_FIXTURE_MODULE\nmodsum\nNON_LEARNING_FIXTURE_LESSON\nlessum',
    );
    // An Urdu document holds only what was written in Urdu.
    expect(urdu).toMatchObject({ textLanguage: 'ur', body: '' });
    for (const document of projection?.documents ?? [])
      expect(searchDocumentSourceSchema.safeParse(document).success).toBe(true);
  });

  it('projects a path with its own words only', async () => {
    const projection = await createLearningSearchProjection(reader()).path.source.project(
      ID(4),
    );
    expect(projection?.documents).toEqual([
      {
        kind: 'learning-path',
        resourceId: ID(4),
        textLanguage: 'en',
        contentLanguage: null,
        title: 'NON_LEARNING_FIXTURE_PATH',
        summary: 'p',
        body: 'd',
        year: null,
        topicIds: [],
      },
    ]);
  });

  it('projects nothing for a withheld record, and never asks about a malformed id', async () => {
    const projection = createLearningSearchProjection(reader());
    expect(await projection.course.source.project(ID(8))).toBeNull();
    expect(await projection.course.source.project('not-an-id')).toBeNull();
    expect(await projection.path.source.project(ID(1))).toBeNull();
  });
});

describe('list', () => {
  it('refuses a cursor that is not a Learning identifier', () => {
    const projection = createLearningSearchProjection(reader());
    expect(() => projection.course.source.list({ after: 'x', limit: 10 })).toThrow();
    expect(() => projection.path.source.list({ after: 'x', limit: 10 })).toThrow();
  });
});

describe('target', () => {
  it('resolves only records public now, at their current /learn address', async () => {
    const projection = createLearningSearchProjection(reader());
    expect([
      ...(await projection.course.target([ID(1), ID(8), 'bad'])).entries(),
    ]).toEqual([[ID(1), '/learn/courses/renamed-course']]);
    expect([...(await projection.path.target([ID(4), ID(1)])).entries()]).toEqual([
      [ID(4), '/learn/paths/a-path'],
    ]);
  });
});
