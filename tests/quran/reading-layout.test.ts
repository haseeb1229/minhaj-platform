import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  QURAN_WINDOW,
  STARTING_POINTS,
  ayahElementId,
  ayahOfFragment,
  boundariesOf,
  mushafPagePath,
  readWindow,
  spanOf,
  startingPointsIn,
  surahPlacePath,
  windowStartOf,
  withWindow,
} from '../../apps/web/src/components/quran/reading-layout.ts';
import { readQuranPosition } from '../../apps/web/src/components/personal-island/requests.ts';

/**
 * Quran Part 1 — how a long reading is laid out: windows of a Surah, the
 * fragment that lands on an Ayah, the divisions that begin at an Ayah, and the
 * places offered to begin.
 *
 * EVERY NUMBER HERE IS SYNTHETIC. Counts, pages, Juz and hizb numbers are
 * arbitrary values chosen to exercise a boundary; none is a fact of the Quran.
 */

describe('a Surah is read one window at a time', () => {
  it('starts every window at a fixed place, so each Ayah has one window', () => {
    expect(QURAN_WINDOW).toBe(40);
    expect(windowStartOf(1)).toBe(1);
    expect(windowStartOf(40)).toBe(1);
    expect(windowStartOf(41)).toBe(41);
    expect(windowStartOf(255)).toBe(241);
    expect(windowStartOf(0)).toBe(1);
  });

  it('reads `?from=` as one bounded window inside the Surah, else the first', () => {
    expect(readWindow(undefined, 286)).toEqual({ start: 1, end: 40 });
    expect(readWindow('41', 286)).toEqual({ start: 41, end: 80 });
    // Any Ayah opens the window it is in.
    expect(readWindow('255', 286)).toEqual({ start: 241, end: 280 });
    expect(readWindow('281', 286)).toEqual({ start: 281, end: 286 });
    expect(readWindow('7', 7)).toEqual({ start: 1, end: 7 });
    // Past the end, malformed, repeated or zero: the first window.
    for (const raw of ['287', '0', '041', '1e2', '-1', ' 41', '41a', ['41', '81'], ''])
      expect(readWindow(raw, 286), String(raw)).toEqual({ start: 1, end: 40 });
  });

  it('adds the window to an address, before its fragment, only past the first', () => {
    expect(withWindow('/quran/surah/2', 1)).toBe('/quran/surah/2');
    expect(withWindow('/quran/surah/2', 41)).toBe('/quran/surah/2?from=41');
    expect(withWindow('/quran/surah/2?translation=x', 81)).toBe(
      '/quran/surah/2?translation=x&from=81',
    );
    expect(withWindow('/quran/surah/2#ayah-2-255', 241)).toBe(
      '/quran/surah/2?from=241#ayah-2-255',
    );
  });

  it('places an Ayah in its Surah: its window, at its own element', () => {
    expect(ayahElementId({ surah: 2, ayah: 255 })).toBe('ayah-2-255');
    expect(surahPlacePath('en', { surah: 2, ayah: 255 })).toBe(
      '/quran/surah/2?from=241#ayah-2-255',
    );
    expect(surahPlacePath('ur', { surah: 18, ayah: 10 })).toBe(
      '/ur/quran/surah/18#ayah-18-10',
    );
    expect(mushafPagePath('ar', 50)).toBe('/ar/quran/page/50');
  });
});

describe('a fragment lands on its Ayah', () => {
  it('reads the current and the earlier anchor forms for this Surah only', () => {
    expect(ayahOfFragment('#ayah-2-255', 2, 286)).toBe(255);
    expect(ayahOfFragment('ayah-2-255', 2, 286)).toBe(255);
    expect(ayahOfFragment('#ayah-255', 2, 286)).toBe(255);
    expect(ayahOfFragment('#ayah-3-5', 2, 286)).toBeNull();
    expect(ayahOfFragment('#ayah-2-287', 2, 286)).toBeNull();
    for (const noise of [
      '',
      '#',
      '#about-this-text',
      '#ayah-',
      '#ayah-0',
      '#ayah-2-01',
      '#ayah-2-5x',
    ])
      expect(ayahOfFragment(noise, 2, 286), noise).toBeNull();
  });
});

describe('the divisions that begin at an Ayah', () => {
  const at = (juz: number, hizb: number | null, page: number | null) => ({
    juz,
    hizb,
    page,
  });

  it('marks where a Juz, a hizb or a page changes from the Ayah before', () => {
    const ayat = [at(1, 1, 2), at(1, 1, 2), at(1, 2, 3), at(2, 3, 3)];
    expect(boundariesOf(ayat, at(1, 1, 1))).toEqual([
      { juz: null, hizb: null, page: 2 },
      { juz: null, hizb: null, page: null },
      { juz: null, hizb: 2, page: 3 },
      { juz: 2, hizb: 3, page: null },
    ]);
  });

  it('begins everything at the start of the corpus, and nothing unrecorded', () => {
    expect(boundariesOf([at(1, 1, 1)], null)).toEqual([{ juz: 1, hizb: 1, page: 1 }]);
    expect(boundariesOf([at(1, null, null), at(1, null, null)], null)).toEqual([
      { juz: 1, hizb: null, page: null },
      { juz: null, hizb: null, page: null },
    ]);
  });

  it('spans a run only where both ends recorded the division', () => {
    expect(spanOf(at(1, 1, 2), at(3, 5, 49), 'page')).toEqual({ start: 2, end: 49 });
    expect(spanOf(at(1, 1, 2), at(3, 5, 49), 'juz')).toEqual({ start: 1, end: 3 });
    expect(spanOf(at(1, 1, null), at(3, 5, 49), 'page')).toBeNull();
    expect(spanOf(null, null, 'juz')).toBeNull();
  });
});

describe('where to begin', () => {
  it('offers fixed citations only, and only those the corpus holds', () => {
    expect(STARTING_POINTS.map((point) => point.key)).toEqual([
      'fatiha',
      'kahf',
      'yasin',
      'mulk',
      'kursi',
    ]);
    // A two-Surah fixture: only the first opening exists; 2:5 is past its count.
    expect(
      startingPointsIn(
        new Map([
          [1, 3],
          [2, 4],
        ]),
      ).map((point) => point.key),
    ).toEqual(['fatiha']);
    expect(startingPointsIn(new Map()).map((point) => point.key)).toEqual([]);
  });
});

describe('the signed-in reading position, as the card asks for it', () => {
  afterEach(() => vi.unstubAllGlobals());

  function answer(status: number, body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit) => {
        // Same origin, no store, a GET with no body and no query: nothing
        // names an account or a target.
        expect(input).toBe('/api/my/quran-position');
        expect(init.method).toBe('GET');
        expect(init.credentials).toBe('same-origin');
        expect(init.cache).toBe('no-store');
        expect(init.body).toBeUndefined();
        return new Response(JSON.stringify(body), { status });
      }),
    );
  }

  it('reads signed out, a position, and no position', async () => {
    const signal = new AbortController().signal;
    answer(200, { signedIn: false });
    expect(await readQuranPosition(signal)).toEqual({ state: 'signed-out' });
    answer(200, { signedIn: true, position: { surah: 2, ayah: 3 } });
    expect(await readQuranPosition(signal)).toEqual({
      state: 'signed-in',
      position: { surah: 2, ayah: 3 },
    });
    answer(200, { signedIn: true, position: null });
    expect(await readQuranPosition(signal)).toEqual({
      state: 'signed-in',
      position: null,
    });
  });

  it('trusts no other shape and no refusal', async () => {
    const signal = new AbortController().signal;
    for (const body of [
      null,
      [],
      { signedIn: 'yes' },
      { signedIn: true },
      { signedIn: true, position: { surah: '2', ayah: 3 } },
      { signedIn: true, position: { surah: 2, ayah: 0 } },
      { signedIn: true, position: { surah: 2.5, ayah: 3 } },
    ]) {
      answer(200, body);
      expect(await readQuranPosition(signal), JSON.stringify(body)).toEqual({
        state: 'failed',
      });
    }
    answer(403, { ok: false, failure: 'denied' });
    expect(await readQuranPosition(signal)).toEqual({ state: 'failed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await readQuranPosition(signal)).toEqual({ state: 'failed' });
  });
});
