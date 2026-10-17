#!/usr/bin/env node
/**
 * The Container image job's smoke test of the PACKAGED realtime image behind
 * the pinned NGINX image (Phase 25).
 *
 * Run inside the CI Docker network, from a container of the realtime image
 * itself (Node only, no dependency):
 *
 *   node realtime-seam-smoke.mjs <realtime-host:port> <proxy-host:port> <origin>
 *
 * WHAT IT SHOWS, and why each is enough here. This job has no database, so no
 * real session exists and a WebSocket cannot complete its handshake — that,
 * the full 101 through NGINX with a real cookie, is proved by the realtime
 * proofs in the `Database foundation` job. What the IMAGE must show is that it
 * starts and answers its probes, and that the proxy really routes:
 *
 *   1. the realtime container's `/healthz` and `/readyz` answer 200;
 *   2. through the proxy, plain HTTP reaches the WEB upstream;
 *   3. through the proxy, a WebSocket upgrade to `/socket.io/` reaches the
 *      REALTIME process and is refused by IT — the same status and body the
 *      container gives directly — so the Upgrade request crossed the proxy and
 *      the transport's own handshake gate answered;
 *   4. an unknown Host is refused by NGINX itself (421).
 *
 * Exits non-zero, naming the failed check, on anything else.
 */

import { request } from 'node:http';

const [realtimeAddress, proxyAddress, origin] = process.argv.slice(2);
if (realtimeAddress === undefined || proxyAddress === undefined || origin === undefined) {
  console.error(
    'Usage: node realtime-seam-smoke.mjs <realtime-host:port> <proxy-host:port> <origin>',
  );
  process.exit(2);
}

function exchange(address, path, headers) {
  const [host, port] = address.split(':');
  return new Promise((resolve, reject) => {
    const outgoing = request({
      host,
      port,
      path,
      method: 'GET',
      headers,
      timeout: 10_000,
    });
    const collect = (response, socket) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        socket?.destroy();
        resolve({ status: response.statusCode ?? 0, body, headers: response.headers });
      });
    };
    outgoing.on('response', (response) => collect(response));
    outgoing.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve({
        status: response.statusCode ?? 101,
        body: '',
        headers: response.headers,
      });
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('timed out')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

const failures = [];
function check(name, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) failures.push(name);
}

const publicHost = new URL(origin).host;
const upgrade = {
  connection: 'Upgrade',
  upgrade: 'websocket',
  'sec-websocket-version': '13',
  'sec-websocket-key': 'c21va2UtdGVzdC1rZXktMDAwMQ==',
  origin,
};
const socketPath = '/socket.io/?EIO=4&transport=websocket';

const health = await exchange(realtimeAddress, '/healthz', {});
check('realtime /healthz answers 200 ok', health.status === 200 && health.body === 'ok');
const ready = await exchange(realtimeAddress, '/readyz', {});
check('realtime /readyz answers 200', ready.status === 200);

const web = await exchange(proxyAddress, '/en', { host: publicHost });
check(
  'plain HTTP through the proxy reaches the web upstream',
  web.body === 'web-upstream',
);

const direct = await exchange(realtimeAddress, socketPath, {
  ...upgrade,
  host: publicHost,
});
const proxied = await exchange(proxyAddress, socketPath, {
  ...upgrade,
  host: publicHost,
});
check(
  'a cookieless upgrade is refused by the transport itself',
  direct.status >= 400 && direct.status < 500,
);
check(
  'the same upgrade through the proxy reaches the transport and gets its answer',
  proxied.status === direct.status && proxied.body === direct.body,
);
check('the proxy did not answer the upgrade itself', !proxied.body.includes('nginx'));

const misdirected = await exchange(proxyAddress, '/en', { host: 'attacker.invalid' });
check('an unknown Host is refused by the proxy', misdirected.status === 421);

if (failures.length > 0) {
  console.error(`\nThe realtime seam smoke failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nThe packaged realtime image and the NGINX seam route as configured.');
