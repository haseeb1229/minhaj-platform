import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

import { storageRuntime } from '@/composition/storage';

/**
 * `/assets/{id}` — THE authorisation-checking serving route
 * (DELIVERY_PLAN.md Phase 7, SECURITY_BASELINE.md §10.1 rule 6).
 *
 * DEFAULT DENY. There is no asset this route will serve without an explicit
 * `allow` from an injected decision port, and Phase 7 ships NO port that ever
 * returns `allow`. That is not an oversight: this phase delivers the
 * MECHANISM, and each Identity-aware consuming phase supplies and tests its
 * own policy (§3). Until one does, every request here is a 404.
 *
 * THIS ROUTE IMPORTS NO IDENTITY. No Better Auth, no session, no `User`, no
 * `Role`, no permission service. Storage is required by phases that are not
 * Identity-gated, and a dependency here would spread Phase 2's external email
 * gate into staging for no architectural reason.
 *
 * NOTHING IN THE REQUEST CAN GRANT ACCESS. The handler reads the asset
 * identifier from the path and NOTHING else — no query parameter, no header,
 * no cookie, no filename, no declared MIME type. There is no `?public=true`
 * and no bypass to find, because no code path here consults anything a caller
 * can set.
 *
 * NOT LOCALE-PREFIXED. An asset is bytes; it has no interface locale, and
 * giving it three URLs would give one object three cache entries and three
 * canonical addresses.
 */

export const dynamic = 'force-dynamic';

/**
 * The Phase-7 policy: deny everything.
 *
 * A consuming phase replaces this with its own port. It is written out rather
 * than left implicit so that the default is a thing you can see, and so that
 * the negative tests have something real to call.
 */
const denyAll: AssetAuthorizationPort = {
  decide: () => Promise.resolve('deny'),
};

/**
 * One response for every refusal.
 *
 * Denied, missing, quarantined, infected, failed and corrupt all produce the
 * SAME 404 with the same body. A distinguishable response would let anyone
 * enumerate which identifiers exist and watch an asset move through its
 * lifecycle, which is a disclosure the authorisation decision was supposed to
 * prevent.
 */
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const storage = await storageRuntime();
  const asset = await storage.open(id, denyAll);

  if (asset === null) return notFound();

  return new Response(toWebStream(asset.body), {
    status: 200,
    headers: {
      /**
       * The VERIFIED type, never a declared or client-supplied one. This is
       * the value content sniffing produced from the bytes themselves.
       */
      'Content-Type': asset.mediaType,
      'Content-Length': String(asset.byteSize),

      /** Never let a browser re-interpret these bytes as something else. */
      'X-Content-Type-Options': 'nosniff',

      /**
       * Always an attachment, and the filename is NOT echoed into the header.
       *
       * A display name is caller-influenced text, and putting it in a header
       * invites quoting and encoding bugs for the sake of a nicer download
       * name. A consuming phase that genuinely needs one can add it with its
       * own encoding and its own tests.
       */
      'Content-Disposition': 'attachment',

      /**
       * A default-deny response is never shared-cached. Whatever a future
       * policy allows will be allowed for a PARTICULAR requester, and a shared
       * cache would hand that response to the next one.
       */
      'Cache-Control': 'private, no-store',

      /** Bytes behind an authorisation decision are not indexable. */
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** Bridge the service's async iterable onto the Web `ReadableStream` a Response wants. */
function toWebStream(body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        // The bytes stopped mid-flight. Fail the stream rather than truncating
        // it into what would look like a complete, shorter file.
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
