import 'server-only';

import sharp from 'sharp';

import type { ImageLimits } from '@minhaj/contracts/platform';

/**
 * Rendering the WebP derivatives of one still image (Rebaseline R2).
 *
 * THE ONLY PLACE STORAGE DECODES PIXELS. Admission (`./image.ts`) never decodes:
 * it validates container structure and strips metadata as bytes stream past.
 * A derivative has to be resized, so this module decodes — and it is fenced
 * accordingly:
 *
 *   - it is handed only bytes Storage already holds as a CLEAN JPEG, PNG or
 *     still WebP, and it refuses anything the decoder reads as another format,
 *     so the rest of libvips' format surface is never reached;
 *   - the declared size is read from the header and checked against `limits`
 *     BEFORE any pixel is decoded, and the decoder itself carries the same
 *     pixel ceiling, so a small file declaring an enormous canvas is refused
 *     rather than expanded (no decompression bomb);
 *   - only the first frame of anything is read;
 *   - the output carries NO metadata at all — no EXIF, XMP, IPTC or colour
 *     profile: pixels are converted to sRGB and written alone;
 *   - a width wider than the displayed image is never produced: a derivative is
 *     never an enlargement.
 *
 * Nothing here touches the filesystem or a database; it is a pure function of
 * the bytes, so one input always yields the same outputs.
 */

/** The formats the decoder may report for a source Storage admitted. */
const SOURCE_FORMATS: readonly string[] = Object.freeze(['jpeg', 'png', 'webp']);

/** Lossy WebP at a quality that keeps photographs and text-on-image legible. */
const WEBP_QUALITY = 78;

/** libvips' own operation cache would hold decoded images between requests. */
sharp.cache(false);

export interface RenderedDerivative {
  readonly width: number;
  readonly bytes: Uint8Array;
}

/**
 * Renders `widths` of `source` as WebP, skipping every width wider than the
 * image as it is DISPLAYED (its EXIF orientation applied). `null` when the
 * bytes are not a decodable still image within `limits`.
 */
export async function renderDerivatives(
  source: Uint8Array,
  limits: ImageLimits,
  widths: readonly number[],
): Promise<readonly RenderedDerivative[] | null> {
  const options = {
    limitInputPixels: limits.maxPixels,
    failOn: 'error',
    animated: false,
    autoOrient: true,
  } as const;

  let displayedWidth: number;
  try {
    const metadata = await sharp(source, options).metadata();
    if (
      metadata.format === undefined ||
      !SOURCE_FORMATS.includes(metadata.format) ||
      metadata.width === undefined ||
      metadata.height === undefined ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      Math.max(metadata.width, metadata.height) > limits.maxEdge ||
      metadata.width * metadata.height > limits.maxPixels
    )
      return null;
    // `width` is the stored raster; the displayed one has orientation applied.
    displayedWidth = metadata.autoOrient.width;
  } catch {
    return null;
  }

  const rendered: RenderedDerivative[] = [];
  for (const width of widths) {
    if (!Number.isInteger(width) || width < 1 || width > displayedWidth) continue;
    try {
      const bytes = await sharp(source, options)
        .resize({ width, withoutEnlargement: true })
        .toColourspace('srgb')
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      rendered.push({ width, bytes: new Uint8Array(bytes) });
    } catch {
      return null;
    }
  }
  return rendered;
}
