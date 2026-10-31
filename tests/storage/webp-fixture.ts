/**
 * Synthetic WebP containers (RFC 9649) for the still-WebP admission tests.
 *
 * Built byte by byte so each test states exactly which structure it exercises.
 * The bitstreams carry valid headers — a shown VP8 key frame with its start
 * code, a VP8L signature with version 0 — and filler where the compressed data
 * would be: the sanitiser reads container structure only and never decodes a
 * pixel, so no test depends on an image library.
 */

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

export const le = (value: number, count: number): number[] =>
  Array.from(
    { length: count },
    (_unused, index) => Math.floor(value / 256 ** index) % 256,
  );

export function concat(
  ...parts: readonly (Uint8Array | readonly number[])[]
): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** One chunk, padded to an even length with `pad` (0 conforms). */
export function chunk(type: string, payload: Uint8Array, pad = 0): Uint8Array {
  return concat(
    ascii(type),
    le(payload.length, 4),
    payload,
    payload.length % 2 === 1 ? [pad] : [],
  );
}

/** A RIFF/WEBP file around `chunks`, its declared size computed unless given. */
export function riff(chunks: readonly Uint8Array[], declared?: number): Uint8Array {
  const body = concat(...chunks);
  return concat(ascii('RIFF'), le(declared ?? body.length + 4, 4), ascii('WEBP'), body);
}

/** A lossy bitstream: a shown key frame of `width` × `height`, `filler` bytes of data. */
export function vp8(
  width: number,
  height: number,
  options: {
    readonly filler?: number;
    readonly tag?: number;
    readonly start?: number[];
  } = {},
): Uint8Array {
  const filler = options.filler ?? 21;
  const firstPartition = filler;
  const tag = options.tag ?? (firstPartition << 5) | (1 << 4);
  return concat(
    le(tag, 3),
    options.start ?? [0x9d, 0x01, 0x2a],
    le(width, 2),
    le(height, 2),
    Array.from({ length: filler }, (_unused, index) => (index * 37 + 11) % 256),
  );
}

/** A lossless bitstream header for `width` × `height`, then `filler` bytes. */
export function vp8l(
  width: number,
  height: number,
  options: {
    readonly alpha?: boolean;
    readonly version?: number;
    readonly filler?: number;
  } = {},
): Uint8Array {
  const bits =
    width -
    1 +
    (height - 1) * 2 ** 14 +
    (options.alpha === true ? 2 ** 28 : 0) +
    (options.version ?? 0) * 2 ** 29;
  return concat(
    [0x2f],
    le(bits, 4),
    Array.from(
      { length: options.filler ?? 12 },
      (_unused, index) => (index * 53 + 7) % 256,
    ),
  );
}

/** A VP8X header chunk: feature flags and a canvas. */
export function vp8x(flags: number, width: number, height: number): Uint8Array {
  return chunk('VP8X', concat([flags, 0, 0, 0], le(width - 1, 3), le(height - 1, 3)));
}

/** An ICC profile whose header states its own length and carries `acsp`. */
export function iccProfile(length = 140): Uint8Array {
  const profile = new Uint8Array(length);
  profile.set(
    [(length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255],
    0,
  );
  profile.set(ascii('acsp'), 36);
  return profile;
}

/** Raw (uncompressed) alpha for a `width` × `height` canvas. */
export function rawAlpha(width: number, height: number, method = 0): Uint8Array {
  return concat([method], new Uint8Array(width * height).fill(0xff));
}

export const text = (value: string) => Uint8Array.from(ascii(value));

/** VP8X flag bits. */
export const FLAG = Object.freeze({
  icc: 0x20,
  alpha: 0x10,
  exif: 0x08,
  xmp: 0x04,
  animation: 0x02,
});
