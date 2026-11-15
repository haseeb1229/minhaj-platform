import { describe, expect, it } from 'vitest';

import type {
  ClassPublicReaderPort,
  LearningActivationPort,
  LearningPublicReaderPort,
  PublicScheduleQuery,
} from '../../packages/contracts/src/learning/index.ts';
import type { LibraryPublicReaderPort } from '../../packages/contracts/src/library/index.ts';
import type { MediaPublicReaderPort } from '../../packages/contracts/src/media/index.ts';
import {
  createClassReadService,
  createLearningReadService,
} from '../../apps/web/src/contexts/learning/index.ts';
import { createLibraryReadService } from '../../apps/web/src/contexts/library/index.ts';
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * Learn Part 2 — the trust boundary of the new public reads. Every input is
 * parsed by its owner's public read service BEFORE any read: a malformed,
 * repeated, oversized or unknown value reaches no adapter, an empty ask reads
 * nothing, and while live learning is off the schedule reads nothing beyond
 * the activation.
 *
 *   - the Topic index's totals (Learning's Courses, Library's Works and
 *     Research, Media's Videos);
 *   - the paths catalogue's summaries;
 *   - the public schedule's narrowing and aggregates.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const COURSE = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';

/** `count` distinct, well-formed identifiers. */
function identifiers(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
}

/** Every shape a Topic list must be refused in, before any read. */
const MALFORMED_TOPICS: readonly (readonly [string, unknown])[] = [
  ['a slug', ['quran']],
  ['an injection', ["x' OR 1=1 --"]],
  ['a repeated Topic', [TOPIC, TOPIC]],
  ['one past the bound', identifiers(201)],
  ['not a list', TOPIC],
  ['nothing', null],
  ['a number', [7]],
];

describe('the Topic index’s totals', () => {
  function readers() {
    const seen: { method: string; topics: readonly string[] }[] = [];
    const learning = createLearningReadService({
      topicCourseTotals: async (topics: readonly string[]) => {
        seen.push({ method: 'courses', topics });
        return [];
      },
    } as unknown as LearningPublicReaderPort);
    const library = createLibraryReadService({
      topicTotals: async (topics: readonly string[]) => {
        seen.push({ method: 'library', topics });
        return { works: [], research: [] };
      },
    } as unknown as LibraryPublicReaderPort);
    const media = createMediaReadService({
      topicVideoTotals: async (topics: readonly string[]) => {
        seen.push({ method: 'videos', topics });
        return [];
      },
    } as unknown as MediaPublicReaderPort);
    return { seen, learning, library, media };
  }

  it('passes the asked Topics, up to the tree’s bound, to each owner', async () => {
    const { seen, learning, library, media } = readers();
    const whole = identifiers(200);
    await learning.topicCourseTotals([TOPIC, OTHER]);
    await library.topicTotals(whole);
    await media.topicVideoTotals([OTHER]);
    expect(seen).toEqual([
      { method: 'courses', topics: [TOPIC, OTHER] },
      { method: 'library', topics: whole },
      { method: 'videos', topics: [OTHER] },
    ]);
  });

  it('reads nothing when no Topic is asked about', async () => {
    const { seen, learning, library, media } = readers();
    expect(await learning.topicCourseTotals([])).toEqual([]);
    expect(await library.topicTotals([])).toEqual({ works: [], research: [] });
    expect(await media.topicVideoTotals([])).toEqual([]);
    expect(seen).toEqual([]);
  });

  it.each(MALFORMED_TOPICS)('refuses %s before any read', async (_name, raw) => {
    const { seen, learning, library, media } = readers();
    await expect(learning.topicCourseTotals(raw)).rejects.toThrow();
    await expect(library.topicTotals(raw)).rejects.toThrow();
    await expect(media.topicVideoTotals(raw)).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});

describe('the paths catalogue’s summaries', () => {
  function recording() {
    const seen: number[] = [];
    const service = createLearningReadService({
      pathSummaries: async (offset: number) => {
        seen.push(offset);
        return {
          items: [],
          hasMore: false,
          figures: { paths: 0, courses: 0, lessons: 0 },
        };
      },
    } as unknown as LearningPublicReaderPort);
    return { service, seen };
  }

  it('starts at the first page and passes a valid offset', async () => {
    const { service, seen } = recording();
    await service.pathSummaries();
    await service.pathSummaries(24);
    expect(seen).toEqual([0, 24]);
  });

  it.each([
    ['a negative offset', -1],
    ['a fraction', 1.5],
    ['an offset past the bound', 25_001],
    ['not a number', Number.NaN],
  ])('refuses %s before any read', async (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.pathSummaries(raw)).toThrow();
    expect(seen).toEqual([]);
  });
});

describe('the public schedule’s narrowing and aggregates', () => {
  function schedule(mode: 'fixture' | 'approved' | null) {
    const seen: { method: string; now: Date; query: PublicScheduleQuery }[] = [];
    const reader = {
      upcomingSessions: async (now: Date, query: PublicScheduleQuery) => {
        seen.push({ method: 'sessions', now, query });
        return { items: [], hasMore: false };
      },
      upcomingFacets: async (now: Date, query: PublicScheduleQuery) => {
        seen.push({ method: 'facets', now, query });
        return { upcoming: 3, matching: 1, courses: [], teachers: [], languages: [] };
      },
    } as unknown as ClassPublicReaderPort;
    const now = new Date('2026-11-15T00:00:00Z');
    let asked = 0;
    const service = createClassReadService({
      reader,
      activation: {
        activeMode: async () => {
          asked += 1;
          return mode;
        },
      } as LearningActivationPort,
      clock: () => now,
    });
    return { service, seen, now, asked: () => asked };
  }

  const EMPTY = {
    course: null,
    teacher: null,
    language: null,
    offset: 0,
  } satisfies PublicScheduleQuery;

  it('states every default, and reads the page and the aggregates at one instant', async () => {
    const { service, seen, now } = schedule('fixture');
    expect(await service.liveSchedule()).toEqual({
      mode: 'fixture',
      page: { items: [], hasMore: false },
      facets: { upcoming: 3, matching: 1, courses: [], teachers: [], languages: [] },
    });
    expect(seen).toEqual([
      { method: 'sessions', now, query: EMPTY },
      { method: 'facets', now, query: EMPTY },
    ]);
  });

  it('passes a Course, a teacher account, a content language and an offset', async () => {
    const { service, seen } = schedule('approved');
    const query = { course: COURSE, teacher: 'account-1', language: 'ur', offset: 24 };
    await service.liveSchedule(query);
    expect(seen.map((entry) => entry.query)).toEqual([query, query]);
  });

  it('reads nothing but the activation while live learning is off, and says so', async () => {
    const { service, seen, asked } = schedule(null);
    expect(await service.liveSchedule({ course: COURSE })).toEqual({
      mode: null,
      page: { items: [], hasMore: false },
      facets: { upcoming: 0, matching: 0, courses: [], teachers: [], languages: [] },
    });
    expect(seen).toEqual([]);
    expect(asked()).toBe(1);
  });

  it.each([
    ['a Course slug', { course: 'a-course' }],
    ['an injected Course', { course: "x' OR 1=1 --" }],
    ['an empty teacher', { teacher: '' }],
    ['an overlong teacher', { teacher: 'x'.repeat(37) }],
    ['an interface word as a language', { language: 'Urdu language' }],
    ['a negative offset', { offset: -1 }],
    ['an offset past the bound', { offset: 25_001 }],
    ['an offset as text', { offset: '24' }],
    ['an unknown field', { subject: 'quran' }],
    ['a list', [COURSE]],
  ])('refuses %s before anything is read', async (_name, raw) => {
    const { service, seen, asked } = schedule('fixture');
    await expect(service.liveSchedule(raw)).rejects.toThrow();
    expect(seen).toEqual([]);
    expect(asked()).toBe(0);
  });
});
