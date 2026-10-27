import { isFixtureHost } from './values.ts';

/**
 * THE SSRF ADDRESS AND URL POLICY (MIGRATION_STRATEGY.md §8.1).
 *
 * Pure decisions over strings, so they are proved exhaustively by unit tests
 * and applied by the safe fetch boundary at the two moments that matter:
 * BEFORE A CONNECTION, to every address a host resolved to, and AGAIN AFTER
 * EVERY REDIRECT. A hostname check alone is not a defence — a public name can
 * resolve to an internal address (DNS rebinding) — which is why the verdict is
 * on the ADDRESS the connection will actually use.
 *
 * No Node import: the policy is Layer 0 and testable anywhere; the transport
 * that applies it lives in `scripts/migration/`.
 */

/** What an address is, as far as fetching is concerned. */
export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'metadata'
  | 'shared'
  | 'reserved'
  | 'multicast'
  | 'unspecified'
  | 'documentation'
  | 'invalid';

/** Parses a dotted-quad IPv4 address strictly — no octal, hex or short forms. */
export function parseIPv4(
  text: string,
): readonly [number, number, number, number] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return [a, b, c, d];
}

/**
 * Parses an IPv6 address (with optional zone refused) into eight 16-bit groups,
 * accepting `::` compression and an embedded dotted-quad tail.
 */
export function parseIPv6(text: string): readonly number[] | null {
  if (text.includes('%')) return null;
  let value = text;
  let tail: readonly [number, number] | null = null;
  const lastColon = value.lastIndexOf(':');
  if (value.includes('.')) {
    const v4 = parseIPv4(value.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    value = value.slice(0, lastColon + 1) + '0:0';
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === ''
      ? []
      : part
          .split(':')
          .map((group) => (/^[0-9a-fA-F]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  const [first = '', second] = halves;
  const head = parse(first);
  const rest = second === undefined ? [] : parse(second);
  if ([...head, ...rest].some((group) => Number.isNaN(group))) return null;
  let groups: number[];
  if (second !== undefined) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail !== null) {
    groups[6] = tail[0];
    groups[7] = tail[1];
  }
  return groups;
}

function classifyIPv4([a, b, c]: readonly [
  number,
  number,
  number,
  number,
]): AddressClass {
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return b === 254 && c === 169 ? 'metadata' : 'link-local';
  if (a === 100 && b >= 64 && b <= 127) return 'shared';
  if (a === 192 && b === 0 && c === 0) return 'reserved';
  if (a === 192 && b === 0 && c === 2) return 'documentation';
  if (a === 198 && b === 51 && c === 100) return 'documentation';
  if (a === 203 && b === 0 && c === 113) return 'documentation';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  if (a === 192 && b === 88 && c === 99) return 'reserved';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

/**
 * The class of one literal address. Anything this cannot parse is `invalid`,
 * and `invalid` is refused like every non-public class: unknown is unsafe.
 *
 * IPv4-MAPPED AND -COMPATIBLE IPv6 (`::ffff:127.0.0.1`, `::127.0.0.1`) and the
 * NAT64 well-known prefix are classified BY THE IPv4 ADDRESS THEY CARRY, so a
 * loopback or metadata address cannot be smuggled through as "IPv6".
 */
export function classifyAddress(address: string): AddressClass {
  const v4 = parseIPv4(address);
  if (v4) return classifyIPv4(v4);
  const groups = parseIPv6(address);
  if (!groups) return 'invalid';
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embedded = (): readonly [number, number, number, number] => [
    g6 >> 8,
    g6 & 0xff,
    g7 >> 8,
    g7 & 0xff,
  ];
  if (groups.every((group) => group === 0)) return 'unspecified';
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  )
    return 'loopback';
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible).
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    (g5 === 0xffff || g5 === 0)
  )
    return classifyIPv4(embedded());
  // 64:ff9b::/96 — NAT64 translates to the IPv4 address it carries.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return classifyIPv4(embedded());
  // fd00:ec2::254 — the AWS IPv6 metadata endpoint, named before the generic
  // fc00::/7 that also contains it.
  if (g0 === 0xfd00 && g1 === 0x0ec2) return 'metadata';
  if ((g0 & 0xfe00) === 0xfc00) return 'private';
  if ((g0 & 0xffc0) === 0xfe80) return 'link-local';
  if ((g0 & 0xffc0) === 0xfec0) return 'reserved';
  if ((g0 & 0xff00) === 0xff00) return 'multicast';
  if (g0 === 0x2001 && g1 === 0x0db8) return 'documentation';
  if (g0 === 0x2002 || (g0 === 0x2001 && g1 === 0)) return 'reserved';
  return 'public';
}

/** May a connection to this literal address proceed for an AUTHORISED source? */
export function isPublicAddress(address: string): boolean {
  return classifyAddress(address) === 'public';
}

/** Why a URL is refused before any network activity. */
export type UrlRefusal =
  'malformed' | 'scheme' | 'credentials' | 'host-literal' | 'out-of-scope' | 'port';

export type UrlVerdict =
  | { readonly ok: true; readonly url: URL; readonly host: string }
  | { readonly ok: false; readonly refusal: UrlRefusal };

/**
 * Validates a URL against a source's authorised hosts BEFORE resolution.
 *
 *   - `http` and `https` only;
 *   - no `user:password@` — credentials never travel in a fetched address;
 *   - no literal IP address as a host — authorised scope is a list of names;
 *   - the host is EXACTLY one of the source's authorised hosts (no suffix or
 *     subdomain match: `evil.example.invalid` is not `example.invalid`);
 *   - only the default port of the scheme, so a scope cannot be stretched to
 *     another service on the same host.
 */
export function checkSourceUrl(
  raw: string,
  authorisedHosts: readonly string[],
): UrlVerdict {
  let url: URL;
  try {
    if (raw.length > 2000 || /[\s\\]/.test(raw))
      return { ok: false, refusal: 'malformed' };
    url = new URL(raw);
  } catch {
    return { ok: false, refusal: 'malformed' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, refusal: 'scheme' };
  if (url.username !== '' || url.password !== '')
    return { ok: false, refusal: 'credentials' };
  const host = url.hostname.toLowerCase();
  if (parseIPv4(host) || host.startsWith('['))
    return { ok: false, refusal: 'host-literal' };
  if (url.port !== '') return { ok: false, refusal: 'port' };
  if (!authorisedHosts.includes(host)) return { ok: false, refusal: 'out-of-scope' };
  return { ok: true, url, host };
}

/** Is every host a fixture host, and is the base URL inside them? */
export function fixtureScopeIsSynthetic(
  baseUrl: string | null,
  hosts: readonly string[],
): boolean {
  if (hosts.length === 0 && baseUrl !== null) return false;
  if (!hosts.every(isFixtureHost)) return false;
  if (baseUrl === null) return true;
  const verdict = checkSourceUrl(baseUrl, hosts);
  return verdict.ok && verdict.url.pathname.endsWith('/') && verdict.url.search === '';
}

/**
 * A real public DNS name an authorised source may name: lower-case labels of
 * letters, digits and inner hyphens, at least two of them, ending in an
 * ALPHABETIC top-level label — so never an IPv4 or IPv6 literal, never a
 * single-label name like `localhost`, never `*.invalid`.
 */
export function isRealHostName(host: string): boolean {
  return (
    host.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) &&
    !host.endsWith('.invalid')
  );
}

/**
 * Is this a REAL source's scope? The mirror of `fixtureScopeIsSynthetic`: at
 * least one host, NO host under `*.fixture.invalid` (a fixture name never
 * becomes a real one), and an `https` base URL — a site root path, no query —
 * on one of those hosts. An export source has no base URL and no hosts.
 */
export function authorisedScopeIsReal(
  baseUrl: string | null,
  hosts: readonly string[],
): boolean {
  if (hosts.some((host) => isFixtureHost(host) || !isRealHostName(host))) return false;
  if (baseUrl === null) return hosts.length === 0;
  if (hosts.length === 0) return false;
  const verdict = checkSourceUrl(baseUrl, hosts);
  return (
    verdict.ok &&
    verdict.url.protocol === 'https:' &&
    verdict.url.pathname.endsWith('/') &&
    verdict.url.search === ''
  );
}

/**
 * The canonical external key of a URL within a source: lower-case scheme and
 * host, no fragment, no default port, the path as served, and the query kept
 * (a legacy site may key records by query) with its parameters sorted.
 */
export function canonicalSourceUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = '';
  const params = [...copy.searchParams.entries()].sort(([a, x], [b, y]) =>
    a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1,
  );
  copy.search = '';
  for (const [key, value] of params) copy.searchParams.append(key, value);
  return copy.toString();
}
