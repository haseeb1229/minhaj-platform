import { describe, expect, it } from 'vitest';

import type {
  MediaAssetRelationPort,
  MediaPersistencePort,
} from '../../packages/contracts/src/media/index.ts';
import { videoInputSchema } from '../../packages/contracts/src/media/index.ts';
import {
  createMediaService,
  createVideoPosterPolicy,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';

/**
 * Phase 30-R — a Video's first-party POSTER, over fake ports.
 *
 * Proved here: the poster is ONE typed asset reference with a bounded box; an
 * update that omits it keeps the stored one (it is absent from the parsed
 * value) while `null` removes it; a poster is recorded only when Storage says
 * the asset is a servable still image right now, and a service built without
 * that answer refuses every poster; and the byte policy allows exactly the
 * recorded poster of a published Video.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YT = 'dQw4w9WgXcQ';
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

const poster = { assetId: ID(7), width: 640, height: 360 };

function harness(images?: ReadonlySet<string>) {
  const saved: unknown[] = [];
  const persistence = new Proxy({} as MediaPersistencePort, {
    get(_target, method: string) {
      return async (input?: unknown) => {
        if (method === 'saveVideo') saved.push(input);
        return { saved: method };
      };
    },
  });
  const service = createMediaService({
    persistence,
    authority: { permits: async () => true },
    references: {
      validPeople: async () => true,
      validTopics: async () => true,
      validLanguage: async () => true,
    },
    ...(images === undefined
      ? {}
      : {
          images: {
            servableImages: async (ids) => new Set(ids.filter((id) => images.has(id))),
          },
        }),
  });
  return { service, saved };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return mediaFailure(error);
  }
  return 'none';
}

describe('a Video poster as input', () => {
  it('is optional, and an omitted poster is absent from the value (kept on update)', () => {
    const value = videoInputSchema.parse(videoInput());
    expect('poster' in value).toBe(false);
    expect(videoInputSchema.parse(videoInput({ poster: null })).poster).toBeNull();
    expect(videoInputSchema.parse(videoInput({ poster })).poster).toEqual(poster);
  });

  it('refuses a malformed asset, an unbounded box, or a remote URL in its place', () => {
    for (const bad of [
      { ...poster, assetId: 'not-a-uuid' },
      { ...poster, width: 0 },
      { ...poster, height: 16_385 },
      { ...poster, url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' },
      'https://i.ytimg.com/vi/x/hqdefault.jpg',
    ])
      expect(videoInputSchema.safeParse(videoInput({ poster: bad })).success).toBe(false);
  });
});

describe('recording a poster', () => {
  it('records a poster Storage says is a servable still image', async () => {
    const { service, saved } = harness(new Set([poster.assetId]));
    await service.saveVideo(actor, null, null, videoInput({ poster }));
    expect(saved).toHaveLength(1);
  });

  it('refuses one Storage does not serve as an image, and saves nothing', async () => {
    const { service, saved } = harness(new Set());
    expect(
      await failure(service.saveVideo(actor, null, null, videoInput({ poster }))),
    ).toBe('invalid');
    expect(saved).toHaveLength(0);
  });

  it('fails closed when the service was built without the image answer', async () => {
    const { service, saved } = harness();
    expect(
      await failure(service.saveVideo(actor, null, null, videoInput({ poster }))),
    ).toBe('invalid');
    expect(saved).toHaveLength(0);
    // No poster needs no answer.
    await service.saveVideo(actor, null, null, videoInput());
    expect(saved).toHaveLength(1);
  });
});

describe('the poster byte policy', () => {
  const asset = (assetId: string, mediaType = 'image/jpeg') => ({
    assetId,
    mediaType,
    byteSize: 1,
    checksum: '0'.repeat(64),
  });
  const relations = (
    state: 'draft' | 'published' | 'archived',
    assetId: string | null,
  ): MediaAssetRelationPort => ({
    audioAsset: async () => null,
    photoAsset: async () => null,
    videoPoster: async (videoId) => (videoId === ID(1) ? { state, assetId } : null),
  });
  const decide = (
    rel: MediaAssetRelationPort,
    request: { videoId: string; assetId: string },
    resolved = asset(request.assetId),
  ) => createVideoPosterPolicy({ relations: rel, request }).decide(resolved);

  it("allows exactly a published Video's recorded poster", async () => {
    expect(
      await decide(relations('published', ID(7)), { videoId: ID(1), assetId: ID(7) }),
    ).toBe('allow');
  });

  it('denies a draft or archived Video, another asset, another Video and a non-image', async () => {
    const request = { videoId: ID(1), assetId: ID(7) };
    expect(await decide(relations('draft', ID(7)), request)).toBe('deny');
    expect(await decide(relations('archived', ID(7)), request)).toBe('deny');
    expect(await decide(relations('published', ID(8)), request)).toBe('deny');
    expect(
      await decide(relations('published', ID(7)), { videoId: ID(2), assetId: ID(7) }),
    ).toBe('deny');
    expect(
      await decide(
        relations('published', ID(7)),
        request,
        asset(ID(7), 'application/pdf'),
      ),
    ).toBe('deny');
    // The asset Storage resolved must be the one the URL named.
    expect(await decide(relations('published', ID(7)), request, asset(ID(8)))).toBe(
      'deny',
    );
  });
});
