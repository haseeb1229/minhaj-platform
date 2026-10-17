import 'server-only';

import type { MessagingActor } from '@minhaj/contracts/messaging';

import { requireOwnSession } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { answer } from '@/app/api/admin/media/upload-transport';

/**
 * The transport every `/api/messaging/*` handler shares (Phase 24): how a
 * refusal is answered and who the request acts as.
 *
 * WHY THESE ARE ROUTE HANDLERS AT ALL. A conversation's pages and its
 * send/read/block/report acts are Server Actions. Three things are not: an
 * attachment upload (the Server Action body cap is global and is not raised —
 * SECURITY_BASELINE.md §10.1), discarding an unsent upload from the same
 * uploader script, and the "check for new messages" catch-up read. None of them
 * authenticates anybody.
 *
 * THE BYTES AND THE DISPLAY TEXT reuse the Media upload transport's own
 * helpers — `chunks` (the body straight from the socket, never gathered) and
 * `decodedHeader` — and the private-read admission is the personal transport's
 * `isPrivateRead`, so neither rule has a second, drifting copy. Only the
 * vocabulary is Messaging's: its refusals map to statuses here.
 *
 * ANSWERS ARE JSON WITH A FIXED VOCABULARY, private, `no-store` and unindexed.
 * A refusal names a category the client already has words for — never a stack,
 * a storage key, a scanner verdict, a body or a file name — and an outage is
 * logged by operation name only.
 */

/** The custom header Messaging's browser requests carry. No HTML form can set it. */
export const MESSAGING_INTENT = {
  header: 'x-minhaj-intent',
  value: 'messaging-attachment',
} as const;

/** Each refusal's HTTP status; the body always carries the category. */
const STATUS: Readonly<Record<string, number>> = {
  invalid: 400,
  denied: 403,
  ended: 403,
  closed: 403,
  blocked: 403,
  terminal: 403,
  unclaimed: 403,
  'not-found': 404,
  conflict: 409,
  'operation-conflict': 409,
  'too-many': 409,
  'too-large': 413,
  unsupported: 415,
  'not-cleared': 422,
  'rate-limited': 429,
  unavailable: 503,
};

/** A refusal — a category, never the request's own input. Unknown is an outage. */
export function failed(failure: string): Response {
  const status = STATUS[failure];
  return status === undefined
    ? answer(503, { status: 'error', failure: 'unavailable' })
    : answer(status, { status: 'error', failure });
}

/**
 * The signed-in account this request acts as — the resolved session's account
 * and nothing else; no header, query value or body names an account. A
 * suspended, closed or revoked session is `null` exactly like none at all. An
 * outage is answered `unavailable` and logged by operation name only.
 */
export async function messagingActor(
  operation: string,
): Promise<{ readonly actor: MessagingActor | null } | { readonly refused: Response }> {
  try {
    // The locale only shapes a sign-in redirect a PAGE would follow; this is
    // not a page, and a missing session is a refusal, never a redirect.
    const active = await requireOwnSession('en');
    return { actor: active === null ? null : { accountId: active.session.account.id } };
  } catch {
    appLogger().error({ operation }, 'Messaging session resolution failed.');
    return { refused: failed('unavailable') };
  }
}
