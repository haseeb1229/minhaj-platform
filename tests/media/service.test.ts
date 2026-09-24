import { describe, expect, it } from 'vitest';

import type {
  MediaPersistencePort,
  PlaylistDetail,
  SeriesRecord,
  VideoListing,
  VideoRecord,
} from '../../packages/contracts/src/media/index.ts';
import {
  createMediaService,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';

/**
 * Phase 10 — the Media service's rules, over fake ports.
 *
 * WHAT IS PROVED HERE, AND ONLY HERE CHEAPLY: every read requires `media.read`
 * and every change `media.administer`, asked of the authority LIVE; references
 * are asked of their owners and a refused one refuses the save; an edit names a
 * version and a create does not; and a Playlist change applies to the version
 * the operator saw or not at all. The SQL half is `media.integration.test.ts`.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YT = 'dQw4w9WgXcQ';

const listing = (id: string): VideoListing => ({
  id,
  slug: `video-${id.slice(-4)}`,
  primaryLocale: 'en',
  state: 'published',
  isFeatured: false,
  provider: 'youtube',
  availability: 'available',
  format: null,
  languageCode: 'en',
  labels: [{ locale: 'en', title: 'Synthetic', description: '' }],
  durationSeconds: null,
  publishedOn: null,
  seriesPosition: null,
  speakerIds: [],
  version: 1,
  updatedAt: new Date(0),
});

function harness(
  options: {
    readonly permissions?: readonly string[];
    readonly references?: boolean;
    readonly series?: SeriesRecord | null;
    readonly playlist?: PlaylistDetail | null;
    readonly videoExists?: boolean;
  } = {},
) {
  const calls: { readonly method: string; readonly input?: unknown }[] = [];
  const permissions = new Set(options.permissions ?? ['media.read', 'media.administer']);
  const asked: string[] = [];

  const persistence = new Proxy({} as MediaPersistencePort, {
    get(_target, method: string) {
      return async (input?: unknown) => {
        calls.push({ method, input });
        if (method === 'series') return options.series ?? null;
        if (method === 'playlist') return options.playlist ?? null;
        if (method === 'video')
          return options.videoExists === false ? null : ({ id: ID(9) } as VideoRecord);
        return { saved: method };
      };
    },
  });

  const service = createMediaService({
    persistence,
    authority: {
      async permits(accountId, permission) {
        asked.push(`${accountId}:${permission}`);
        return permissions.has(permission);
      },
    },
    references: {
      validPeople: async () => options.references ?? true,
      validTopics: async () => options.references ?? true,
      validLanguage: async () => options.references ?? true,
    },
  });

  return { service, calls, asked };
}

const actor = { accountId: ID(100) };

const videoInput = (overrides: Record<string, unknown> = {}) => ({
  slug: 'synthetic-video',
  primaryLocale: 'en',
  state: 'draft',
  isFeatured: false,
  provider: 'youtube',
  providerReference: YT,
  availability: 'available',
  format: null,
  languageCode: 'en',
  labels: [{ locale: 'en', title: 'Synthetic', description: '' }],
  durationSeconds: null,
  publishedOn: null,
  thumbnailUrl: null,
  captions: false,
  transcript: null,
  seriesId: null,
  seriesPosition: null,
  speakerIds: [],
  topicIds: [],
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return mediaFailure(error);
  }
  return 'accepted';
}

describe('authority', () => {
  it('refuses every read without media.read, and asks live each time', async () => {
    const { service, calls, asked } = harness({ permissions: [] });
    expect(await failure(service.videos(actor))).toBe('denied');
    expect(await failure(service.video(actor, ID(1)))).toBe('denied');
    expect(await failure(service.playlists(actor))).toBe('denied');
    expect(await failure(service.seriesDirectory(actor))).toBe('denied');
    expect(calls).toEqual([]);
    expect(asked).toHaveLength(4);
  });

  it('refuses every change to a reader who may only look', async () => {
    const { service, calls } = harness({ permissions: ['media.read'] });
    expect(await failure(service.saveVideo(actor, null, null, videoInput()))).toBe(
      'denied',
    );
    expect(
      await failure(
        service.saveSeries(actor, null, null, {
          slug: 'x-series',
          kind: 'series',
          primaryLocale: 'en',
          state: 'draft',
          labels: [{ locale: 'en', title: 'x', description: '' }],
        }),
      ),
    ).toBe('denied');
    expect(
      await failure(
        service.changePlaylist(actor, ID(1), 1, { op: 'remove', videoId: ID(2) }),
      ),
    ).toBe('denied');
    expect(calls).toEqual([]);
  });

  it('refuses an actor with no account at all', async () => {
    const { service, asked } = harness();
    expect(await failure(service.videos({ accountId: '' }))).toBe('denied');
    expect(asked).toEqual([]);
  });
});

describe('saving a Video', () => {
  it('stores the parsed provider identifier, never what was typed', async () => {
    const { service, calls } = harness();
    await service.saveVideo(
      actor,
      null,
      null,
      videoInput({ providerReference: `https://youtu.be/${YT}` }),
    );
    const saved = calls.find((call) => call.method === 'saveVideo')?.input as {
      value: Record<string, unknown>;
    };
    expect(saved.value['providerVideoId']).toBe(YT);
    expect(saved.value).not.toHaveProperty('providerReference');
  });

  it('refuses a speaker, topic or language its owner does not know', async () => {
    const { service, calls } = harness({ references: false });
    expect(await failure(service.saveVideo(actor, null, null, videoInput()))).toBe(
      'invalid',
    );
    expect(calls.some((call) => call.method === 'saveVideo')).toBe(false);
  });

  it('refuses a Series that does not exist', async () => {
    const { service } = harness({ series: null });
    expect(
      await failure(
        service.saveVideo(
          actor,
          null,
          null,
          videoInput({ seriesId: ID(5), seriesPosition: 1 }),
        ),
      ),
    ).toBe('invalid');
  });

  it('requires a version to edit, and refuses one on a create', async () => {
    const { service } = harness();
    expect(await failure(service.saveVideo(actor, ID(1), null, videoInput()))).toBe(
      'invalid',
    );
    expect(await failure(service.saveVideo(actor, null, 3, videoInput()))).toBe(
      'invalid',
    );
    expect(await failure(service.saveVideo(actor, 'not-an-id', 1, videoInput()))).toBe(
      'invalid',
    );
  });
});

describe('changing a Playlist', () => {
  const playlist = (version: number, ids: readonly string[]): PlaylistDetail => ({
    id: ID(50),
    slug: 'synthetic-playlist',
    primaryLocale: 'en',
    state: 'published',
    labels: [{ locale: 'en', title: 'Synthetic', description: '' }],
    version,
    updatedAt: new Date(0),
    videos: ids.map(listing),
  });

  it('applies the change to the version the operator saw', async () => {
    const { service, calls } = harness({ playlist: playlist(4, [ID(1), ID(2)]) });
    await service.changePlaylist(actor, ID(50), 4, {
      op: 'move',
      videoId: ID(2),
      direction: 'earlier',
    });
    expect(calls.find((call) => call.method === 'setPlaylistVideos')?.input).toEqual({
      actorId: actor.accountId,
      playlistId: ID(50),
      expectedVersion: 4,
      videoIds: [ID(2), ID(1)],
      change: 'move',
    });
  });

  it('refuses a stale version, a duplicate, an unknown Video and a missing Playlist', async () => {
    expect(
      await failure(
        harness({ playlist: playlist(5, [ID(1)]) }).service.changePlaylist(
          actor,
          ID(50),
          4,
          {
            op: 'remove',
            videoId: ID(1),
          },
        ),
      ),
    ).toBe('conflict');
    expect(
      await failure(
        harness({ playlist: playlist(1, [ID(1)]) }).service.changePlaylist(
          actor,
          ID(50),
          1,
          {
            op: 'add',
            videoId: ID(1),
          },
        ),
      ),
    ).toBe('duplicate-member');
    expect(
      await failure(
        harness({ playlist: playlist(1, []), videoExists: false }).service.changePlaylist(
          actor,
          ID(50),
          1,
          { op: 'add', videoId: ID(7) },
        ),
      ),
    ).toBe('invalid');
    expect(
      await failure(
        harness({ playlist: null }).service.changePlaylist(actor, ID(50), 1, {
          op: 'remove',
          videoId: ID(1),
        }),
      ),
    ).toBe('not-found');
  });

  it('accepts only a named change, never a list', async () => {
    const { service } = harness({ playlist: playlist(1, [ID(1)]) });
    expect(
      await failure(
        service.changePlaylist(actor, ID(50), 1, { op: 'replace', videoIds: [] }),
      ),
    ).toBe('invalid');
  });
});

describe('failure labels', () => {
  it('maps only known refusals, and everything else to unavailable', () => {
    expect(
      mediaFailure(Object.assign(new Error('x'), { reason: 'duplicate-video' })),
    ).toBe('duplicate-video');
    expect(mediaFailure(Object.assign(new Error('x'), { reason: 'SELECT * FROM' }))).toBe(
      'unavailable',
    );
    expect(mediaFailure(new Error('connection reset'))).toBe('unavailable');
  });
});
