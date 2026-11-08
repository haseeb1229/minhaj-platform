/**
 * THE ONE RULE FOR AN IMAGE ADDRESS (R2): first-party asset routes only.
 *
 * Every picture the platform shows is served by an owning context's own byte
 * route under `/assets/…`, which checks that the record is public and the asset
 * is clean before it sends a byte. A remote URL, a protocol-relative `//host`
 * address, a `data:` or `javascript:` scheme, a dot segment or an encoded
 * separator would each step around that check, so they are refused here — and
 * a refused source renders NO image at all rather than a broken one
 * (Content-Security-Policy `img-src 'self'` would refuse most of them anyway;
 * this keeps the claim true in the markup too).
 */

const SEGMENT = /^[A-Za-z0-9._~%-]+$/;

/** The address itself when it is a first-party asset path, otherwise `null`. */
export function firstPartyImagePath(src: string): string | null {
  if (!src.startsWith('/assets/')) return null;
  const segments = src.slice('/assets/'.length).split('/');
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..' || /[/\\]/.test(decoded)) return null;
  }
  return src;
}

/** One derivative of an image: its first-party address and its pixel width. */
export interface ImageSource {
  readonly src: string;
  readonly width: number;
}

/**
 * A `srcset` value from derivatives — each first-party, each a positive whole
 * width, each width once, narrowest first — or `undefined` when none survive.
 */
export function imageSrcSet(
  sources: readonly ImageSource[] | undefined,
): string | undefined {
  if (sources === undefined) return undefined;
  const byWidth = new Map<number, ImageSource>();
  for (const source of sources) {
    if (!Number.isInteger(source.width) || source.width <= 0) continue;
    if (firstPartyImagePath(source.src) === null || byWidth.has(source.width)) continue;
    byWidth.set(source.width, source);
  }
  const kept = [...byWidth.values()].sort((a, b) => a.width - b.width);
  return kept.length === 0
    ? undefined
    : kept.map((source) => `${source.src} ${String(source.width)}w`).join(', ');
}
