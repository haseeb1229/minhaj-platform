import 'server-only';

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The realtime process's plain-HTTP surface: two probes and nothing else.
 *
 *   GET /healthz → 200 `ok` while the process is alive.
 *   GET /readyz  → 200 while accepting sockets; 503 while starting or closing,
 *                  so the proxy stops routing new upgrades during the drain.
 *
 * Every other path is 404 — Socket.IO's own path never reaches this handler,
 * because Engine.IO intercepts it first. No CORS header is ever written: the
 * transport is same-origin behind the proxy. While closing, every response
 * asks for the connection to be closed, so a keep-alive probe cannot hold the
 * port open past shutdown.
 */

export interface ProbeState {
  ready(): boolean;
  closing(): boolean;
}

function respond(
  response: ServerResponse,
  status: number,
  body: string,
  close: boolean,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  if (close) response.setHeader('connection', 'close');
  response.end(body);
}

export function probeHandler(state: ProbeState) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const close = state.closing();
    const method = request.method ?? 'GET';
    let path: string | null;
    try {
      path = new URL(request.url ?? '/', 'http://realtime.invalid').pathname;
    } catch {
      path = null;
    }
    const probe = method === 'GET' || method === 'HEAD';

    if (probe && path === '/healthz') return respond(response, 200, 'ok', close);
    if (probe && path === '/readyz') {
      return state.ready()
        ? respond(response, 200, 'ready', close)
        : respond(response, 503, 'not ready', close);
    }
    respond(response, 404, 'not found', close);
  };
}
