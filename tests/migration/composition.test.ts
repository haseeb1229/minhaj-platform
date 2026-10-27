import { describe, expect, it } from 'vitest';

import type {
  VideoListing,
  VideoRecord,
} from '../../packages/contracts/src/media/index.ts';
import type { StagedVideoPayload } from '../../packages/contracts/src/migration/index.ts';
import type {
  StorageServicePort,
  StoredAsset,
  UploadPolicy,
} from '../../packages/contracts/src/platform/index.ts';
import {
  mediaVideoTargetOver,
  type MediaVideoOperations,
} from '../../apps/web/src/composition/migration-targets.ts';
import {
  MIGRATION_ASSET_MAX_BYTES,
  MIGRATION_ASSET_MEDIA_TYPES,
  livePermits,
  migrationAssetStorage,
  migrationAuthority,
  migrationTopics,
} from '../../apps/web/src/composition/migration-wiring.ts';

/**
 * Phase 29 — the Layer-4 pieces Migration is composed from, over fakes.
 *
 * THE MEDIA TARGET: a payload becomes exactly Media's own Video input; an
 * interrupted publication is resumed by ADOPTING the Video it made — only a
 * published Video with the payload's provider identity AND slug — and never by
 * a second save; Media's refusals stay refusals and its outages become
 * `unavailable`; withdrawal archives at the published version and changes no
 * other value. THE WIRING: the publisher is re-verified for exactly
 * `migration.publish` + `migration-publication`; an unknown permission key is
 * a denial never put to Identity; topics are asked in Taxonomy's bounded
 * batches; Storage is asked for still images and PDFs only, and its custody
 * states map faithfully.
 *
 * Phase 30 adds the Library and Editorial targets and the router, proved over
 * stateful fakes of each domain's operations in `./publication-targets.test.ts`.
 */

const ACTOR = { accountId: '00000000-0000-4000-8000-0000000000aa' };
const VIDEO_ID = '00000000-0000-4000-8000-000000000001';
const TOPIC = '00000000-0000-4000-8000-0000000000f1';
/** No assets and no other migrated record: the Video target uses neither. */
const NO_LINKS = { assets: [], resolve: async () => null };

const PAYLOAD: StagedVideoPayload = {
  kind: 'media.video',
  slug: 'fixture-v001-proof',
  primaryLocale: 'ur',
  languageCode: 'ur',
  provider: 'youtube',
  providerVideoId: 'AbCdEfGhIj0',
  labels: [
    { locale: 'ur', title: 'FIXTURE عنوان', description: 'FIXTURE تفصیل' },
    { locale: 'en', title: 'FIXTURE title', description: 'FIXTURE description' },
  ],
  descriptionHtml: '<p>FIXTURE تفصیل</p>',
  publishedOn: '2020-01-02',
  durationSeconds: 3600,
  legacyIdentifier: 'v001',
};

function record(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: VIDEO_ID,
    slug: PAYLOAD.slug,
    primaryLocale: 'ur',
    state: 'published',
    isFeatured: false,
    provider: 'youtube',
    providerVideoId: PAYLOAD.providerVideoId,
    availability: 'available',
    format: null,
    languageCode: 'ur',
    labels: PAYLOAD.labels.map((label) => ({ ...label })),
    durationSeconds: 3600,
    publishedOn: '2020-01-02',
    thumbnailUrl: null,
    captions: false,
    transcript: null,
    series: null,
    speakerIds: [],
    topicIds: [TOPIC],
    version: 1,
    updatedAt: new Date('2026-10-23T00:00:00Z'),
    ...overrides,
  };
}

const listing = (video: VideoRecord): VideoListing => ({
  id: video.id,
  slug: video.slug,
  primaryLocale: video.primaryLocale,
  state: video.state,
  isFeatured: video.isFeatured,
  provider: video.provider,
  availability: video.availability,
  format: video.format,
  languageCode: video.languageCode,
  labels: video.labels,
  durationSeconds: video.durationSeconds,
  publishedOn: video.publishedOn,
  seriesPosition: null,
  speakerIds: video.speakerIds,
  version: video.version,
  updatedAt: video.updatedAt,
});

const refusal = (reason: string) => Object.assign(new Error(reason), { reason });

interface Calls {
  saves: {
    id: string | null;
    expectedVersion: number | null;
    input: Record<string, unknown>;
  }[];
  queries: unknown[];
}

/** A fake Media: `save` decides the save's answer; `stored` is what the reads see. */
function fakeMedia(options: {
  readonly save?: (
    input: Record<string, unknown>,
    id: string | null,
  ) => VideoRecord | Error;
  readonly stored?: readonly VideoRecord[];
  readonly read?: () => Error | null;
}): { media: MediaVideoOperations; calls: Calls } {
  const calls: Calls = { saves: [], queries: [] };
  const stored = options.stored ?? [];
  const media = {
    async saveVideo(
      _actor: unknown,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      const input = raw as Record<string, unknown>;
      calls.saves.push({ id, expectedVersion, input });
      const answer = options.save?.(input, id) ?? record();
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async video(_actor: unknown, id: string) {
      const failure = options.read?.();
      if (failure) throw failure;
      return stored.find((video) => video.id === id) ?? null;
    },
    async videos(_actor: unknown, raw: unknown = {}) {
      calls.queries.push(raw);
      const failure = options.read?.();
      if (failure) throw failure;
      const query = raw as { offset: number; text: string | null };
      const matching = stored.filter((video) => video.slug.includes(query.text ?? ''));
      return {
        items: matching.slice(query.offset, query.offset + 24).map(listing),
        hasMore: matching.length > query.offset + 24,
      };
    },
  } as unknown as MediaVideoOperations;
  return { media, calls };
}

const notHeld = { videoHeld: async () => false };

describe('Phase 29 Media publication target', () => {
  it('serves media.video only', () => {
    const target = mediaVideoTargetOver({
      media: fakeMedia({}).media,
      holdings: notHeld,
    });
    expect(target.supports('media.video')).toBe(true);
    expect(target.supports('editorial.article' as never)).toBe(false);
  });

  it('publishes the payload as exactly Media’s own published Video input', async () => {
    const { media, calls } = fakeMedia({ save: () => record({ version: 1 }) });
    const target = mediaVideoTargetOver({ media, holdings: notHeld });
    const result = await target.publish({
      kind: 'media.video',
      payload: PAYLOAD,
      ...NO_LINKS,
      topicIds: [TOPIC],
      actor: ACTOR,
      resumed: false,
    });
    expect(result).toEqual({
      status: 'published',
      target: { kind: 'media.video', id: VIDEO_ID },
      stage: 'public',
      version: 1,
      canonicalPath: `/watch/videos/${PAYLOAD.slug}`,
    });
    expect(calls.saves).toHaveLength(1);
    expect(calls.saves[0]).toEqual({
      id: null,
      expectedVersion: null,
      input: {
        slug: PAYLOAD.slug,
        primaryLocale: 'ur',
        state: 'published',
        isFeatured: false,
        provider: 'youtube',
        providerReference: PAYLOAD.providerVideoId,
        availability: 'available',
        format: null,
        languageCode: 'ur',
        labels: PAYLOAD.labels,
        durationSeconds: 3600,
        publishedOn: '2020-01-02',
        thumbnailUrl: null,
        captions: false,
        transcript: null,
        seriesId: null,
        seriesPosition: null,
        speakerIds: [],
        topicIds: [TOPIC],
      },
    });
  });

  it('adopts, without saving again, the published Video an interrupted publication made', async () => {
    for (const reason of ['duplicate-video', 'duplicate-slug']) {
      const existing = record({ version: 3 });
      const { media, calls } = fakeMedia({
        save: () => refusal(reason),
        stored: [
          record({
            id: '00000000-0000-4000-8000-0000000000b0',
            slug: `${PAYLOAD.slug}-other`,
          }),
          existing,
        ],
      });
      const result = await mediaVideoTargetOver({ media, holdings: notHeld }).publish({
        kind: 'media.video',
        payload: PAYLOAD,
        ...NO_LINKS,
        topicIds: [],
        actor: ACTOR,
        resumed: true,
      });
      expect(result).toEqual({
        status: 'published',
        target: { kind: 'media.video', id: existing.id },
        stage: 'public',
        version: 3,
        canonicalPath: `/watch/videos/${PAYLOAD.slug}`,
      });
      expect(calls.saves).toHaveLength(1);
      expect(calls.queries[0]).toEqual({ offset: 0, state: null, text: PAYLOAD.slug });
    }
  });

  it('refuses to adopt anything that is not exactly this payload’s published Video', async () => {
    const cases: [readonly VideoRecord[], string][] = [
      [[record({ state: 'archived' })], 'target-not-published'],
      [[record({ state: 'draft' })], 'target-not-published'],
      [[record({ providerVideoId: 'ZZZZZZZZZZZ' })], 'target-conflict'],
      [[record({ provider: 'vimeo', providerVideoId: '123456' })], 'target-conflict'],
      [[record({ slug: `${PAYLOAD.slug}-2` })], 'target-conflict'],
      [[], 'target-conflict'],
    ];
    for (const [stored, reason] of cases) {
      const { media, calls } = fakeMedia({
        save: () => refusal('duplicate-video'),
        stored,
      });
      const result = await mediaVideoTargetOver({ media, holdings: notHeld }).publish({
        kind: 'media.video',
        payload: PAYLOAD,
        ...NO_LINKS,
        topicIds: [],
        actor: ACTOR,
        resumed: true,
      });
      expect(result).toEqual({ status: 'refused', reason });
      expect(calls.saves).toHaveLength(1);
    }
  });

  it('refuses, without adopting, an existing Video met by a FRESH entry', async () => {
    for (const reason of ['duplicate-video', 'duplicate-slug']) {
      const { media, calls } = fakeMedia({
        save: () => refusal(reason),
        stored: [record({ version: 2 })],
      });
      const result = await mediaVideoTargetOver({ media, holdings: notHeld }).publish({
        kind: 'media.video',
        payload: PAYLOAD,
        ...NO_LINKS,
        topicIds: [],
        actor: ACTOR,
        resumed: false,
      });
      expect(result).toEqual({ status: 'refused', reason: 'target-exists' });
      expect(calls.saves).toHaveLength(1);
      expect(calls.queries).toHaveLength(0);
    }
  });

  it('keeps Media’s refusals as refusals and its outages as unavailable', async () => {
    for (const reason of ['denied', 'invalid', 'conflict']) {
      const { media } = fakeMedia({ save: () => refusal(reason) });
      expect(
        await mediaVideoTargetOver({ media, holdings: notHeld }).publish({
          kind: 'media.video',
          payload: PAYLOAD,
          ...NO_LINKS,
          topicIds: [],
          actor: ACTOR,
          resumed: false,
        }),
      ).toEqual({ status: 'refused', reason });
    }
    const outage = fakeMedia({ save: () => new Error('socket hang up') });
    expect(
      await mediaVideoTargetOver({ media: outage.media, holdings: notHeld }).publish({
        kind: 'media.video',
        payload: PAYLOAD,
        ...NO_LINKS,
        topicIds: [],
        actor: ACTOR,
        resumed: false,
      }),
    ).toEqual({ status: 'unavailable' });
    const adoptionOutage = fakeMedia({
      save: () => refusal('duplicate-video'),
      read: () => new Error('timeout'),
    });
    expect(
      await mediaVideoTargetOver({
        media: adoptionOutage.media,
        holdings: notHeld,
      }).publish({
        kind: 'media.video',
        payload: PAYLOAD,
        ...NO_LINKS,
        topicIds: [],
        actor: ACTOR,
        resumed: true,
      }),
    ).toEqual({ status: 'unavailable' });
  });

  it('inspects existence, version and whether a person holds the Video', async () => {
    const { media } = fakeMedia({ stored: [record({ version: 4 })] });
    const asked: string[] = [];
    const target = mediaVideoTargetOver({
      media,
      holdings: {
        videoHeld: async (id) => {
          asked.push(id);
          return true;
        },
      },
    });
    expect(
      await target.inspect({
        target: { kind: 'media.video', id: VIDEO_ID },
        actor: ACTOR,
      }),
    ).toEqual({
      exists: true,
      version: 4,
      referencedByPeople: true,
    });
    expect(asked).toEqual([VIDEO_ID]);
    expect(
      await target.inspect({
        target: { kind: 'media.video', id: '00000000-0000-4000-8000-0000000000c0' },
        actor: ACTOR,
      }),
    ).toEqual({ exists: false, version: 0, referencedByPeople: false });
  });

  it('withdraws by archiving at the published version and changing nothing else', async () => {
    const current = record({
      version: 2,
      isFeatured: true,
      thumbnailUrl: 'https://i.ytimg.com/vi/AbCdEfGhIj0/hqdefault.jpg',
      transcript: 'FIXTURE transcript',
      captions: true,
      format: 'lecture',
      speakerIds: ['00000000-0000-4000-8000-0000000000d1'],
      series: {
        id: '00000000-0000-4000-8000-0000000000e1',
        slug: 'fixture-series',
        kind: 'series',
        primaryLocale: 'en',
        labels: [],
        state: 'published',
        position: 7,
      },
    });
    const { media, calls } = fakeMedia({
      stored: [current],
      save: () => record({ version: 3, state: 'archived' }),
    });
    const target = mediaVideoTargetOver({ media, holdings: notHeld });
    expect(
      await target.withdraw({
        target: { kind: 'media.video', id: VIDEO_ID },
        expectedVersion: 2,
        actor: ACTOR,
      }),
    ).toEqual({ status: 'withdrawn', version: 3 });
    expect(calls.saves).toEqual([
      {
        id: VIDEO_ID,
        expectedVersion: 2,
        input: {
          slug: current.slug,
          primaryLocale: 'ur',
          state: 'archived',
          isFeatured: true,
          provider: 'youtube',
          providerReference: current.providerVideoId,
          availability: 'available',
          format: 'lecture',
          languageCode: 'ur',
          labels: current.labels,
          durationSeconds: 3600,
          publishedOn: '2020-01-02',
          thumbnailUrl: current.thumbnailUrl,
          captions: true,
          transcript: 'FIXTURE transcript',
          seriesId: '00000000-0000-4000-8000-0000000000e1',
          seriesPosition: 7,
          speakerIds: current.speakerIds,
          topicIds: [TOPIC],
        },
      },
    ]);
  });

  it('refuses to withdraw a Video edited since publication, or one that is gone', async () => {
    const edited = fakeMedia({ stored: [record({ version: 5 })] });
    expect(
      await mediaVideoTargetOver({ media: edited.media, holdings: notHeld }).withdraw({
        target: { kind: 'media.video', id: VIDEO_ID },
        expectedVersion: 2,
        actor: ACTOR,
      }),
    ).toEqual({ status: 'refused', reason: 'conflict' });
    expect(edited.calls.saves).toEqual([]);
    const gone = fakeMedia({ stored: [] });
    expect(
      await mediaVideoTargetOver({ media: gone.media, holdings: notHeld }).withdraw({
        target: { kind: 'media.video', id: VIDEO_ID },
        expectedVersion: 2,
        actor: ACTOR,
      }),
    ).toEqual({ status: 'refused', reason: 'not-found' });
  });
});

describe('Phase 29 Migration wiring', () => {
  it('re-verifies the publisher for exactly migration.publish with a migration-publication step-up', async () => {
    const asked: unknown[] = [];
    const authority = migrationAuthority({
      hasPermission: async () => true,
      verifyPrivilegedActor: async (input) => {
        asked.push(input);
        return true;
      },
    });
    const actor = { authorisation: 'verified', accountId: ACTOR.accountId };
    expect(await authority.verifyPublisher(actor)).toBe(ACTOR.accountId);
    expect(asked).toEqual([
      { actor, permission: 'migration.publish', stepUp: 'migration-publication' },
    ]);
    for (const plain of [null, undefined, 'actor', 42])
      expect(await authority.verifyPublisher(plain)).toBeNull();
    expect(asked).toHaveLength(1);

    const refusing = migrationAuthority({
      hasPermission: async () => true,
      verifyPrivilegedActor: async () => false,
    });
    expect(await refusing.verifyPublisher(actor)).toBeNull();
  });

  it('denies a permission key the catalogue does not know without asking Identity', async () => {
    const asked: string[] = [];
    const permits = livePermits({
      hasPermission: async (_account, permission) => {
        asked.push(permission);
        return true;
      },
      verifyPrivilegedActor: async () => false,
    });
    expect(await permits(ACTOR.accountId, 'migration.read')).toBe(true);
    expect(await permits(ACTOR.accountId, 'migration.everything')).toBe(false);
    expect(asked).toEqual(['migration.read']);
  });

  it('asks Taxonomy about topics in bounded batches and answers only the ones it knows', async () => {
    const batches: number[] = [];
    const ids = Array.from(
      { length: 650 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const topics = migrationTopics(async (asked) => {
      batches.push(asked.length);
      return asked.filter((_, index) => index % 2 === 0).map((id) => ({ id }));
    });
    const found = await topics.existingTopics([...ids, ...ids.slice(0, 10)]);
    expect(batches).toEqual([300, 300, 50]);
    expect(found.size).toBe(325);
  });

  it('stores acquired bytes through Storage as images or PDFs only, mapping custody faithfully', async () => {
    const policies: UploadPolicy[] = [];
    const answers: StoredAsset[] = [
      {
        id: 'a1',
        state: 'clean',
        mediaType: 'image/png',
        byteSize: 3,
        checksum: 'c1',
        rejection: null,
      },
      {
        id: 'a2',
        state: 'quarantined',
        mediaType: 'application/pdf',
        byteSize: 3,
        checksum: 'c2',
        rejection: null,
      },
      {
        id: 'a3',
        state: 'rejected',
        mediaType: 'text/html',
        byteSize: 3,
        checksum: 'c3',
        rejection: 'detected-type-not-allowed',
      },
      {
        id: 'a4',
        state: 'failed',
        mediaType: 'image/png',
        byteSize: 3,
        checksum: 'c4',
        rejection: null,
      },
    ];
    const storage = {
      async store(bytes: AsyncIterable<Uint8Array>, policy: UploadPolicy) {
        let size = 0;
        for await (const chunk of bytes) size += chunk.byteLength;
        expect(size).toBe(3);
        policies.push(policy);
        const answer = answers.shift();
        if (answer === undefined) throw new Error('no answer');
        return answer;
      },
    } as unknown as StorageServicePort;
    const port = migrationAssetStorage(async () => storage);
    const input = {
      bytes: new Uint8Array([1, 2, 3]),
      declaredMediaType: 'image/png',
      displayName: null,
    };

    expect(await port.store(input)).toEqual({
      status: 'stored',
      assetId: 'a1',
      mediaType: 'image/png',
      byteSize: 3,
      checksum: 'c1',
      clean: true,
    });
    expect(await port.store(input)).toMatchObject({
      status: 'stored',
      assetId: 'a2',
      clean: false,
    });
    expect(await port.store(input)).toEqual({
      status: 'rejected',
      reason: 'detected-type-not-allowed',
    });
    await expect(port.store(input)).rejects.toThrow(/custody/);
    for (const policy of policies) {
      expect(policy.allowedMediaTypes).toEqual([
        'image/png',
        'image/jpeg',
        'application/pdf',
      ]);
      expect(policy.maxBytes).toBe(8 * 1024 * 1024);
      expect(policy.image).toBeUndefined();
      expect(policy.declaredMediaType).toBe('image/png');
    }
    expect(MIGRATION_ASSET_MEDIA_TYPES).toEqual([
      'image/png',
      'image/jpeg',
      'application/pdf',
    ]);
    expect(MIGRATION_ASSET_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
