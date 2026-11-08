import 'server-only';

import type {
  AssetAuthorizationPort,
  StorageServicePort,
} from '@minhaj/contracts/platform';
import { requestDerivation } from '@/composition/storage-derivatives';
import { derivativeWidthOf } from '@/components/ui/image-derivatives';
import { refuseMediaBytes } from './media/serve';
import { toWebStream } from './web-stream';

/**
 * Serving one WebP DERIVATIVE of a public picture (Rebaseline R2) — for every
 * `…/{assetId}/{width}w.webp` route beside a domain's picture route.
 *
 * THE SAME TWO OWNERS DECIDE, ABOUT THE SOURCE. The route builds exactly the
 * policy its sibling picture route builds, and Storage applies it to the SOURCE
 * asset — clean custody, bytes present, the owning context allowing that asset
 * on that published record now — before it looks for the derivative at all. A
 * derivative is never reachable where its source is not: a draft's picture, a
 * withdrawn record's, a replaced one, a restricted one no record shows, and a
 * malformed address are all the same `404`, `private, no-store`.
 *
 * WHY THIS ONE MAY BE SHARED-CACHED FOR A YEAR, WHEN THE SOURCE IS NOT. The
 * address is content-addressed: it names the source ASSET — whose bytes never
 * change under its id; a new picture is a new asset and a new address — and the
 * width, and the derivative is a pure function of those. So `public, max-age=
 * 31536000, immutable` can never serve stale bytes for an address. Withdrawal
 * works by the address disappearing: a page stops emitting it the moment the
 * record stops showing the picture, and this route answers it `404` from then
 * on. What it cannot do is reach into a cache that already holds the bytes —
 * that is the accepted cost of the class, and why no edge cache in front of
 * this application stores it (the staging proxy caches nothing).
 *
 * A WIDTH NOT DERIVED YET is not an error: the source is servable, so the
 * browser is sent to the source's own address (`307`, `no-store`, so nothing
 * remembers the detour) and the derivation is asked for in the background.
 * The redirect target is the sibling picture route's own path, derived from
 * this request's path, never from a query, a header or a stored value.
 */

/** `public` and `immutable` — only ever on a 200/304 for a content-addressed derivative. */
export const DERIVATIVE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The sibling picture route's path: this path without its last segment. */
const SOURCE_PATH = /^\/assets(?:\/[A-Za-z0-9_-]+)+$/;

export async function serveDerivative(
  storage: StorageServicePort,
  request: Request,
  assetId: string,
  segment: string,
  policy: AssetAuthorizationPort,
): Promise<Response> {
  const width = derivativeWidthOf(segment);
  if (width === null) return refuseMediaBytes();

  const found = await storage.openDerivative(assetId, width, policy);
  if (found === null) return refuseMediaBytes();

  if (found === 'not-derived') {
    const path = new URL(request.url).pathname;
    const source = path.slice(0, path.lastIndexOf('/'));
    if (!SOURCE_PATH.test(source)) return refuseMediaBytes();
    requestDerivation(assetId, policy);
    return new Response(null, {
      status: 307,
      headers: {
        Location: source,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  const etag = `"${found.checksum}"`;
  const headers = {
    'Content-Type': found.mediaType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cache-Control': DERIVATIVE_CACHE_CONTROL,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    ETag: etag,
  };

  // Both owners allowed the source and the derivative is clean; only now may an
  // unchanged copy be confirmed. The lazy stream is dropped unopened.
  const ifNoneMatch = request.headers.get('if-none-match');
  if (
    ifNoneMatch !== null &&
    ifNoneMatch
      .split(',')
      .map((candidate) => candidate.trim())
      .includes(etag)
  )
    return new Response(null, { status: 304, headers });

  return new Response(toWebStream(found.body), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(found.byteSize) },
  });
}
