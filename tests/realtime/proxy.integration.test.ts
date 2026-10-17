import { randomBytes } from 'node:crypto';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { databaseConfigured } from '../identity/harness.ts';
import {
  freePort,
  frontDoorAbsent,
  frontDoorName,
  httpGet,
  removeFrontDoor,
  startFrontDoor,
  upstreamBindAddress,
} from '../../scripts/shared/realtime-harness.mjs';
import {
  body,
  connect,
  connected,
  failureOf,
  realtimeWorld,
  sendOver,
  startRealtimeProcess,
  subscribe,
  type Client,
  type RealtimeProcess,
  type RealtimeWorld,
} from './harness.ts';

/**
 * Phase 25 — the NGINX WebSocket seam, run for real: the pinned image
 * rendering the repository's own template (`docker/nginx/templates/`), in
 * front of the REAL realtime process.
 *
 * WHAT IT PROVES. That `/socket.io/` is upgraded to the realtime process and a
 * real client connects, follows and receives through it, with the
 * transport's exact-Origin check intact behind the proxy; that ordinary HTTP
 * reaches the web upstream; that `Host` is preserved; that every forwarding
 * header a client could forge — `X-Forwarded-For`, `X-Real-IP`,
 * `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`, `Forwarded` —
 * is SET by NGINX or cleared, on both paths; that an unknown Host is refused
 * without reaching any upstream; and that nothing but GET reaches the socket
 * path.
 *
 * HOW HEADERS ARE SEEN. The web upstream here is a recording HTTP server in
 * this process — the proof is about what NGINX hands an upstream, and a
 * recorder shows exactly that. A second proxy routes BOTH paths to the
 * recorder so the socket path's upgrade request can be inspected too. The
 * realtime upstream of the first proxy is the real process.
 *
 * The containers reach host processes through Docker's `host-gateway`, never
 * host networking, and are removed and proved gone.
 */

const live = databaseConfigured ? describe : describe.skip;

interface Recorded {
  readonly kind: 'http' | 'upgrade';
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

/** A recording upstream: answers HTTP with 200 and refuses every upgrade with 400. */
async function recorder(host: string): Promise<{
  readonly port: number;
  readonly requests: Recorded[];
  close(): Promise<void>;
}> {
  const requests: Recorded[] = [];
  const server: Server = createServer((incoming, response) => {
    requests.push({
      kind: 'http',
      method: incoming.method ?? '',
      url: incoming.url ?? '',
      headers: incoming.headers,
    });
    incoming.resume();
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('recorded');
  });
  server.on('upgrade', (incoming, socket) => {
    requests.push({
      kind: 'upgrade',
      method: incoming.method ?? '',
      url: incoming.url ?? '',
      headers: incoming.headers,
    });
    socket.end(
      'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port.');
  return {
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A raw request through the proxy, answering with its status. */
function raw(
  url: string,
  method: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = request({
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      agent: false,
      timeout: 10_000,
    });
    outgoing.on('response', (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    outgoing.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 101);
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('timed out')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** Forged forwarding headers a hostile client sends. */
const FORGED = {
  'x-forwarded-for': '203.0.113.7',
  'x-real-ip': '203.0.113.7',
  'x-forwarded-host': 'attacker.invalid',
  'x-forwarded-proto': 'https',
  'x-forwarded-port': '443',
  forwarded: 'for=203.0.113.7;host=attacker.invalid;proto=https',
};

/** What NGINX must have handed the upstream, whatever the client sent. */
function proxySet(headers: IncomingHttpHeaders, publicHost: string): void {
  expect(headers['host']).toBe(publicHost);
  const forwardedFor = headers['x-forwarded-for'];
  expect(typeof forwardedFor).toBe('string');
  expect(forwardedFor).not.toContain('203.0.113.7');
  // ONE address — NGINX's view of its peer — never a list a client began.
  expect(forwardedFor).not.toContain(',');
  expect(headers['x-real-ip']).toBe(forwardedFor);
  expect(headers['x-forwarded-proto']).toBe('http');
  expect(headers['x-forwarded-host']).toBeUndefined();
  expect(headers['x-forwarded-port']).toBeUndefined();
  expect(headers['forwarded']).toBeUndefined();
}

live('Phase 25 — the NGINX WebSocket seam in front of the real realtime process', () => {
  let world: RealtimeWorld;
  let realtime: RealtimeProcess;
  let web: Awaited<ReturnType<typeof recorder>>;
  let origin: string;
  let publicHost: string;
  let inspectOrigin: string;
  let inspectHost: string;
  const containers: string[] = [];
  const clients: Client[] = [];

  beforeAll(async () => {
    world = await realtimeWorld();
    await world.activate();

    const upstreamHost = upstreamBindAddress();
    const proxyPort = await freePort('127.0.0.1');
    const inspectPort = await freePort('127.0.0.1');
    publicHost = `127.0.0.1:${String(proxyPort)}`;
    origin = `http://${publicHost}`;
    inspectHost = `127.0.0.1:${String(inspectPort)}`;
    inspectOrigin = `http://${inspectHost}`;

    web = await recorder(upstreamHost);
    // The realtime process admits exactly the PROXY's origin, as deployed.
    realtime = await startRealtimeProcess({
      databaseUrl: world.databaseUrl,
      host: upstreamHost,
      origin,
    });

    const front = frontDoorName('realtime-proof', randomBytes(6).toString('hex'));
    containers.push(front);
    await startFrontDoor({
      name: front,
      publicPort: proxyPort,
      webPort: web.port,
      realtimePort: realtime.port,
    });

    const inspect = frontDoorName('realtime-proof', randomBytes(6).toString('hex'));
    containers.push(inspect);
    await startFrontDoor({
      name: inspect,
      publicPort: inspectPort,
      webPort: web.port,
      realtimePort: web.port,
    });
  }, 300_000);

  afterAll(async () => {
    for (const client of clients) client.close();
    for (const name of containers) await removeFrontDoor(name);
    for (const name of containers) expect(frontDoorAbsent(name)).toBe(true);
    await realtime?.stop();
    await web?.close();
    await world?.close();
  }, 120_000);

  it('sends ordinary HTTP to the web upstream with Host kept and every forwarding header set by NGINX', async () => {
    const before = web.requests.length;
    const response = await httpGet(`${origin}/en/messages?page=2`, FORGED);
    expect(response).toMatchObject({ status: 200, body: 'recorded' });
    const seen = web.requests.slice(before);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: 'http',
      method: 'GET',
      url: '/en/messages?page=2',
    });
    proxySet(seen[0]!.headers, publicHost);
  });

  it('refuses an unknown Host without reaching any upstream', async () => {
    const before = web.requests.length;
    const response = await httpGet(`${origin}/en`, { host: 'attacker.invalid' });
    expect(response.status).toBe(421);
    expect(web.requests.length).toBe(before);
  });

  it('upgrades `/socket.io/`: a real client connects, follows and receives through NGINX', async () => {
    const pair = await world.pair('proxied');
    const learner = await connected(origin, { cookie: pair.learner.cookie, origin });
    const teacher = await connected(origin, { cookie: pair.teacher.cookie, origin });
    clients.push(learner, teacher);
    expect(failureOf(await subscribe(learner, pair.conversationId))).toBe('accepted');
    expect(failureOf(await subscribe(teacher, pair.conversationId))).toBe('accepted');

    const sent = await sendOver(teacher, pair.conversationId, body('proxied'));
    expect(sent.ok).toBe(true);
    const frame = await learner.next(
      'message:created',
      (payload: { conversationId: string }) =>
        payload.conversationId === pair.conversationId,
    );
    expect(frame).toMatchObject({
      conversationId: pair.conversationId,
      message: { sequence: 1, body: body('proxied') },
    });
    // None of it touched the web upstream.
    expect(web.requests.some((seen) => seen.url.startsWith('/socket.io/'))).toBe(false);
  });

  it('keeps the transport’s exact-Origin and cookie checks intact behind the proxy', async () => {
    const pair = await world.pair('proxied-refused');
    for (const options of [
      { cookie: pair.learner.cookie, origin: 'https://attacker.invalid' },
      { cookie: pair.learner.cookie, origin: 'http://localhost:3000' },
      { cookie: pair.learner.cookie, origin: null },
      { origin },
    ])
      expect(
        (await connect(origin, options)).connected,
        JSON.stringify(options.origin),
      ).toBe(false);
  });

  it('sets the socket path’s forwarding headers too, and passes the upgrade on', async () => {
    const before = web.requests.length;
    const status = await raw(
      `${inspectOrigin}/socket.io/?EIO=4&transport=websocket`,
      'GET',
      {
        ...FORGED,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        origin: inspectOrigin,
      },
    );
    expect(status).toBe(400);
    const seen = web.requests.slice(before);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: 'upgrade',
      method: 'GET',
      url: '/socket.io/?EIO=4&transport=websocket',
    });
    const headers = seen[0]!.headers;
    expect(headers['upgrade']).toBe('websocket');
    expect(String(headers['connection']).toLowerCase()).toBe('upgrade');
    // The browser's Origin reaches the transport untouched: it is what the
    // handshake checks.
    expect(headers['origin']).toBe(inspectOrigin);
    proxySet(headers, inspectHost);
  });

  it('lets nothing but GET reach the socket path', async () => {
    const before = web.requests.length;
    for (const method of ['POST', 'PUT', 'DELETE'])
      expect(
        await raw(`${inspectOrigin}/socket.io/?EIO=4&transport=polling`, method, {}),
      ).toBe(403);
    expect(web.requests.length).toBe(before);
  });
});
