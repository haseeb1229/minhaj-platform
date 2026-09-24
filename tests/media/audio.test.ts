import { describe, expect, it } from 'vitest';

import {
  AUDIO_MEDIA_TYPES,
  AUDIO_UPLOAD_MAX_BYTES,
  audioSeriesInputSchema,
  audioTrackInputSchema,
  type AudioAssetRelation,
  type AudioTrackRecord,
  type MediaPersistencePort,
} from '../../packages/contracts/src/media/index.ts';
import type {
  AssetAccessRequest,
  StorageServicePort,
  StoredAsset,
  UploadPolicy,
} from '../../packages/contracts/src/platform/storage.ts';
import {
  createAudioAssetPolicy,
  createAudioUpload,
  createMediaService,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';

/**
 * Phase 11 — the audio rules, over fake ports.
 *
 * WHAT IS PROVED HERE CHEAPLY: an AudioTrack cannot describe a Quran recitation
 * (the schema refuses the shape, not merely ignores it); a published track must
 * have audio; the upload re-checks authority and the version BEFORE a byte is
 * stored, attaches only a CLEAN asset and names Storage's refusals in words the
 * screen has; and the serving policy allows only the exact asset of a published
 * track — or, for a preview, a live administrator. The SQL, filesystem and real
 * scanner halves are `tests/storage/media-audio.integration.test.ts`.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { accountId: ID(100) };

const trackInput = (overrides: Record<string, unknown> = {}) => ({
  slug: 'synthetic-track',
  primaryLocale: 'en',
  state: 'draft',
  languageCode: 'en',
  labels: [{ locale: 'en', title: 'Synthetic recording', description: '' }],
  durationSeconds: null,
  recordedOn: null,
  transcript: null,
  seriesId: null,
  seriesPosition: null,
  speakerIds: [],
  topicIds: [],
  ...overrides,
});

const record = (overrides: Partial<AudioTrackRecord> = {}): AudioTrackRecord => ({
  id: ID(1),
  slug: 'synthetic-track',
  primaryLocale: 'en',
  state: 'draft',
  languageCode: 'en',
  labels: [{ locale: 'en', title: 'Synthetic recording', description: '' }],
  durationSeconds: null,
  recordedOn: null,
  transcript: null,
  assetId: null,
  series: null,
  speakerIds: [],
  topicIds: [],
  version: 3,
  updatedAt: new Date(0),
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

/* ===========================================================================
 * The Quran boundary, and the smallest shape
 * ========================================================================= */

describe('an AudioTrack can never describe a Quran recitation', () => {
  it.each([
    ['a reciter', { reciter: 'synthetic' }],
    ['a Surah', { surah: 1 }],
    ['an Ayah range', { ayahFrom: 1, ayahTo: 7 }],
    ['a Juz', { juz: 30 }],
    ['a recitation kind', { kind: 'recitation' }],
    ['a recitation format', { format: 'recitation' }],
    ['an isQuran flag', { isQuran: true }],
    ['a Recitation reference', { recitationId: ID(7) }],
  ])('refuses %s rather than ignoring it', (_label, extra) => {
    expect(audioTrackInputSchema.safeParse(trackInput(extra)).success).toBe(false);
  });

  it('accepts the plain non-Quran shape', () => {
    expect(audioTrackInputSchema.safeParse(trackInput()).success).toBe(true);
  });

  it('accepts no asset identifier from a form', () => {
    // The file is attached only by uploading it; no form can name an asset.
    expect(audioTrackInputSchema.safeParse(trackInput({ assetId: ID(8) })).success).toBe(
      false,
    );
  });

  it('keeps an AudioSeries free of the Video series kind', () => {
    const base = {
      slug: 'synthetic-series',
      primaryLocale: 'en',
      state: 'draft',
      labels: [{ locale: 'en', title: 'Synthetic series', description: '' }],
    };
    expect(audioSeriesInputSchema.safeParse(base).success).toBe(true);
    expect(audioSeriesInputSchema.safeParse({ ...base, kind: 'program' }).success).toBe(
      false,
    );
  });

  it('pairs a series with its place, exactly', () => {
    expect(
      audioTrackInputSchema.safeParse(
        trackInput({ seriesId: ID(2), seriesPosition: null }),
      ).success,
    ).toBe(false);
    expect(
      audioTrackInputSchema.safeParse(trackInput({ seriesId: null, seriesPosition: 1 }))
        .success,
    ).toBe(false);
    expect(
      audioTrackInputSchema.safeParse(trackInput({ seriesId: ID(2), seriesPosition: 1 }))
        .success,
    ).toBe(true);
  });

  it('accepts one playable format, within a technical ceiling', () => {
    expect([...AUDIO_MEDIA_TYPES]).toEqual(['audio/mpeg']);
    expect(AUDIO_UPLOAD_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});

/* ===========================================================================
 * The administrative service
 * ========================================================================= */

function serviceHarness(
  options: {
    readonly permissions?: readonly string[];
    readonly current?: AudioTrackRecord | null;
    readonly seriesExists?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const permissions = new Set(options.permissions ?? ['media.read', 'media.administer']);
  const persistence = new Proxy({} as MediaPersistencePort, {
    get(_target, method: string) {
      return async () => {
        calls.push(method);
        if (method === 'audioTrack') return options.current ?? null;
        if (method === 'audioSeries')
          return options.seriesExists === false ? null : { id: ID(2) };
        return { saved: method };
      };
    },
  });
  const service = createMediaService({
    persistence,
    authority: { permits: async (_id, key) => permissions.has(key) },
    references: {
      validPeople: async () => true,
      validTopics: async () => true,
      validLanguage: async () => true,
    },
  });
  return { service, calls };
}

describe('the audio administration', () => {
  it('refuses reads without media.read and changes without media.administer', async () => {
    const reader = serviceHarness({ permissions: [] });
    expect(await failure(reader.service.audioTracks(actor))).toBe('denied');
    expect(await failure(reader.service.audioSeriesDirectory(actor))).toBe('denied');

    const looker = serviceHarness({ permissions: ['media.read'] });
    expect(
      await failure(looker.service.saveAudioTrack(actor, null, null, trackInput())),
    ).toBe('denied');
    expect(looker.calls).not.toContain('saveAudioTrack');
  });

  it('refuses to publish a track with no audio, before writing', async () => {
    const created = serviceHarness();
    expect(
      await failure(
        created.service.saveAudioTrack(
          actor,
          null,
          null,
          trackInput({ state: 'published' }),
        ),
      ),
    ).toBe('no-audio');

    const edited = serviceHarness({ current: record({ assetId: null }) });
    expect(
      await failure(
        edited.service.saveAudioTrack(
          actor,
          ID(1),
          3,
          trackInput({ state: 'published' }),
        ),
      ),
    ).toBe('no-audio');
    expect(edited.calls).not.toContain('saveAudioTrack');

    const ready = serviceHarness({ current: record({ assetId: ID(8) }) });
    expect(
      await failure(
        ready.service.saveAudioTrack(actor, ID(1), 3, trackInput({ state: 'published' })),
      ),
    ).toBe('accepted');
  });

  it('refuses a series that does not exist', async () => {
    const { service } = serviceHarness({ seriesExists: false });
    expect(
      await failure(
        service.saveAudioTrack(
          actor,
          null,
          null,
          trackInput({ seriesId: ID(2), seriesPosition: 1 }),
        ),
      ),
    ).toBe('invalid');
  });
});

/* ===========================================================================
 * The upload
 * ========================================================================= */

function uploadHarness(
  options: {
    readonly permitted?: boolean;
    readonly current?: AudioTrackRecord | null;
    readonly stored?: StoredAsset;
  } = {},
) {
  const events: string[] = [];
  let policy: UploadPolicy | null = null;
  const persistence = {
    audioTrack: async () => {
      events.push('read');
      return options.current === undefined ? record() : options.current;
    },
    attachAudioAsset: async (input: { assetId: string; expectedVersion: number }) => {
      events.push(`attach:${input.assetId}:${String(input.expectedVersion)}`);
      return record({ assetId: input.assetId, version: 4 });
    },
  } as unknown as MediaPersistencePort;
  const storage: StorageServicePort = {
    async store(_bytes, given) {
      events.push('store');
      policy = given;
      return (
        options.stored ?? {
          id: ID(8),
          state: 'clean',
          mediaType: 'audio/mpeg',
          byteSize: 834,
          checksum: 'a'.repeat(64),
          rejection: null,
        }
      );
    },
    open: async () => null,
    reconcile: async () => 0,
  };
  const upload = createAudioUpload({
    persistence,
    authority: { permits: async () => options.permitted ?? true },
    storage: async () => storage,
  });
  return { upload, events, policy: () => policy };
}

/** The fake Storage never reads the body; one synthetic chunk stands in for it. */
const noBytes = (async function* () {
  yield new Uint8Array([0]);
})();
const file = { declaredMediaType: 'audio/mpeg', displayName: 'talk.mp3' };

describe('uploading a track’s audio', () => {
  it('attaches a clean asset under the version the operator uploaded against', async () => {
    const { upload, events, policy } = uploadHarness();
    const saved = await upload.uploadAudio(actor, ID(1), 3, noBytes, file);

    expect(saved.assetId).toBe(ID(8));
    expect(events).toEqual(['read', 'store', `attach:${ID(8)}:3`]);
    expect(policy()).toEqual({
      allowedMediaTypes: ['audio/mpeg'],
      maxBytes: AUDIO_UPLOAD_MAX_BYTES,
      declaredMediaType: 'audio/mpeg',
      displayName: 'talk.mp3',
    });
  });

  it('stores nothing for a caller without media.administer', async () => {
    const { upload, events } = uploadHarness({ permitted: false });
    expect(await failure(upload.uploadAudio(actor, ID(1), 3, noBytes, file))).toBe(
      'denied',
    );
    expect(events).toEqual([]);
  });

  it('stores nothing for a stale version or a missing track', async () => {
    const stale = uploadHarness();
    expect(await failure(stale.upload.uploadAudio(actor, ID(1), 2, noBytes, file))).toBe(
      'conflict',
    );
    expect(stale.events).toEqual(['read']);

    const missing = uploadHarness({ current: null });
    expect(
      await failure(missing.upload.uploadAudio(actor, ID(1), 3, noBytes, file)),
    ).toBe('not-found');
    expect(missing.events).toEqual(['read']);
  });

  it.each([
    ['too-large', 'too-large'],
    ['detected-type-not-allowed', 'unsupported'],
    ['declared-type-mismatch', 'unsupported'],
    ['unreadable', 'unsupported'],
    ['empty', 'unsupported'],
    ['infected', 'not-cleared'],
    ['unscannable', 'not-cleared'],
  ] as const)(
    'names Storage’s %s refusal as %s, and attaches nothing',
    async (rejection, word) => {
      const { upload, events } = uploadHarness({
        stored: {
          id: ID(8),
          state: 'rejected',
          mediaType: 'application/octet-stream',
          byteSize: 0,
          checksum: '',
          rejection,
        },
      });
      expect(await failure(upload.uploadAudio(actor, ID(1), 3, noBytes, file))).toBe(
        word,
      );
      expect(events.some((event) => event.startsWith('attach'))).toBe(false);
    },
  );

  it('attaches nothing still in quarantine', async () => {
    const { upload, events } = uploadHarness({
      stored: {
        id: ID(8),
        state: 'quarantined',
        mediaType: 'audio/mpeg',
        byteSize: 834,
        checksum: 'a'.repeat(64),
        rejection: null,
      },
    });
    expect(await failure(upload.uploadAudio(actor, ID(1), 3, noBytes, file))).toBe(
      'not-cleared',
    );
    expect(events.some((event) => event.startsWith('attach'))).toBe(false);
  });
});

/* ===========================================================================
 * The serving policy
 * ========================================================================= */

const asset = (overrides: Partial<AssetAccessRequest> = {}): AssetAccessRequest => ({
  assetId: ID(8),
  mediaType: 'audio/mpeg',
  byteSize: 834,
  checksum: 'a'.repeat(64),
  ...overrides,
});

function policyFor(
  relation: AudioAssetRelation | null,
  request = { trackId: ID(1), assetId: ID(8) },
  preview?: boolean,
) {
  return createAudioAssetPolicy({
    relations: { audioAsset: async () => relation },
    request,
    ...(preview === undefined
      ? {}
      : {
          preview: {
            accountId: ID(100),
            authority: { permits: async () => preview },
          },
        }),
  });
}

describe('Media’s half of the two allows', () => {
  it('allows exactly the recorded asset of a published track', async () => {
    expect(await policyFor({ state: 'published', assetId: ID(8) }).decide(asset())).toBe(
      'allow',
    );
  });

  it.each([
    ['a draft track', { state: 'draft', assetId: ID(8) }],
    ['an archived track', { state: 'archived', assetId: ID(8) }],
    ['another asset than the one recorded', { state: 'published', assetId: ID(9) }],
    ['a track with no file', { state: 'published', assetId: null }],
  ] as const)('denies %s', async (_label, relation) => {
    expect(await policyFor(relation).decide(asset())).toBe('deny');
  });

  it('denies a track that does not exist, and a malformed identifier', async () => {
    expect(await policyFor(null).decide(asset())).toBe('deny');
    expect(
      await policyFor(
        { state: 'published', assetId: ID(8) },
        { trackId: 'not-a-uuid', assetId: ID(8) },
      ).decide(asset()),
    ).toBe('deny');
  });

  it('denies when Storage resolved a different asset than the URL named', async () => {
    expect(
      await policyFor({ state: 'published', assetId: ID(8) }).decide(
        asset({ assetId: ID(9) }),
      ),
    ).toBe('deny');
  });

  it('denies any file that is not audio', async () => {
    expect(
      await policyFor({ state: 'published', assetId: ID(8) }).decide(
        asset({ mediaType: 'application/pdf' }),
      ),
    ).toBe('deny');
  });

  it('lets a live administrator preview a draft, and nobody else', async () => {
    const draft = { state: 'draft', assetId: ID(8) } as const;
    expect(await policyFor(draft, undefined, true).decide(asset())).toBe('allow');
    expect(await policyFor(draft, undefined, false).decide(asset())).toBe('deny');
    // Even an administrator previews only the asset recorded on that track.
    expect(
      await policyFor({ state: 'draft', assetId: ID(9) }, undefined, true).decide(
        asset(),
      ),
    ).toBe('deny');
  });
});
