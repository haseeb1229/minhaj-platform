import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuranAvailability } from '@minhaj/contracts/quran';

/**
 * R2 — THE EVIDENCE BEHIND TWO PRESENCE SIGNALS (`@/composition/presence`).
 *
 * `quran` is decided by the posture table (`QURAN_MODE_POSTURE[mode].navigation`)
 * rather than a comparison of its own: an approved corpus and a reference
 * preview are promoted, a fixture never. `hadithWorks` is present only while
 * the `hadith` Topic is active AND the Library holds a public work under it.
 *
 * Every owning context's read is replaced by a stub; a read that throws must
 * contribute no evidence and promote nothing (fail closed).
 */

const state: {
  quran: QuranAvailability | Error;
  topic: { id: string; status: string } | null | Error;
  works: number | Error;
} = { quran: { active: false }, topic: null, works: 0 };

const fail = () => Promise.reject(new Error('NON_FIXTURE no evidence'));
const answer = <T>(value: T | Error): Promise<T> =>
  value instanceof Error ? Promise.reject(value) : Promise.resolve(value);

vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/composition/quran-read', () => ({
  quranReadRuntime: () => ({ reader: { availability: () => answer(state.quran) } }),
}));
vi.mock('@/composition/taxonomy', () => ({
  taxonomyRuntime: () => ({
    taxonomy: { findTopicBySlug: () => answer(state.topic) },
  }),
}));
vi.mock('@/composition/library-read', () => ({
  libraryReadRuntime: () => ({
    works: () =>
      answer(state.works).then((count) => ({
        items: Array.from({ length: count }, (_, index) => ({ id: String(index) })),
        hasMore: false,
      })),
    sitemap: fail,
    scholarlySitemap: fail,
  }),
}));
vi.mock('@/composition/editorial-read', () => ({
  editorialReadRuntime: () =>
    new Proxy(
      { pageSitemap: () => Promise.resolve([]) },
      { get: (target, key) => (key in target ? target[key as 'pageSitemap'] : fail) },
    ),
}));
for (const [path, name] of [
  ['@/composition/donations-read', 'donationsReadRuntime'],
  ['@/composition/fatwa-read', 'fatwaReadRuntime'],
  ['@/composition/global-read', 'globalReadRuntime'],
  ['@/composition/hadith-read', 'hadithReadRuntime'],
  ['@/composition/media-read', 'mediaReadRuntime'],
  ['@/composition/membership-read', 'membershipReadRuntime'],
  ['@/composition/people-read', 'peopleReadRuntime'],
] as const)
  vi.doMock(path, () => ({
    [name]: () => {
      throw new Error('NON_FIXTURE unavailable');
    },
  }));
vi.mock('@/composition/learning-read', () => ({
  learningReadRuntime: () => {
    throw new Error('NON_FIXTURE unavailable');
  },
  liveClassesReadRuntime: () => {
    throw new Error('NON_FIXTURE unavailable');
  },
}));
vi.mock('@/composition/learning-teachers', () => ({ teacherDirectory: fail }));

async function signals() {
  const { readPresence } = await import('../../apps/web/src/composition/presence.ts');
  return (await readPresence()).signals;
}

beforeEach(() => {
  vi.resetModules();
  state.quran = { active: false };
  state.topic = null;
  state.works = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Quran signal follows the posture table', () => {
  it('promotes an approved corpus and a reference preview', async () => {
    state.quran = { active: true, mode: 'approved' };
    expect((await signals()).has('quran')).toBe(true);
    vi.resetModules();
    state.quran = { active: true, mode: 'reference' };
    const reference = await signals();
    expect(reference.has('quran')).toBe(true);
    expect(reference.has('quranReference')).toBe(true);
  });

  it('never promotes a fixture, an inactive corpus or a failed read', async () => {
    state.quran = { active: true, mode: 'fixture' };
    expect((await signals()).has('quran')).toBe(false);
    vi.resetModules();
    state.quran = { active: false };
    expect((await signals()).has('quran')).toBe(false);
    vi.resetModules();
    state.quran = new Error('NON_FIXTURE read failed');
    expect((await signals()).has('quran')).toBe(false);
  });
});

describe('the Hadith works signal', () => {
  it('is present with an active hadith Topic that has a public work', async () => {
    state.topic = { id: 'topic-hadith', status: 'active' };
    state.works = 2;
    expect((await signals()).has('hadithWorks')).toBe(true);
  });

  it('is absent with no Topic, an archived one, no work, or a failed read', async () => {
    for (const [topic, works] of [
      [null, 3],
      [{ id: 'topic-hadith', status: 'archived' }, 3],
      [{ id: 'topic-hadith', status: 'active' }, 0],
      [new Error('NON_FIXTURE taxonomy failed'), 3],
      [{ id: 'topic-hadith', status: 'active' }, new Error('NON_FIXTURE library failed')],
    ] as const) {
      vi.resetModules();
      state.topic = topic;
      state.works = works;
      expect((await signals()).has('hadithWorks'), JSON.stringify(topic)).toBe(false);
    }
  });
});
