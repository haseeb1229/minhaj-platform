import { describe, expect, it, vi } from 'vitest';

import type {
  FetchOutcome,
  MigrationFetchPort,
} from '../../packages/contracts/src/migration/index.ts';

import {
  CURATED_READS,
  HAFS,
  MP3QURAN_ENDPOINTS,
  attributionOf,
  planRead,
  readMoshafs,
  readSurahTiming,
  readTimedReads,
  streamOfFolderUrl,
} from '../../scripts/quran/mp3quran.ts';
import { mp3quranFetcher, politeJson } from '../../scripts/quran/recitations-runtime.ts';

/**
 * Quran Part 5 — mp3quran.net's API, READ: which curated reads can be
 * imported, what is recorded of each (names verbatim, the CDN folder only if
 * the allowlist admits it), and a Surah's timing — used only where it covers
 * every Ayah exactly once, monotonically, and never adjusted.
 *
 * NO NETWORK. Every body below is a small inline fixture SHAPED like the API's
 * answers (field names and nesting as the real endpoints return them); the
 * names are `NON_QURAN_FIXTURE` sentinels except the riwayah label, which is
 * the value the import requires.
 */

const READ = CURATED_READS[0] ?? { read: 0, folder: '' };
const FOLDER_URL = `https://cdn.mp3quran.net/${READ.folder}/`;

const timedBody = (overrides: Record<string, unknown> = {}) => [
  {
    id: READ.read,
    name: 'NON_QURAN_FIXTURE قارئ',
    rewaya: HAFS,
    folder_url: FOLDER_URL,
    soar_count: 114,
    soar_link: `https://www.mp3quran.net/api/v3/ayat_timing/soar?read=${String(READ.read)}`,
    ...overrides,
  },
];

const recitersBody = (
  reciter: string,
  moshaf: string,
  overrides: Record<string, unknown> = {},
) => ({
  reciters: [
    {
      id: 900,
      name: reciter,
      letter: 'N',
      moshaf: [
        {
          id: READ.read,
          name: moshaf,
          rewaya_id: 1,
          server: FOLDER_URL,
          surah_total: 114,
          moshaf_type: 11,
          surah_list: '1,2,3',
          ...overrides,
        },
      ],
    },
  ],
});

const english = () =>
  readMoshafs(
    recitersBody('NON_QURAN_FIXTURE Reciter', "Rewayat Hafs A'n Assem - Murattal"),
  );
const arabic = () =>
  readMoshafs(recitersBody('NON_QURAN_FIXTURE القارئ', 'حفص عن عاصم - مرتل'));

describe('a curated read is planned only from what the API says, exactly', () => {
  it('records the names verbatim, the folder as the stream, and slugs from the folder', () => {
    const plan = planRead(READ, readTimedReads(timedBody()), english(), arabic());
    const [, folderName, moshaf] =
      /^audio\/([a-z0-9-]+)\/(r[0-9]+)$/.exec(READ.folder) ?? [];
    expect(plan).toEqual({
      read: READ.read,
      stream: { provider: 'mp3quran', path: READ.folder },
      personSlug: folderName,
      recitationSlug: `${folderName ?? ''}-${moshaf ?? ''}`,
      nameEnglish: 'NON_QURAN_FIXTURE Reciter',
      nameArabic: 'NON_QURAN_FIXTURE القارئ',
      moshaf: "Rewayat Hafs A'n Assem - Murattal",
      style: 'Murattal',
    });
    if ('skip' in plan) return;
    expect(attributionOf(plan)).toBe(
      "Recitation: NON_QURAN_FIXTURE Reciter (Rewayat Hafs A'n Assem - Murattal). Audio and timings: mp3quran.net",
    );
  });

  it('records no style where the moshaf name has none to split off', () => {
    const plan = planRead(
      READ,
      readTimedReads(timedBody()),
      readMoshafs(recitersBody('NON_QURAN_FIXTURE Reciter', 'NON_QURAN_FIXTURE moshaf')),
      arabic(),
    );
    expect('skip' in plan ? plan : plan.style).toBeNull();
  });

  it.each([
    ['not-timed', timedBody({ id: 1 })],
    ['not-hafs', timedBody({ rewaya: 'ورش عن نافع' })],
    ['not-complete', timedBody({ soar_count: 113 })],
    [
      'folder-changed',
      timedBody({ folder_url: 'https://cdn.mp3quran.net/audio/other-reciter/r1/' }),
    ],
    [
      'folder-changed',
      timedBody({ folder_url: `https://server6.mp3quran.net/${READ.folder}/` }),
    ],
    [
      'folder-changed',
      timedBody({ folder_url: `http://cdn.mp3quran.net/${READ.folder}/` }),
    ],
  ])('skips a read as %s', (reason, body) => {
    expect(planRead(READ, readTimedReads(body), english(), arabic())).toEqual({
      skip: reason,
    });
  });

  it('skips a read whose reciter the reciters list does not name in both languages', () => {
    expect(planRead(READ, readTimedReads(timedBody()), new Map(), arabic())).toEqual({
      skip: 'no-reciter',
    });
    expect(planRead(READ, readTimedReads(timedBody()), english(), new Map())).toEqual({
      skip: 'no-reciter',
    });
  });

  it('skips a read whose reciter entry points at another folder', () => {
    const moved = readMoshafs(
      recitersBody('NON_QURAN_FIXTURE Reciter', 'X - Murattal', {
        server: 'https://cdn.mp3quran.net/audio/other-reciter/r1/',
      }),
    );
    expect(planRead(READ, readTimedReads(timedBody()), moved, arabic())).toEqual({
      skip: 'folder-changed',
    });
  });

  it('never takes a name that would need repairing', () => {
    for (const unusable of [' NON_QURAN_FIXTURE padded', '', 'NON_QURAN\u0007bell', 42])
      expect(
        readMoshafs(recitersBody(unusable as string, 'X - Murattal')).size,
        JSON.stringify(unusable),
      ).toBe(0);
  });

  it('reads garbage as nothing rather than guessing', () => {
    expect(readTimedReads({ not: 'a list' }).size).toBe(0);
    expect(readTimedReads([{ id: '123' }, null, 5]).size).toBe(0);
    expect(readMoshafs([]).size).toBe(0);
    expect(readMoshafs({ reciters: [{ name: 'x', moshaf: 'not a list' }] }).size).toBe(0);
  });

  it('pins every curated read to an allowlisted CDN folder, once', () => {
    const reads = CURATED_READS.map((entry) => entry.read);
    expect(new Set(reads).size).toBe(reads.length);
    for (const entry of CURATED_READS)
      expect(streamOfFolderUrl(`https://cdn.mp3quran.net/${entry.folder}/`)?.path).toBe(
        entry.folder,
      );
  });

  it('asks only the API host', () => {
    for (const url of [
      MP3QURAN_ENDPOINTS.timedReads,
      MP3QURAN_ENDPOINTS.reciters('eng'),
      MP3QURAN_ENDPOINTS.reciters('ar'),
      MP3QURAN_ENDPOINTS.timing(READ.read, 2),
    ])
      expect(new URL(url).host).toBe('www.mp3quran.net');
    expect(MP3QURAN_ENDPOINTS.timing(123, 2)).toBe(
      'https://www.mp3quran.net/api/v3/ayat_timing?surah=2&read=123',
    );
  });
});

describe('a folder URL is a stream only on the allowlisted CDN', () => {
  it.each([
    [
      'https://cdn.mp3quran.net/audio/non-quran-fixture/r1/',
      'audio/non-quran-fixture/r1',
    ],
    ['https://cdn.mp3quran.net/audio/non-quran-fixture/r1', null],
    ['https://cdn.mp3quran.net.evil.example/audio/x/r1/', null],
    ['https://server8.mp3quran.net/audio/x/r1/', null],
    ['https://cdn.mp3quran.net/audio/X/r1/', null],
    ['https://cdn.mp3quran.net/other/x/r1/', null],
    ['https://cdn.mp3quran.net/audio/x/r1/001.mp3', null],
  ])('%s → %s', (url, path) => {
    expect(streamOfFolderUrl(url)?.path ?? null).toBe(path);
  });
});

describe('a Surah’s timing is used only as it is, and only its start and end', () => {
  const entry = (ayah: unknown, start: unknown, end: unknown) => ({
    ayah,
    polygon: '181.08,18.31 57.54,18.31',
    start_time: start,
    end_time: end,
    x: '66.48',
    y: '34.46',
    page: 'https://www.mp3quran.net/api/quran_pages_svg/001.svg',
  });

  it('takes ayah, start_time and end_time and nothing else', () => {
    expect(readSurahTiming([entry(1, 6420, 11120), entry(2, 11120, 17640)], 2)).toEqual({
      timings: [
        { ayah: 1, startMs: 6420, endMs: 11120 },
        { ayah: 2, startMs: 11120, endMs: 17640 },
      ],
    });
    // The page and polygon fields can be anything at all: they are not read.
    expect(
      readSurahTiming([{ ...entry(1, 0, 10), polygon: null, page: 9, x: [], y: {} }], 1),
    ).toEqual({ timings: [{ ayah: 1, startMs: 0, endMs: 10 }] });
  });

  it('sets aside an entry numbered 0 — the opening, not an Ayah', () => {
    expect(readSurahTiming([entry(0, 0, 5000), entry(1, 5000, 9000)], 1)).toEqual({
      timings: [{ ayah: 1, startMs: 5000, endMs: 9000 }],
    });
  });

  it('orders the entries by Ayah', () => {
    const read = readSurahTiming([entry(2, 10, 20), entry(1, 0, 10)], 2);
    expect('timings' in read ? read.timings.map((each) => each.ayah) : read).toEqual([
      1, 2,
    ]);
  });

  it.each([
    ['coverage', [entry(1, 0, 10)], 2],
    ['coverage', [entry(1, 0, 10), entry(3, 10, 20)], 2],
    ['coverage', [entry(1, 0, 10), entry(1, 10, 20)], 2],
    ['coverage', [entry(1, 0, 10), entry(2, 10, 20)], 1],
    ['empty-span', [entry(1, 0, 10), entry(2, 20, 20)], 2],
    ['overlap', [entry(1, 0, 15), entry(2, 10, 20)], 2],
    ['bounds', [entry(1, -5, 10)], 1],
    ['bounds', [entry(1, 0, 43_200_001)], 1],
    ['unreadable', [entry(1, '0', 10)], 1],
    ['unreadable', [entry(1, 0, 10.5)], 1],
    ['unreadable', [entry(null, 0, 10)], 1],
    ['unreadable', { not: 'a list' }, 1],
  ])('skips as %s, never adjusting', (reason, body, ayahCount) => {
    expect(readSurahTiming(body, ayahCount)).toEqual({ skip: reason });
  });
});

describe('the API is asked politely, and its answer is JSON or a refusal', () => {
  const answer = (status: number, body: string): FetchOutcome => ({
    kind: 'response',
    status,
    requestedUrl: MP3QURAN_ENDPOINTS.timedReads,
    finalUrl: MP3QURAN_ENDPOINTS.timedReads,
    contentType: 'application/json',
    headers: {},
    body: new TextEncoder().encode(body),
    retryAfter: null,
  });
  const failed: FetchOutcome = {
    kind: 'failure',
    classification: 'network',
    requestedUrl: MP3QURAN_ENDPOINTS.timedReads,
    detail: 'connection-failed',
  };
  const refusal: FetchOutcome = {
    kind: 'refused',
    classification: 'scope-refused',
    requestedUrl: MP3QURAN_ENDPOINTS.timedReads,
    detail: 'url-out-of-scope',
  };

  function harness(outcomes: FetchOutcome[]) {
    const fetch = vi.fn<MigrationFetchPort['fetch']>(() =>
      Promise.resolve(outcomes.shift() ?? answer(200, '[]')),
    );
    const sleeps: number[] = [];
    const get = politeJson({ fetcherKey: 'fake', fetcherVersion: '1', fetch }, (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    });
    return { fetch, sleeps, get };
  }

  it('waits at least a second between two requests', async () => {
    const { get, sleeps, fetch } = harness([answer(200, '[1]'), answer(200, '{"a":2}')]);
    expect(await get(MP3QURAN_ENDPOINTS.timedReads)).toEqual([1]);
    expect(sleeps).toEqual([]);
    expect(await get(MP3QURAN_ENDPOINTS.reciters('eng'))).toEqual({ a: 2 });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(900);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a network failure', failed],
    ['a 503', answer(503, 'busy')],
    ['a 429', answer(429, 'slow down')],
  ])('retries %s, waiting longer each time', async (_label, transient) => {
    const { get, sleeps, fetch } = harness([transient, transient, answer(200, '[7]')]);
    expect(await get(MP3QURAN_ENDPOINTS.timedReads)).toEqual([7]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThan(1900);
    expect(sleeps[1]).toBeGreaterThan(2900);
  });

  it('gives up after three attempts', async () => {
    const { get, fetch } = harness([failed, failed, failed, answer(200, '[]')]);
    await expect(get(MP3QURAN_ENDPOINTS.timedReads)).rejects.toThrow(
      /could not be read \(failure: connection-failed\)/,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a refusal or a 404', async () => {
    const refused = harness([refusal, answer(200, '[]')]);
    await expect(refused.get(MP3QURAN_ENDPOINTS.timedReads)).rejects.toThrow(
      /scope-refused|refused: url-out-of-scope/,
    );
    expect(refused.fetch).toHaveBeenCalledTimes(1);
    const missing = harness([answer(404, ''), answer(200, '[]')]);
    await expect(missing.get(MP3QURAN_ENDPOINTS.timedReads)).rejects.toThrow(
      /answered 404/,
    );
    expect(missing.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses an answer that is not JSON, or not UTF-8', async () => {
    await expect(
      harness([answer(200, '<html>')]).get(MP3QURAN_ENDPOINTS.timedReads),
    ).rejects.toThrow(/other than JSON/);
    const invalid: FetchOutcome = {
      ...answer(200, ''),
      body: Uint8Array.from([0x5b, 0xff, 0x5d]),
    } as FetchOutcome;
    await expect(harness([invalid]).get(MP3QURAN_ENDPOINTS.timedReads)).rejects.toThrow(
      /other than JSON/,
    );
  });

  it('binds its fetcher to the API host alone', async () => {
    const connector = vi.fn(() => Promise.reject(new Error('must not connect')));
    const fetcher = mp3quranFetcher({
      resolver: () => Promise.resolve(['93.184.216.34']),
      connector,
    });
    const outcome = await fetcher.fetch('https://cdn.mp3quran.net/audio/x/r1/001.mp3');
    expect(outcome).toMatchObject({ kind: 'refused', classification: 'scope-refused' });
    expect(connector).not.toHaveBeenCalled();
  });
});
