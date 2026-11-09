import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FetchOutcome } from '@minhaj/contracts/migration';

import {
  FIXTURE_ARCHIVE_HOST,
  FIXTURE_RETRY_AFTER,
  startFixtureServer,
  type FixtureServer,
} from '../../../scripts/migration/fixture-server.ts';
import {
  FETCHER_KEY,
  FETCHER_VERSION,
  MIGRATION_USER_AGENT,
  RESPONSE_HEADER_ALLOWLIST,
  createFixtureFetcher,
  createSafeDownloader,
  createSafeFetcher,
  fixtureAddressPolicy,
  fixtureConnector,
  fixtureResolver,
  nodeConnector,
  type Connector,
  type PinnedConnection,
} from '../../../scripts/migration/safe-fetch.ts';

import { TEST_POLICY, fixtureSource } from './support.ts';

/**
 * The safe fetch boundary (MIGRATION_STRATEGY.md §8.1).
 *
 * NO REAL HOST IS EVER CONTACTED. Policy refusals are proved with an injected
 * resolver and a connector that fails the test if it is ever reached; the
 * transport is proved against the local fixture server on 127.0.0.1.
 */

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.control.reset();
});

/** A connector that must never be reached. */
function forbiddenConnector() {
  return vi.fn<Connector>(() =>
    Promise.reject(new Error('connector must not be called')),
  );
}

/** A connector that carries any pinned connection to the fixture server, recording the pin. */
function recordingConnector() {
  const pins: PinnedConnection[] = [];
  const connector = vi.fn<Connector>((connection) => {
    pins.push(connection);
    return nodeConnector({
      ...connection,
      address: server.endpoint.address,
      port: server.endpoint.port,
    });
  });
  return { connector, pins };
}

function expectRefused(outcome: FetchOutcome, classification: string, detail?: string) {
  expect(outcome.kind).toBe('refused');
  if (outcome.kind !== 'refused') return;
  expect(outcome.classification).toBe(classification);
  if (detail !== undefined) expect(outcome.detail).toBe(detail);
}

describe('addresses are refused before any connection (authorised-mode policy)', () => {
  const host = 'legacy.example.invalid';

  it.each([
    ['IPv4 loopback', '127.0.0.1'],
    ['another loopback', '127.9.8.7'],
    ['private 10/8', '10.1.2.3'],
    ['private 172.16/12', '172.20.0.1'],
    ['private 192.168/16', '192.168.0.10'],
    ['link-local', '169.254.10.20'],
    ['cloud metadata (IPv4)', '169.254.169.254'],
    ['cloud metadata (IPv6)', 'fd00:ec2::254'],
    ['IPv6 loopback', '::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
    ['NAT64 loopback', '64:ff9b::7f00:1'],
    ['NAT64 metadata', '64:ff9b::a9fe:a9fe'],
    ['IPv6 unique-local', 'fc00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['documentation IPv4', '192.0.2.10'],
    ['documentation IPv6', '2001:db8::1'],
    ['unspecified IPv4', '0.0.0.0'],
    ['unspecified IPv6', '::'],
    ['shared address space', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['not an address at all', 'definitely-not-an-address'],
  ])('refuses %s (%s)', async (_label, address) => {
    const connector = forbiddenConnector();
    const resolver = vi.fn(() => Promise.resolve([address]));
    const fetcher = createSafeFetcher({
      hosts: [host],
      policy: TEST_POLICY,
      resolver,
      connector,
    });

    const outcome = await fetcher.fetch(`https://${host}/page.html`);

    expectRefused(outcome, 'address-refused');
    expect(resolver).toHaveBeenCalledWith(host);
    expect(connector).not.toHaveBeenCalled();
  });

  it('refuses a host when ANY of its addresses is internal, even if the first is public', async () => {
    const connector = forbiddenConnector();
    const fetcher = createSafeFetcher({
      hosts: [host],
      policy: TEST_POLICY,
      resolver: () => Promise.resolve(['11.0.0.1', '10.0.0.1']),
      connector,
    });

    expectRefused(
      await fetcher.fetch(`https://${host}/`),
      'address-refused',
      'address-private',
    );
    expect(connector).not.toHaveBeenCalled();
  });

  it('treats a failed or empty resolution as a network failure, never as permission', async () => {
    const connector = forbiddenConnector();
    const failing = createSafeFetcher({
      hosts: [host],
      policy: TEST_POLICY,
      resolver: () => Promise.reject(new Error('NXDOMAIN')),
      connector,
    });
    const empty = createSafeFetcher({
      hosts: [host],
      policy: TEST_POLICY,
      resolver: () => Promise.resolve([]),
      connector,
    });

    expect(await failing.fetch(`https://${host}/`)).toMatchObject({
      kind: 'failure',
      classification: 'network',
    });
    expect(await empty.fetch(`https://${host}/`)).toMatchObject({
      kind: 'failure',
      classification: 'network',
    });
    expect(connector).not.toHaveBeenCalled();
  });
});

describe('URLs are refused before resolution', () => {
  const host = 'legacy.example.invalid';

  it.each([
    ['credentials', `http://fixture:secret@${host}/`, 'url-credentials'],
    ['a username alone', `http://fixture@${host}/`, 'url-credentials'],
    ['a literal IPv4 host', 'http://127.0.0.1/', 'url-host-literal'],
    ['a literal IPv6 host', 'http://[::1]/', 'url-host-literal'],
    ['a non-default port', `http://${host}:8080/`, 'url-port'],
    ['a host outside the scope', 'http://other.example.invalid/', 'url-out-of-scope'],
    ['a subdomain of the scope', `http://evil.${host}/`, 'url-out-of-scope'],
    ['a non-http scheme', `ftp://${host}/file`, 'url-scheme'],
    ['a file URL', 'file:///etc/hostname', 'url-scheme'],
    ['a malformed URL', 'http://exa mple.invalid/', 'url-malformed'],
  ])('refuses %s', async (_label, url, detail) => {
    const resolver = vi.fn(() => Promise.resolve(['11.0.0.1']));
    const connector = forbiddenConnector();
    const fetcher = createSafeFetcher({
      hosts: [host],
      policy: TEST_POLICY,
      resolver,
      connector,
    });

    const outcome = await fetcher.fetch(url);

    expectRefused(outcome, 'scope-refused', detail);
    expect(resolver).not.toHaveBeenCalled();
    expect(connector).not.toHaveBeenCalled();
  });

  it('never records the credentials of a refused URL', async () => {
    const fetcher = createSafeFetcher({
      hosts: [host],
      policy: TEST_POLICY,
      resolver: () => Promise.resolve(['11.0.0.1']),
      connector: forbiddenConnector(),
    });

    const outcome = await fetcher.fetch(`http://fixture:sentinel-secret@${host}/`);

    expect(JSON.stringify(outcome)).not.toContain('sentinel-secret');
  });
});

describe('DNS rebinding: the connection is pinned, and every redirect re-resolves', () => {
  it('connects to the first validated address and refuses a later private answer for the same host', async () => {
    const answers = [['11.0.0.1'], ['127.0.0.1']];
    const resolver = vi.fn(() => Promise.resolve(answers.shift() ?? ['127.0.0.1']));
    const { connector, pins } = recordingConnector();
    const fetcher = createSafeFetcher({
      hosts: ['videos.fixture.invalid'],
      policy: TEST_POLICY,
      resolver,
      connector,
    });

    const outcome = await fetcher.fetch(
      'http://videos.fixture.invalid/redirect/same-host',
    );

    expect(pins.map((pin) => pin.address)).toEqual(['11.0.0.1']);
    expect(resolver).toHaveBeenCalledTimes(2);
    expectRefused(outcome, 'address-refused', 'address-loopback');
    expect(server.control.requestCount('/redirect/same-host')).toBe(1);
    expect(server.control.requestCount('/videos/v002.html')).toBe(0);
  });

  it('the default transport uses the pinned address and never asks real DNS', async () => {
    // `videos.fixture.invalid` cannot resolve anywhere; only the pinned lookup
    // can make this connection succeed.
    const controller = new AbortController();
    const response = await nodeConnector({
      url: new URL('http://videos.fixture.invalid/videos/v001.html'),
      host: 'videos.fixture.invalid',
      address: server.endpoint.address,
      port: server.endpoint.port,
      headers: { host: 'videos.fixture.invalid', 'user-agent': MIGRATION_USER_AGENT },
      signal: controller.signal,
    });
    response.resume();

    expect(response.statusCode).toBe(200);
    expect(response.socket.remoteAddress).toBe(server.endpoint.address);
  });
});

describe('fixture fetching: redirects are re-validated hop by hop', () => {
  const fetcher = () => createFixtureFetcher(fixtureSource(), server.endpoint);

  it('follows an in-scope redirect and reports the final URL', async () => {
    const outcome = await fetcher().fetch(
      'http://videos.fixture.invalid/redirect/in-scope',
    );

    expect(outcome).toMatchObject({
      kind: 'response',
      status: 200,
      requestedUrl: 'http://videos.fixture.invalid/redirect/in-scope',
      finalUrl: 'http://videos.fixture.invalid/videos/v001.html',
    });
  });

  it('follows a chain exactly as long as the policy allows, and no longer', async () => {
    expect(
      await fetcher().fetch('http://videos.fixture.invalid/redirect/chain/3'),
    ).toMatchObject({
      kind: 'response',
      status: 200,
    });

    const short = createFixtureFetcher(
      fixtureSource({ policy: { ...TEST_POLICY, maxRedirects: 2 } }),
      server.endpoint,
    );
    expectRefused(
      await short.fetch('http://videos.fixture.invalid/redirect/chain/3'),
      'redirect-refused',
      'redirect-limit',
    );
  });

  it('caps a redirect loop at the policy bound', async () => {
    const outcome = await fetcher().fetch('http://videos.fixture.invalid/redirect/loop');

    expectRefused(outcome, 'redirect-refused', 'redirect-limit');
    expect(server.control.requestCount('/redirect/loop')).toBe(
      TEST_POLICY.maxRedirects + 1,
    );
  });

  it('refuses a redirect to another fixture host outside the source scope, without requesting it', async () => {
    const outcome = await fetcher().fetch(
      'http://videos.fixture.invalid/redirect/out-of-scope',
    );

    expectRefused(outcome, 'scope-refused', 'redirect-out-of-scope');
    expect(server.control.requestCount('/videos/a001.html', FIXTURE_ARCHIVE_HOST)).toBe(
      0,
    );
  });

  it('follows the same redirect when the scope does include that host', async () => {
    const wide = createFixtureFetcher(
      fixtureSource({ hosts: ['videos.fixture.invalid', FIXTURE_ARCHIVE_HOST] }),
      server.endpoint,
    );

    expect(
      await wide.fetch('http://videos.fixture.invalid/redirect/out-of-scope'),
    ).toMatchObject({
      kind: 'response',
      status: 200,
      finalUrl: `http://${FIXTURE_ARCHIVE_HOST}/videos/a001.html`,
    });
  });

  it.each([
    ['a non-http scheme', '/redirect/non-http', 'redirect-refused', 'redirect-scheme'],
    ['a file URL', '/redirect/file', 'redirect-refused', 'redirect-scheme'],
    [
      'a missing Location',
      '/redirect/missing-location',
      'redirect-refused',
      'redirect-without-location',
    ],
    ['credentials', '/redirect/credentials', 'scope-refused', 'redirect-credentials'],
    ['a non-default port', '/redirect/port', 'scope-refused', 'redirect-port'],
    ['a literal IP', '/redirect/literal-ip', 'scope-refused', 'redirect-host-literal'],
  ])('refuses a redirect to %s', async (_label, path, classification, detail) => {
    expectRefused(
      await fetcher().fetch(`http://videos.fixture.invalid${path}`),
      classification,
      detail,
    );
  });
});

describe('deadline, body cap and response handling', () => {
  const fetcher = () => createFixtureFetcher(fixtureSource(), server.endpoint);

  it('gives up on a slow response at the policy timeout', async () => {
    const started = Date.now();
    const outcome = await fetcher().fetch('http://videos.fixture.invalid/slow');

    expect(outcome).toMatchObject({ kind: 'failure', classification: 'timeout' });
    expect(Date.now() - started).toBeLessThan(TEST_POLICY.timeoutMs + 2000);
  });

  it('refuses a body whose declared length exceeds the cap', async () => {
    expectRefused(
      await fetcher().fetch('http://videos.fixture.invalid/oversized'),
      'too-large',
      'declared-length-exceeds-cap',
    );
  });

  it('aborts an undeclared, unbounded body as soon as it exceeds the cap', async () => {
    // The fixture streams up to 64 MiB; returning at all proves the reader
    // stopped at the 64 KiB cap instead of buffering the stream.
    expectRefused(
      await fetcher().fetch('http://videos.fixture.invalid/endless'),
      'too-large',
      'body-exceeds-cap',
    );
  });

  it('keeps only allowlisted response headers and exposes Retry-After', async () => {
    server.control.setStatus('/videos/v001.html', 429, { retryAfter: '2', times: 1 });

    const limited = await fetcher().fetch(
      'http://videos.fixture.invalid/videos/v001.html',
    );
    const ok = await fetcher().fetch('http://videos.fixture.invalid/videos/v001.html');

    expect(limited).toMatchObject({ kind: 'response', status: 429, retryAfter: '2' });
    expect(ok).toMatchObject({ kind: 'response', status: 200, retryAfter: null });
    for (const outcome of [limited, ok]) {
      if (outcome.kind !== 'response') continue;
      for (const name of Object.keys(outcome.headers))
        expect(RESPONSE_HEADER_ALLOWLIST as readonly string[]).toContain(name);
    }
    expect(server.control.requestCount('/videos/v001.html')).toBe(2);
  });

  it.each(Object.entries(FIXTURE_RETRY_AFTER))(
    'exposes a %s Retry-After verbatim, for the pipeline to judge',
    async (_label, value) => {
      server.control.setStatus('/videos/v003.html', 429, { retryAfter: value, times: 1 });

      expect(
        await fetcher().fetch('http://videos.fixture.invalid/videos/v003.html'),
      ).toMatchObject({
        kind: 'response',
        status: 429,
        retryAfter: value,
        headers: { 'retry-after': value },
      });
    },
  );

  it.each([404, 403, 410, 500, 503])(
    'returns a %i as a response for the pipeline to classify',
    async (status) => {
      server.control.setStatus('/videos/v002.html', status);

      expect(
        await fetcher().fetch('http://videos.fixture.invalid/videos/v002.html'),
      ).toMatchObject({
        kind: 'response',
        status,
      });
    },
  );

  it('sends an honest User-Agent and no cookie or credential header', async () => {
    const outcome = await fetcher().fetch('http://videos.fixture.invalid/headers');
    if (outcome.kind !== 'response') throw new Error('expected a response');

    const seen = JSON.parse(new TextDecoder().decode(outcome.body)) as {
      names: string[];
      userAgent: string;
    };
    expect(seen.userAgent).toBe(MIGRATION_USER_AGENT);
    expect(seen.names).not.toContain('cookie');
    expect(seen.names).not.toContain('authorization');
    expect(seen.names).not.toContain('proxy-authorization');
  });

  it('identifies itself as the safe-fetch boundary', () => {
    const port = fetcher();
    expect([port.fetcherKey, port.fetcherVersion]).toEqual([
      FETCHER_KEY,
      FETCHER_VERSION,
    ]);
  });

  it('refuses to be built with a policy outside the source bounds', () => {
    expect(() =>
      createSafeFetcher({
        hosts: ['videos.fixture.invalid'],
        policy: { ...TEST_POLICY, maxBodyBytes: 1024 * 1024 * 1024 },
        resolver: fixtureResolver({ endpoint: server.endpoint }),
      }),
    ).toThrow();
  });
});

describe('a fixture fetcher cannot be pointed at a real host', () => {
  it('refuses to exist for an authorised source or a non-synthetic scope', () => {
    expect(() =>
      createFixtureFetcher(
        fixtureSource({ authorityKind: 'authorised' }),
        server.endpoint,
      ),
    ).toThrow(/fixture sources only/);
    expect(() =>
      createFixtureFetcher(
        fixtureSource({
          hosts: ['www.example.org'],
          baseUrl: 'https://www.example.org/',
        }),
        server.endpoint,
      ),
    ).toThrow(/fixture.invalid/);
  });

  it('refuses a non-fixture URL even if a source URL is edited to name one', async () => {
    const fetcher = createFixtureFetcher(fixtureSource(), server.endpoint);
    const before = server.control.totalRequests();

    expectRefused(
      await fetcher.fetch('https://www.example.org/videos/1'),
      'scope-refused',
      'url-out-of-scope',
    );
    expect(server.control.totalRequests()).toBe(before);
  });

  it('the fixture resolver refuses any non-fixture name, so even a widened scope reaches nothing', async () => {
    const connector = forbiddenConnector();
    const fetcher = createSafeFetcher({
      hosts: ['www.example.org'],
      policy: TEST_POLICY,
      resolver: fixtureResolver({ endpoint: server.endpoint }),
      addressPolicy: fixtureAddressPolicy(server.endpoint),
      connector,
    });

    expect(await fetcher.fetch('https://www.example.org/')).toMatchObject({
      kind: 'failure',
      classification: 'network',
      detail: 'resolution-failed',
    });
    expect(connector).not.toHaveBeenCalled();
  });

  it('the fixture connector refuses a target that is not a fixture host on the fixture address', async () => {
    const base = forbiddenConnector();
    const connector = fixtureConnector(server.endpoint, base);
    const signal = new AbortController().signal;
    const common = {
      url: new URL('http://www.example.org/'),
      port: 80,
      headers: {},
      signal,
    };

    await expect(
      connector({ ...common, host: 'www.example.org', address: server.endpoint.address }),
    ).rejects.toThrow();
    await expect(
      connector({ ...common, host: 'videos.fixture.invalid', address: '11.0.0.1' }),
    ).rejects.toThrow();
    expect(base).not.toHaveBeenCalled();
  });

  it('a fixture endpoint must be loopback', () => {
    expect(() =>
      fixtureResolver({ endpoint: { address: '11.0.0.1', port: 80 } }),
    ).toThrow(/loopback/);
    expect(() => fixtureAddressPolicy({ address: '10.0.0.1', port: 80 })).toThrow(
      /loopback/,
    );
  });
});

/* ===========================================================================
 * Quran Part 5 — one large file, streamed to disk through the same boundary
 * ========================================================================= */

describe('the safe downloader: the fetcher’s boundary, streamed to a file', () => {
  const HOST = 'downloads.example.org';
  /** A public address the resolver answers with; the connector carries it to loopback. */
  const PUBLIC = '93.184.216.34';
  const BODY = Buffer.from('NON_QURAN_FIXTURE archive bytes '.repeat(4096));
  let downloads: Server;
  let port = 0;
  let work: string;

  beforeAll(async () => {
    work = mkdtempSync(path.join(tmpdir(), 'minhaj-safe-download-'));
    downloads = createServer((request, response) => {
      switch (request.url) {
        case '/ok':
          response.writeHead(200, { 'content-length': String(BODY.length) });
          response.end(BODY);
          return;
        case '/chunked':
          // No declared length: only the streamed count can refuse it.
          response.writeHead(200, { 'transfer-encoding': 'chunked' });
          response.write(BODY);
          response.end(BODY);
          return;
        case '/declared':
          response.writeHead(200, { 'content-length': String(BODY.length * 10) });
          response.end(BODY);
          return;
        case '/redirect-out':
          response.writeHead(302, { location: 'http://elsewhere.example.org/ok' });
          response.end();
          return;
        case '/redirect-in':
          response.writeHead(302, { location: '/ok' });
          response.end();
          return;
        default:
          response.writeHead(404, { 'content-length': '0' });
          response.end();
      }
    });
    await new Promise<void>((resolve) => downloads.listen(0, '127.0.0.1', resolve));
    port = (downloads.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => downloads.close(() => resolve()));
    rmSync(work, { recursive: true, force: true });
  });

  /** Carries a pinned connection to the local download server, recording the pin. */
  function toLocal() {
    const pins: PinnedConnection[] = [];
    const connector = vi.fn<Connector>((connection) => {
      pins.push(connection);
      return nodeConnector({ ...connection, address: '127.0.0.1', port });
    });
    return { connector, pins };
  }

  const downloader = (
    connector: Connector,
    overrides: Partial<Parameters<typeof createSafeDownloader>[0]> = {},
  ) =>
    createSafeDownloader({
      hosts: [HOST],
      resolver: () => Promise.resolve([PUBLIC]),
      connector,
      timeoutMs: 10_000,
      maxRedirects: 1,
      maxBytes: BODY.length,
      ...overrides,
    });

  const target = (name: string) => path.join(work, name);
  const leftovers = () => readdirSync(work).filter((name) => name.endsWith('.part'));

  it.each([
    ['a zero deadline', { timeoutMs: 0 }],
    ['a deadline over two hours', { timeoutMs: 2 * 60 * 60 * 1000 + 1 }],
    ['no size ceiling', { maxBytes: 0 }],
    ['a size over 2 GiB', { maxBytes: 2 * 1024 * 1024 * 1024 + 1 }],
    ['an unbounded redirect chain', { maxRedirects: 6 }],
    ['a fractional bound', { maxBytes: 1.5 }],
  ])('cannot be built with %s', (_label, overrides) => {
    expect(() => downloader(forbiddenConnector(), overrides)).toThrow(/bounds/);
  });

  it('refuses an address outside its scope before any connection', async () => {
    const connector = forbiddenConnector();
    const outcome = await downloader(connector).download(
      'http://other.example.org/ok',
      target('scope.zip'),
    );
    expectRefused(outcome as FetchOutcome, 'scope-refused', 'url-out-of-scope');
    expect(connector).not.toHaveBeenCalled();
    expect(existsSync(target('scope.zip'))).toBe(false);
  });

  it('refuses a host that resolves to a private address', async () => {
    const connector = forbiddenConnector();
    const outcome = await downloader(connector, {
      resolver: () => Promise.resolve(['10.0.0.7']),
    }).download(`http://${HOST}/ok`, target('private.zip'));
    expectRefused(outcome as FetchOutcome, 'address-refused');
    expect(connector).not.toHaveBeenCalled();
  });

  it('re-checks a redirect, refusing one out of scope without requesting it', async () => {
    const { connector, pins } = toLocal();
    const outcome = await downloader(connector).download(
      `http://${HOST}/redirect-out`,
      target('redirect.zip'),
    );
    expectRefused(outcome as FetchOutcome, 'scope-refused', 'redirect-out-of-scope');
    expect(pins.map((pin) => pin.url.pathname)).toEqual(['/redirect-out']);
    // An in-scope redirect is followed, and pinned again.
    const followed = await downloader(toLocal().connector).download(
      `http://${HOST}/redirect-in`,
      target('followed.zip'),
    );
    expect(followed.kind).toBe('downloaded');
  });

  it('answers a status that is not 200 with that status, writing nothing', async () => {
    const outcome = await downloader(toLocal().connector).download(
      `http://${HOST}/missing`,
      target('missing.zip'),
    );
    expect(outcome).toEqual({ kind: 'status', status: 404 });
    expect(existsSync(target('missing.zip'))).toBe(false);
  });

  it('refuses a declared length over the ceiling before reading the body', async () => {
    const outcome = await downloader(toLocal().connector).download(
      `http://${HOST}/declared`,
      target('declared.zip'),
    );
    expectRefused(outcome as FetchOutcome, 'too-large', 'declared-length-exceeds-cap');
    expect(existsSync(target('declared.zip'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('refuses a streamed body over the ceiling, leaving no partial file', async () => {
    const outcome = await downloader(toLocal().connector).download(
      `http://${HOST}/chunked`,
      target('chunked.zip'),
    );
    expectRefused(outcome as FetchOutcome, 'too-large', 'body-exceeds-cap');
    expect(existsSync(target('chunked.zip'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('writes exactly the bytes it was sent, and their SHA-256', async () => {
    const { connector, pins } = toLocal();
    const file = target('ok.zip');
    const outcome = await downloader(connector, {
      userAgent: 'NON_QURAN_FIXTURE-downloader/1.0',
    }).download(`http://${HOST}/ok`, file);
    expect(outcome).toEqual({
      kind: 'downloaded',
      bytes: BODY.length,
      sha256: createHash('sha256').update(BODY).digest('hex'),
    });
    expect(readFileSync(file).equals(BODY)).toBe(true);
    expect(leftovers()).toEqual([]);
    // Pinned to the validated address, honest about itself, sending no cookie.
    expect(pins[0]?.address).toBe(PUBLIC);
    expect(pins[0]?.headers['user-agent']).toBe('NON_QURAN_FIXTURE-downloader/1.0');
    expect(Object.keys(pins[0]?.headers ?? {}).sort()).toEqual([
      'accept',
      'accept-encoding',
      'connection',
      'host',
      'user-agent',
    ]);
  });
});
