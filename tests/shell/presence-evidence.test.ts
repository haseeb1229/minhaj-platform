import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuranAvailability } from '@minhaj/contracts/quran';

/**
 * R2 — THE EVIDENCE BEHIND THE QURAN PRESENCE SIGNALS (`@/composition/presence`).
 *
 * `quran` is decided by the posture table (`QURAN_MODE_POSTURE[mode].navigation`)
 * rather than a comparison of its own: an approved corpus and a reference
 * preview count, a fixture never; `quranReference` (which puts the text's
 * licence attribution in the footer) only for a reference preview.
 *
 * Every owning context's read is replaced by a stub; a read that throws must
 * contribute no evidence (fail closed).
 */

const state: { quran: QuranAvailability | Error } = { quran: { active: false } };

const fail = () => Promise.reject(new Error('NON_FIXTURE no evidence'));
const answer = <T>(value: T | Error): Promise<T> =>
  value instanceof Error ? Promise.reject(value) : Promise.resolve(value);

vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/composition/quran-read', () => ({
  quranReadRuntime: () => ({ reader: { availability: () => answer(state.quran) } }),
}));
vi.mock('@/composition/library-read', () => ({
  libraryReadRuntime: () => ({ sitemap: fail, scholarlySitemap: fail }),
}));
vi.mock('@/composition/editorial-read', () => ({
  editorialReadRuntime: () => new Proxy({}, { get: () => fail }),
}));
for (const [path, name] of [
  ['@/composition/donations-read', 'donationsReadRuntime'],
  ['@/composition/fatwa-read', 'fatwaReadRuntime'],
  ['@/composition/hadith-read', 'hadithReadRuntime'],
  ['@/composition/media-read', 'mediaReadRuntime'],
  ['@/composition/membership-read', 'membershipReadRuntime'],
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

async function signals() {
  const { readPresence } = await import('../../apps/web/src/composition/presence.ts');
  return (await readPresence()).signals;
}

beforeEach(() => {
  vi.resetModules();
  state.quran = { active: false };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Quran signal follows the posture table', () => {
  it('counts an approved corpus and a reference preview', async () => {
    state.quran = { active: true, mode: 'approved' };
    expect((await signals()).has('quran')).toBe(true);
    vi.resetModules();
    state.quran = { active: true, mode: 'reference' };
    const reference = await signals();
    expect(reference.has('quran')).toBe(true);
    expect(reference.has('quranReference')).toBe(true);
  });

  it('never counts a fixture, an inactive corpus or a failed read', async () => {
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
