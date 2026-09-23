import 'server-only';

import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

import { storageRuntime } from '@/composition/storage';

/**
 * Serving bytes for a Library Edition, once, for both routes beside this file.
 *
 * WHY LIBRARY HAS ITS OWN SERVING ROUTES AT ALL. `/assets/{id}` is Phase 7's
 * MECHANISM and it ships a policy that never allows: "Phase 7 delivers NO allow
 * decision at all. A consuming phase supplies one; until then the correct behaviour
 * is that nothing is reachable." That route also imports no Identity, by contract
 * and by test. Phase 8 is the first consuming phase, so it supplies its policy on
 * routes it owns rather than by weakening the mechanism's own default (§24, §59).
 *
 * BOTH OWNERS MUST PERMIT, INDEPENDENTLY (§27, §45). This function asks
 * `StorageServicePort.open`, which applies the TECHNICAL decision — clean custody,
 * a checksum matching the stored bytes, bytes actually present on disk — and
 * consults the injected policy for the BUSINESS decision. It returns `null` unless
 * both say yes, and Library cannot override the technical half: a quarantined or
 * infected asset is refused however emphatically the Library policy allows it.
 *
 * NOTHING HERE TOUCHES A FILESYSTEM. No path is constructed, no storage root is
 * named, no Asset table is queried and ClamAV is never called from Library. The
 * service hands back a stream or nothing (§24).
 *
 * ONE RESPONSE FOR EVERY REFUSAL. Denied, missing, quarantined, infected, failed,
 * corrupt, unrelated and not-yet-published all produce the SAME 404 with the same
 * body. A distinguishable answer would let anyone enumerate which assets exist and
 * watch one move through its custody lifecycle — the disclosure the authorisation
 * decision was there to prevent — and it would also leak the scanner result and the
 * internal reason that §38 prohibits surfacing.
 */

/** The refusal. Identical for every cause, deliberately. */
export function refuseAsset(): Response {
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

/**
 * Which media types may be rendered IN the browser rather than saved.
 *
 * "Read online" for a file-backed Edition means opening it, so a download-only
 * disposition would make that experience a save dialog. But `inline` is the
 * dangerous disposition: a document the browser renders in this origin is a
 * document that can carry script. So the allowance is an ALLOWLIST of exactly one
 * type, matched against the VERIFIED type — the value content sniffing produced
 * from the bytes themselves, never a declared or caller-supplied one — and
 * everything else is an attachment.
 *
 * `nosniff` travels with every response regardless, so a browser cannot decide
 * these bytes are something more interesting than what the header says.
 */
const INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set(['application/pdf']);

export async function serveLibraryAsset(
  assetId: string,
  policy: AssetAuthorizationPort,
  intent: 'inline' | 'attachment',
): Promise<Response> {
  const storage = await storageRuntime();
  const asset = await storage.open(assetId, policy);

  if (asset === null) return refuseAsset();

  const disposition =
    intent === 'inline' && INLINE_MEDIA_TYPES.has(asset.mediaType)
      ? 'inline'
      : 'attachment';

  return new Response(toWebStream(asset.body), {
    status: 200,
    headers: {
      /** The VERIFIED type, from the bytes. Never a declared or client value. */
      'Content-Type': asset.mediaType,
      'Content-Length': String(asset.byteSize),
      'X-Content-Type-Options': 'nosniff',

      /**
       * The filename is NOT echoed into the header. A display name is
       * caller-influenced text, and putting it here invites quoting and encoding
       * bugs for the sake of a nicer saved name.
       */
      'Content-Disposition': disposition,

      /**
       * NEVER SHARED-CACHED. This response was authorised for a PARTICULAR
       * request — a public Edition today, a withdrawn one tomorrow, and for the
       * preview route a particular administrator — and a shared cache would hand
       * it to the next caller. `no-store` rather than a short `max-age` because
       * rights and publication state are exactly the kind of decision that must
       * not survive its own revocation (§36).
       */
      'Cache-Control': 'private, no-store',

      /** Bytes behind an authorisation decision are not indexable. */
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * Bridges the service's async iterable onto the Web `ReadableStream` a `Response`
 * wants.
 *
 * STREAMED, NEVER BUFFERED. A scanned edition PDF can be tens of megabytes, and
 * reading one into memory to hand it back would put the whole file in the server's
 * heap per concurrent reader (§49: "Never buffer huge PDF into memory").
 *
 * A MID-FLIGHT FAILURE ERRORS THE STREAM rather than closing it. Closing would
 * deliver a shorter file that looks complete, which is a corrupt download the
 * reader has no way to detect.
 */
function toWebStream(body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
