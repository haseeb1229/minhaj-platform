import 'server-only';

import type { IncomingMessage } from 'node:http';

import type { RealtimeSessionPort } from './types.ts';

/**
 * Who a connection is — decided by Identity, from the cookie, every time.
 *
 * THE COOKIE IS THE ONLY CREDENTIAL. A connection authenticates with the
 * session cookie its upgrade request carried, exactly as a web request does.
 * Nothing in a Socket.IO `auth` payload, a query parameter, or any other
 * header is read: a token offered there is never seen by this module, so it
 * can never authenticate.
 *
 * NARROW HEADERS. Identity is handed a WHATWG `Headers` carrying `cookie` and
 * `host` and nothing else — what a session lookup needs — so no header the
 * client chose (a forwarded address, an authorisation scheme, an
 * `x-anything`) can steer the decision.
 *
 * NEVER STORED IN THE OPEN. The cookie lives only inside the closure
 * `sessionCheck` returns: it is not a property of any object the transport
 * logs, emits or inspects, and it never leaves this module except as the
 * `Headers` handed to Identity.
 */

/** The account a request's cookie resolves to NOW, or `null` when it resolves to none. */
export type SessionCheck = () => Promise<string | null>;

/**
 * The check for one upgrade request, or `null` when the request carries no
 * cookie and host at all (refused without asking Identity).
 */
export function sessionCheckFor(
  port: RealtimeSessionPort,
  request: IncomingMessage,
): SessionCheck | null {
  const cookie = request.headers.cookie;
  const host = request.headers.host;
  if (typeof cookie !== 'string' || cookie.length === 0) return null;
  if (typeof host !== 'string' || host.length === 0) return null;

  return async () => {
    // Built afresh on every call: Identity may not keep, or mutate, a
    // reference the next event's decision would then share.
    const headers = new Headers();
    headers.set('cookie', cookie);
    headers.set('host', host);
    const outcome = await port.resolve(headers);
    return outcome.state === 'active' ? outcome.session.account.id : null;
  };
}
