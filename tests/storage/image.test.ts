import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ByteLimitExceeded } from '../../packages/storage/src/filesystem.ts';
import {
  exifOrientation,
  ImageRefused,
  sanitiseImage,
} from '../../packages/storage/src/image.ts';
import {
  containsText,
  exifSegment,
  jpegSegment,
  jpegWith,
  pngChunk,
  pngText,
  SYNTHETIC_JPEG,
  SYNTHETIC_JPEG_SIZE,
  SYNTHETIC_PROGRESSIVE_JPEG,
  syntheticPng,
} from '../../packages/database/src/lifecycle/phase12-fixture.ts';

/**
 * Phase 12 — still-image admission, over real bytes.
 *
 * WHAT THIS PROVES: a JPEG or PNG is admitted only when it is structurally
 * whole; a header asking for more pixels than the limits is refused before its
 * image data is read; every kind of hidden metadata a camera or editor writes
 * — EXIF (including location), XMP, IPTC, comments, embedded thumbnails,
 * trailing data, PNG text and EXIF chunks — is absent from what is kept, while
 * the orientation fact survives as the ONLY EXIF entry; and the byte ceiling
 * counts what ARRIVES, discarded metadata included.
 *
 * Every image is synthetic and every "private" fact is a sentinel string.
 */

const LIMITS = { maxPixels: 40_000_000, maxEdge: 16_384 };
const CEILING = 16 * 1024 * 1024;

/** Feeds `bytes` in small, awkward chunks, so boundaries fall mid-structure. */
function chunked(bytes: Uint8Array, size = 7): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (let at = 0; at < bytes.length; at += size) yield bytes.slice(at, at + size);
  })();
}

async function run(
  bytes: Uint8Array,
  options: {
    readonly limits?: typeof LIMITS;
    readonly ceiling?: number;
    readonly size?: number;
  } = {},
) {
  const image = sanitiseImage(
    chunked(bytes, options.size),
    options.limits ?? LIMITS,
    options.ceiling ?? CEILING,
  );
  const parts: Buffer[] = [];
  for await (const part of image.bytes) parts.push(Buffer.from(part));
  return { bytes: Uint8Array.from(Buffer.concat(parts)), dimensions: image.dimensions() };
}

async function refusal(
  bytes: Uint8Array,
  options: Parameters<typeof run>[1] = {},
): Promise<string> {
  try {
    await run(bytes, options);
  } catch (error) {
    if (error instanceof ImageRefused) return error.rejection;
    if (error instanceof ByteLimitExceeded) return 'too-large';
    throw error;
  }
  return 'accepted';
}

const SENTINEL = 'SENTINEL-GPS-51.5074N-0.1278W-SERIAL-0000';

describe('JPEG: whole images pass, their pixels untouched', () => {
  it.each([
    ['baseline', SYNTHETIC_JPEG],
    ['progressive', SYNTHETIC_PROGRESSIVE_JPEG],
  ])('admits a %s JPEG unchanged and reports its size', async (_label, jpeg) => {
    for (const size of [1, 7, 4096]) {
      const out = await run(jpeg, { size });
      expect(Buffer.from(out.bytes).equals(Buffer.from(jpeg))).toBe(true);
      expect(out.dimensions).toEqual(SYNTHETIC_JPEG_SIZE);
    }
  });

  it('refuses a truncated JPEG at every cut, and never reports dimensions for one', async () => {
    for (const cut of [
      3,
      20,
      150,
      250,
      SYNTHETIC_JPEG.length - 2,
      SYNTHETIC_JPEG.length - 1,
    ]) {
      expect(
        await refusal(SYNTHETIC_JPEG.subarray(0, cut)),
        `cut at ${String(cut)}`,
      ).toBe('unreadable');
    }
  });

  it('refuses bytes between segments, a second frame, and codings browsers cannot show', async () => {
    const withGarbage = jpegWith([Uint8Array.from([0x00, 0x11, 0x22])]);
    expect(await refusal(withGarbage)).toBe('unreadable');

    // Arithmetic-coded (SOF9) and lossless (SOF3) frames: the baseline SOF0
    // marker rewritten in place.
    for (const marker of [0xc9, 0xc3]) {
      const altered = Uint8Array.from(SYNTHETIC_JPEG);
      const at = Buffer.from(altered).indexOf(Buffer.from([0xff, 0xc0]));
      altered[at + 1] = marker;
      expect(await refusal(altered), marker.toString(16)).toBe('unreadable');
    }

    const at = Buffer.from(SYNTHETIC_JPEG).indexOf(Buffer.from([0xff, 0xc0]));
    const length = ((SYNTHETIC_JPEG[at + 2] ?? 0) << 8) | (SYNTHETIC_JPEG[at + 3] ?? 0);
    const frame = SYNTHETIC_JPEG.subarray(at, at + 2 + length);
    expect(await refusal(jpegWith([frame]))).toBe('unreadable');
  });

  it('refuses a header that declares too many pixels, before reading its image data', async () => {
    // A frame header claiming 60000 × 60000 — a tiny file asking a decoder for
    // three and a half billion pixels — followed by NOTHING. The refusal must
    // come from the header alone, not from reaching the truncated end.
    const bomb = Uint8Array.from([
      0xff,
      0xd8,
      ...jpegSegment(0xc0, Uint8Array.from([8, 0xea, 0x60, 0xea, 0x60, 1, 1, 0x11, 0])),
    ]);
    expect(await refusal(bomb)).toBe('dimensions-too-large');
    // And the edge bound alone: a panorama wider than the longest side allowed.
    expect(
      await refusal(SYNTHETIC_JPEG, { limits: { maxPixels: 40_000_000, maxEdge: 40 } }),
    ).toBe('dimensions-too-large');
    expect(
      await refusal(SYNTHETIC_JPEG, { limits: { maxPixels: 1000, maxEdge: 16_384 } }),
    ).toBe('dimensions-too-large');
  });
});

describe('JPEG: hidden metadata never survives', () => {
  it('removes EXIF, XMP, IPTC, comments, unknown APP segments, the JFIF thumbnail and trailing data', async () => {
    const jfifWithThumbnail = jpegSegment(
      0xe0,
      Uint8Array.from([
        ...Buffer.from('JFIF\0', 'latin1'),
        1,
        2,
        0,
        0,
        72,
        0,
        72,
        2,
        1, // a 2 × 1 thumbnail…
        ...Buffer.from('THUMB!', 'latin1'), // …of six bytes of "pixels"
      ]),
    );
    const input = jpegWith(
      [
        jfifWithThumbnail,
        exifSegment({ sentinel: `${SENTINEL}-EXIF` }),
        jpegSegment(
          0xe1,
          Uint8Array.from(
            Buffer.from(
              `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${SENTINEL}-XMP</x:xmpmeta>`,
              'latin1',
            ),
          ),
        ),
        jpegSegment(
          0xed,
          Uint8Array.from(Buffer.from(`Photoshop 3.0\0${SENTINEL}-IPTC`, 'latin1')),
        ),
        jpegSegment(0xe2, Uint8Array.from(Buffer.from(`MPF\0${SENTINEL}-MPF`, 'latin1'))),
        jpegSegment(0xef, Uint8Array.from(Buffer.from(`${SENTINEL}-APP15`, 'latin1'))),
        jpegSegment(0xfe, Uint8Array.from(Buffer.from(`${SENTINEL}-COMMENT`, 'latin1'))),
      ],
      {
        trailer: Uint8Array.from(
          Buffer.from(`${SENTINEL}-TRAILER-appended-video`, 'latin1'),
        ),
      },
    );

    const out = await run(input);

    expect(containsText(input, SENTINEL)).toBe(true);
    expect(containsText(out.bytes, 'SENTINEL')).toBe(false);
    expect(containsText(out.bytes, 'THUMB!')).toBe(false);
    expect(containsText(out.bytes, 'Exif')).toBe(false);
    expect(out.dimensions).toEqual(SYNTHETIC_JPEG_SIZE);

    // What remains is the JFIF header with no thumbnail, then the original
    // image exactly.
    expect(Array.from(out.bytes.subarray(0, 6))).toEqual([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    ]);
    expect(out.bytes[2 + 4 + 12]).toBe(0);
    expect(out.bytes[2 + 4 + 13]).toBe(0);
    expect(
      Buffer.from(out.bytes.subarray(20)).equals(Buffer.from(SYNTHETIC_JPEG.subarray(2))),
    ).toBe(true);
  });

  it('keeps ONLY the orientation, as the one EXIF entry, and reports the rotated size', async () => {
    for (const littleEndian of [false, true]) {
      const input = jpegWith([
        exifSegment({ orientation: 6, sentinel: SENTINEL, littleEndian }),
      ]);
      const out = await run(input);

      expect(containsText(out.bytes, 'SENTINEL')).toBe(false);
      // A 90° rotation: the picture is displayed 32 wide and 48 tall.
      expect(out.dimensions).toEqual({ width: 32, height: 48 });

      const segment = out.bytes.subarray(2, 2 + 36);
      expect(Array.from(segment.subarray(0, 4))).toEqual([0xff, 0xe1, 0x00, 0x22]);
      expect(exifOrientation(segment.subarray(10))).toBe(6);
    }
  });

  it('writes nothing back for an upright photograph', async () => {
    const out = await run(
      jpegWith([exifSegment({ orientation: 1, sentinel: SENTINEL })]),
    );
    expect(Buffer.from(out.bytes).equals(Buffer.from(SYNTHETIC_JPEG))).toBe(true);
  });

  it('keeps a colour profile, because it changes how the pixels look', async () => {
    const icc = jpegSegment(
      0xe2,
      Uint8Array.from([...Buffer.from('ICC_PROFILE\0', 'latin1'), 1, 1, 9, 8, 7]),
    );
    const out = await run(jpegWith([icc]));
    expect(Buffer.from(out.bytes).includes(Buffer.from(icc))).toBe(true);
  });

  it('counts discarded metadata against the ceiling — stripping is no way around it', async () => {
    const padding = new Uint8Array(60_000).fill(0x41);
    const segments = Array.from({ length: 5 }, () => jpegSegment(0xfe, padding));
    const input = jpegWith(segments);
    expect(await refusal(input, { ceiling: 200_000 })).toBe('too-large');
    expect(await refusal(input, { ceiling: 400_000 })).toBe('accepted');
  });
});

describe('PNG', () => {
  it('admits a whole PNG unchanged and reports its size', async () => {
    const png = syntheticPng(120, 45);
    const out = await run(png, { size: 13 });
    expect(Buffer.from(out.bytes).equals(Buffer.from(png))).toBe(true);
    expect(out.dimensions).toEqual({ width: 120, height: 45 });
  });

  it('drops text, time, EXIF, animation and private chunks, and trailing data', async () => {
    const png = syntheticPng(20, 10, {
      before: [
        pngText('Author', `${SENTINEL}-TEXT`),
        pngChunk('eXIf', Uint8Array.from(Buffer.from(`MM\0*${SENTINEL}-EXIF`, 'latin1'))),
        pngChunk('tIME', Uint8Array.from([7, 234, 1, 2, 3, 4, 5])),
        pngChunk('acTL', Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0])),
        pngChunk('prVt', Uint8Array.from(Buffer.from(`${SENTINEL}-PRIVATE`, 'latin1'))),
        pngChunk('gAMA', Uint8Array.from([0, 0, 0xb1, 0x8f])),
      ],
      after: [pngText('Comment', `${SENTINEL}-AFTER`)],
    });
    const input = Uint8Array.from(
      Buffer.concat([png, Buffer.from(`${SENTINEL}-TRAILER`)]),
    );

    const out = await run(input);
    expect(containsText(out.bytes, 'SENTINEL')).toBe(false);
    for (const dropped of ['tEXt', 'eXIf', 'tIME', 'acTL', 'prVt']) {
      expect(containsText(out.bytes, dropped), dropped).toBe(false);
    }
    // The colour chunk is kept.
    expect(containsText(out.bytes, 'gAMA')).toBe(true);
    expect(out.dimensions).toEqual({ width: 20, height: 10 });
  });

  it('refuses a truncated PNG, a bad CRC, an unknown critical chunk and split image data', async () => {
    const png = syntheticPng(20, 10);
    for (const cut of [8, 20, 40, png.length - 12, png.length - 1]) {
      expect(await refusal(png.subarray(0, cut)), `cut at ${String(cut)}`).toBe(
        'unreadable',
      );
    }

    const corrupt = Uint8Array.from(png);
    corrupt[40] = (corrupt[40] ?? 0) ^ 0xff;
    expect(await refusal(corrupt)).toBe('unreadable');

    expect(
      await refusal(
        syntheticPng(8, 8, { before: [pngChunk('ZZZZ', new Uint8Array(2))] }),
      ),
    ).toBe('unreadable');

    const split = syntheticPng(8, 8, {
      after: [pngText('x', 'y'), pngChunk('IDAT', deflateSync(new Uint8Array(4)))],
    });
    expect(await refusal(split)).toBe('unreadable');
  });

  it('refuses a tiny file that declares an enormous canvas, from its header alone', async () => {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, 50_000);
    view.setUint32(4, 50_000);
    header[8] = 8;
    header[9] = 2;
    const bomb = Uint8Array.from(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
      ]),
    );
    expect(await refusal(bomb)).toBe('dimensions-too-large');
  });

  it('refuses a colour type and bit depth the format does not define', async () => {
    const png = Uint8Array.from(syntheticPng(4, 4));
    // IHDR's bit depth byte, and a CRC recomputed so only the value is wrong.
    const header = Uint8Array.from(png.subarray(16, 29));
    header[8] = 3;
    const rebuilt = Uint8Array.from(
      Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', header), png.subarray(33)]),
    );
    expect(await refusal(rebuilt)).toBe('unreadable');
  });
});

describe('anything else passes through for the sniff to judge', () => {
  it('forwards non-image bytes untouched and reports no dimensions', async () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const out = await run(zip);
    expect(Buffer.from(out.bytes).equals(Buffer.from(zip))).toBe(true);
    expect(out.dimensions).toBeNull();

    // A few bytes that OPEN with a JPEG start-of-image are held to the JPEG
    // rules and refused here. Seven bytes of a PNG signature are not yet a PNG
    // and are forwarded unmeasured — which the service refuses, because an
    // image policy admits only what this module measured (service.test.ts).
    expect(await refusal(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('unreadable');
    const partial = await run(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]),
    );
    expect(partial.dimensions).toBeNull();
  });
});
