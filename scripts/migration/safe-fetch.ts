import {
  request as httpRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';

import {
  authorisedScopeIsReal,
  checkSourceUrl,
  classifyAddress,
  fixtureScopeIsSynthetic,
  isFixtureHost,
  isPublicAddress,
  isRealHostName,
  sourcePolicySchema,
  type FetchOutcome,
  type MigrationFetchPort,
  type SourcePolicy,
  type SourceRecord,
} from '@minhaj/contracts/migration';

import { readRobots, type RobotsPolicy } from './robots.ts';

/**
 * THE SAFE FETCH BOUNDARY (MIGRATION_STRATEGY.md §4.2, §8.1).
 *
 * One fetcher serves ONE source scope and makes ONE attempt per call; retries,
 * politeness waits and Retry-After handling belong to the pipeline, which
 * reads `status` and `retryAfter` from the outcome.
 *
 * The order of checks is the defence:
 *
 *   1. `checkSourceUrl` — scheme, credentials, literal IP, exact host, default
 *      port — before anything touches the network;
 *   2. resolution through an INJECTED resolver, and EVERY address it returns
 *      must pass the address policy (a host answering with one public and one
 *      private address is refused outright, not half-trusted);
 *   3. the connection is PINNED to the first validated address: Node is given
 *      a `lookup` that can only answer with that address, so nothing between
 *      the check and the connect can re-resolve the name (DNS rebinding);
 *   4. redirects are never followed by the transport: each `Location` is
 *      resolved against the current URL and goes through 1–3 again before the
 *      next hop, bounded by the source's `maxRedirects`.
 *
 * One deadline covers the whole exchange, redirects included. The body is
 * read against the source's cap and the connection is destroyed the moment
 * the cap is exceeded — nothing beyond it is buffered. Only allowlisted
 * response headers survive, and no cookie, credential or authorisation header
 * is ever sent. Refusal and failure `detail`s are fixed codes: never a body,
 * a header value or a URL.
 *
 * FIXTURE MODE (Phase 29 runs nothing else): `fixtureResolver` resolves only
 * `*.fixture.invalid` names, to one loopback endpoint; `fixtureAddressPolicy`
 * admits only that address; `fixtureConnector` substitutes the fixture
 * server's port and refuses any other target. A fixture fetcher therefore
 * cannot reach a real host even if a source URL is edited: the scope check,
 * the resolver and the connector each refuse it independently.
 */

export const FETCHER_KEY = 'safe-fetch';
export const FETCHER_VERSION = '1';

/** Honest and identifying (MIGRATION_STRATEGY.md §4.2). */
export const MIGRATION_USER_AGENT =
  'OneMinhajMigration/1.0 (+https://minhaj.org; fixture-only engineering proof)';

/**
 * The User-Agent of an AUTHORISED source's fetches: the platform's name, what
 * the traffic is for and where it is reviewed — never a browser impersonation.
 */
export const AUTHORISED_USER_AGENT =
  'OneMinhajMigration/1.30 (+https://minhaj.haseebliaqat.me; authorised pre-adoption migration of public content)';

/** The response headers worth keeping as provenance. Everything else is dropped. */
export const RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  'content-type',
  'content-length',
  'last-modified',
  'etag',
  'retry-after',
  'cache-control',
] as const);

/** A header value longer than this is dropped rather than truncated into a lie. */
const MAX_HEADER_VALUE = 200;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Name → addresses. Injected, so tests and fixtures never touch real DNS. */
export type Resolver = (host: string) => Promise<readonly string[]>;

/** May a connection go to this literal address? */
export type AddressPolicy = (address: string) => boolean;

/** Everything a connector needs, after every check has passed. */
export interface PinnedConnection {
  readonly url: URL;
  readonly host: string;
  /** The validated address the connection MUST use. */
  readonly address: string;
  readonly port: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/** Opens one pinned GET exchange and yields the response head. */
export type Connector = (connection: PinnedConnection) => Promise<IncomingMessage>;

export interface SafeFetcherOptions {
  /** The source's authorised hosts — exact names, no suffix matching. */
  readonly hosts: readonly string[];
  readonly policy: SourcePolicy;
  readonly resolver: Resolver;
  /** Defaults to `isPublicAddress`, the policy for an authorised source. */
  readonly addressPolicy?: AddressPolicy;
  readonly connector?: Connector;
  readonly userAgent?: string;
}

/**
 * The default transport: Node's own client with a `lookup` that answers only
 * with the pinned address, no connection pooling (a pooled socket could
 * outlive its pin), and the TLS server name taken from the host.
 */
export const nodeConnector: Connector = (connection) =>
  new Promise<IncomingMessage>((resolve, reject) => {
    const family = isIP(connection.address);
    if (family === 0) {
      reject(new Error('pinned address is not a literal address'));
      return;
    }
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address: connection.address, family }]);
      else callback(null, connection.address, family);
    };
    const options: RequestOptions & { servername?: string } = {
      method: 'GET',
      hostname: connection.host,
      port: connection.port,
      path: `${connection.url.pathname}${connection.url.search}`,
      headers: { ...connection.headers },
      lookup,
      agent: false,
      signal: connection.signal,
    };
    const https = connection.url.protocol === 'https:';
    if (https) options.servername = connection.host;
    const request = (https ? httpsRequest : httpRequest)(options, resolve);
    request.on('error', reject);
    request.end();
  });

type Refusal = Extract<FetchOutcome, { kind: 'refused' }>['classification'];

function refused(
  requestedUrl: string,
  classification: Refusal,
  detail: string,
): FetchOutcome {
  return { kind: 'refused', classification, requestedUrl, detail };
}

function failure(
  requestedUrl: string,
  classification: 'network' | 'timeout',
  detail: string,
): FetchOutcome {
  return { kind: 'failure', classification, requestedUrl, detail };
}

/** The requested URL as it may be recorded: parsed, credentials removed, bounded. */
function recordableUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    const text = url.toString();
    return text.length <= 2000 ? text : '[url-too-long]';
  } catch {
    return '[malformed-url]';
  }
}

/** Waits for `promise` unless the deadline passes first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('rejected'));
      },
    );
  });
}

function singleHeader(response: IncomingMessage, name: string): string | null {
  const value = response.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_HEADER_VALUE)
    return null;
  return text;
}

function allowlistedHeaders(response: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = singleHeader(response, name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

type BodyResult =
  | { readonly ok: true; readonly body: Uint8Array }
  | { readonly ok: false; readonly reason: 'too-large' | 'network' | 'timeout' };

/** Reads at most `cap` bytes; the socket is destroyed the moment it would exceed. */
function readCapped(
  response: IncomingMessage,
  cap: number,
  signal: AbortSignal,
): Promise<BodyResult> {
  return new Promise<BodyResult>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (result: BodyResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (!result.ok) response.destroy();
      resolve(result);
    };
    const onAbort = () => settle({ ok: false, reason: 'timeout' });
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    response.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > cap) {
        settle({ ok: false, reason: 'too-large' });
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () =>
      settle({ ok: true, body: new Uint8Array(Buffer.concat(chunks, total)) }),
    );
    response.on('error', () =>
      settle({ ok: false, reason: signal.aborted ? 'timeout' : 'network' }),
    );
    response.on('close', () => {
      if (!response.complete)
        settle({ ok: false, reason: signal.aborted ? 'timeout' : 'network' });
    });
  });
}

/**
 * Creates the fetch boundary for one source scope.
 *
 * The policy is re-validated here, so a fetcher cannot be built with a
 * zero timeout, an unbounded body or an unbounded redirect chain.
 */
export function createSafeFetcher(options: SafeFetcherOptions): MigrationFetchPort {
  const policy = sourcePolicySchema.parse(options.policy);
  const hosts = Object.freeze([...options.hosts]);
  const resolver = options.resolver;
  const addressPolicy = options.addressPolicy ?? isPublicAddress;
  const connector = options.connector ?? nodeConnector;
  const userAgent = options.userAgent ?? MIGRATION_USER_AGENT;
  if (!/^[\x20-\x7e]{1,200}$/.test(userAgent))
    throw new Error('safe fetch: invalid User-Agent');

  /** Resolves, validates EVERY address, and pins the first. */
  async function pin(
    host: string,
    requestedUrl: string,
    signal: AbortSignal,
  ): Promise<{ readonly address: string } | FetchOutcome> {
    let addresses: readonly unknown[];
    try {
      addresses = await untilAborted(
        Promise.resolve().then(() => resolver(host)),
        signal,
      );
    } catch {
      return signal.aborted
        ? failure(requestedUrl, 'timeout', 'deadline-exceeded')
        : failure(requestedUrl, 'network', 'resolution-failed');
    }
    if (!Array.isArray(addresses) || addresses.length === 0)
      return failure(requestedUrl, 'network', 'resolution-empty');
    for (const address of addresses) {
      if (typeof address !== 'string' || !addressPolicy(address)) {
        const kind = typeof address === 'string' ? classifyAddress(address) : 'invalid';
        return refused(requestedUrl, 'address-refused', `address-${kind}`);
      }
    }
    return { address: addresses[0] as string };
  }

  async function exchange(
    raw: string,
    requestedUrl: string,
    signal: AbortSignal,
  ): Promise<FetchOutcome> {
    const first = checkSourceUrl(raw, hosts);
    if (!first.ok) return refused(requestedUrl, 'scope-refused', `url-${first.refusal}`);
    let url = first.url;
    let host = first.host;

    for (let hop = 0; ; hop += 1) {
      const pinned = await pin(host, requestedUrl, signal);
      if (!('address' in pinned)) return pinned;

      let response: IncomingMessage;
      try {
        response = await untilAborted(
          connector({
            url,
            host,
            address: pinned.address,
            port: url.protocol === 'https:' ? 443 : 80,
            headers: {
              host: url.host,
              'user-agent': userAgent,
              accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
              'accept-encoding': 'identity',
              connection: 'close',
            },
            signal,
          }),
          signal,
        );
      } catch {
        return signal.aborted
          ? failure(requestedUrl, 'timeout', 'deadline-exceeded')
          : failure(requestedUrl, 'network', 'connection-failed');
      }

      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        const location = response.headers.location;
        response.destroy();
        if (typeof location !== 'string' || location.length === 0)
          return refused(requestedUrl, 'redirect-refused', 'redirect-without-location');
        if (hop >= policy.maxRedirects)
          return refused(requestedUrl, 'redirect-refused', 'redirect-limit');
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return refused(requestedUrl, 'redirect-refused', 'redirect-malformed');
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:')
          return refused(requestedUrl, 'redirect-refused', 'redirect-scheme');
        const verdict = checkSourceUrl(next.toString(), hosts);
        if (!verdict.ok)
          return refused(requestedUrl, 'scope-refused', `redirect-${verdict.refusal}`);
        url = verdict.url;
        host = verdict.host;
        continue;
      }

      const declared = Number(singleHeader(response, 'content-length') ?? Number.NaN);
      if (Number.isFinite(declared) && declared > policy.maxBodyBytes) {
        response.destroy();
        return refused(requestedUrl, 'too-large', 'declared-length-exceeds-cap');
      }
      const body = await readCapped(response, policy.maxBodyBytes, signal);
      if (!body.ok) {
        if (body.reason === 'too-large')
          return refused(requestedUrl, 'too-large', 'body-exceeds-cap');
        return body.reason === 'timeout'
          ? failure(requestedUrl, 'timeout', 'deadline-exceeded')
          : failure(requestedUrl, 'network', 'body-interrupted');
      }
      return {
        kind: 'response',
        status,
        requestedUrl,
        finalUrl: url.toString(),
        contentType: singleHeader(response, 'content-type'),
        headers: allowlistedHeaders(response),
        body: body.body,
        retryAfter: singleHeader(response, 'retry-after'),
      };
    }
  }

  return {
    fetcherKey: FETCHER_KEY,
    fetcherVersion: FETCHER_VERSION,
    async fetch(raw: string): Promise<FetchOutcome> {
      const requestedUrl = recordableUrl(raw);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      try {
        return await exchange(raw, requestedUrl, controller.signal);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* ===========================================================================
 * Fixture mode
 * ========================================================================= */

/** Where the local fixture server listens. Loopback IPv4 only. */
export interface FixtureEndpoint {
  readonly address: string;
  readonly port: number;
}

function assertFixtureEndpoint(endpoint: FixtureEndpoint): void {
  if (isIP(endpoint.address) !== 4 || classifyAddress(endpoint.address) !== 'loopback')
    throw new Error('fixture endpoint must be a loopback IPv4 address');
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65_535)
    throw new Error('fixture endpoint port is invalid');
}

/** Resolves `*.fixture.invalid` to the fixture endpoint and NOTHING else. */
export function fixtureResolver(options: {
  readonly endpoint: FixtureEndpoint;
}): Resolver {
  const { endpoint } = options;
  assertFixtureEndpoint(endpoint);
  return (host) =>
    isFixtureHost(host)
      ? Promise.resolve([endpoint.address])
      : Promise.reject(new Error('fixture resolver refuses a non-fixture host'));
}

/** Admits exactly the fixture endpoint's address. */
export function fixtureAddressPolicy(endpoint: FixtureEndpoint): AddressPolicy {
  assertFixtureEndpoint(endpoint);
  return (address) => address === endpoint.address;
}

/**
 * Carries a fixture URL (default port) to the fixture server's real port, and
 * refuses any connection that is not a fixture host pinned to the endpoint.
 */
export function fixtureConnector(
  endpoint: FixtureEndpoint,
  base: Connector = nodeConnector,
): Connector {
  assertFixtureEndpoint(endpoint);
  return (connection) =>
    connection.address === endpoint.address && isFixtureHost(connection.host)
      ? base({ ...connection, port: endpoint.port })
      : Promise.reject(new Error('fixture connector refuses a non-fixture target'));
}

/**
 * The fetcher for a FIXTURE source. Refuses to exist for any other source,
 * and for a fixture source whose scope is not entirely synthetic.
 */
export function createFixtureFetcher(
  source: SourceRecord,
  endpoint: FixtureEndpoint,
): MigrationFetchPort {
  if (source.authorityKind !== 'fixture')
    throw new Error('a fixture fetcher serves fixture sources only');
  if (!fixtureScopeIsSynthetic(source.baseUrl, source.hosts))
    throw new Error('a fixture source may name only *.fixture.invalid hosts');
  return createSafeFetcher({
    hosts: source.hosts,
    policy: source.policy,
    resolver: fixtureResolver({ endpoint }),
    addressPolicy: fixtureAddressPolicy(endpoint),
    connector: fixtureConnector(endpoint),
  });
}

/* ===========================================================================
 * Authorised mode — a real source, real DNS, public addresses only
 * ========================================================================= */

/**
 * The system resolver: EVERY address the name resolves to (both families, in
 * the resolver's own order), so the boundary can refuse a host that answers
 * with even one non-public address. Nothing is cached here; each hop
 * resolves again and is validated again.
 */
export const systemResolver: Resolver = async (host) => {
  const answers = await dnsLookup(host, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

/**
 * The fetcher for an AUTHORISED source: its exact hosts, its own politeness
 * bounds, the system resolver, PUBLIC addresses only (the default policy) and
 * the pinned Node transport. Refuses to exist for a fixture source, or for a
 * scope that is not a real `https` one — a fixture name never reaches DNS.
 */
export function createAuthorisedFetcher(
  source: SourceRecord,
  options: { readonly resolver?: Resolver; readonly connector?: Connector } = {},
): MigrationFetchPort {
  if (source.authorityKind !== 'authorised')
    throw new Error('an authorised fetcher serves authorised sources only');
  if (
    source.accessMethod !== 'http' ||
    !authorisedScopeIsReal(source.baseUrl, source.hosts)
  )
    throw new Error('an authorised source must name a real https scope');
  return createSafeFetcher({
    hosts: source.hosts,
    policy: source.policy,
    resolver: options.resolver ?? systemResolver,
    ...(options.connector === undefined ? {} : { connector: options.connector }),
    userAgent: AUTHORISED_USER_AGENT,
  });
}

/**
 * Phase 30-R. The fetcher an AUTHORISED source acquires its IMAGES through:
 * the same boundary as its pages — exact hosts, public addresses, pinned
 * transport, the honest User-Agent — over its page hosts AND its registered
 * first-party asset hosts, and nothing else. An asset host's own robots.txt is
 * honoured: read once per host (a definitive 200 or 4xx only; anything else is
 * read again), and a disallowed picture is refused before it is requested.
 */
export function createAuthorisedAssetFetcher(
  source: SourceRecord,
  options: { readonly resolver?: Resolver; readonly connector?: Connector } = {},
): MigrationFetchPort {
  if (source.authorityKind !== 'authorised')
    throw new Error('an authorised fetcher serves authorised sources only');
  if (
    source.accessMethod !== 'http' ||
    !authorisedScopeIsReal(source.baseUrl, source.hosts) ||
    !source.assetHosts.every(isRealHostName)
  )
    throw new Error('an authorised source must name a real https scope');
  const inner = createSafeFetcher({
    hosts: [...source.hosts, ...source.assetHosts],
    policy: source.policy,
    resolver: options.resolver ?? systemResolver,
    ...(options.connector === undefined ? {} : { connector: options.connector }),
    userAgent: AUTHORISED_USER_AGENT,
  });
  const robots = new Map<string, RobotsPolicy>();
  return {
    fetcherKey: inner.fetcherKey,
    fetcherVersion: inner.fetcherVersion,
    async fetch(url) {
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        return inner.fetch(url);
      }
      if (source.assetHosts.includes(host)) {
        let policy = robots.get(host);
        if (policy === undefined) {
          const read = await readRobots(inner, `https://${host}`);
          const definitive =
            read.outcome.kind === 'response' &&
            (read.outcome.status === 200 ||
              (read.outcome.status >= 400 && read.outcome.status < 500));
          if (!definitive) return read.outcome;
          policy = read.policy;
          robots.set(host, policy);
        }
        if (!policy.allows(url))
          return {
            kind: 'refused',
            classification: 'scope-refused',
            requestedUrl: url,
            detail: 'robots-disallowed',
          };
      }
      return inner.fetch(url);
    },
  };
}
