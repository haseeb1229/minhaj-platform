import { IMAGE_DERIVATIVE_WIDTHS } from '@minhaj/contracts/platform';

import type { ImageSource } from './image-source';

/**
 * THE ADDRESSES OF A PICTURE'S WEBP DERIVATIVES (Rebaseline R2).
 *
 * Storage renders a public still image at a few narrower widths
 * (`IMAGE_DERIVATIVE_WIDTHS`), each served by a route BESIDE the owning
 * context's own picture route: `{picture route}/{width}w.webp`. The derivative
 * route asks exactly the same owners about the same source asset, so an
 * address built here is only ever as reachable as the picture itself.
 *
 * CONTENT-ADDRESSED. The picture route names the source ASSET, whose bytes
 * never change under its id (a new picture is a new asset), and the segment
 * names the width; a derivative is a pure function of the two, which is what
 * lets its route answer `immutable`. Nothing here asks a database: the widths
 * offered are those no wider than the picture's own recorded width, so a
 * derivative is never an enlargement — and one not rendered yet is answered
 * with a redirect to the picture itself, never a broken image.
 */

/** `640w.webp` — the one segment grammar the derivative routes accept. */
const SEGMENT = /^([1-9]\d{2,3})w\.webp$/;

/**
 * The picture routes that have a derivative route beside them: the PUBLIC
 * routes of Editorial lead images, Library covers, Media photographs and
 * posters, and People portraits. Previews, audio and private bytes do not.
 * Each pattern is the whole path, so a longer or shorter one never matches.
 */
const PICTURE_ROUTES: readonly RegExp[] = Object.freeze([
  /^\/assets\/editorial\/(?!previews\/)[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
  /^\/assets\/library\/covers\/(?:editions|issues)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
  /^\/assets\/media\/(?:photos|posters)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
  /^\/assets\/people\/portraits\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
]);

/** The width a derivative segment names, or `null` for anything else. */
export function derivativeWidthOf(segment: string): number | null {
  const match = SEGMENT.exec(segment);
  const width = match === null ? NaN : Number(match[1]);
  return (IMAGE_DERIVATIVE_WIDTHS as readonly number[]).includes(width) ? width : null;
}

/** One derivative's address. */
export function derivativePath(picture: string, width: number): string {
  return `${picture}/${String(width)}w.webp`;
}

/**
 * The derivatives a picture of `width` pixels has, narrowest first — each no
 * wider than the picture — plus the picture itself as the widest candidate
 * when it is narrower than the widest derivative (so a browser that needs
 * every pixel still gets them). `undefined` for an address without
 * derivatives, an unknown width, or a picture narrower than the narrowest.
 */
export function derivativeSources(
  picture: string,
  width: number | null | undefined,
): readonly ImageSource[] | undefined {
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 1 ||
    !PICTURE_ROUTES.some((route) => route.test(picture))
  )
    return undefined;
  const sources: ImageSource[] = IMAGE_DERIVATIVE_WIDTHS.filter(
    (candidate) => candidate <= width,
  ).map((candidate) => ({ src: derivativePath(picture, candidate), width: candidate }));
  if (sources.length === 0) return undefined;
  const widest = IMAGE_DERIVATIVE_WIDTHS[IMAGE_DERIVATIVE_WIDTHS.length - 1] ?? 0;
  if (width < widest && sources.at(-1)?.width !== width)
    sources.push({ src: picture, width });
  return sources;
}

/**
 * A public picture as the image primitives take it: its own address and its
 * derivatives — e.g. `<Cover {...publicImage(editionCoverPath(id, asset), w)} … />`.
 */
export function publicImage(
  picture: string,
  width: number | null | undefined,
): { readonly path: string; readonly derivatives?: readonly ImageSource[] } {
  const derivatives = derivativeSources(picture, width);
  return derivatives === undefined ? { path: picture } : { path: picture, derivatives };
}

/** A `srcset` value for a hand-written `<img>` of a public picture, or `undefined`. */
export function derivativeSrcSet(
  picture: string,
  width: number | null | undefined,
): string | undefined {
  return derivativeSources(picture, width)
    ?.map((source) => `${source.src} ${String(source.width)}w`)
    .join(', ');
}
