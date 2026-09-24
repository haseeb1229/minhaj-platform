import 'server-only';

import type {
  AssetAuthorizationPort,
  StorageServicePort,
} from '@minhaj/contracts/platform';
import { parseByteRange } from '@minhaj/storage';

import { toWebStream } from '../web-stream';

/**
 * Serving Media's bytes — an AudioTrack's recording (Phase 11) and a Photo's
 * image (Phase 12) — for every route beneath this directory.
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
export function refuseMediaBytes(): Response {
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
  if (asset === null) return refuseMediaBytes();

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

/**
 * Serving a Photo's image (Phase 12) — the same two independent allows, and a
 * cache posture chosen so that WITHDRAWAL IS IMMEDIATE.
 *
 * `private, no-cache` with a strong validator. A browser may keep the image it
 * was shown, but must ask again before every reuse; no shared cache may store
 * it. The asking is decided in full: `open` — Storage's custody AND Media's
 * policy — runs BEFORE the validator is compared, so a `304 Not Modified` is
 * sent only for an image both owners would serve right now. A Photo archived a
 * moment ago answers its visitor's next revalidation with the same 404 as a
 * guess, and the browser stops showing it. What a gallery page gets for this is
 * one small round trip per image instead of the bytes.
 *
 * The validator is the checksum of the stored bytes — the bytes Storage
 * cleared — so it can never match a different image. Replacing a Photo's image
 * changes its address anyway, because the address names the asset.
 *
 * `preview` serves `private, no-store`: an administrator looking at a draft
 * leaves nothing behind.
 */
export async function servePhoto(
  storage: StorageServicePort,
  assetId: string,
  policy: AssetAuthorizationPort,
  request: { readonly ifNoneMatch: string | null; readonly preview: boolean },
): Promise<Response> {
  const asset = await storage.open(assetId, policy);
  if (asset === null) return refuseMediaBytes();

  const etag = `"${asset.checksum}"`;
  const headers = {
    'Content-Type': asset.mediaType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cache-Control': request.preview ? 'private, no-store' : 'private, no-cache',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    ...(request.preview ? {} : { ETag: etag }),
  };

  // Both owners have allowed; only now may an unchanged copy be confirmed. The
  // lazy stream is dropped unopened.
  if (
    !request.preview &&
    request.ifNoneMatch !== null &&
    request.ifNoneMatch
      .split(',')
      .map((candidate) => candidate.trim())
      .includes(etag)
  ) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(toWebStream(asset.body), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(asset.byteSize) },
  });
}
