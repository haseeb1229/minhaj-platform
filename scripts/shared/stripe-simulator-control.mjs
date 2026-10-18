/**
 * A loopback-only control surface for the browser run's Stripe simulator
 * (Phase 27).
 *
 * WHY A SURFACE AT ALL. The simulator must exist before the web server starts
 * — the server is configured with its origin — so it lives in the browser
 * server's own process (`scripts/browser-server.mjs`), not in a Playwright
 * worker. A spec that proves a pending donation stays pending until a VERIFIED
 * webhook arrives has to hold and release the simulator's webhooks from the
 * worker, and this is the one narrow way it reaches them: the way
 * `tests/browser/realtime-control.ts` reaches the realtime process.
 *
 * NARROW BY CONSTRUCTION. It listens on 127.0.0.1 only, answers only `POST
 * /control` carrying this run's random bearer token, and performs only the
 * operations named in `OPERATIONS` — webhook hold/drop/release, completing or
 * failing a checkout the way the hosted page or an asynchronous payment would,
 * reading the simulator's own records, and one fault: a checkout address on a
 * host that is not the provider's, which the Donations service must refuse.
 * The simulator's secrets never pass through it.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * The operations a spec may perform, each a plain function of JSON arguments.
 * Everything else the simulator's `control` offers stays out of reach.
 */
function operations(control) {
  return Object.freeze({
    setWebhookMode: (mode) => control.setWebhookMode(mode),
    held: () => control.held(),
    releaseHeld: () => control.releaseHeld(),
    flush: () => control.flush(),
    deliveries: () => control.deliveries(),
    events: () => control.events(),
    requests: () => control.requests(),
    session: (id) => control.session(id) ?? null,
    complete: (id, completion) => control.complete(id, completion),
    settleAsync: (id, result) => control.settleAsync(id, result),
    clearFaults: () => control.clearFaults(),
    /**
     * The next checkout the provider creates answers with its address moved to
     * `url` — a host that is not the provider's. Stripe saves the true
     * response under the idempotency key, so a retry of the same create is
     * answered with the real address.
     */
    tamperCheckoutUrl: (url) => {
      if (typeof url !== 'string' || url.length > 200)
        throw new Error('A tampered checkout address must be a short string.');
      control.inject('POST /v1/checkout/sessions', {
        kind: 'tamper',
        mutate: (body) => ({ ...body, url }),
      });
    },
  });
}

function reply(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function authorised(header, token) {
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  const received = Buffer.from(typeof header === 'string' ? header : '', 'utf8');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('Control request too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Starts the control surface for one simulator on 127.0.0.1 and a random
 * port. Resolves `{ origin, token, close }`.
 */
export async function startSimulatorControl(control) {
  const token = randomBytes(24).toString('hex');
  const allowed = operations(control);

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/control') {
        reply(response, 404, { error: 'not-found' });
        return;
      }
      if (!authorised(request.headers['authorization'], token)) {
        reply(response, 401, { error: 'unauthorised' });
        return;
      }
      let command;
      try {
        command = await readJson(request);
      } catch {
        reply(response, 400, { error: 'malformed' });
        return;
      }
      const { op, args = [] } = command ?? {};
      if (typeof op !== 'string' || !Object.hasOwn(allowed, op) || !Array.isArray(args)) {
        reply(response, 400, { error: 'unknown-operation' });
        return;
      }
      try {
        const result = await allowed[op](...args);
        reply(response, 200, { result: result ?? null });
      } catch (error) {
        reply(response, 409, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address();

  async function close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { origin: `http://127.0.0.1:${String(port)}`, token, close };
}
