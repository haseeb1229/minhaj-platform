import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

import { sha256, syntheticStorageKey } from './phase11-fixture.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-12 STATE for the recovery rehearsals, and the synthetic
 * images every Phase-12 proof uses.
 *
 * NOTHING HERE IS A PHOTOGRAPH OF ANYONE OR ANYTHING. The PNGs are generated
 * colour gradients; the JPEG is a 48 × 32 gradient encoded once for this
 * repository and embedded below. The "camera metadata" the proofs inject is
 * made of recognisable SENTINEL strings, so a test can prove that no byte of it
 * survives — never real coordinates, device serials or names.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That Media's
 * photographs came back with their RELATIONSHIPS and INVARIANTS:
 *
 *   - a published Photo with its typed Storage asset, recorded dimensions, a
 *     partial date, alternative text and an Urdu caption read back exactly;
 *   - a DRAFT Photo with an asset of its own, whose image must still be refused
 *     after the restore;
 *   - an ARCHIVED Photo with no image;
 *   - a Gallery RENAMED once, both slugs reserved to it, holding the three
 *     Photos in a deliberate ORDER that must come back unchanged.
 *
 * The bytes are the other half; `tests/storage/photo-recovery.integration.test.ts`
 * restores the storage root beside the database.
 */

/* ===========================================================================
 * Synthetic images
 * ========================================================================= */

/** A 48 × 32 baseline JPEG gradient with no metadata segment at all. */
export const SYNTHETIC_JPEG: Uint8Array = Uint8Array.from(
  Buffer.from(
    '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAgADADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAABAMFBv/EABcQAAMBAAAAAAAAAAAAAAAAAAACA2H/xAAXAQEBAQEAAAAAAAAAAAAAAAAFBAIH/8QAFhEBAQEAAAAAAAAAAAAAAAAAAwAC/9oADAMBAAIRAxEAPwDnEjghI4XSOCEjgnpIoFoJHBCRwukcEJHCbSTYLRSOCEjhZI4ISOEuknAWxUjghI4XSOCEjhrSXMwWgkcEpHCyRwQkcJtJOAtFI4ISOFkjghI4TaSbBb//2Q==',
    'base64',
  ),
);

/** The same gradient, progressive: ten scans with Huffman tables between them. */
export const SYNTHETIC_PROGRESSIVE_JPEG: Uint8Array = Uint8Array.from(
  Buffer.from(
    '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wgARCAAgADADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAwIEBf/EABcBAQEBAQAAAAAAAAAAAAAAAAQDAQb/2gAMAwEAAhADEAAAAeaiIkhoiTdCWknYktN5mEtJOhLSbf/EABUQAQEAAAAAAAAAAAAAAAAAAAAR/9oACAEBAAEFAoiIiIiIiIiIiIiIiP/EABURAQEAAAAAAAAAAAAAAAAAAAIA/9oACAEDAQE/AQoKCgoKCv/EABYRAAMAAAAAAAAAAAAAAAAAAAABAv/aAAgBAgEBPwF0Oh0Oh0Oj/8QAFBABAAAAAAAAAAAAAAAAAAAAQP/aAAgBAQAGPwJH/8QAFRABAQAAAAAAAAAAAAAAAAAAAAH/2gAIAQEAAT8hjGMYxjGMYxjGMYxjGMYx/9oADAMBAAIAAwAAABDPAAx73//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQMBAT8QX/8A/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAgEBPxBAAf/EABUQAQEAAAAAAAAAAAAAAAAAAABh/9oACAEBAAE/EJJJJJJJJJJJJJJJJJJJJJJJJP/Z',
    'base64',
  ),
);

/** The synthetic JPEG's size. */
export const SYNTHETIC_JPEG_SIZE = Object.freeze({ width: 48, height: 32 });

/** One PNG chunk — length, type, data and CRC — exactly as the format lays it out. */
export function pngChunk(type: string, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)) >>> 0);
  return out;
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A genuine, decodable RGB PNG gradient of `width` × `height`, with optional
 * extra chunks placed before the image data (`before`) or after it (`after`).
 * `hue` varies the colours so different fixtures are visibly different.
 */
export function syntheticPng(
  width: number,
  height: number,
  options: {
    readonly hue?: number;
    readonly before?: readonly Uint8Array[];
    readonly after?: readonly Uint8Array[];
  } = {},
): Uint8Array {
  if (width < 1 || height < 1 || width * height > 4_000_000) {
    throw new Error('A synthetic PNG is between one pixel and four megapixels.');
  }
  const hue = options.hue ?? 0;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const start = y * (1 + width * 3);
    rows[start] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const at = start + 1 + x * 3;
      rows[at] = (Math.round((x / Math.max(1, width - 1)) * 180) + hue) % 256;
      rows[at + 1] = (Math.round((y / Math.max(1, height - 1)) * 160) + 40) % 256;
      rows[at + 2] = (120 + hue * 3) % 256;
    }
  }
  const parts = [
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    ...(options.before ?? []),
    pngChunk('IDAT', deflateSync(rows)),
    ...(options.after ?? []),
    pngChunk('IEND'),
  ];
  return Uint8Array.from(Buffer.concat(parts));
}

/** A PNG `tEXt` chunk: keyword, NUL, text. */
export function pngText(keyword: string, text: string): Uint8Array {
  return pngChunk('tEXt', Uint8Array.from(Buffer.from(`${keyword}\0${text}`, 'latin1')));
}

/** One JPEG marker segment with its length. */
export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return Uint8Array.from([0xff, marker, length >> 8, length & 0xff, ...payload]);
}

/**
 * An EXIF APP1 segment in big-endian TIFF: an Orientation entry (when given)
 * and an ImageDescription carrying `sentinel` — standing in for every private
 * fact a camera writes (location, serial, owner).
 */
export function exifSegment(input: {
  readonly orientation?: number;
  readonly sentinel: string;
  readonly littleEndian?: boolean;
}): Uint8Array {
  const text = Buffer.from(`${input.sentinel}\0`, 'latin1');
  const entries = input.orientation === undefined ? 1 : 2;
  const ifdSize = 2 + entries * 12 + 4;
  const textOffset = 8 + ifdSize;
  const tiff = new Uint8Array(textOffset + text.length);
  const view = new DataView(tiff.buffer);
  const little = input.littleEndian === true;
  tiff.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, entries, little);
  let at = 10;
  // 0x010E ImageDescription, ASCII, pointing at the sentinel text.
  view.setUint16(at, 0x010e, little);
  view.setUint16(at + 2, 2, little);
  view.setUint32(at + 4, text.length, little);
  view.setUint32(at + 8, textOffset, little);
  at += 12;
  if (input.orientation !== undefined) {
    view.setUint16(at, 0x0112, little);
    view.setUint16(at + 2, 3, little);
    view.setUint32(at + 4, 1, little);
    view.setUint16(at + 8, input.orientation, little);
    at += 12;
  }
  view.setUint32(at, 0, little);
  tiff.set(text, textOffset);
  return jpegSegment(
    0xe1,
    Uint8Array.from([...Buffer.from('Exif\0\0', 'latin1'), ...tiff]),
  );
}

/** The synthetic JPEG with `segments` inserted straight after its SOI marker. */
export function jpegWith(
  segments: readonly Uint8Array[],
  options: { readonly base?: Uint8Array; readonly trailer?: Uint8Array } = {},
): Uint8Array {
  const base = options.base ?? SYNTHETIC_JPEG;
  return Uint8Array.from(
    Buffer.concat([
      base.subarray(0, 2),
      ...segments,
      base.subarray(2),
      ...(options.trailer === undefined ? [] : [options.trailer]),
    ]),
  );
}

/** Does `haystack` contain the bytes of `needle` anywhere? */
export function containsText(haystack: Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));
}

/* ===========================================================================
 * The populated recovery fixture
 * ========================================================================= */

export interface Phase12Fixture {
  readonly runId: string;
  readonly publishedPhotoId: string;
  readonly draftPhotoId: string;
  readonly archivedPhotoId: string;
  readonly assetId: string;
  readonly assetKey: string;
  readonly draftAssetId: string;
  readonly draftAssetKey: string;
  readonly galleryId: string;
  readonly galleryOriginalSlug: string;
  readonly gallerySlug: string;
}

/** The synthetic image both fixture assets hold. */
export const PHASE12_IMAGE: Uint8Array = syntheticPng(64, 40, { hue: 30 });

export function newPhase12Fixture(): Phase12Fixture {
  const runId = randomUUID().replaceAll('-', '');
  return {
    runId,
    publishedPhotoId: randomUUID(),
    draftPhotoId: randomUUID(),
    archivedPhotoId: randomUUID(),
    assetId: randomUUID(),
    assetKey: syntheticStorageKey(),
    draftAssetId: randomUUID(),
    draftAssetKey: syntheticStorageKey(),
    galleryId: randomUUID(),
    galleryOriginalSlug: `phase12-gallery-original-${runId}`,
    gallerySlug: `phase12-gallery-current-${runId}`,
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase12Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-12 fixture runId does not match the expected pattern.');
  }
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-z/-]{1,120}$/.test(value)) {
      throw new Error(`Phase-12 fixture field '${name}' is not a safe generated value.`);
    }
  }
}

const TEXT = {
  captionUr: 'بحالی کے ثبوت کی آزمائشی تصویر',
  altEn: 'A synthetic colour gradient used only as a recovery proof.',
} as const;

/**
 * Writes the populated Phase-12 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real foreign keys, CHECKs, filtered
 * index and slug trigger are exercised — the rename is a real UPDATE.
 */
export async function writePhase12Fixture(
  sql: SqlSession,
  fixture: Phase12Fixture,
): Promise<void> {
  assertSafe(fixture);
  const f = fixture;
  const checksum = sha256(PHASE12_IMAGE);
  const size = PHASE12_IMAGE.byteLength;

  await sql.query(`
    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[displayName],[updatedAt]) VALUES
      (N'${f.assetId}', N'${f.assetKey}', N'image/png', ${String(size)}, N'${checksum}', N'clean', N'synthetic-recovery.png', SYSUTCDATETIME()),
      (N'${f.draftAssetId}', N'${f.draftAssetKey}', N'image/png', ${String(size)}, N'${checksum}', N'clean', NULL, SYSUTCDATETIME());

    INSERT INTO [dbo].[Photo] ([id],[primaryLocale],[state],[credit],[takenYear],[takenMonth],[takenDay],[assetId],[width],[height],[version],[updatedAt]) VALUES
      (N'${f.publishedPhotoId}', N'ur', N'published', N'Synthetic recovery credit', 1995, 3, NULL, N'${f.assetId}', 64, 40, 2, SYSUTCDATETIME()),
      (N'${f.draftPhotoId}', N'en', N'draft', NULL, NULL, NULL, NULL, N'${f.draftAssetId}', 64, 40, 1, SYSUTCDATETIME()),
      (N'${f.archivedPhotoId}', N'en', N'archived', NULL, 1989, NULL, NULL, NULL, NULL, NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[PhotoLabel] ([photoId],[locale],[altText],[caption]) VALUES
      (N'${f.publishedPhotoId}', N'en', N'${TEXT.altEn}', NULL),
      (N'${f.publishedPhotoId}', N'ur', NULL, N'${TEXT.captionUr}'),
      (N'${f.draftPhotoId}', N'en', NULL, N'Synthetic draft photograph');

    INSERT INTO [dbo].[Gallery] ([id],[slug],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${f.galleryId}', N'${f.galleryOriginalSlug}', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Gallery] SET [slug]=N'${f.gallerySlug}', [version]=2 WHERE [id]=N'${f.galleryId}';
    INSERT INTO [dbo].[GalleryLabel] ([galleryId],[locale],[title],[description])
      VALUES (N'${f.galleryId}', N'en', N'Synthetic recovery gallery', N'');
    INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES
      (N'${f.galleryId}', N'${f.draftPhotoId}', 0),
      (N'${f.galleryId}', N'${f.publishedPhotoId}', 1),
      (N'${f.galleryId}', N'${f.archivedPhotoId}', 2);
  `);
}

/** Every authoritative Phase-12 row this fixture wrote, in a stable order. */
export async function capturePhase12Fixture(
  sql: SqlSession,
  fixture: Phase12Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const photos = `N'${f.publishedPhotoId}',N'${f.draftPhotoId}',N'${f.archivedPhotoId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'Asset',
      `SELECT [id],[storageKey],[mediaType],[byteSize],[checksum],[state] FROM [dbo].[Asset] WHERE [id] IN (N'${f.assetId}',N'${f.draftAssetId}') ORDER BY [id]`,
      2,
    ],
    ['Photo', `SELECT * FROM [dbo].[Photo] WHERE [id] IN (${photos}) ORDER BY [id]`, 3],
    [
      'PhotoLabel',
      `SELECT * FROM [dbo].[PhotoLabel] WHERE [photoId] IN (${photos}) ORDER BY [photoId],[locale]`,
      3,
    ],
    ['Gallery', `SELECT * FROM [dbo].[Gallery] WHERE [id]=N'${f.galleryId}'`, 1],
    [
      'GalleryLabel',
      `SELECT * FROM [dbo].[GalleryLabel] WHERE [galleryId]=N'${f.galleryId}'`,
      1,
    ],
    [
      'GallerySlugHistory',
      `SELECT * FROM [dbo].[GallerySlugHistory] WHERE [galleryId]=N'${f.galleryId}' ORDER BY [slug]`,
      2,
    ],
    [
      'GalleryItem',
      `SELECT * FROM [dbo].[GalleryItem] WHERE [galleryId]=N'${f.galleryId}' ORDER BY [position]`,
      3,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-12 recovery expected ${expected} ${name} row(s), found ${data.length}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/**
 * Verifies the restored photograph state and returns one line of what was
 * proved: row equality, the Urdu caption character for character, the slug
 * trigger enabled, every Phase-12 CHECK and foreign key trusted, and the
 * filtered unique index on the Photo's asset still unique and filtered.
 */
export async function verifyRestoredPhase12(
  sql: SqlSession,
  fixture: Phase12Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase12Fixture(sql, fixture),
    expected,
    'Phase-12 photograph authoritative values changed during recovery.',
  );

  const [text] = await sql.query<{ caption: string }>(
    `SELECT [caption] FROM [dbo].[PhotoLabel]
     WHERE [photoId]=N'${fixture.publishedPhotoId}' AND [locale]=N'ur';`,
  );
  if (text?.caption !== TEXT.captionUr) {
    throw new Error('Restored Urdu Phase-12 caption does not match.');
  }

  const [trigger] = await sql.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM sys.triggers
     WHERE [name]=N'MediaReserveGallerySlug' AND [is_disabled]=0;`,
  );
  if (Number(trigger?.total ?? 0) !== 1) {
    throw new Error('Restored database lost the Phase-12 slug-reservation trigger.');
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (OBJECT_ID(N'Photo'),OBJECT_ID(N'PhotoLabel'),
                                OBJECT_ID(N'Gallery'),OBJECT_ID(N'GalleryLabel'),
                                OBJECT_ID(N'GalleryItem'))
       AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (OBJECT_ID(N'Photo'),OBJECT_ID(N'GalleryItem'))
       AND (is_disabled=1 OR is_not_trusted=1);`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-12 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [index] = await sql.query<{ filtered: number }>(
    `SELECT COUNT_BIG(*) AS [filtered] FROM sys.indexes
     WHERE [name]=N'Photo_assetId_key' AND [is_unique]=1 AND [has_filter]=1;`,
  );
  if (Number(index?.filtered ?? 0) !== 1) {
    throw new Error('Restored database lost the filtered unique Photo asset index.');
  }

  return 'photos, gallery order, asset relations, dates, captions and slug history intact';
}
