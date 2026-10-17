import 'server-only';

import type { MessagingActor } from '@minhaj/contracts/messaging';
import type { AssetStream } from '@minhaj/contracts/platform';

import { requireOwnSession } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { toWebStream } from '../web-stream';

/**
 * Serving a message attachment's bytes, once, for the three routes beside
 * this file — the participant's, the support staff member's and the
 * moderator's (Phase 24).
 *
 * PRIVATE BYTES, BEHIND A SESSION. Unlike the public Library and Media byte
 * routes, every attachment belongs to a conversation, so each request resolves
 * the session first and hands the account to Messaging. Messaging re-decides
 * on THIS request — the participant's current relationship, the staff member's
 * live `messaging.support`, the moderator's live `messaging.moderate` and the
 * report's evidence window — and Storage then applies its own technical half:
 * clean custody, a matching checksum, bytes present. Both must say yes.
 *
 * ONE RESPONSE FOR EVERY REFUSAL. No session, not a participant, an ended
 * relationship, a withheld message, another report's evidence, a quarantined
 * file and a malformed identifier all produce the SAME 404 — never a redirect,
 * which would tell a signed-out visitor that the address means something.
 *
 * WHAT IS SENT. The VERIFIED type Storage sniffed from the bytes, never a
 * declared one; images `inline`, a PDF and anything else `attachment` — a
 * document a browser renders in this origin is a document that can carry
 * script, and only the two image types are safe to render here. The file name
 * is NOT echoed into the header: it is display text the sender chose. Every
 * answer is private, `no-store`, `nosniff`, same-origin for embedding and
 * unindexed, so a revoked relationship wins on the very next request.
 */

/** The refusal. Identical for every cause, deliberately. */
function refuse(): Response {
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

/** Only these verified types may render in the browser; everything else is saved. */
const INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/**
 * Serves what `open` resolves for the signed-in actor, or the one 404. `open`
 * is the owner's decision; this function adds none and reads nothing else of
 * the request.
 */
export async function serveMessagingAttachment(
  operation: string,
  open: (actor: MessagingActor) => Promise<AssetStream | null>,
): Promise<Response> {
  let asset: AssetStream | null;
  try {
    const active = await requireOwnSession('en');
    if (active === null) return refuse();
    asset = await open({ accountId: active.session.account.id });
  } catch {
    // An outage is not a denial, but it is answered the same way: a byte
    // route has no screen to explain it on, and nothing about the asset may
    // depend on why it was not sent. Logged by operation name only.
    appLogger().error({ operation }, 'Messaging attachment read failed.');
    return refuse();
  }
  if (asset === null) return refuse();

  return new Response(toWebStream(asset.body), {
    status: 200,
    headers: {
      /** The VERIFIED type, from the bytes. Never a declared or client value. */
      'Content-Type': asset.mediaType,
      'Content-Length': String(asset.byteSize),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': INLINE_MEDIA_TYPES.has(asset.mediaType)
        ? 'inline'
        : 'attachment',
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
