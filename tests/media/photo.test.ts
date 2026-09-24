import { describe, expect, it } from 'vitest';

import {
  applyGalleryChange,
  galleryChangeSchema,
  galleryInputSchema,
  PHOTO_IMAGE_LIMITS,
  PHOTO_LIMITS,
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_MAX_BYTES,
  photoArchiveQuerySchema,
  photoInputSchema,
  photoWords,
  validPartialDate,
  type GalleryDetail,
  type MediaPersistencePort,
  type PhotoAssetRelation,
  type PhotoRecord,
} from '../../packages/contracts/src/media/index.ts';
import type {
  AssetAccessRequest,
  StorageServicePort,
  StoredAsset,
  UploadPolicy,
} from '../../packages/contracts/src/platform/storage.ts';
import {
  createMediaService,
  createPhotoAssetPolicy,
  createPhotoUpload,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';
import {
  archivePath,
  partialDate,
  readArchiveQuery,
} from '../../apps/web/src/components/media/presentation.ts';

/**
 * Phase 12 — the photograph rules, over fake ports.
 *
 * WHAT IS PROVED HERE CHEAPLY: a Photo's schema refuses anything it does not
 * name (an Event reference included) and admits only real, non-future partial
 * dates; a Gallery's membership changes by named changes that stay
 * duplicate-free and bounded; a Photo's words fall back without inventing any;
 * a published Photo must have an image; the upload re-checks authority and
 * version BEFORE a byte is stored, sends an IMAGE policy, attaches only a clean
 * image with its measured size, and names every refusal; and the serving
 * policy allows only the exact image of a published Photo — or, for a preview,
 * a live administrator. The SQL, filesystem and real scanner halves are
 * `tests/storage/media-photo.integration.test.ts`.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { accountId: ID(100) };

const photo = (overrides: Partial<PhotoRecord> = {}): PhotoRecord => ({
  id: ID(1),
  primaryLocale: 'en',
  state: 'draft',
  labels: [],
  credit: null,
  taken: null,
  assetId: null,
  width: null,
  height: null,
  version: 3,
  updatedAt: new Date(0),
  ...overrides,
});

const photoInput = (overrides: Record<string, unknown> = {}) => ({
  primaryLocale: 'en',
  state: 'draft',
  labels: [],
  credit: null,
  taken: null,
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

/* ========================================================================== */

describe('a Photo says only what it is given', () => {
  it('refuses a field it does not name — an Event, a slug, a person, a topic, an asset', () => {
    for (const extra of [
      { eventId: ID(9) },
      { slug: 'a-photo' },
      { speakerIds: [ID(9)] },
      { topicIds: [ID(9)] },
      { assetId: ID(9) },
      { galleryKind: 'event' },
    ]) {
      expect(
        photoInputSchema.safeParse(photoInput(extra)).success,
        Object.keys(extra)[0],
      ).toBe(false);
    }
    expect(photoInputSchema.safeParse(photoInput()).success).toBe(true);
  });

  it('keeps a date only as precise as it is known, real and not in the future', () => {
    const today = new Date(Date.UTC(2026, 8, 24));
    expect(validPartialDate({ year: 1989, month: null, day: null }, today)).toBe(true);
    expect(validPartialDate({ year: 1989, month: 3, day: null }, today)).toBe(true);
    expect(validPartialDate({ year: 2024, month: 2, day: 29 }, today)).toBe(true);
    expect(validPartialDate({ year: 2023, month: 2, day: 29 }, today)).toBe(false);
    expect(validPartialDate({ year: 1989, month: null, day: 4 }, today)).toBe(false);
    expect(validPartialDate({ year: 2026, month: 10, day: null }, today)).toBe(false);
    expect(validPartialDate({ year: 2026, month: 9, day: 25 }, today)).toBe(false);
    expect(validPartialDate({ year: 2027, month: null, day: null }, today)).toBe(false);

    expect(
      photoInputSchema.safeParse(
        photoInput({ taken: { year: 1825, month: null, day: null } }),
      ).success,
    ).toBe(false);
  });

  it('needs alternative text or a caption in a label, and one label per locale', () => {
    const label = (overrides: Record<string, unknown>) => ({
      locale: 'en',
      altText: null,
      caption: null,
      ...overrides,
    });
    expect(photoInputSchema.safeParse(photoInput({ labels: [label({})] })).success).toBe(
      false,
    );
    expect(
      photoInputSchema.safeParse(photoInput({ labels: [label({ altText: 'Text' })] }))
        .success,
    ).toBe(true);
    expect(
      photoInputSchema.safeParse(
        photoInput({ labels: [label({ caption: 'A' }), label({ caption: 'B' })] }),
      ).success,
    ).toBe(false);
    expect(
      photoInputSchema.safeParse(
        photoInput({
          labels: [label({ altText: 'x'.repeat(PHOTO_LIMITS.altText + 1) })],
        }),
      ).success,
    ).toBe(false);
  });

  it('resolves words locale first, then the primary locale, and never invents any', () => {
    const record = photo({
      primaryLocale: 'ur',
      labels: [
        { locale: 'en', altText: 'English alternative', caption: null },
        { locale: 'ur', altText: null, caption: 'اردو کیپشن' },
      ],
    });
    // Arabic has neither: the caption falls back to the primary locale, and
    // the alternative text to the only locale that has one — each marked.
    expect(photoWords(record, 'ar')).toEqual({
      altText: { text: 'English alternative', locale: 'en' },
      caption: { text: 'اردو کیپشن', locale: 'ur' },
    });
    expect(photoWords(photo(), 'en')).toEqual({ altText: null, caption: null });
  });
});

describe('a Gallery holds Photos by named, bounded changes', () => {
  const A = ID(11);
  const B = ID(12);
  const C = ID(13);

  it('adds, removes and moves, and refuses what would change nothing or duplicate', () => {
    expect(applyGalleryChange([A], { op: 'add', photoIds: [B, C] })).toEqual({
      photoIds: [A, B, C],
    });
    expect(applyGalleryChange([A, B], { op: 'add', photoIds: [B] })).toEqual({
      refusal: 'duplicate-member',
    });
    expect(applyGalleryChange([A, B, C], { op: 'remove', photoId: B })).toEqual({
      photoIds: [A, C],
    });
    expect(
      applyGalleryChange([A, B, C], { op: 'move', photoId: C, direction: 'first' }),
    ).toEqual({
      photoIds: [C, A, B],
    });
    expect(
      applyGalleryChange([A, B, C], { op: 'move', photoId: A, direction: 'last' }),
    ).toEqual({
      photoIds: [B, C, A],
    });
    expect(
      applyGalleryChange([A, B, C], { op: 'move', photoId: B, direction: 'earlier' }),
    ).toEqual({ photoIds: [B, A, C] });
    expect(
      applyGalleryChange([A, B, C], { op: 'move', photoId: B, direction: 'later' }),
    ).toEqual({
      photoIds: [A, C, B],
    });
    for (const change of [
      { op: 'move', photoId: A, direction: 'first' },
      { op: 'move', photoId: A, direction: 'earlier' },
      { op: 'move', photoId: C, direction: 'later' },
      { op: 'remove', photoId: ID(99) },
    ] as const) {
      expect(applyGalleryChange([A, B, C], change)).toEqual({ refusal: 'invalid' });
    }
  });

  it('is bounded — by the Gallery ceiling, and by one page per add', () => {
    const full = Array.from({ length: PHOTO_LIMITS.galleryPhotos }, (_, index) =>
      ID(1000 + index),
    );
    expect(applyGalleryChange(full, { op: 'add', photoIds: [ID(5)] })).toEqual({
      refusal: 'limit',
    });
    const tooMany = Array.from({ length: PHOTO_LIMITS.galleryAdd + 1 }, (_, index) =>
      ID(2000 + index),
    );
    expect(galleryChangeSchema.safeParse({ op: 'add', photoIds: tooMany }).success).toBe(
      false,
    );
    expect(galleryChangeSchema.safeParse({ op: 'add', photoIds: [A, A] }).success).toBe(
      false,
    );
  });

  it('refuses an Event reference or a type on a Gallery', () => {
    const gallery = {
      slug: 'a-gallery',
      primaryLocale: 'en',
      state: 'draft',
      labels: [{ locale: 'en', title: 'Synthetic gallery', description: '' }],
    };
    expect(galleryInputSchema.safeParse(gallery).success).toBe(true);
    for (const extra of [
      { eventId: ID(9) },
      { kind: 'event' },
      { coverPhotoId: ID(9) },
    ]) {
      expect(galleryInputSchema.safeParse({ ...gallery, ...extra }).success).toBe(false);
    }
  });
});

describe('the archive is by the date taken, never by when a record was made', () => {
  it('reads a year and a month tolerantly, and a month never without its year', () => {
    expect(readArchiveQuery({ year: '1995', month: '3' })).toEqual({
      year: 1995,
      month: 3,
      offset: 0,
    });
    expect(readArchiveQuery({ month: '3' })).toMatchObject({ year: null, month: null });
    expect(readArchiveQuery({ year: '95' })).toMatchObject({ year: null });
    expect(readArchiveQuery({ year: '1700' })).toMatchObject({ year: null });
    expect(readArchiveQuery({ year: '1995', month: '13' })).toMatchObject({
      month: null,
    });
    expect(photoArchiveQuerySchema.safeParse({ month: 3 }).success).toBe(false);
    expect(archivePath('ur', { year: 1995, month: 3 }, 24)).toBe(
      '/ur/media/archive?year=1995&month=3&offset=24',
    );
  });

  it('shows a partial date at exactly its precision', () => {
    expect(partialDate({ year: 1989, month: null, day: null }, 'en')).toEqual({
      text: '1989',
      machine: '1989',
    });
    expect(partialDate({ year: 1989, month: 3, day: null }, 'en')).toEqual({
      text: 'March 1989',
      machine: '1989-03',
    });
    expect(partialDate({ year: 1989, month: 3, day: 4 }, 'en').machine).toBe(
      '1989-03-04',
    );
  });
});

/* ========================================================================== */

function uploadHarness(
  options: {
    readonly permitted?: boolean;
    readonly current?: PhotoRecord | null;
    readonly stored?: StoredAsset;
  } = {},
) {
  const events: string[] = [];
  let policy: UploadPolicy | undefined;
  const persistence = {
    photo: async () => {
      events.push('read');
      return options.current === undefined ? photo() : options.current;
    },
    attachPhotoAsset: async (input: {
      assetId: string;
      expectedVersion: number;
      width: number;
      height: number;
    }) => {
      events.push(
        `attach:${input.assetId}:${String(input.expectedVersion)}:${String(input.width)}x${String(input.height)}`,
      );
      return photo({
        assetId: input.assetId,
        width: input.width,
        height: input.height,
        version: 4,
      });
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
          mediaType: 'image/jpeg',
          byteSize: 361,
          checksum: 'a'.repeat(64),
          rejection: null,
          image: { width: 48, height: 32 },
        }
      );
    },
    open: async () => null,
    servable: async () => new Set<string>(),
    reconcile: async () => 0,
  };
  const upload = createPhotoUpload({
    persistence,
    authority: { permits: async () => options.permitted ?? true },
    storage: async () => storage,
  });
  return { upload, events, policy: () => policy };
}

const noBytes = (async function* () {
  yield new Uint8Array([0]);
})();
const file = { declaredMediaType: 'image/jpeg', displayName: 'photo.jpg' };

describe('uploading a Photo’s image', () => {
  it('stores under an IMAGE policy and attaches the clean image with its measured size', async () => {
    const h = uploadHarness();
    const saved = await h.upload.uploadPhoto(actor, ID(1), 3, noBytes, file);

    expect(saved.assetId).toBe(ID(8));
    expect(h.events).toEqual(['read', 'store', `attach:${ID(8)}:3:48x32`]);
    expect(h.policy()).toEqual({
      allowedMediaTypes: [...PHOTO_MEDIA_TYPES],
      maxBytes: PHOTO_UPLOAD_MAX_BYTES,
      image: PHOTO_IMAGE_LIMITS,
      declaredMediaType: 'image/jpeg',
      displayName: 'photo.jpg',
    });
  });

  it('refuses before storing a byte: no permission, a missing Photo, a stale version', async () => {
    for (const [options, version, expected] of [
      [{ permitted: false }, 3, 'denied'],
      [{ current: null }, 3, 'not-found'],
      [{}, 2, 'conflict'],
    ] as const) {
      const h = uploadHarness(options);
      expect(
        await failure(h.upload.uploadPhoto(actor, ID(1), version, noBytes, file)),
      ).toBe(expected);
      expect(h.events).not.toContain('store');
    }
  });

  it('names each of Storage’s refusals, and attaches nothing it did not clear', async () => {
    const refused = (rejection: StoredAsset['rejection']): StoredAsset => ({
      id: ID(8),
      state: 'rejected',
      mediaType: 'application/octet-stream',
      byteSize: 0,
      checksum: '',
      rejection,
    });
    for (const [stored, expected] of [
      [refused('too-large'), 'too-large'],
      [refused('dimensions-too-large'), 'dimensions'],
      [refused('unreadable'), 'unsupported'],
      [refused('declared-type-mismatch'), 'unsupported'],
      [refused('infected'), 'not-cleared'],
      [
        {
          id: ID(8),
          state: 'quarantined',
          mediaType: 'image/png',
          byteSize: 10,
          checksum: 'b'.repeat(64),
          rejection: null,
          image: { width: 1, height: 1 },
        },
        'not-cleared',
      ],
    ] as const) {
      const h = uploadHarness({ stored });
      expect(await failure(h.upload.uploadPhoto(actor, ID(1), 3, noBytes, file))).toBe(
        expected,
      );
      expect(h.events.some((event) => event.startsWith('attach'))).toBe(false);
    }
  });
});

/* ========================================================================== */

const asset = (overrides: Partial<AssetAccessRequest> = {}): AssetAccessRequest => ({
  assetId: ID(8),
  mediaType: 'image/jpeg',
  byteSize: 361,
  checksum: 'a'.repeat(64),
  ...overrides,
});

function policyFor(
  relation: PhotoAssetRelation | null,
  request = { photoId: ID(1), assetId: ID(8) },
  preview?: boolean,
) {
  return createPhotoAssetPolicy({
    relations: {
      photoAsset: async () => relation,
      audioAsset: async () => {
        throw new Error('The photo policy asked about a track.');
      },
    },
    request,
    ...(preview === undefined
      ? {}
      : { preview: { accountId: ID(100), authority: { permits: async () => preview } } }),
  });
}

describe('Media’s half of the two allows, for a Photo', () => {
  it('allows exactly the recorded image of a published Photo', async () => {
    expect(await policyFor({ state: 'published', assetId: ID(8) }).decide(asset())).toBe(
      'allow',
    );
  });

  it('denies a draft or archived Photo, another image, a guess and a non-image', async () => {
    for (const state of ['draft', 'archived'] as const) {
      expect(await policyFor({ state, assetId: ID(8) }).decide(asset()), state).toBe(
        'deny',
      );
    }
    expect(await policyFor({ state: 'published', assetId: ID(9) }).decide(asset())).toBe(
      'deny',
    );
    expect(await policyFor(null).decide(asset())).toBe('deny');
    expect(
      await policyFor({ state: 'published', assetId: ID(8) }).decide(
        asset({ mediaType: 'audio/mpeg' }),
      ),
    ).toBe('deny');
    expect(
      await policyFor({ state: 'published', assetId: ID(8) }).decide(
        asset({ assetId: ID(7) }),
      ),
    ).toBe('deny');
    expect(
      await policyFor(
        { state: 'published', assetId: ID(8) },
        { photoId: 'not-a-uuid', assetId: ID(8) },
      ).decide(asset()),
    ).toBe('deny');
  });

  it('previews a draft only for a live administrator, and still only its own image', async () => {
    expect(
      await policyFor({ state: 'draft', assetId: ID(8) }, undefined, true).decide(
        asset(),
      ),
    ).toBe('allow');
    expect(
      await policyFor({ state: 'draft', assetId: ID(8) }, undefined, false).decide(
        asset(),
      ),
    ).toBe('deny');
    expect(
      await policyFor({ state: 'draft', assetId: ID(9) }, undefined, true).decide(
        asset(),
      ),
    ).toBe('deny');
  });
});

/* ========================================================================== */

describe('the service keeps the rules the database keeps too', () => {
  function service(current: PhotoRecord | null, gallery: GalleryDetail | null = null) {
    const calls: string[] = [];
    const persistence = {
      photo: async () => current,
      savePhoto: async () => {
        calls.push('savePhoto');
        return photo();
      },
      gallery: async () => gallery,
      setGalleryPhotos: async (input: { photoIds: readonly string[] }) => {
        calls.push(`set:${input.photoIds.join(',')}`);
        return gallery;
      },
    } as unknown as MediaPersistencePort;
    return {
      calls,
      media: createMediaService({
        persistence,
        authority: {
          permits: async (_id, key) => key === 'media.read' || key === 'media.administer',
        },
        references: {
          validPeople: async () => true,
          validTopics: async () => true,
          validLanguage: async () => true,
        },
      }),
    };
  }

  it('refuses to publish a Photo with no image, and a reader may not save at all', async () => {
    const s = service(photo());
    expect(
      await failure(
        s.media.savePhoto(actor, ID(1), 3, photoInput({ state: 'published' })),
      ),
    ).toBe('no-image');
    expect(
      await failure(
        s.media.savePhoto(actor, null, null, photoInput({ state: 'published' })),
      ),
    ).toBe('no-image');
    expect(s.calls).toEqual([]);

    const reader = createMediaService({
      persistence: {} as MediaPersistencePort,
      authority: { permits: async (_id, key) => key === 'media.read' },
      references: {
        validPeople: async () => true,
        validTopics: async () => true,
        validLanguage: async () => true,
      },
    });
    expect(await failure(reader.savePhoto(actor, null, null, photoInput()))).toBe(
      'denied',
    );
    expect(await failure(reader.saveGallery(actor, null, null, {}))).toBe('denied');
    expect(await failure(reader.changeGallery(actor, ID(2), 1, {}))).toBe('denied');
  });

  it('applies a membership change only to the version the operator saw', async () => {
    const gallery: GalleryDetail = {
      id: ID(2),
      slug: 'a-gallery',
      primaryLocale: 'en',
      state: 'draft',
      labels: [{ locale: 'en', title: 'G', description: '' }],
      version: 5,
      updatedAt: new Date(0),
      photos: [photo({ id: ID(11) }), photo({ id: ID(12) })],
    };
    const s = service(null, gallery);
    expect(
      await failure(
        s.media.changeGallery(actor, ID(2), 4, { op: 'remove', photoId: ID(11) }),
      ),
    ).toBe('conflict');
    expect(s.calls).toEqual([]);
    await s.media.changeGallery(actor, ID(2), 5, {
      op: 'move',
      photoId: ID(12),
      direction: 'first',
    });
    expect(s.calls).toEqual([`set:${ID(12)},${ID(11)}`]);
  });
});
