import 'server-only';

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { REALTIME_LIMITS, REALTIME_PATH } from '@minhaj/contracts/messaging';
import { Server } from 'socket.io';

import { createConnectionBudget } from './budgets.ts';
import type { Connection } from './connection.ts';
import { attachEvents } from './events.ts';
import { createHandshakeGate } from './handshake.ts';
import { probeHandler } from './http.ts';
import { createHub } from './hub.ts';
import { transportLog } from './logging.ts';
import type { RealtimeServer, RealtimeServerOptions } from './types.ts';

/**
 * The realtime transport process: one HTTP server, one Socket.IO server, and
 * the hub between them (DELIVERY_PLAN.md Phase 25).
 *
 * THE SOCKET.IO SETTINGS ARE SECURITY SETTINGS:
 *
 *   - `transports: ['websocket']` — no HTTP long-polling, so there is no
 *     second request shape to authenticate, no polling session id to hijack,
 *     and no upgrade path; the client is configured the same way.
 *   - `allowRequest` — the handshake gate (`handshake.ts`): exact Origin,
 *     WebSocket only, an active session from the cookie alone.
 *   - no `cors` option — the transport is same-origin behind the proxy and
 *     answers no cross-origin preflight; the Origin check is the policy.
 *   - `serveClient: false` — the browser client is bundled by the web
 *     application, never served from here.
 *   - `maxHttpBufferSize` — the largest frame accepted; a larger one closes
 *     the connection before it is parsed.
 *   - connection-state recovery is left OFF (by not configuring it): a
 *     reconnecting socket is a new connection, re-authenticated, and recovers
 *     what it missed by durable catch-up from SQL — never from replayed
 *     transport memory.
 *   - `connectTimeout` — an admitted upgrade that never completes the
 *     Socket.IO connect is dropped promptly instead of holding a slot.
 *
 * ONE PROCESS, ONE INSTANCE. No adapter, no pub/sub: delivery reaches the
 * sockets of this process. A message sent through the web path is not pushed
 * from here; its recipients see it on their next catch-up.
 */

const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;

type Phase = 'starting' | 'ready' | 'closing' | 'closed';

/** The configured origin must already BE an origin — nothing is normalised into one. */
function exactOrigin(candidate: string): string {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('The realtime allowed origin is not a URL.');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.origin !== candidate
  ) {
    throw new Error('The realtime allowed origin must be an exact scheme://host[:port].');
  }
  return candidate;
}

export async function startRealtimeServer(
  options: RealtimeServerOptions,
): Promise<RealtimeServer> {
  const allowedOrigin = exactOrigin(options.allowedOrigin);
  const graceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  if (!Number.isFinite(graceMs) || graceMs < 0) {
    throw new Error(
      'The realtime shutdown grace must be a non-negative number of milliseconds.',
    );
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error('The realtime port must be an integer from 0 to 65535.');
  }
  const now = options.now ?? Date.now;
  const log = transportLog(options.logger);

  let phase: Phase = 'starting';
  const accepting = (): boolean => phase === 'ready';
  const isClosing = (): boolean => phase === 'closing' || phase === 'closed';

  const httpServer = createServer(probeHandler({ ready: accepting, closing: isClosing }));
  const gate = createHandshakeGate({
    session: options.session,
    allowedOrigin,
    accepting,
    logger: options.logger,
  });

  const io = new Server(httpServer, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    allowUpgrades: false,
    serveClient: false,
    maxHttpBufferSize: REALTIME_LIMITS.maxPayloadBytes,
    perMessageDeflate: false,
    httpCompression: false,
    allowRequest: (request, callback) => {
      gate.allowRequest(request, callback);
    },
    connectTimeout: CONNECT_TIMEOUT_MS,
  });

  const hub = createHub({ io, messaging: options.messaging, now, log });

  io.on('connection', (socket) => {
    const handshake = gate.take(socket.request);
    // Only a request the gate admitted becomes a connection; anything else —
    // impossible by construction, or a race with close — is dropped.
    if (handshake === undefined || !accepting()) {
      socket.disconnect(true);
      return;
    }

    const connection: Connection = {
      id: handshake.correlationId,
      socket,
      actor: { accountId: handshake.accountId },
      budget: createConnectionBudget(now),
      subscriptions: new Set(),
      log: transportLog(options.logger, handshake.correlationId),
      stillSignedIn: async () =>
        (await handshake.stillSignedIn()) === handshake.accountId,
    };
    hub.register(connection);
    attachEvents(hub, connection, isClosing);

    // `error` is the one event name a client can send that Node's EventEmitter
    // treats specially: unheard, it would throw. It is heard, and ignored.
    socket.on('error', () => {
      connection.log('debug', { operation: 'socket-error', outcome: 'ignored' });
    });
    socket.on('disconnect', () => {
      const subscriptions = connection.subscriptions.size;
      hub.drop(connection);
      connection.log('info', {
        operation: 'disconnect',
        outcome: 'closed',
        subscriptions,
      });
    });
    connection.log('info', { operation: 'connect', outcome: 'ok' });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => reject(error);
      httpServer.once('error', failed);
      httpServer.listen(options.port, options.host, () => {
        httpServer.off('error', failed);
        resolve();
      });
    });
  } catch (error) {
    // Nothing was accepted; release what was built and fail the start.
    phase = 'closed';
    await io.close();
    throw error;
  }
  phase = 'ready';
  const port = (httpServer.address() as AddressInfo).port;

  let closed: Promise<void> | null = null;

  async function shutDown(): Promise<void> {
    phase = 'closing';
    log('info', { operation: 'close', outcome: 'draining' });
    // In-flight sends get their grace to commit AND be answered, so their
    // sockets are still open while they finish; new events are refused.
    await hub.settle(graceMs);
    hub.quiesce();
    const finished = io.close();
    httpServer.closeIdleConnections();
    await finished;
    phase = 'closed';
    log('info', { operation: 'close', outcome: 'closed' });
  }

  return {
    port,
    close() {
      closed ??= shutDown();
      return closed;
    },
  };
}
