import { describe, expect, it } from 'vitest';

import type {
  LearningPublicReaderPort,
  TopicCourseQuery,
} from '../../packages/contracts/src/learning/index.ts';
import { createLearningReadService } from '../../apps/web/src/contexts/learning/index.ts';

/**
 * Quran Part 13 — the Topic course hub read's trust boundary. Every field of
 * the query is parsed by Learning's public read service BEFORE any read: a
 * value that is malformed, out of range or unknown reaches no adapter, and an
 * accepted one reaches it with every default stated.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';
const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';

function recording() {
  const seen: { method: string; query: unknown }[] = [];
  const reader = {
    topicCourses: async (query: TopicCourseQuery) => {
      seen.push({ method: 'topicCourses', query });
      return { items: [], total: 0, hasMore: false };
    },
    topicCourseFacets: async (query: TopicCourseQuery) => {
      seen.push({ method: 'topicCourseFacets', query });
      return {
        hub: { courses: 0, live: 0, selfPaced: 0, lessons: 0, teachers: 0, languages: 0 },
        formats: { all: 0, live: 0, selfPaced: 0 },
        levels: { beginner: 0, intermediate: 0, advanced: 0 },
        languages: { items: [], hasMore: false },
        teachers: { items: [], hasMore: false },
      };
    },
    topicCoursePaths: async (topic: string | null) => {
      seen.push({ method: 'topicCoursePaths', query: topic });
      return [];
    },
  } as unknown as LearningPublicReaderPort;
  return { service: createLearningReadService(reader), seen };
}

describe('Learning’s public Topic course hub read', () => {
  it('states every default for an empty query', async () => {
    const { service, seen } = recording();
    await service.topicCourses();
    await service.topicCourseFacets({});
    await service.topicCoursePaths();
    const expected: TopicCourseQuery = {
      topic: null,
      format: null,
      level: null,
      language: null,
      teacher: null,
      sort: 'level',
      titleLocale: null,
      offset: 0,
      limit: 12,
    };
    expect(seen).toEqual([
      { method: 'topicCourses', query: expected },
      { method: 'topicCourseFacets', query: expected },
      { method: 'topicCoursePaths', query: null },
    ]);
  });

  it('passes a full, valid query through unchanged', async () => {
    const { service, seen } = recording();
    const query = {
      topic: TOPIC,
      format: 'live',
      level: 'advanced',
      language: 'ur-PK',
      teacher: PERSON,
      sort: 'title',
      titleLocale: 'ar',
      offset: 25_000,
      limit: 1,
    };
    await service.topicCourses(query);
    await service.topicCourseFacets({ ...query, format: 'self-paced', sort: 'newest' });
    await service.topicCoursePaths(TOPIC);
    expect(seen[0]?.query).toEqual(query);
    expect(seen[1]?.query).toEqual({ ...query, format: 'self-paced', sort: 'newest' });
    expect(seen[2]?.query).toBe(TOPIC);
  });

  it.each([
    ['an unknown format', { format: 'in-person' }],
    ['an unknown level', { level: 'expert' }],
    ['an unknown order', { sort: 'popular' }],
    ['a malformed Topic', { topic: 'quran' }],
    ['a malformed teacher', { teacher: "x' OR 1=1 --" }],
    ['a teacher named by slug', { teacher: 'shaykh-example' }],
    ['a malformed language', { language: "ur'; DROP TABLE Course;--" }],
    ['an unknown title locale', { titleLocale: 'fr' }],
    ['a negative offset', { offset: -1 }],
    ['an offset past the bound', { offset: 25_001 }],
    ['a fractional offset', { offset: 1.5 }],
    ['a page larger than the hub’s', { limit: 13 }],
    ['an empty page', { limit: 0 }],
    ['a field it does not know', { state: 'draft' }],
    ['a widening it does not offer', { includeDrafts: true }],
  ])('refuses %s before any read', async (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.topicCourses(raw)).toThrow();
    expect(() => service.topicCourseFacets(raw)).toThrow();
    expect(seen).toEqual([]);
  });

  it.each([
    ['a slug', 'quran'],
    ['an injection', "x' OR 1=1 --"],
    ['a number', 7],
    ['an object', { id: TOPIC }],
  ])('refuses a path read for %s as its Topic', async (_name, topic) => {
    const { service, seen } = recording();
    expect(() => service.topicCoursePaths(topic)).toThrow();
    expect(seen).toEqual([]);
  });
});
