import { describe, expect, it } from 'vitest';

import type {
  LibraryPersistencePort,
  WorkDetail,
} from '../../packages/contracts/src/library/index.ts';
import type {
  MediaPersistencePort,
  VideoRecord,
} from '../../packages/contracts/src/media/index.ts';
import {
  createLibraryService,
  libraryFailure,
} from '../../apps/web/src/contexts/library/index.ts';
import {
  createMediaService,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';

/**
 * Quran Part 8 — the passage acts of the two OWNERS, over fake ports: Library's
 * and Media's `change…QuranPassages` (an editor's add, move and remove) and
 * `applyTitleQuranPassages` (the operator command's whole set). What is proved
 * here: the owner's administer permission, asked live; the version the
 * operator saw or a conflict; the structure check (a range within its Surah)
 * with no Quran read; no repeat; a start within the video; never overwriting
 * a passage an editor recorded. The SQL half is the owners' integration suites.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { accountId: ID(100) };
const kahf = { surah: 18, ayahFrom: 1, ayahTo: 10 };

function libraryHarness(options: {
  readonly permissions?: readonly string[];
  readonly work?: Partial<WorkDetail> | null;
}) {
  const calls: { method: string; input?: unknown }[] = [];
  const permissions = new Set(
    options.permissions ?? ['library.read', 'library.administer'],
  );
  const persistence = new Proxy({} as LibraryPersistencePort, {
    get(_target, method: string) {
      return async (input?: unknown) => {
        calls.push({ method, input });
        if (method === 'work')
          return options.work === null
            ? null
            : ({
                id: ID(1),
                version: 3,
                quranPassages: [],
                ...options.work,
              } as WorkDetail);
        return { saved: method };
      };
    },
  });
  const service = createLibraryService({
    persistence,
    authority: { permits: async (_id, permission) => permissions.has(permission) },
    references: {
      validPeople: async () => true,
      validTopics: async () => true,
      validLanguage: async () => true,
    },
  });
  return { service, calls };
}

function mediaHarness(options: {
  readonly permissions?: readonly string[];
  readonly video?: Partial<VideoRecord> | null;
}) {
  const calls: { method: string; input?: unknown }[] = [];
  const permissions = new Set(options.permissions ?? ['media.read', 'media.administer']);
  const persistence = new Proxy({} as MediaPersistencePort, {
    get(_target, method: string) {
      return async (input?: unknown) => {
        calls.push({ method, input });
        if (method === 'video')
          return options.video === null
            ? null
            : ({
                id: ID(2),
                version: 5,
                durationSeconds: 3600,
                quranPassages: [],
                ...options.video,
              } as VideoRecord);
        return { saved: method };
      };
    },
  });
  const service = createMediaService({
    persistence,
    authority: { permits: async (_id, permission) => permissions.has(permission) },
    references: {
      validPeople: async () => true,
      validTopics: async () => true,
      validLanguage: async () => true,
    },
  });
  return { service, calls };
}

async function libraryRefusal(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return libraryFailure(error);
  }
  return 'accepted';
}

async function mediaRefusal(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return mediaFailure(error);
  }
  return 'accepted';
}

const writes = (calls: readonly { method: string; input?: unknown }[], method: string) =>
  calls.filter((call) => call.method === method);

describe('a Work’s Quran passages (Library)', () => {
  it('adds one under the version the editor saw, naming the change', async () => {
    const { service, calls } = libraryHarness({ work: { quranPassages: [] } });
    await service.changeWorkQuranPassages(actor, ID(1), 3, { op: 'add', passage: kahf });
    expect(writes(calls, 'setWorkQuranPassages')).toEqual([
      {
        method: 'setWorkQuranPassages',
        input: {
          actorId: actor.accountId,
          workId: ID(1),
          expectedVersion: 3,
          passages: [kahf],
          change: 'add',
        },
      },
    ]);
  });

  it('refuses without library.administer, before reading anything', async () => {
    const { service, calls } = libraryHarness({ permissions: ['library.read'] });
    expect(
      await libraryRefusal(
        service.changeWorkQuranPassages(actor, ID(1), 3, { op: 'add', passage: kahf }),
      ),
    ).toBe('denied');
    expect(calls).toEqual([]);
  });

  it('refuses a stale version, an unknown Work, a repeat and a range beyond its Surah', async () => {
    expect(
      await libraryRefusal(
        libraryHarness({}).service.changeWorkQuranPassages(actor, ID(1), 2, {
          op: 'add',
          passage: kahf,
        }),
      ),
    ).toBe('conflict');
    expect(
      await libraryRefusal(
        libraryHarness({ work: null }).service.changeWorkQuranPassages(actor, ID(1), 3, {
          op: 'add',
          passage: kahf,
        }),
      ),
    ).toBe('not-found');
    expect(
      await libraryRefusal(
        libraryHarness({
          work: { quranPassages: [kahf] },
        }).service.changeWorkQuranPassages(actor, ID(1), 3, {
          op: 'add',
          passage: kahf,
        }),
      ),
    ).toBe('duplicate-passage');
    const { service, calls } = libraryHarness({});
    expect(
      await libraryRefusal(
        service.changeWorkQuranPassages(actor, ID(1), 3, {
          op: 'add',
          passage: { surah: 1, ayahFrom: 1, ayahTo: 8 },
        }),
      ),
    ).toBe('invalid');
    expect(writes(calls, 'setWorkQuranPassages')).toEqual([]);
  });

  it('moves and removes by place', async () => {
    const fatiha = { surah: 1, ayahFrom: 1, ayahTo: 7 };
    const { service, calls } = libraryHarness({
      work: { quranPassages: [kahf, fatiha] },
    });
    await service.changeWorkQuranPassages(actor, ID(1), 3, {
      op: 'move',
      position: 1,
      direction: 'earlier',
    });
    await service.changeWorkQuranPassages(actor, ID(1), 3, { op: 'remove', position: 0 });
    expect(
      writes(calls, 'setWorkQuranPassages').map(
        (call) => (call.input as { passages: unknown }).passages,
      ),
    ).toEqual([[fatiha, kahf], [fatiha]]);
  });

  it('applies a proposed set only to a Work that carries none, at its version', async () => {
    const { service, calls } = libraryHarness({});
    await service.applyTitleQuranPassages(actor, ID(1), 3, [kahf]);
    expect(writes(calls, 'setWorkQuranPassages')[0]?.input).toMatchObject({
      change: 'title',
      passages: [kahf],
    });
    expect(
      await libraryRefusal(
        libraryHarness({
          work: { quranPassages: [kahf] },
        }).service.applyTitleQuranPassages(actor, ID(1), 3, [kahf]),
      ),
    ).toBe('conflict');
    expect(
      await libraryRefusal(
        libraryHarness({}).service.applyTitleQuranPassages(actor, ID(1), 3, []),
      ),
    ).toBe('invalid');
    expect(
      await libraryRefusal(
        libraryHarness({}).service.applyTitleQuranPassages(actor, ID(1), 3, [kahf, kahf]),
      ),
    ).toBe('duplicate-passage');
  });
});

describe('a Video’s Quran passages (Media)', () => {
  it('adds one with where the lecture begins it', async () => {
    const { service, calls } = mediaHarness({});
    await service.changeVideoQuranPassages(actor, ID(2), 5, {
      op: 'add',
      passage: { ...kahf, startSeconds: 754 },
    });
    expect(writes(calls, 'setVideoQuranPassages')[0]?.input).toEqual({
      actorId: actor.accountId,
      videoId: ID(2),
      expectedVersion: 5,
      passages: [{ ...kahf, startSeconds: 754 }],
      change: 'add',
    });
  });

  it('refuses a start beyond the video’s recorded duration, but not an unknown one', async () => {
    expect(
      await mediaRefusal(
        mediaHarness({
          video: { durationSeconds: 600 },
        }).service.changeVideoQuranPassages(actor, ID(2), 5, {
          op: 'add',
          passage: { ...kahf, startSeconds: 754 },
        }),
      ),
    ).toBe('invalid');
    expect(
      await mediaRefusal(
        mediaHarness({
          video: { durationSeconds: null },
        }).service.changeVideoQuranPassages(actor, ID(2), 5, {
          op: 'add',
          passage: { ...kahf, startSeconds: 754 },
        }),
      ),
    ).toBe('accepted');
  });

  it('refuses without media.administer, a stale version and a repeated passage', async () => {
    const reader = mediaHarness({ permissions: ['media.read'] });
    expect(
      await mediaRefusal(
        reader.service.changeVideoQuranPassages(actor, ID(2), 5, {
          op: 'add',
          passage: { ...kahf, startSeconds: null },
        }),
      ),
    ).toBe('denied');
    expect(reader.calls).toEqual([]);
    expect(
      await mediaRefusal(
        mediaHarness({}).service.changeVideoQuranPassages(actor, ID(2), 4, {
          op: 'remove',
          position: 0,
        }),
      ),
    ).toBe('conflict');
    expect(
      await mediaRefusal(
        mediaHarness({
          video: { quranPassages: [{ ...kahf, startSeconds: 10 }] },
        }).service.changeVideoQuranPassages(actor, ID(2), 5, {
          op: 'add',
          passage: { ...kahf, startSeconds: null },
        }),
      ),
    ).toBe('duplicate-passage');
  });

  it('applies a proposed set only to a Video that carries none', async () => {
    const { service, calls } = mediaHarness({});
    await service.applyTitleQuranPassages(actor, ID(2), 5, [
      { ...kahf, startSeconds: null },
    ]);
    expect(writes(calls, 'setVideoQuranPassages')[0]?.input).toMatchObject({
      change: 'title',
    });
    expect(
      await mediaRefusal(
        mediaHarness({
          video: { quranPassages: [{ ...kahf, startSeconds: null }] },
        }).service.applyTitleQuranPassages(actor, ID(2), 5, [
          { ...kahf, startSeconds: null },
        ]),
      ),
    ).toBe('conflict');
  });
});

describe('the editors’ passage form, as the admin actions read it', async () => {
  const { passageChangeOf } =
    await import('../../apps/web/src/app/[locale]/admin/quran-passage-form.ts');
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it('reads an added passage: a range, one Ayah, or the whole Surah', () => {
    expect(
      passageChangeOf(
        form({ op: 'add', surah: '18', ayahFrom: '1', ayahTo: '10' }),
        false,
      ),
    ).toEqual({
      op: 'add',
      passage: { surah: 18, ayahFrom: 1, ayahTo: 10 },
    });
    expect(
      passageChangeOf(form({ op: 'add', surah: '2', ayahFrom: '255' }), false),
    ).toEqual({
      op: 'add',
      passage: { surah: 2, ayahFrom: 255, ayahTo: 255 },
    });
    expect(passageChangeOf(form({ op: 'add', surah: '1' }), false)).toEqual({
      op: 'add',
      passage: { surah: 1, ayahFrom: 1, ayahTo: 7 },
    });
  });

  it('reads a lecture’s start, and refuses a malformed one rather than reading zero', () => {
    expect(
      passageChangeOf(
        form({ op: 'add', surah: '2', ayahFrom: '255', start: '12:34' }),
        true,
      ),
    ).toEqual({
      op: 'add',
      passage: { surah: 2, ayahFrom: 255, ayahTo: 255, startSeconds: 754 },
    });
    const bad = passageChangeOf(
      form({ op: 'add', surah: '2', ayahFrom: 'x', start: 'soon' }),
      true,
    ) as {
      passage: { ayahFrom: number; startSeconds: number };
    };
    expect(bad.passage.ayahFrom).toBeNaN();
    expect(bad.passage.startSeconds).toBeNaN();
  });

  it('reads a move and a removal by place, and nothing else', () => {
    expect(
      passageChangeOf(form({ op: 'move', position: '2', direction: 'later' }), false),
    ).toEqual({
      op: 'move',
      position: 2,
      direction: 'later',
    });
    expect(
      passageChangeOf(form({ op: 'remove', position: '0', surah: '1' }), false),
    ).toEqual({
      op: 'remove',
      position: 0,
    });
  });
});
