import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTHORISED_MAX_CONCURRENCY,
  AUTHORISED_MIN_INTERVAL_MS,
  type FetchOutcome,
  type SourceRecord,
} from '@minhaj/contracts/migration';

/**
 * The system resolver's only dependency, replaced: no test here ever asks a
 * real DNS server anything, and no connection ever leaves the process.
 */
const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }));

import {
  AUTHORISED_USER_AGENT,
  MIGRATION_USER_AGENT,
  createAuthorisedAssetFetcher,
  createAuthorisedFetcher,
  systemResolver,
  type Connector,
  type PinnedConnection,
} from '../../../scripts/migration/safe-fetch.ts';

import { TEST_POLICY, fixtureSource } from './support.ts';

/**
 * THE AUTHORISED FETCHER (Phase 30): a real source's exact hosts, its own
 * politeness bounds, the system resolver, PUBLIC addresses only, the pinned
 * transport and an honest User-Agent. It refuses to exist for a fixture or
 * for a scope that is not a real `https` one.
 */

const HOST = 'www.example.org';

function authorisedSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return fixtureSource({
    key: 'example-source',
    name: 'Example source',
    authorityKind: 'authorised',
    baseUrl: `https://${HOST}/`,
    hosts: [HOST],
    authorisationReference: 'Board letter MQI/2026/07',
    authorisedOn: '2026-10-01',
    policy: {
      ...TEST_POLICY,
      minIntervalMs: AUTHORISED_MIN_INTERVAL_MS,
      maxConcurrency: AUTHORISED_MAX_CONCURRENCY,
    },
    ...overrides,
  });
}

function forbiddenConnector() {
  return vi.fn<Connector>(() =>
    Promise.reject(new Error('connector must not be called')),
  );
}

/** A connector answering in-process with a synthetic 200, recording each pin. */
function answeringConnector(body = 'ok') {
  const pins: PinnedConnection[] = [];
  const connector = vi.fn<Connector>(async (connection) => {
    pins.push(connection);
    const response = new IncomingMessage(new Socket());
    response.statusCode = 200;
    response.headers = { 'content-type': 'text/html; charset=utf-8' };
    response.push(body);
    response.push(null);
    return response;
  });
  return { connector, pins };
}

function expectRefused(outcome: FetchOutcome, classification: string, detail?: string) {
  expect(outcome.kind).toBe('refused');
  if (outcome.kind !== 'refused') return;
  expect(outcome.classification).toBe(classification);
  if (detail !== undefined) expect(outcome.detail).toBe(detail);
}

beforeEach(() => {
  lookup.mockReset();
  lookup.mockRejectedValue(new Error('no DNS in tests unless a test scripts one'));
});

describe('createAuthorisedFetcher refuses to exist for the wrong source', () => {
  it('refuses a fixture source, whatever its scope', () => {
    expect(() => createAuthorisedFetcher(fixtureSource())).toThrow(
      /authorised sources only/,
    );
    expect(() =>
      createAuthorisedFetcher(
        fixtureSource({ baseUrl: `https://${HOST}/`, hosts: [HOST] }),
      ),
    ).toThrow(/authorised sources only/);
  });

  it.each([
    ['plain http', { baseUrl: `http://${HOST}/` }],
    [
      'a *.invalid host',
      { baseUrl: 'https://legacy.example.invalid/', hosts: ['legacy.example.invalid'] },
    ],
    [
      'a fixture host',
      { baseUrl: 'https://videos.fixture.invalid/', hosts: ['videos.fixture.invalid'] },
    ],
    ['a fixture host beside a real one', { hosts: [HOST, 'videos.fixture.invalid'] }],
    ['credentials in the base', { baseUrl: `https://user:pw@${HOST}/` }],
    [
      'a literal address',
      { baseUrl: 'https://93.184.216.34/', hosts: ['93.184.216.34'] },
    ],
    ['a base off its hosts', { baseUrl: 'https://other.example.org/' }],
    ['no hosts', { hosts: [] }],
    ['no base', { baseUrl: null }],
    ['an export source', { accessMethod: 'export' as const, baseUrl: null, hosts: [] }],
  ])('refuses %s', (_name, overrides) => {
    expect(() =>
      createAuthorisedFetcher(authorisedSource(overrides), {
        connector: forbiddenConnector(),
      }),
    ).toThrow(/real https scope/);
  });

  it('never resolves a name while refusing', () => {
    try {
      createAuthorisedFetcher(authorisedSource({ hosts: ['videos.fixture.invalid'] }));
    } catch {
      // refused, as above
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('createAuthorisedFetcher: public addresses only', () => {
  it.each([
    ['private', ['10.0.0.7']],
    ['loopback', ['127.0.0.1']],
    ['cloud metadata', ['169.254.169.254']],
    ['IPv6 loopback', ['::1']],
    ['IPv6 unique-local', ['fd12::1']],
    ['a public answer beside a private one', ['93.184.216.34', '192.168.1.1']],
    ['a private answer before a public one', ['172.16.0.1', '93.184.216.34']],
  ])('refuses a host answering %s, before any connection', async (_name, addresses) => {
    const connector = forbiddenConnector();
    const resolver = vi.fn(async () => addresses);
    const fetcher = createAuthorisedFetcher(authorisedSource(), { resolver, connector });
    expectRefused(await fetcher.fetch(`https://${HOST}/news/1`), 'address-refused');
    expect(resolver).toHaveBeenCalledWith(HOST);
    expect(connector).not.toHaveBeenCalled();
  });

  it('refuses a URL outside the exact hosts before resolving anything', async () => {
    const connector = forbiddenConnector();
    const resolver = vi.fn(async () => ['93.184.216.34']);
    const fetcher = createAuthorisedFetcher(authorisedSource(), { resolver, connector });
    for (const url of [
      'https://example.org/',
      'https://evil.example/',
      `https://${HOST}.evil.example/`,
      'https://93.184.216.34/',
      `https://user@${HOST}/`,
    ])
      expectRefused(await fetcher.fetch(url), 'scope-refused');
    expect(resolver).not.toHaveBeenCalled();
    expect(connector).not.toHaveBeenCalled();
  });

  it('pins the validated public address and announces itself honestly', async () => {
    const { connector, pins } = answeringConnector('<p>hello</p>');
    const fetcher = createAuthorisedFetcher(authorisedSource(), {
      resolver: async () => ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
      connector,
    });
    const outcome = await fetcher.fetch(`https://${HOST}/news/1`);
    expect(outcome).toMatchObject({
      kind: 'response',
      status: 200,
      finalUrl: `https://${HOST}/news/1`,
    });
    if (outcome.kind === 'response')
      expect(new TextDecoder().decode(outcome.body)).toBe('<p>hello</p>');
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ host: HOST, address: '93.184.216.34', port: 443 });
    expect(pins[0]?.headers['user-agent']).toBe(AUTHORISED_USER_AGENT);
    expect(pins[0]?.headers['host']).toBe(HOST);
    // Never a browser impersonation, and never the fixture-only identity.
    expect(AUTHORISED_USER_AGENT).toMatch(/^OneMinhajMigration\/[0-9.]+ \(\+https:\/\//);
    expect(AUTHORISED_USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari|fixture/i);
    expect(AUTHORISED_USER_AGENT).not.toBe(MIGRATION_USER_AGENT);
  });
});

describe('systemResolver', () => {
  it('asks for EVERY address, both families, in the resolver’s own order', async () => {
    lookup.mockResolvedValueOnce([
      { address: '2606:2800:220:1::1', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(await systemResolver(HOST)).toEqual(['2606:2800:220:1::1', '93.184.216.34']);
    expect(lookup).toHaveBeenCalledWith(HOST, { all: true, verbatim: true });
  });

  it('is the authorised fetcher’s default — so one internal answer refuses the host', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    const connector = forbiddenConnector();
    const fetcher = createAuthorisedFetcher(authorisedSource(), { connector });
    expectRefused(
      await fetcher.fetch(`https://${HOST}/`),
      'address-refused',
      'address-private',
    );
    expect(lookup).toHaveBeenCalledWith(HOST, { all: true, verbatim: true });
    expect(connector).not.toHaveBeenCalled();
  });

  it('treats a failed resolution as a network failure, never as permission', async () => {
    const connector = forbiddenConnector();
    const fetcher = createAuthorisedFetcher(authorisedSource(), { connector });
    const outcome = await fetcher.fetch(`https://${HOST}/`);
    expect(outcome).toMatchObject({ kind: 'failure', classification: 'network' });
    expect(connector).not.toHaveBeenCalled();
  });
});

/* ===========================================================================
 * Phase 30-R — the asset fetcher
 * ========================================================================= */

describe('createAuthorisedAssetFetcher (Phase 30-R)', () => {
  const ASSET_HOST = 'images.example.org';
  const source = authorisedSource({ assetHosts: [ASSET_HOST] });

  /** A connector answering per path: robots.txt as scripted, everything else 200. */
  function routedConnector(robots: { status: number; body: string }) {
    const asked: string[] = [];
    const connector = vi.fn<Connector>(async (connection) => {
      asked.push(connection.url.toString());
      const response = new IncomingMessage(new Socket());
      const isRobots = connection.url.pathname === '/robots.txt';
      response.statusCode = isRobots ? robots.status : 200;
      response.headers = {
        'content-type': isRobots ? 'text/plain' : 'image/jpeg',
      };
      response.push(isRobots ? robots.body : 'JPEGBYTES');
      response.push(null);
      return response;
    });
    return { connector, asked };
  }

  beforeEach(() => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('reaches an asset host only after its robots.txt, read once per host', async () => {
    const { connector, asked } = routedConnector({
      status: 200,
      body: 'User-agent: *\nDisallow: /private/\n',
    });
    const fetcher = createAuthorisedAssetFetcher(source, { connector });
    const allowed = await fetcher.fetch(`https://${ASSET_HOST}/lead/a.jpg`);
    expect(allowed).toMatchObject({ kind: 'response', status: 200 });
    // A disallowed picture is refused before it is requested.
    expectRefused(
      await fetcher.fetch(`https://${ASSET_HOST}/private/b.jpg`),
      'scope-refused',
      'robots-disallowed',
    );
    expect(asked).toEqual([
      `https://${ASSET_HOST}/robots.txt`,
      `https://${ASSET_HOST}/lead/a.jpg`,
    ]);
  });

  it('treats a missing robots.txt as allowing, and an unreadable one as no answer', async () => {
    const missing = routedConnector({ status: 404, body: 'not found' });
    expect(
      await createAuthorisedAssetFetcher(source, { connector: missing.connector }).fetch(
        `https://${ASSET_HOST}/lead/a.jpg`,
      ),
    ).toMatchObject({ kind: 'response', status: 200 });
    const failing = routedConnector({ status: 503, body: 'down' });
    const fetcher = createAuthorisedAssetFetcher(source, {
      connector: failing.connector,
    });
    expect(await fetcher.fetch(`https://${ASSET_HOST}/lead/a.jpg`)).toMatchObject({
      kind: 'response',
      status: 503,
    });
    // Never taken as permission: the picture itself was not requested.
    expect(failing.asked).toEqual([`https://${ASSET_HOST}/robots.txt`]);
  });

  it('serves the page hosts as the page fetcher does, and refuses every other host', async () => {
    const { connector, asked } = routedConnector({ status: 404, body: '' });
    const fetcher = createAuthorisedAssetFetcher(source, { connector });
    expect(await fetcher.fetch(`https://${HOST}/images/a.jpg`)).toMatchObject({
      kind: 'response',
      status: 200,
    });
    const refused = [
      'https://cdn.example.net/a.jpg',
      `https://sub.${ASSET_HOST}/a.jpg`,
      `https://${ASSET_HOST}:8443/a.jpg`,
      `https://user:secret@${ASSET_HOST}/a.jpg`,
    ];
    for (const url of refused) expect((await fetcher.fetch(url)).kind).toBe('refused');
    // None of them was ever requested; at most the asset host's robots.txt was read.
    for (const url of asked)
      expect([
        `https://${HOST}/images/a.jpg`,
        `https://${ASSET_HOST}/robots.txt`,
      ]).toContain(url);
  });

  it('refuses to exist for a fixture source or an unreal asset host', () => {
    expect(() => createAuthorisedAssetFetcher(fixtureSource())).toThrow();
    for (const assetHosts of [['localhost'], ['10.0.0.1'], ['images.example.invalid']])
      expect(() =>
        createAuthorisedAssetFetcher(authorisedSource({ assetHosts }), {
          connector: forbiddenConnector(),
        }),
      ).toThrow();
  });
});
