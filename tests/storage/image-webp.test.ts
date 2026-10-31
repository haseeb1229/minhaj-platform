import { describe, expect, it } from 'vitest';

import { ByteLimitExceeded } from '../../packages/storage/src/filesystem.ts';
import { ImageRefused, sanitiseImage } from '../../packages/storage/src/image.ts';
import { containsText } from '../../packages/database/src/lifecycle/phase12-fixture.ts';
import {
  chunk,
  concat,
  FLAG,
  iccProfile,
  le,
  rawAlpha,
  riff,
  text,
  vp8,
  vp8l,
  vp8x,
} from './webp-fixture.ts';

/**
 * Phase 30-RF — still-WebP admission, over real container bytes.
 *
 * WHAT THIS PROVES: for a policy that names `image/webp`, a still WebP is
 * admitted only when its RIFF container is exact — declared length, chunk
 * bounds, zero padding, nothing after the end — and it holds ONE image
 * bitstream with a sound header whose dimensions are within the limits; its
 * bitstream is kept byte for byte with any transparency and a self-describing
 * colour profile, while EXIF, XMP and unknown chunks are absent from what is
 * kept; animation, contradictory feature flags, a second image and malformed
 * alpha are refusals; and for any other policy a WebP is not touched here at
 * all, so the sniff refuses it as before.
 *
 * Every image is synthetic and every "private" fact is a sentinel string.
 */

const LIMITS = { maxPixels: 40_000_000, maxEdge: 16_384 };
const CEILING = 16 * 1024 * 1024;
const SENTINEL = 'SENTINEL-GPS-51.5074N-0.1278W-SERIAL-0000';

/** Feeds `bytes` in small, awkward chunks, so boundaries fall mid-structure. */
function chunked(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (let at = 0; at < bytes.length; at += size) yield bytes.slice(at, at + size);
  })();
}

interface Options {
  readonly limits?: typeof LIMITS;
  readonly ceiling?: number;
  readonly size?: number;
  readonly webp?: boolean;
}

async function run(bytes: Uint8Array, options: Options = {}) {
  const image = sanitiseImage(
    chunked(bytes, options.size ?? 7),
    options.limits ?? LIMITS,
    options.ceiling ?? CEILING,
    { webp: options.webp ?? true },
  );
  const parts: Buffer[] = [];
  for await (const part of image.bytes) parts.push(Buffer.from(part));
  return { bytes: Uint8Array.from(Buffer.concat(parts)), dimensions: image.dimensions() };
}

async function refused(bytes: Uint8Array, options: Options = {}): Promise<string> {
  try {
    await run(bytes, options);
  } catch (error) {
    if (error instanceof ImageRefused) return error.rejection;
    if (error instanceof ByteLimitExceeded) return 'too-large';
    throw error;
  }
  return 'accepted';
}

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const STILL = chunk('VP8 ', vp8(16, 16));

describe('WebP: a still image passes, its bitstream untouched', () => {
  it('admits a simple lossy and a simple lossless WebP unchanged, at any chunking', async () => {
    const lossy = riff([chunk('VP8 ', vp8(320, 200))]);
    // An odd-sized lossless payload: its zero padding byte is part of the file.
    const oddPayload = vp8l(64, 48, { filler: 12 });
    expect(oddPayload.length % 2).toBe(1);
    const lossless = riff([chunk('VP8L', oddPayload)]);
    for (const [input, size] of [
      [lossy, { width: 320, height: 200 }],
      [lossless, { width: 64, height: 48 }],
    ] as const) {
      for (const chunkSize of [1, 7, 4096]) {
        const out = await run(input, { size: chunkSize });
        expect(same(out.bytes, input)).toBe(true);
        expect(out.dimensions).toEqual(size);
      }
    }
  });

  it('keeps transparency: a VP8X canvas, its ALPH and the lossy bitstream', async () => {
    const input = riff([
      vp8x(FLAG.alpha, 4, 3),
      chunk('ALPH', rawAlpha(4, 3)),
      chunk('VP8 ', vp8(4, 3)),
    ]);
    const out = await run(input);
    expect(same(out.bytes, input)).toBe(true);
    expect(out.dimensions).toEqual({ width: 4, height: 3 });

    // Losslessly compressed alpha is kept as written: it is never decoded.
    const compressed = riff([
      vp8x(FLAG.alpha, 4, 3),
      chunk('ALPH', concat([0x01], [9, 8, 7, 6, 5])),
      chunk('VP8 ', vp8(4, 3)),
    ]);
    expect((await run(compressed)).dimensions).toEqual({ width: 4, height: 3 });
  });

  it('drops EXIF, XMP and unknown chunks anywhere, and rewrites the header to what is kept', async () => {
    const profile = iccProfile();
    const input = riff([
      vp8x(FLAG.icc | FLAG.alpha | FLAG.exif | FLAG.xmp, 8, 8),
      chunk('ICCP', profile),
      chunk('ALPH', rawAlpha(8, 8)),
      chunk('VP8 ', vp8(8, 8)),
      chunk('EXIF', text(`MM ${SENTINEL} GPS`)),
      chunk('XMP ', text(`<x:xmpmeta>${SENTINEL}</x:xmpmeta>`)),
      chunk('ZZZZ', text(SENTINEL)),
    ]);
    const out = await run(input);
    expect(containsText(out.bytes, SENTINEL)).toBe(false);
    expect(
      same(
        out.bytes,
        riff([
          vp8x(FLAG.icc | FLAG.alpha, 8, 8),
          chunk('ICCP', profile),
          chunk('ALPH', rawAlpha(8, 8)),
          chunk('VP8 ', vp8(8, 8)),
        ]),
      ),
    ).toBe(true);
    expect(out.dimensions).toEqual({ width: 8, height: 8 });

    // Metadata alone needs no VP8X: what is kept is the simple file.
    const metadataOnly = riff([
      vp8x(FLAG.exif, 64, 48),
      chunk('EXIF', text(SENTINEL)),
      chunk('VP8L', vp8l(64, 48)),
      chunk('XMP ', text(SENTINEL)),
    ]);
    expect(
      same((await run(metadataOnly)).bytes, riff([chunk('VP8L', vp8l(64, 48))])),
    ).toBe(true);
  });

  it('keeps a lossless image’s own transparency in the header when a profile needs one', async () => {
    const profile = iccProfile();
    const out = await run(
      riff([
        vp8x(FLAG.icc | FLAG.alpha, 4, 4),
        chunk('ICCP', profile),
        chunk('VP8L', vp8l(4, 4, { alpha: true })),
      ]),
    );
    expect(
      same(
        out.bytes,
        riff([
          vp8x(FLAG.icc | FLAG.alpha, 4, 4),
          chunk('ICCP', profile),
          chunk('VP8L', vp8l(4, 4, { alpha: true })),
        ]),
      ),
    ).toBe(true);
  });

  it('drops a colour profile that is oversized or does not describe itself, never the image', async () => {
    const unsound = new Uint8Array(140); // no length header, no `acsp`
    for (const profile of [unsound, iccProfile(1024 * 1024 + 2)]) {
      const out = await run(
        riff([
          vp8x(FLAG.icc, 64, 48),
          chunk('ICCP', profile),
          chunk('VP8L', vp8l(64, 48)),
        ]),
        { size: 65_536 },
      );
      expect(same(out.bytes, riff([chunk('VP8L', vp8l(64, 48))]))).toBe(true);
    }
  });

  it('produces the same bytes every time: a stable checksum for one input', async () => {
    const input = riff([vp8x(FLAG.exif, 16, 16), chunk('EXIF', text(SENTINEL)), STILL]);
    const first = await run(input, { size: 3 });
    const second = await run(input, { size: 4096 });
    expect(same(first.bytes, second.bytes)).toBe(true);
  });
});

describe('WebP: everything but a sound still image is refused', () => {
  it('refuses animation however it is declared', async () => {
    expect(await refused(riff([vp8x(FLAG.animation, 16, 16), STILL]))).toBe('unreadable');
    const anim = chunk('ANIM', new Uint8Array(6));
    const anmf = chunk('ANMF', concat(new Uint8Array(16), STILL));
    expect(await refused(riff([vp8x(0, 16, 16), anim, STILL]))).toBe('unreadable');
    expect(await refused(riff([STILL, anmf]))).toBe('unreadable');
    expect(await refused(riff([STILL, anim]))).toBe('unreadable');
  });

  it('refuses a RIFF size that is odd, too small, past the data or short of it', async () => {
    const declared = riff([STILL]).length - 8;
    expect(await refused(riff([STILL], declared + 1))).toBe('unreadable');
    expect(await refused(riff([STILL], 4))).toBe('unreadable');
    expect(await refused(riff([STILL], declared + 2))).toBe('unreadable');
    // Declared shorter than the chunk it holds: the chunk overruns the RIFF.
    expect(await refused(riff([STILL], declared - 2))).toBe('unreadable');
  });

  it('refuses a missing or non-zero padding byte, and a chunk larger than the file', async () => {
    const odd = vp8l(64, 48, { filler: 12 });
    expect(await refused(riff([chunk('VP8L', odd, 0x41)]))).toBe('unreadable');
    // No padding: the next chunk's first byte lands where the zero belongs.
    const unpadded = concat(text('VP8L'), le(odd.length, 4), odd);
    const following = chunk('ZZZZ', text('x'));
    expect(
      await refused(
        riff([concat(unpadded, following.subarray(0, following.length - 1))]),
      ),
    ).toBe('unreadable');
    const overrun = concat(text('VP8 '), le(0xfffffff0, 4), vp8(16, 16));
    expect(await refused(riff([overrun]))).toBe('unreadable');
  });

  it('refuses bytes after the declared end — a polyglot hides there', async () => {
    expect(
      await refused(concat(riff([STILL]), text('PK\u0003\u0004 hidden archive'))),
    ).toBe('unreadable');
    expect(await refused(concat(riff([STILL]), [0]))).toBe('unreadable');
  });

  it('refuses a truncated file at every cut, and never reports dimensions for one', async () => {
    const input = riff([
      vp8x(FLAG.alpha, 4, 3),
      chunk('ALPH', rawAlpha(4, 3)),
      chunk('VP8 ', vp8(4, 3)),
    ]);
    for (let cut = 12; cut < input.length; cut += 1)
      expect(await refused(input.subarray(0, cut)), `cut at ${String(cut)}`).toBe(
        'unreadable',
      );
  });

  it('refuses a second image and an ALPH out of place', async () => {
    const lossless = chunk('VP8L', vp8l(16, 16));
    expect(await refused(riff([STILL, lossless]))).toBe('unreadable');
    expect(await refused(riff([STILL, STILL]))).toBe('unreadable');
    // Alpha for a lossless image, which carries its own.
    expect(
      await refused(
        riff([vp8x(FLAG.alpha, 16, 16), chunk('ALPH', rawAlpha(16, 16)), lossless]),
      ),
    ).toBe('unreadable');
    // Anything between ALPH and its bitstream; ALPH after the image; a VP8X that is not first.
    expect(
      await refused(
        riff([
          vp8x(FLAG.alpha, 16, 16),
          chunk('ALPH', rawAlpha(16, 16)),
          chunk('ZZZZ', text('x')),
          STILL,
        ]),
      ),
    ).toBe('unreadable');
    expect(await refused(riff([STILL, chunk('ALPH', rawAlpha(16, 16))]))).toBe(
      'unreadable',
    );
    expect(await refused(riff([STILL, vp8x(0, 16, 16)]))).toBe('unreadable');
  });

  it('refuses feature flags that contradict the chunks, and reserved bits', async () => {
    // ALPH without the alpha flag; the alpha flag without ALPH on a lossy image.
    expect(
      await refused(riff([vp8x(0, 16, 16), chunk('ALPH', rawAlpha(16, 16)), STILL])),
    ).toBe('unreadable');
    expect(await refused(riff([vp8x(FLAG.alpha, 16, 16), STILL]))).toBe('unreadable');
    // A profile without the flag, the flag without a profile, two profiles, a late profile.
    expect(
      await refused(riff([vp8x(0, 16, 16), chunk('ICCP', iccProfile()), STILL])),
    ).toBe('unreadable');
    expect(await refused(riff([vp8x(FLAG.icc, 16, 16), STILL]))).toBe('unreadable');
    expect(
      await refused(
        riff([
          vp8x(FLAG.icc, 16, 16),
          chunk('ICCP', iccProfile()),
          chunk('ICCP', iccProfile()),
          STILL,
        ]),
      ),
    ).toBe('unreadable');
    expect(
      await refused(riff([vp8x(FLAG.icc, 16, 16), STILL, chunk('ICCP', iccProfile())])),
    ).toBe('unreadable');
    // Reserved flag bits, and the reserved bytes after them.
    for (const flags of [0x80, 0x40, 0x01])
      expect(await refused(riff([vp8x(flags, 16, 16), STILL])), flags.toString(16)).toBe(
        'unreadable',
      );
    expect(
      await refused(
        riff([chunk('VP8X', concat([0, 1, 0, 0], le(15, 3), le(15, 3))), STILL]),
      ),
    ).toBe('unreadable');
    // A VP8X of the wrong size.
    expect(
      await refused(
        riff([chunk('VP8X', concat([0, 0, 0, 0], le(15, 3), le(15, 3), [0, 0])), STILL]),
      ),
    ).toBe('unreadable');
  });

  it('refuses a canvas that disagrees with its bitstream, and malformed alpha', async () => {
    expect(
      await refused(riff([vp8x(FLAG.icc, 17, 16), chunk('ICCP', iccProfile()), STILL])),
    ).toBe('unreadable');
    // Raw alpha one byte short of the canvas; reserved bits; preprocessing 2; compression 2.
    expect(
      await refused(
        riff([
          vp8x(FLAG.alpha, 4, 3),
          chunk('ALPH', rawAlpha(4, 3).subarray(0, 12)),
          chunk('VP8 ', vp8(4, 3)),
        ]),
      ),
    ).toBe('unreadable');
    for (const method of [0x40, 0x20, 0x02])
      expect(
        await refused(
          riff([
            vp8x(FLAG.alpha, 4, 3),
            chunk('ALPH', rawAlpha(4, 3, method)),
            chunk('VP8 ', vp8(4, 3)),
          ]),
        ),
        method.toString(16),
      ).toBe('unreadable');
  });

  it('refuses a lossy bitstream that is not a shown key frame, or lacks its start code', async () => {
    const filler = 21;
    for (const tag of [
      (filler << 5) | (1 << 4) | 1, // an interframe
      (filler << 5) | (1 << 4) | (4 << 1), // version 4
      filler << 5, // not shown
      1 << 4, // an empty first partition
      (500 << 5) | (1 << 4), // a first partition past the chunk
    ])
      expect(
        await refused(riff([chunk('VP8 ', vp8(16, 16, { tag }))])),
        tag.toString(16),
      ).toBe('unreadable');
    expect(
      await refused(riff([chunk('VP8 ', vp8(16, 16, { start: [0x9d, 0x01, 0x2b] }))])),
    ).toBe('unreadable');
    expect(await refused(riff([chunk('VP8 ', vp8(0, 16))]))).toBe('unreadable');
    expect(await refused(riff([chunk('VP8 ', vp8(16, 16).subarray(0, 9))]))).toBe(
      'unreadable',
    );
  });

  it('refuses a lossless bitstream with the wrong signature or a version other than 0', async () => {
    const bad = vp8l(16, 16);
    bad[0] = 0x2e;
    expect(await refused(riff([chunk('VP8L', bad)]))).toBe('unreadable');
    expect(await refused(riff([chunk('VP8L', vp8l(16, 16, { version: 1 }))]))).toBe(
      'unreadable',
    );
  });

  it('refuses a file with no image, and a chunk name that is not four printable characters', async () => {
    expect(await refused(riff([chunk('EXIF', text(SENTINEL))]))).toBe('unreadable');
    expect(await refused(riff([vp8x(0, 16, 16), chunk('EXIF', text(SENTINEL))]))).toBe(
      'unreadable',
    );
    expect(await refused(riff([STILL, chunk('EX\u0000F', text('x'))]))).toBe(
      'unreadable',
    );
  });

  it('refuses a tiny file that declares an enormous canvas, from its headers alone', async () => {
    expect(await refused(riff([vp8x(0, 16_384, 16_384), STILL]))).toBe(
      'dimensions-too-large',
    );
    expect(await refused(riff([vp8x(0, 0x1000000, 1), STILL]))).toBe(
      'dimensions-too-large',
    );
    expect(await refused(riff([chunk('VP8L', vp8l(16_384, 16_384))]))).toBe(
      'dimensions-too-large',
    );
    expect(
      await refused(riff([chunk('VP8 ', vp8(300, 300))]), {
        limits: { maxPixels: 1000, maxEdge: 16_384 },
      }),
    ).toBe('dimensions-too-large');
  });

  it('counts dropped metadata against the ceiling — stripping is no way around it', async () => {
    const input = riff([
      vp8x(FLAG.exif, 16, 16),
      chunk('EXIF', new Uint8Array(4096)),
      STILL,
    ]);
    expect(await refused(input, { ceiling: 2048 })).toBe('too-large');
  });

  it('is not a WebP for a policy that does not name one, nor a RIFF of another kind', async () => {
    const input = riff([STILL]);
    const untouched = await run(input, { webp: false });
    expect(same(untouched.bytes, input)).toBe(true);
    expect(untouched.dimensions).toBeNull();

    const wave = concat(text('RIFF'), le(8, 4), text('WAVEfmt '));
    const forwarded = await run(wave);
    expect(same(forwarded.bytes, wave)).toBe(true);
    expect(forwarded.dimensions).toBeNull();
  });
});
