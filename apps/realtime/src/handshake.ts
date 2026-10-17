import 'server-only';

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { Logger } from '@minhaj/server-core/logger';

import { elapsedSince, transportLog } from './logging.ts';
import { sessionCheckFor, type SessionCheck } from './session.ts';
import type { RealtimeSessionPort } from './types.ts';

/**
 * The handshake gate — Engine.IO's `allowRequest`, run on the upgrade request
 * BEFORE a WebSocket exists (SECURITY_BASELINE.md §12.4: no anonymous
 * connections).
 *
 * In order, each refusal final:
 *
 *   1. ACCEPTING. A closing server takes no one new.
 *   2. ORIGIN. The `Origin` header must equal the one configured origin,
 *      exactly. A missing Origin is refused, not assumed: a browser always
 *      sends one on a WebSocket upgrade, so its absence means the caller is
 *      not the platform's page. There is no CORS configuration at all — the
 *      transport is same-origin behind the proxy, and this check is the whole
 *      of its cross-origin policy. A hostile page cannot ride a victim's
 *      cookie in, because its Origin is its own.
 *   3. TRANSPORT. WebSocket only. Engine.IO already refuses an unlisted
 *      transport before this runs; it is checked again here so the rule does
 *      not hang on one option.
 *   4. SESSION. The request's Cookie header alone, resolved by Identity, must
 *      be `active`. No cookie is refused without asking.
 *
 * What the gate learned is held against the request object, which Engine.IO
 * hands on as the socket's `request`, and is TAKEN exactly once when the
 * Socket.IO connection is made. A request that never connects leaves nothing
 * behind: the map is weak.
 */

export interface AdmittedHandshake {
  readonly correlationId: string;
  readonly accountId: string;
  readonly stillSignedIn: SessionCheck;
}

export interface HandshakeGate {
  allowRequest(
    request: IncomingMessage,
    callback: (error: string | null | undefined, success: boolean) => void,
  ): void;
  /** The admission for this request, once; `undefined` when it was never admitted. */
  take(request: IncomingMessage): AdmittedHandshake | undefined;
}

export interface HandshakeOptions {
  readonly session: RealtimeSessionPort;
  readonly allowedOrigin: string;
  readonly accepting: () => boolean;
  readonly logger: Logger;
}

/** A WebSocket upgrade asking for the WebSocket transport — nothing else. */
function isWebSocketUpgrade(request: IncomingMessage): boolean {
  const upgrade = request.headers.upgrade;
  if (typeof upgrade !== 'string' || upgrade.toLowerCase() !== 'websocket') return false;
  try {
    const query = new URL(request.url ?? '/', 'http://realtime.invalid').searchParams;
    return query.get('transport') === 'websocket';
  } catch {
    return false;
  }
}

export function createHandshakeGate(options: HandshakeOptions): HandshakeGate {
  const admitted = new WeakMap<IncomingMessage, AdmittedHandshake>();

  async function decide(
    request: IncomingMessage,
    correlationId: string,
  ): Promise<string> {
    if (!options.accepting()) return 'closing';
    if (request.headers.origin !== options.allowedOrigin) return 'origin';
    if (!isWebSocketUpgrade(request)) return 'transport';

    const check = sessionCheckFor(options.session, request);
    if (check === null) return 'no-session';
    let accountId: string | null;
    try {
      accountId = await check();
    } catch {
      return 'unavailable';
    }
    if (accountId === null) return 'denied';
    if (!options.accepting()) return 'closing';

    admitted.set(request, { correlationId, accountId, stillSignedIn: check });
    return 'admitted';
  }

  return {
    allowRequest(request, callback) {
      const correlationId = randomUUID();
      const startedAt = performance.now();
      void decide(request, correlationId).then(
        (outcome) => {
          transportLog(options.logger, correlationId)('info', {
            operation: 'handshake',
            outcome,
            durationMs: elapsedSince(startedAt),
          });
          // The refusal text is fixed: it never says which check failed.
          callback(outcome === 'admitted' ? null : 'forbidden', outcome === 'admitted');
        },
        () => {
          callback('forbidden', false);
        },
      );
    },

    take(request) {
      const handshake = admitted.get(request);
      admitted.delete(request);
      return handshake;
    },
  };
}
