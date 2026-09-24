import 'server-only';

import type {
  AssetAuthorizationPort,
  StorageServicePort,
} from '@minhaj/contracts/platform';
import { parseByteRange } from '@minhaj/storage';

import { toWebStream } from '../web-stream';

/**
 * Serving an AudioTrack's bytes, for both routes beside this file (Phase 11).
 *
 * BOTH OWNERS MUST PERMIT, INDEPENDENTLY. `StorageServicePort.open` applies the
 * TECHNICAL decision — clean custody, the bytes actually present — and consults
 * Media's policy for the BUSINESS decision. It returns `null` unless both say
 * yes, and Media cannot override the technical half.
 *
 * A RANGE IS DECIDED EXACTLY AS A WHOLE FILE IS. The range header is read only
 * AFTER `open` has released the asset, so a partial request passes the same
 * two decisions as a full one — there is no second door, and a range of a
 * draft's file is the same 404 as the whole of it (§17 of the phase contract).
 * One well-formed `bytes=` range is answered `206`; one past the end is `416`;
 * anything malformed, multipart or conditional (`If-Range`) is ignored and the
 * whole file is sent, which RFC 9110 permits and which is always correct.
 *
 * NOTHING HERE TOUCHES A FILESYSTEM. No path, no root, no Asset table and no
 * scanner: the service hands back a lazy stream — whole or ranged — or nothing,
 * and whichever is sent is streamed from disk, never buffered.
 *
 * ONE RESPONSE FOR EVERY REFUSAL, identical for every cause, so the route can be
 * used neither to enumerate assets nor to watch one move through custody.
 */

/** The refusal. Identical for every cause, deliberately. */
export function refuseAudio(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function serveAudio(
  storage: StorageServicePort,
  assetId: string,
  policy: AssetAuthorizationPort,
  request: { readonly range: string | null; readonly ifRange: string | null },
): Promise<Response> {
  const asset = await storage.open(assetId, policy);
  if (asset === null) return refuseAudio();

  const headers = {
    /** The VERIFIED type, from the bytes. Never a declared or client value. */
    'Content-Type': asset.mediaType,
    'X-Content-Type-Options': 'nosniff',
    /**
     * `inline` so a player can play it; there is no filename, and no download
     * is offered or implied — playback is not a right to keep a copy.
     */
    'Content-Disposition': 'inline',
    'Accept-Ranges': 'bytes',
    /**
     * NEVER SHARED-CACHED. This was authorised for this request; a track
     * archived a minute from now must not keep playing from somebody's cache.
     */
    'Cache-Control': 'private, no-store',
    /** Another origin may not embed these bytes in its own page. */
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
  };

  // No validator is ever emitted, so no `If-Range` can match one: whole file.
  const range =
    request.ifRange === null
      ? parseByteRange(request.range, asset.byteSize)
      : ({ kind: 'full' } as const);

  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${String(asset.byteSize)}` },
    });
  }

  if (range.kind === 'partial') {
    return new Response(toWebStream(asset.range(range.start, range.end)), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${String(range.start)}-${String(range.end)}/${String(asset.byteSize)}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  }

  return new Response(toWebStream(asset.body), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(asset.byteSize) },
  });
}
