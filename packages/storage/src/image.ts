import 'server-only';

import { crc32, inflateSync } from 'node:zlib';

import type { ImageDimensions, ImageLimits } from '@minhaj/contracts/platform';

import { ByteLimitExceeded } from './filesystem.ts';

/**
 * Still-image admission (Phase 12) — structural validation and metadata
 * removal for the two raster formats the platform accepts, JPEG and PNG,
 * performed WHILE the bytes stream into storage.
 *
 * WHY THIS EXISTS. Sniffing (`./sniff.ts`) says what a file LOOKS like from its
 * first bytes. An image needs more before it may be offered to a visitor's
 * browser:
 *
 *   - it must be STRUCTURALLY WHOLE — a truncated or malformed file renders as a
 *     broken image, and a file with no image data is not an image;
 *   - its DECLARED DIMENSIONS must be bounded, because a few kilobytes of
 *     compressed data can ask a decoder for billions of pixels (the
 *     "decompression bomb");
 *   - its HIDDEN METADATA must not be published. A camera or phone writes GPS
 *     coordinates, device serial numbers, owner names, embedded thumbnails
 *     (which can show the picture BEFORE it was cropped) and editing history
 *     into EXIF, XMP, IPTC and comment segments, and some devices append whole
 *     videos after the image. None of that is the photograph.
 *
 * THE SERVER NEVER DECODES A PIXEL. Everything here reads container STRUCTURE —
 * JPEG marker segments, PNG chunks — and copies the image data through
 * untouched. No image library parses untrusted pixels on the server, so there
 * is no decoder attack surface here, and the photograph is not re-encoded: its
 * pixels are exactly the pixels that were uploaded.
 *
 * WHAT IS KEPT, and nothing else:
 *
 *   JPEG — the frame, scan, quantisation, Huffman and restart segments that ARE
 *          the image; the ICC colour profile and the Adobe colour-transform
 *          marker, because they change how the pixels look; and the JFIF header
 *          with any embedded thumbnail removed. If the camera recorded that the
 *          picture must be ROTATED to be seen upright, that one fact is written
 *          back as a minimal EXIF segment holding the orientation and nothing
 *          else — dropping it would turn every portrait phone photograph on its
 *          side.
 *   PNG  — the critical chunks, and the colour chunks (`tRNS`, `gAMA`, `cHRM`,
 *          `sRGB`, and an `iCCP` profile that inflates within a bound). Text,
 *          time, EXIF, animation and every private chunk are dropped, so an
 *          animated PNG becomes its still default image.
 *
 * Anything after the image's end marker is discarded.
 *
 * THE BYTE CEILING APPLIES TO WHAT ARRIVES, not to what is kept: metadata that
 * is discarded still counts, so stripping cannot be used to push an unbounded
 * upload through.
 *
 * STRICT, AND THAT IS DELIBERATE. A structure this parser does not understand
 * is a refusal, not a guess — an arithmetic-coded, lossless, hierarchical or
 * 12-bit JPEG, a JPEG with bytes between its segments, a PNG with a bad CRC or
 * an unknown critical chunk. Browsers cannot display several of those, and the
 * rest are rare enough that asking for an ordinary export is the right answer.
 */

/** Why an image was refused, in the words Storage records. */
export type ImageRejection = 'unreadable' | 'dimensions-too-large';

/** Raised when the bytes are not an admissible still image. */
export class ImageRefused extends Error {
  constructor(readonly rejection: ImageRejection) {
    super(
      rejection === 'unreadable'
        ? 'The image is malformed or not a supported still image.'
        : 'The image declares more pixels than are permitted.',
    );
  }
}

/** The media types this module can structurally validate. */
export const SANITISABLE_IMAGE_TYPES: readonly string[] = Object.freeze([
  'image/jpeg',
  'image/png',
]);

/** How many progressive scans a JPEG may carry. Real encoders use about ten. */
const MAX_JPEG_SCANS = 100;

/** A compressed ICC profile larger than this is dropped, not inflated. */
const MAX_PNG_ICC_COMPRESSED = 1024 * 1024;

/** An ICC profile that inflates past this is dropped: colour, not a bomb. */
const MAX_PNG_ICC_INFLATED = 4 * 1024 * 1024;

const truncated = () => new ImageRefused('unreadable');

/* ===========================================================================
 * A pull-based reader over the upload stream
 * ========================================================================= */

/**
 * Reads the upload in exact-sized pieces without ever holding more than one
 * marker segment or chunk header at a time.
 *
 * Every byte pulled from the upload counts against the ceiling, whether it is
 * later kept or discarded.
 */
class ByteSource {
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private received = 0;
  private readonly iterator: AsyncIterator<Uint8Array>;

  constructor(
    input: AsyncIterable<Uint8Array>,
    private readonly maxBytes: number,
  ) {
    this.iterator = input[Symbol.asyncIterator]();
  }

  private get available(): number {
    return this.buffer.length - this.offset;
  }

  /** Pulls one more chunk from the upload; `false` at its end. */
  private async pull(): Promise<boolean> {
    for (;;) {
      const next = await this.iterator.next();
      if (next.done === true) return false;
      const chunk = next.value;
      this.received += chunk.byteLength;
      if (this.received > this.maxBytes) throw new ByteLimitExceeded();
      if (chunk.byteLength === 0) continue;
      if (this.available === 0) {
        this.buffer = chunk;
      } else {
        const joined = new Uint8Array(this.available + chunk.byteLength);
        joined.set(this.buffer.subarray(this.offset), 0);
        joined.set(chunk, this.available);
        this.buffer = joined;
      }
      this.offset = 0;
      return true;
    }
  }

  /** At least `count` bytes are buffered; `false` if the upload ends first. */
  async ensure(count: number): Promise<boolean> {
    while (this.available < count) {
      if (!(await this.pull())) return false;
    }
    return true;
  }

  /** Exactly `count` bytes, copied. For headers and small segments only. */
  async take(count: number): Promise<Uint8Array> {
    if (!(await this.ensure(count))) throw truncated();
    const out = this.buffer.slice(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }

  /** The byte `ahead` places past the cursor, which must be buffered. */
  peek(ahead: number): number {
    return this.buffer[this.offset + ahead] ?? -1;
  }

  /** Whatever is buffered now, without copying. */
  view(): Uint8Array {
    return this.buffer.subarray(this.offset);
  }

  advance(count: number): void {
    this.offset += count;
  }

  /** Exactly `count` bytes as they arrive — streamed, never gathered. */
  async *pass(count: number): AsyncGenerator<Uint8Array> {
    let remaining = count;
    while (remaining > 0) {
      if (this.available === 0 && !(await this.pull())) throw truncated();
      const size = Math.min(remaining, this.available);
      yield this.buffer.subarray(this.offset, this.offset + size);
      this.offset += size;
      remaining -= size;
    }
  }

  /** Discards exactly `count` bytes. */
  async skip(count: number): Promise<void> {
    for await (const _ of this.pass(count)) {
      // Discarded: the bytes still count against the ceiling as they arrive.
    }
  }

  /** Reads and discards everything left, still under the ceiling. */
  async drain(): Promise<void> {
    this.offset = this.buffer.length;
    while (await this.pull()) this.offset = this.buffer.length;
  }
}

const u16 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);

const u32 = (bytes: Uint8Array, at: number) =>
  (((bytes[at] ?? 0) << 24) >>> 0) +
  (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));

const startsWith = (bytes: Uint8Array, text: string) =>
  bytes.length >= text.length &&
  [...text].every((character, index) => bytes[index] === character.charCodeAt(0));

function withinLimits(width: number, height: number, limits: ImageLimits): void {
  if (width < 1 || height < 1) throw new ImageRefused('unreadable');
  if (
    width > limits.maxEdge ||
    height > limits.maxEdge ||
    width * height > limits.maxPixels
  )
    throw new ImageRefused('dimensions-too-large');
}

/* ===========================================================================
 * JPEG (ITU-T T.81)
 * ========================================================================= */

/**
 * The EXIF orientation (1–8) in a TIFF structure, or 1 when absent or unusual.
 *
 * Reads IFD0 ONLY and only tag 0x0112. Nothing else in the EXIF block is read,
 * kept or trusted — no location, no device, no date.
 */
export function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return 1;
  const read16 = (at: number) =>
    little ? (tiff[at] ?? 0) | ((tiff[at + 1] ?? 0) << 8) : u16(tiff, at);
  const read32 = (at: number) =>
    little
      ? ((tiff[at] ?? 0) |
          ((tiff[at + 1] ?? 0) << 8) |
          ((tiff[at + 2] ?? 0) << 16) |
          ((tiff[at + 3] ?? 0) << 24)) >>>
        0
      : u32(tiff, at);
  if (read16(2) !== 42) return 1;
  const ifd = read32(4);
  if (ifd + 2 > tiff.length) return 1;
  const entries = read16(ifd);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (read16(entry) !== 0x0112) continue;
    if (read16(entry + 2) !== 3 || read32(entry + 4) !== 1) return 1;
    const value = read16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/**
 * A complete APP1 segment carrying ONE fact: the orientation. A minimal
 * big-endian TIFF with a single IFD0 entry, and nothing else.
 */
function orientationSegment(orientation: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xe1,
    0x00,
    0x22,
    // "Exif\0\0"
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    // "MM", 42, IFD0 at offset 8
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    // one entry: Orientation, SHORT, count 1, value
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    // no next IFD
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

/**
 * SOF markers of the three codings browsers display: baseline, extended
 * sequential and progressive Huffman. Every other frame type — lossless,
 * hierarchical, arithmetic-coded — is refused with the reserved codes below.
 */
const SUPPORTED_FRAMES: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);

async function* sanitiseJpeg(
  source: ByteSource,
  limits: ImageLimits,
  report: (dimensions: ImageDimensions) => void,
): AsyncGenerator<Uint8Array> {
  const start = await source.take(2);
  if (start[0] !== 0xff || start[1] !== 0xd8) throw truncated();
  yield start;

  let frame: { width: number; height: number } | null = null;
  let orientation = 1;
  let jfifSeen = false;
  let exifSeen = false;
  let scans = 0;

  for (;;) {
    // ---- a marker: 0xFF, optional fill bytes, then the marker code -------
    const lead = await source.take(1);
    if (lead[0] !== 0xff) throw truncated();
    let marker = 0xff;
    while (marker === 0xff) marker = (await source.take(1))[0] ?? -1;

    if (marker === 0xd9) {
      // End of image. It must have carried at least one scan.
      if (frame === null || scans === 0) throw truncated();
      yield Uint8Array.from([0xff, 0xd9]);
      await source.drain();
      const swapped = orientation >= 5;
      report({
        width: swapped ? frame.height : frame.width,
        height: swapped ? frame.width : frame.height,
      });
      return;
    }

    // Standalone markers outside a scan, a second SOI, and byte-stuffing are
    // all structural errors here.
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8) throw truncated();
    if (marker >= 0xd0 && marker <= 0xd7) throw truncated();

    const length = u16(await source.take(2), 0);
    if (length < 2) throw truncated();
    const size = length - 2;
    const header = Uint8Array.from([0xff, marker, length >> 8, length & 0xff]);

    if (marker >= 0xe0 && marker <= 0xef) {
      // ---- application segments: kept only where they change the picture --
      if (marker === 0xe0 && !jfifSeen && size >= 14) {
        const head = await source.take(14);
        await source.skip(size - 14);
        if (startsWith(head, 'JFIF\0')) {
          jfifSeen = true;
          // The JFIF header with its thumbnail dimensions zeroed — the
          // thumbnail itself was just skipped.
          head[12] = 0;
          head[13] = 0;
          yield Uint8Array.from([0xff, 0xe0, 0x00, 0x10]);
          yield head;
        }
        continue;
      }
      if (marker === 0xe1 && !exifSeen && size >= 6) {
        const payload = await source.take(size);
        if (startsWith(payload, 'Exif\0\0')) {
          exifSeen = true;
          orientation = exifOrientation(payload.subarray(6));
          if (orientation !== 1) yield orientationSegment(orientation);
        }
        continue;
      }
      if (marker === 0xe2 && size >= 12) {
        const head = await source.take(12);
        if (startsWith(head, 'ICC_PROFILE\0')) {
          yield header;
          yield head;
          yield* source.pass(size - 12);
        } else {
          await source.skip(size - 12);
        }
        continue;
      }
      if (marker === 0xee && size >= 5) {
        const payload = await source.take(size);
        if (startsWith(payload, 'Adobe')) {
          yield header;
          yield payload;
        }
        continue;
      }
      await source.skip(size);
      continue;
    }

    if (marker === 0xfe) {
      // A comment: text an encoder or a person wrote, never the picture.
      await source.skip(size);
      continue;
    }

    if (SUPPORTED_FRAMES.has(marker)) {
      if (frame !== null) throw truncated();
      const payload = await source.take(size);
      const components = payload[5] ?? 0;
      if (
        size < 6 ||
        payload[0] !== 8 ||
        ![1, 3, 4].includes(components) ||
        size !== 6 + 3 * components
      )
        throw truncated();
      const height = u16(payload, 1);
      const width = u16(payload, 3);
      withinLimits(width, height, limits);
      frame = { width, height };
      yield header;
      yield payload;
      continue;
    }

    if (marker === 0xdb || marker === 0xc4 || marker === 0xdd) {
      // Quantisation tables, Huffman tables, restart interval: the image.
      yield header;
      yield* source.pass(size);
      continue;
    }

    // Any other frame type, arithmetic conditioning, DNL, hierarchical
    // markers, the JPGn extensions, every reserved code — and a scan before
    // its frame.
    if (marker !== 0xda || frame === null) throw truncated();

    // ---- start of scan, then the entropy-coded data it introduces ---------
    scans += 1;
    if (scans > MAX_JPEG_SCANS) throw truncated();
    const payload = await source.take(size);
    const selectors = payload[0] ?? 0;
    if (selectors < 1 || selectors > 4 || size !== 1 + 2 * selectors + 3)
      throw truncated();
    yield header;
    yield payload;

    for (;;) {
      if (!(await source.ensure(1))) throw truncated();
      const visible = source.view();
      const next = visible.indexOf(0xff);
      if (next === -1) {
        yield visible;
        source.advance(visible.length);
        continue;
      }
      if (next > 0) {
        yield visible.subarray(0, next);
        source.advance(next);
      }
      if (!(await source.ensure(2))) throw truncated();
      const following = source.peek(1);
      if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) {
        // A stuffed 0xFF data byte, or a restart marker: part of the scan.
        yield source.view().subarray(0, 2);
        source.advance(2);
        continue;
      }
      if (following === 0xff) {
        // A fill byte before a marker; the marker itself is read next.
        source.advance(1);
        continue;
      }
      // A marker ends the scan. Leave its 0xFF for the segment loop.
      break;
    }
  }
}

/* ===========================================================================
 * PNG (ISO/IEC 15948)
 * ========================================================================= */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Bit depths each colour type permits. */
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** Ancillary chunks that change how the pixels look, kept before the image data. */
const PNG_COLOUR_CHUNKS: ReadonlySet<string> = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB']);

/** The chunk's four-letter type, or `null` when it is not four ASCII letters. */
function chunkType(bytes: Uint8Array): string | null {
  const letters = [...bytes];
  if (
    letters.length !== 4 ||
    !letters.every(
      (byte) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a),
    )
  )
    return null;
  return String.fromCharCode(...letters);
}

/** Is this `iCCP` payload a well-formed profile that inflates within its bound? */
function boundedIccProfile(data: Uint8Array): boolean {
  const separator = data.indexOf(0);
  if (separator < 1 || separator > 79 || data[separator + 1] !== 0) return false;
  try {
    inflateSync(data.subarray(separator + 2), { maxOutputLength: MAX_PNG_ICC_INFLATED });
    return true;
  } catch {
    // Corrupt or oversized: the colour hint is dropped, the image is not.
    return false;
  }
}

async function* sanitisePng(
  source: ByteSource,
  limits: ImageLimits,
  report: (dimensions: ImageDimensions) => void,
): AsyncGenerator<Uint8Array> {
  const signature = await source.take(8);
  if (!PNG_SIGNATURE.every((byte, index) => signature[index] === byte)) throw truncated();
  yield signature;

  let dimensions: ImageDimensions | null = null;
  let colourType = -1;
  let palette = false;
  let imageData: 'before' | 'within' | 'after' = 'before';

  for (;;) {
    const head = await source.take(8);
    const length = u32(head, 0);
    const type = chunkType(head.subarray(4, 8));
    if (type === null || length > 0x7fffffff) throw truncated();
    const critical = type.charCodeAt(0) < 0x61;

    if (dimensions === null && type !== 'IHDR') throw truncated();
    if (imageData === 'within' && type !== 'IDAT') imageData = 'after';

    // A kept chunk is re-emitted exactly, with its CRC verified as it passes.
    const keep = async function* (): AsyncGenerator<Uint8Array> {
      let crc = crc32(head.subarray(4, 8));
      yield head;
      for await (const piece of source.pass(length)) {
        crc = crc32(piece, crc);
        yield piece;
      }
      const stored = await source.take(4);
      if (u32(stored, 0) !== crc >>> 0) throw truncated();
      yield stored;
    };

    switch (type) {
      case 'IHDR': {
        if (dimensions !== null || length !== 13) throw truncated();
        const data = await source.take(13);
        const stored = await source.take(4);
        if (u32(stored, 0) !== crc32(data, crc32(head.subarray(4, 8))) >>> 0)
          throw truncated();
        const width = u32(data, 0);
        const height = u32(data, 4);
        const depth = data[8] ?? 0;
        colourType = data[9] ?? -1;
        if (
          !(PNG_DEPTHS[colourType] ?? []).includes(depth) ||
          data[10] !== 0 ||
          data[11] !== 0 ||
          (data[12] !== 0 && data[12] !== 1) ||
          width > 0x7fffffff ||
          height > 0x7fffffff
        )
          throw truncated();
        withinLimits(width, height, limits);
        dimensions = { width, height };
        yield head;
        yield data;
        yield stored;
        continue;
      }
      case 'PLTE': {
        if (
          imageData !== 'before' ||
          palette ||
          length === 0 ||
          length % 3 !== 0 ||
          length > 768 ||
          colourType === 0 ||
          colourType === 4
        )
          throw truncated();
        palette = true;
        yield* keep();
        continue;
      }
      case 'IDAT': {
        if (imageData === 'after' || (colourType === 3 && !palette)) throw truncated();
        imageData = 'within';
        yield* keep();
        continue;
      }
      case 'IEND': {
        if (length !== 0 || imageData === 'before' || dimensions === null)
          throw truncated();
        yield* keep();
        await source.drain();
        report(dimensions);
        return;
      }
      default:
        break;
    }

    if (critical) throw truncated();

    if (imageData === 'before' && PNG_COLOUR_CHUNKS.has(type)) {
      yield* keep();
      continue;
    }

    if (imageData === 'before' && type === 'iCCP' && length <= MAX_PNG_ICC_COMPRESSED) {
      const data = await source.take(length);
      const stored = await source.take(4);
      if (u32(stored, 0) !== crc32(data, crc32(head.subarray(4, 8))) >>> 0)
        throw truncated();
      if (boundedIccProfile(data)) {
        yield head;
        yield data;
        yield stored;
      }
      continue;
    }

    // Text, time, EXIF, animation, private and every other ancillary chunk.
    await source.skip(length + 4);
  }
}

/* ===========================================================================
 * The transform
 * ========================================================================= */

export interface SanitisedImage {
  /** The kept bytes, streamed. Iterating it performs the validation. */
  readonly bytes: AsyncIterable<Uint8Array>;
  /**
   * The displayed dimensions — after orientation — once `bytes` has been read
   * to its end; `null` when the upload was not a JPEG or PNG at all, in which
   * case its bytes passed through untouched for the ordinary sniff to refuse.
   */
  readonly dimensions: () => ImageDimensions | null;
}

/**
 * Wraps an upload so that reading it validates and strips a JPEG or PNG.
 *
 * Bytes that do not BEGIN like a JPEG or a PNG pass through unchanged: this
 * module does not decide what a file is — the sniff does, and it will refuse
 * them against the caller's image-only allowlist. `maxBytes` bounds what
 * ARRIVES, discarded metadata included.
 */
export function sanitiseImage(
  input: AsyncIterable<Uint8Array>,
  limits: ImageLimits,
  maxBytes: number,
): SanitisedImage {
  let dimensions: ImageDimensions | null = null;
  const report = (value: ImageDimensions) => {
    dimensions = value;
  };

  async function* bytes(): AsyncGenerator<Uint8Array> {
    const source = new ByteSource(input, maxBytes);
    const known = await source.ensure(8);
    const lead = source.view();

    // Anything that OPENS like a JPEG — its start-of-image marker — is held to
    // the JPEG rules, however short or malformed what follows is. Forwarding it
    // instead would leave its fate to a three-byte sniff.
    if (lead[0] === 0xff && lead[1] === 0xd8) {
      yield* sanitiseJpeg(source, limits, report);
      return;
    }
    if (known && PNG_SIGNATURE.every((byte, index) => lead[index] === byte)) {
      yield* sanitisePng(source, limits, report);
      return;
    }

    // Not an image this module knows: forwarded as it arrived.
    for (;;) {
      const visible = source.view();
      if (visible.length > 0) {
        yield visible;
        source.advance(visible.length);
      }
      if (!(await source.ensure(1))) return;
    }
  }

  return { bytes: bytes(), dimensions: () => dimensions };
}
