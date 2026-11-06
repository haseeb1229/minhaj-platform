import { type ChildProcess, spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureProductionBuild, nextBin, webRoot } from './next-production-build.ts';

/**
 * Locale routing, proven against a REAL production server (ROUTE_MAP.md §1).
 *
 * Everything here is an HTTP request to a `next build` output served by
 * `next start`. That is deliberate: locale resolution is decided by the proxy,
 * the framework's route matching and the render tree together, and a unit test
 * of any one of them would assert a model of the other two rather than the
 * behaviour a visitor gets. The redirect status, the `Location`, the absence of
 * any cookie and the terminal outcome of a bad locale are all observable only
 * here.
 *
 * THE CONTRACT (Rebaseline R1, owner decision 2026-11-06):
 *
 *   - English is UNPREFIXED: `/`, `/explore`, `/library`.
 *   - Urdu and Arabic carry their prefix: `/ur/explore`, `/ar/explore`.
 *   - The ADDRESS ALONE decides the language. No cookie and no
 *     `Accept-Language` header ever redirects an unprefixed URL, so a shared
 *     link shows everyone the same language and a crawler sees what a
 *     visitor sees.
 *   - `/en` and `/en/…` answer ONE permanent redirect to the unprefixed
 *     address, query preserved.
 *   - No public GET writes a cookie.
 *
 * The pure builder behind every address is proven in `locale-path.test.ts`.
 * No browser and no Playwright here: every property below is expressible over
 * HTTP. The one that is not — the hydrated switcher restoring the current
 * query string — is a browser property.
 */

let server: ChildProcess | null = null;
let base = '';

/** Reserves a free TCP port and releases it. */
async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createServer();

    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();

      if (address === null || typeof address === 'string') {
        socket.close();
        reject(new Error('could not obtain an ephemeral port'));
        return;
      }

      const { port } = address;
      socket.close(() => resolve(port));
    });
  });
}

/** Is anything accepting connections on this port? */
async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const settle = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1500);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/**
 * THE PAGE EACH LOCALE IS READ ON. The home page (`/`, `/ur`, `/ar`) is the
 * portal — a public CONTENT route that reads published records per request
 * (ARCHITECTURE.md §8.3.1.1), so it needs the database this suite deliberately
 * runs without (the `Verify` job has none). Every property asserted on a page
 * below — the shell, the switcher, `lang`/`dir`, no alternates, `noindex`, no
 * canonical, shared caching, no catalogue in the payload — is a property of
 * the locale tree's PRERENDERED shell, and is read on the prerendered page every
 * locale has. English is that page's UNPREFIXED address. The home portal's own
 * rendering is proved where a database exists: `tests/browser/shell.spec.ts`
 * in the Browser flows job. What IS asserted on `/` here is the routing
 * contract — it is never redirected — which needs no database.
 */
const PAGE = { en: '/explore', ur: '/ur/explore', ar: '/ar/explore' } as const;

/** The opening `<html>` tag each locale's document carries. */
const HTML = {
  en: '<html lang="en" dir="ltr"',
  ur: '<html lang="ur" dir="rtl"',
  ar: '<html lang="ar" dir="rtl"',
} as const;

/**
 * One request, never followed.
 *
 * `redirect: 'manual'` is the whole point: a followed redirect hides both the
 * status code and the `Location`, and those two ARE the contract.
 */
async function request(
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(base + path, { headers, redirect: 'manual' });
}

/** The document's opening `<html …>` tag, or `''` when there is none. */
function openingTag(html: string): string {
  return html.match(/<html[^>]*>/)?.[0] ?? '';
}

const isRedirect = (status: number) => status >= 300 && status < 400;

/**
 * Every redirect target must resolve back to THIS origin.
 *
 * Asserted by resolving the `Location` the way a browser would, rather than
 * by banning a hostile substring. The substring test is the tempting one and
 * it is wrong in both directions: it fails a perfectly safe
 * `/?next=%2F%2Fevil.example.com`, where the hostile string is an inert query
 * VALUE being carried along, and it would pass any off-site host whose name
 * the test did not happen to enumerate.
 *
 * The property that actually matters is the origin, so the origin is what is
 * checked. A protocol-relative `//evil.example.com` resolves to a different
 * origin and fails here, which is exactly right.
 */
function expectInternal(location: string | null) {
  expect(location).not.toBeNull();

  const resolved = new URL(location as string, base);

  expect(resolved.origin, `${location} must stay on this origin`).toBe(
    new URL(base).origin,
  );
}

/**
 * The visitor-controlled language signals, every one of which an unprefixed
 * address must IGNORE. The cookie name is the one next-intl used to store a
 * preference before R1 — a returning visitor's browser may still send it.
 */
const PREFERENCES: readonly (readonly [string, Record<string, string>])[] = [
  ['no preference at all', {}],
  ['Accept-Language: ur', { 'accept-language': 'ur' }],
  ['Accept-Language: ar', { 'accept-language': 'ar' }],
  ['a regional Urdu tag', { 'accept-language': 'ur-PK,ur;q=0.9' }],
  ['a stored NEXT_LOCALE=ur cookie', { cookie: 'NEXT_LOCALE=ur' }],
  [
    'a stored NEXT_LOCALE=ar cookie with Accept-Language: ar',
    { cookie: 'NEXT_LOCALE=ar', 'accept-language': 'ar' },
  ],
];

/**
 * The secrets a PRODUCTION process must supply for itself.
 *
 * Phase 2 gave the server-environment schema three values with development
 * defaults, and `parseServerEnv` REJECTS those defaults under
 * `NODE_ENV=production` (SECURITY_BASELINE.md §18.1). The instrumentation hook
 * validates at startup, so a production launch without them answers 500 to
 * every request — which is the guard working exactly as intended.
 *
 * This suite is about LOCALE ROUTING and has to get past it, the same way
 * `tests/config/startup.test.ts` does. Supplying them here weakens nothing:
 * the guard itself is proved in that file, by a test that launches WITHOUT
 * them and asserts the process exits non-zero and never listens.
 *
 * Synthetic sentinels, recognisably not credentials, and never a real value.
 */
const PRODUCTION_SECRETS = {
  AUTH_SECRETS: '1:synthetic-locale-routing-sentinel-0001',
  RATE_LIMIT_DIGEST_KEY: 'synthetic-locale-routing-rate-limit-0001',
  EMAIL_DIGEST_KEY: 'synthetic-locale-routing-email-digest-0001',
  NEWSLETTER_TOKEN_KEY: 'synthetic-locale-routing-newsletter-token-0001',
} as const;

beforeAll(async () => {
  await ensureProductionBuild();

  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;

  server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: webRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', ...PRODUCTION_SECRETS },
  });

  /**
   * The child's output is kept, and its early exit is noticed.
   *
   * Without this, a server that fails to start surfaces as `ECONNRESET` on
   * every one of a hundred assertions, and the reason — a port taken, an
   * incomplete build — appears nowhere. One clear failure beats a hundred
   * mysterious ones.
   */
  let output = '';
  let exited: { code: number | null; signal: string | null } | null = null;

  server.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  server.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  server.once('exit', (code, signal) => (exited = { code, signal }));

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(
        `\`next start\` exited before listening (${JSON.stringify(exited)}).\n${output}`,
      );
    }

    if (await isListening(port)) {
      // Reached SOMETHING on that port. Confirm it is this server: an
      // ephemeral port is reserved and released before the child binds it, so
      // a parallel suite could in principle have taken it in between.
      const probe = await fetch(`${base}${PAGE.en}`, { redirect: 'manual' });
      const html = await probe.text();

      if (!html.includes(HTML.en)) {
        // The STATUS and the server's own output, not merely "something else".
        //
        // This check cannot tell a stolen port from this application failing to
        // serve, and the two need opposite repairs. Reporting only the former
        // sends the reader hunting for a port conflict when the answer — a
        // rejected environment, a half-written build — was on the child's
        // stderr the whole time.
        throw new Error(
          `\`next start\` on port ${port} did not serve this application: ` +
            `HTTP ${probe.status}, body begins ${JSON.stringify(html.slice(0, 200))}.\n` +
            `${output}`,
        );
      }

      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`the production server did not start within 120s.\n${output}`);
}, 900_000);

afterAll(() => {
  if (server !== null && server.exitCode === null) server.kill();
});

// ===========================================================================
// The address alone decides the language — ROUTE_MAP.md §1.1 (R1)
// ===========================================================================

describe('an unprefixed address is English, deterministically', () => {
  it.each(PREFERENCES)(
    '`/explore` serves English 200 with %s',
    async (_label, headers) => {
      const response = await request(PAGE.en, headers);

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(openingTag(await response.text())).toContain(HTML.en);
    },
  );

  it.each(PREFERENCES)('`/` is never redirected, with %s', async (_label, headers) => {
    // `/` is the English home itself — not a negotiation point. Before R1 it
    // answered a 307 chosen by cookie and `Accept-Language`; now no visitor
    // signal can move it anywhere. Its CONTENT is the database-backed portal
    // (see PAGE above), so what is asserted here is the routing outcome: the
    // same answer as a visitor with no preference, never a redirect, and never
    // an Urdu or Arabic document.
    const baseline = await request('/');
    const response = await request('/', headers);
    const tag = openingTag(await response.text());

    expect(isRedirect(response.status), `status ${response.status}`).toBe(false);
    expect(response.status).toBe(baseline.status);
    expect(response.headers.get('location')).toBeNull();
    expect(tag).not.toContain('lang="ur"');
    expect(tag).not.toContain('lang="ar"');
  });

  it('serves the SAME document whatever language the visitor prefers', async () => {
    // Not merely "also English": byte-identical, so no preference leaks into
    // a shared, cached response.
    const plain = await (await request(PAGE.en)).text();

    for (const [label, headers] of PREFERENCES) {
      expect(await (await request(PAGE.en, headers)).text(), label).toBe(plain);
    }
  });

  it('does not let a preference move a PREFIXED page either', async () => {
    const response = await request(PAGE.ur, {
      'accept-language': 'ar',
      cookie: 'NEXT_LOCALE=en',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(openingTag(await response.text())).toContain(HTML.ur);
  });

  it.each(['de', 'EN', 'en-GB', '', '../ar', 'en ar', '//evil.example.com'])(
    'ignores a stored value %j entirely',
    async (stored) => {
      // A cookie is visitor-controlled input. Nothing reads it now; whatever
      // it holds, it never becomes a path segment or a redirect.
      const response = await request(PAGE.en, {
        'accept-language': 'ur',
        cookie: `NEXT_LOCALE=${stored}`,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(openingTag(await response.text())).toContain(HTML.en);
    },
  );
});

describe('every locale serves its prerendered shell', () => {
  it.each([
    [PAGE.en, 'en', 'ltr'],
    [PAGE.ur, 'ur', 'rtl'],
    [PAGE.ar, 'ar', 'rtl'],
  ])(
    '%s renders 200 with lang=%s and the accepted direction',
    async (path, locale, dir) => {
      const response = await request(path);

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();

      const tag = openingTag(await response.text());

      expect(tag).toContain(`lang="${locale}"`);
      expect(tag).toContain(`dir="${dir}"`);
    },
  );

  it('renders with no cookie and no session of any kind', async () => {
    // ARCHITECTURE.md §8: the public tree must never depend on session state,
    // and must not degrade when there is none. A bare request works fully.
    const response = await request(PAGE.ur);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(HTML.ur);
    expect(html).toContain('<nav');
  });
});

// ===========================================================================
// The legacy `/en` prefix — ONE permanent redirect
// ===========================================================================

describe('a legacy `/en` address answers ONE permanent redirect to its unprefixed address', () => {
  it.each([
    ['/en', '/'],
    ['/en/explore', '/explore'],
    ['/en/explore?x=1', '/explore?x=1'],
    ['/en/quran/surah/2', '/quran/surah/2'],
    ['/en/library?topic=fiqh&topic=tafsir', '/library?topic=fiqh&topic=tafsir'],
    ['/en/search?q=minhaj&page=2', '/search?q=minhaj&page=2'],
    // Percent-encoding is carried, not re-encoded or decoded.
    ['/en/search?q=%D8%A7%D8%B1%D8%AF%D9%88', '/search?q=%D8%A7%D8%B1%D8%AF%D9%88'],
    // A page that does not exist is still one hop — to its own 404.
    ['/en/de', '/de'],
  ])('%s → 301 %s', async (legacy, canonical) => {
    const response = await request(legacy);

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(canonical);
  });

  it('uses 301 exactly — not 302, 307 or 308 — and marks the hop uncacheable and unindexable', async () => {
    // The target no longer varies by visitor, so the redirect is PERMANENT:
    // `/en/…` is a retired address, and search engines transfer its standing
    // to the unprefixed one.
    const response = await request('/en/explore');

    expect(response.status).not.toBe(302);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(308);
    expect(response.status).toBe(301);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('is ONE hop: the target is the page itself, never a further redirect', async () => {
    const first = await request('/en/explore?x=1');
    const target = first.headers.get('location') as string;

    const second = await request(target);

    expect(second.status).toBe(200);
    expect(second.headers.get('location')).toBeNull();
    expect(openingTag(await second.text())).toContain(HTML.en);
  });

  it('answers a legacy search URL by the redirect alone, never by spending search budget', async () => {
    // Search admission runs before the legacy redirect and would answer a
    // throttled `303` to `/search/limited`. A legacy `/en/search?q=…` skips
    // it, so the visitor's ONE hop is the canonical search address.
    const response = await request('/en/search?q=minhaj');

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/search?q=minhaj');
  });

  it('does not redirect the Urdu or Arabic prefix', async () => {
    for (const path of ['/ur/explore?x=1', '/ar/explore?x=1']) {
      const response = await request(path);

      expect(response.status, path).toBe(200);
      expect(response.headers.get('location'), path).toBeNull();
    }
  });

  it('never leaves a visitor on a slashed `/en/` address', async () => {
    // Next normalises the trailing slash and the proxy retires `/en`; however
    // the two are ordered, the chain is short, stays on this site, and ends on
    // the unprefixed home.
    let path = '/en/';
    const seen: string[] = [];

    for (let hop = 0; hop < 3; hop += 1) {
      const response = await request(path);
      if (!isRedirect(response.status)) break;
      const location = response.headers.get('location');
      expectInternal(location);
      path = new URL(location as string, base).pathname;
      seen.push(path);
    }

    expect(seen.length, JSON.stringify(seen)).toBeGreaterThan(0);
    expect(seen.length, JSON.stringify(seen)).toBeLessThanOrEqual(2);
    expect(seen.at(-1)).toBe('/');
  });
});

describe('a trailing slash is normalised to the canonical form', () => {
  it.each([
    ['/explore/', '/explore'],
    ['/ur/explore/', '/ur/explore'],
    ['/ar/explore/', '/ar/explore'],
    ['/ur/', '/ur'],
  ])('%s redirects to %s', async (slashed, canonical) => {
    // ROUTE_MAP.md §2.1 allows one canonical URL per resource; the slashed
    // form redirects to the canonical one rather than serving a duplicate.
    const response = await request(slashed);

    expect([301, 307, 308]).toContain(response.status);
    expect(new URL(response.headers.get('location') as string, base).pathname).toBe(
      canonical,
    );
  });

  it('never leaves a deep unprefixed path slashed', async () => {
    const response = await request('/library/');
    const location = response.headers.get('location') as string;

    expect(location).not.toBeNull();
    expect(new URL(location, base).pathname).toBe('/library');
  });
});

// ===========================================================================
// The authoritative invalid-locale guard
// ===========================================================================

describe('an unsupported locale terminates at 404, never a localised 200', () => {
  it.each([
    '/fr/explore',
    '/de',
    '/de/deep',
    '/zz',
    '/en-GB/explore',
    '/ur/zz',
    '/ar/nonexistent',
    '/ur/fr/explore',
  ])('%s is a terminal 404', async (path) => {
    // An unprefixed path is English, so `/fr/explore` is the English path
    // `fr/explore` — which does not exist. It is never redirected under some
    // locale and never rendered as French.
    const response = await request(path);

    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
  });

  it('never renders unsupported-locale content as a valid localised page', async () => {
    // The guard that matters if the proxy is ever bypassed or its matcher
    // changed: the render tree validates `[locale]` itself, so `/fr` cannot
    // become a page in some unsupported language whatever routing does.
    for (const [path, unsupported] of [
      ['/fr/explore', 'fr'],
      ['/de', 'de'],
      ['/en-GB/explore', 'en-GB'],
    ] as const) {
      const response = await request(path);
      const tag = openingTag(await response.text());

      expect(response.status, path).toBe(404);
      expect(tag, path).not.toContain(`lang="${unsupported}"`);
    }
  });

  it('canonicalises a case variant of a supported locale, never serving it', async () => {
    // `/UR` is NOT an unsupported locale. BCP 47 language tags are
    // case-insensitive (RFC 5646 §2.1.1), so `UR` names the same language as
    // `ur`; it is redirected to the canonical lowercase form rather than
    // serving two URLs for one page (ROUTE_MAP.md §2.1, §10 rule 5).
    const urdu = await request('/UR/explore');

    expect(isRedirect(urdu.status)).toBe(true);
    expect(urdu.headers.get('location')).toBe('/ur/explore');

    // `/EN` is the retired English prefix in another spelling: the security
    // property is that it is never a 200 and that the chain ends — on this
    // site — at the unprefixed address.
    let path = '/EN/explore';
    const seen: string[] = [];
    for (let hop = 0; hop < 3; hop += 1) {
      const response = await request(path);
      if (!isRedirect(response.status)) {
        expect(response.status, path).toBe(200);
        break;
      }
      const location = response.headers.get('location');
      expectInternal(location);
      path = new URL(location as string, base).pathname;
      seen.push(path);
    }

    expect(seen.length, JSON.stringify(seen)).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe('/explore');
  });
});

// ===========================================================================
// Non-locale routes — ROUTE_MAP.md §10 rule 6
// ===========================================================================

describe('the proxy matcher leaves non-locale routes alone', () => {
  it.each([
    ['an API route', '/api/search'],
    ['a health probe', '/api/health'],
    ['a readiness probe', '/api/ready'],
    ['a webhook path', '/api/webhooks/stripe'],
    ['the feed index', '/rss'],
    ['a named feed', '/rss/news'],
    ['robots.txt', '/robots.txt'],
    ['the sitemap index', '/sitemap.xml'],
    ['a partitioned sitemap', '/sitemaps/library-en.xml'],
    ['the favicon', '/favicon.ico'],
  ])('does not redirect %s', async (_label, path) => {
    // What is proven is that they are not REDIRECTED: a locale prefix bolted
    // onto a webhook or a health probe is a silent integration failure.
    const response = await request(path);

    expect(response.headers.get('location')).toBeNull();
    expect(isRedirect(response.status)).toBe(false);
  });

  it('serves the HUMAN-readable sitemap page in each locale', async () => {
    // ROUTE_MAP.md §3.1 lists `/sitemap` as an ordinary public page, while
    // §3.10 lists `/sitemap.xml` as unprefixed. A `sitemap` PREFIX exclusion
    // would have swallowed both.
    for (const [path, html] of [
      ['/sitemap', HTML.en],
      ['/ur/sitemap', HTML.ur],
      ['/ar/sitemap', HTML.ar],
    ] as const) {
      const response = await request(path);

      expect(response.status, path).toBe(200);
      expect(openingTag(await response.text()), path).toContain(html);
    }

    const legacy = await request('/en/sitemap');

    expect(legacy.status).toBe(301);
    expect(legacy.headers.get('location')).toBe('/sitemap');
  });

  it('still routes a path that merely starts like an excluded one', async () => {
    // The exclusions are segment-anchored, not prefix matches: `/apiary` and
    // `/rssfeed` are ordinary application paths. The proxy therefore runs on
    // them: it retires their `/en` form, and it rewrites the unprefixed form
    // into the English tree (Next reports the internal target in
    // `x-middleware-rewrite`), which answers with its own 404. An excluded
    // path is never rewritten.
    for (const path of ['/apiary', '/rssfeed']) {
      const legacy = await request(`/en${path}`);

      expect(legacy.status, path).toBe(301);
      expect(legacy.headers.get('location'), path).toBe(path);

      const response = await request(path);

      expect(response.status, path).toBe(404);
      expect(response.headers.get('location'), path).toBeNull();
      expect(response.headers.get('x-middleware-rewrite'), path).toBe(`/en${path}`);
    }

    for (const path of ['/api/nonexistent', '/rss/x']) {
      expect((await request(path)).headers.get('x-middleware-rewrite'), path).toBeNull();
    }
  });
});

// ===========================================================================
// Security — SECURITY_BASELINE.md §9
// ===========================================================================

describe('nothing a visitor controls can move a redirect off this site', () => {
  it('ignores a forwarded host', async () => {
    const response = await request('/en/explore', {
      'x-forwarded-host': 'evil.example.com',
      'x-forwarded-proto': 'https',
    });

    expect(response.status).toBe(301);
    expectInternal(response.headers.get('location'));
  });

  it('ignores a spoofed Host header', async () => {
    const response = await request('/en', { host: 'evil.example.com' });

    expect(response.status).toBe(301);
    expectInternal(response.headers.get('location'));
  });

  it.each([
    'evil.example.com',
    '//evil.example.com',
    'https://evil.example.com',
    'en, //evil.example.com',
  ])('ignores hostile Accept-Language %j', async (value) => {
    // On an unprefixed page it is not consulted at all; on a legacy address
    // it cannot change the one destination.
    const page = await request(PAGE.en, { 'accept-language': value });

    expect(page.status).toBe(200);
    expect(page.headers.get('location')).toBeNull();

    const legacy = await request('/en', { 'accept-language': value });

    expectInternal(legacy.headers.get('location'));
    expect(legacy.headers.get('location')).toBe('/');
  });

  it('cannot be steered by a query parameter', async () => {
    // A query parameter is data carried along, never a destination. The
    // hostile text survives INSIDE the query — it has to, because dropping
    // query parameters would break every filtered route — and the destination
    // is still this site.
    const response = await request(
      '/en?next=//evil.example.com&returnTo=https://evil.example.com',
    );
    const location = response.headers.get('location') as string;

    expectInternal(location);
    expect(location).toMatch(/^\/\?/);
    expect(new URL(location, base).pathname).toBe('/');
  });

  it.each([
    '/%5Cevil.example.com',
    '/%2F%2Fevil.example.com',
    '/en/%5Cevil.example.com',
    '/en/%5C%5Cevil.example.com',
    '/en/%2F%2Fevil.example.com',
    '/en/%2f%2fevil.example.com',
    '/en//evil.example.com',
    '/en///evil.example.com',
  ])('does not turn %s into a network-path redirect', async (path) => {
    // The legacy redirect builds its target from the request's own path, so
    // this is where a `//host` target could be born. Every hop of whatever
    // chain the path produces must stay on this origin.
    let current = path;
    for (let hop = 0; hop < 4; hop += 1) {
      const response = await request(current);
      if (!isRedirect(response.status)) break;
      const location = response.headers.get('location');
      expectInternal(location);
      expect(location as string, current).not.toMatch(/^\/\//);
      expect(location as string, current).not.toMatch(/^\/\\/);
      const next = new URL(location as string, base);
      current = next.pathname + next.search;
    }
  });

  it('never emits an absolute or off-site redirect target', async () => {
    for (const path of [
      '/en',
      '/en/explore?a=1',
      '/en/de',
      '/UR/explore',
      '/EN',
      '/explore/',
      '/en/sitemap',
    ]) {
      const location = (await request(path)).headers.get('location');

      expectInternal(location);
    }
  });
});

describe('no public GET writes a cookie', () => {
  /**
   * With detection off there is no preference to store, and a public GET that
   * emitted `Set-Cookie` would turn a shared response private. Every public
   * response — page, legacy redirect, slash redirect, 404 — is cookie-free,
   * whatever the visitor sends.
   */
  it.each([
    '/',
    PAGE.en,
    `${PAGE.en}?a=1`,
    PAGE.ur,
    PAGE.ar,
    '/en',
    '/en/explore?x=1',
    '/explore/',
    '/sitemap',
    '/fr/explore',
    '/UR/explore',
  ])('%s sets no cookie', async (path) => {
    for (const [label, headers] of PREFERENCES) {
      const response = await request(path, headers);

      expect(response.headers.get('set-cookie'), `${path} ${label}`).toBeNull();
    }
  });

  it('grants nothing: a forged preference changes nothing at all', async () => {
    // The adversarial case. A visitor can write any cookie they like; the
    // address alone still decides the language.
    const response = await request(PAGE.ur, { cookie: 'NEXT_LOCALE=ar' });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(HTML.ur);
  });
});

// ===========================================================================
// Route-scoped headers follow the unprefixed English address
// ===========================================================================

describe('route-scoped security headers apply to every locale’s address', () => {
  /**
   * `next.config.ts` widens or tightens a header for exact route shapes. Each
   * shape must now match the UNPREFIXED English address and its `/ur` and
   * `/ar` forms — an English page that silently lost its `no-store` or kept a
   * too-wide policy is the regression this catches. Headers from the config
   * apply whatever the page itself answers, so no database is needed.
   */
  it.each(['/donate/return', '/ur/donate/return', '/ar/donate/return'])(
    '%s is never cached and never sends a Referer',
    async (path) => {
      const response = await request(path);

      expect(response.headers.get('referrer-policy'), path).toBe('no-referrer');
      expect(response.headers.get('cache-control'), path).toBe('private, no-store');
    },
  );

  it.each(['/admin/media/videos/x', '/ur/admin/media/videos/x'])(
    '%s may frame only the video providers',
    async (path) => {
      const csp = (await request(path)).headers.get('content-security-policy') ?? '';

      expect(csp, path).toMatch(/frame-src https:\/\//);
      expect(csp, path).not.toContain("frame-src 'none'");
    },
  );

  it.each([PAGE.en, PAGE.ur, '/watch/videos'])('%s frames nothing', async (path) => {
    const csp = (await request(path)).headers.get('content-security-policy') ?? '';

    expect(csp, path).toContain("frame-src 'none'");
  });
});

// ===========================================================================
// The Phase 4 SEO boundary — ROUTE_MAP.md §9.2
// ===========================================================================

describe('locale availability is not advertised as content availability', () => {
  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s declares no alternate language versions',
    async (path) => {
      // Three interface locales exist. That is NOT evidence that the CONTENT
      // of a page exists in three languages, and §9.2 requires every
      // advertised alternate to be a genuine canonical language version.
      //
      // What is prohibited is the DECLARATION — `<link rel="alternate"
      // hreflang>` and `x-default` — which is the authoritative signal.
      const html = await (await request(path)).text();

      expect(html).not.toMatch(/rel="alternate"/);
      expect(html).not.toMatch(/<link[^>]*hreflang/i);
      expect(html).not.toMatch(/x-default/);
    },
  );

  it('uses hreflang only as a link hint on the switcher, never as a declaration', async () => {
    // The switcher puts `hreflang` on each ANCHOR. That is the HTML meaning of
    // the attribute — "the thing at the other end of this link is in that
    // language" — and it is true: the target IS the interface in that
    // language. It is not an alternates declaration, it makes no claim about
    // any OTHER page, and search engines take the `<link rel="alternate">`
    // form as authoritative.
    //
    // The distinction is worth pinning, because "no hreflang anywhere" is the
    // assertion someone would reach for, and it would forbid correct markup
    // while leaving the declaration that actually matters unchecked.
    const html = await (await request(PAGE.en)).text();
    const anchorHints = html.match(/hrefLang="[a-z]{2}"/gi) ?? [];

    expect(anchorHints.length).toBeGreaterThan(0);

    // Every one of them sits inside a switcher, on an anchor. The document
    // carries the switcher twice — the no-JavaScript rendering and the
    // streamed one that knows the query — and both are switchers.
    const switchers = (html.match(/<nav\b[\s\S]*?<\/nav>/g) ?? []).filter(
      (region) =>
        region.includes('English') &&
        region.includes('اردو') &&
        region.includes('العربية'),
    );
    const inSwitchers = switchers.join('').match(/<a\b[^>]*hrefLang=/gi) ?? [];

    expect(switchers.length).toBeGreaterThan(0);
    expect(inSwitchers.length).toBe(anchorHints.length);
  });

  it('emits no `Link` alternates header either', async () => {
    // next-intl sets one by default. Turning it off is the same decision as
    // omitting the markup, and it is invisible in the HTML.
    for (const path of [PAGE.en, PAGE.ur, PAGE.ar, '/', '/en']) {
      const link = (await request(path)).headers.get('link') ?? '';

      expect(link, path).not.toMatch(/alternate/i);
    }
  });

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s stays noindex while nothing is published',
    async (path) => {
      const html = await (await request(path)).text();

      expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\/?>/);
    },
  );

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s declares no canonical URL yet',
    async (path) => {
      const html = await (await request(path)).text();

      expect(html).not.toMatch(/rel="canonical"/);
    },
  );

  it('keeps robots.txt free of the retired English prefix', async () => {
    const robots = await (await request('/robots.txt')).text();

    expect(robots).not.toMatch(/^(?:Dis)?allow:\s*\/en(?:\/|$)/im);
  });
});

// ===========================================================================
// Public caching — ARCHITECTURE.md §8
// ===========================================================================

describe('public pages are rendered per request and never stored by a shared cache', () => {
  /**
   * R1 — the public shell reads a public "presence" snapshot per request
   * (`apps/web/src/composition/presence.ts` calls `connection()`), so every
   * page under `app/[locale]/(public)`, `/explore` included, is DYNAMIC. A
   * dynamic page must say so: a shared cache that stored one rendering would
   * serve it — whatever presence it showed — to everyone behind it.
   */
  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s is marked private and uncacheable',
    async (path) => {
      const cacheControl = (await request(path)).headers.get('cache-control') ?? '';

      expect(cacheControl).toBe(
        'private, no-cache, no-store, max-age=0, must-revalidate',
      );
      expect(cacheControl).not.toMatch(/s-maxage|public/);
    },
  );

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s does not vary by cookie or language',
    async (path) => {
      // Locale is in the URL precisely so it does not have to be in any cache
      // key: a `Vary: Cookie` or `Vary: Accept-Language` would announce that a
      // visitor preference changes the response, which it must not — the
      // address alone decides the language.
      const vary = (await request(path)).headers.get('vary') ?? '';

      expect(vary.toLowerCase()).not.toContain('cookie');
      expect(vary.toLowerCase()).not.toContain('accept-language');
    },
  );
});

// ===========================================================================
// The locale switcher — ROUTE_MAP.md §1.3, WCAG 2.2
// ===========================================================================

describe('the locale switcher is present, accessible and same-origin', () => {
  /**
   * The SWITCHER'S anchors, as raw markup.
   *
   * SCOPED TO THE SWITCHER, and it has to be: the page has a real header, a
   * mega menu and a footer, and a document-wide scrape would be asserting that
   * the entire shell has exactly three links.
   *
   * The switcher's `<nav>` is identified by the endonyms it renders — the three
   * language names, each in its own script — which is the one thing that is
   * true of it and of nothing else on the page, in every locale.
   */
  async function switchersOf(path: string): Promise<string[][]> {
    const html = await (await request(path)).text();

    const switchers = (html.match(/<nav\b[\s\S]*?<\/nav>/g) ?? []).filter(
      (region) =>
        region.includes('English') &&
        region.includes('اردو') &&
        region.includes('العربية'),
    );

    // Not `?? []`: an empty list would make every assertion below pass
    // vacuously on a page that had lost its switcher entirely.
    if (switchers.length === 0) {
      throw new Error(`No locale switcher found on ${path}.`);
    }

    return switchers.map((switcher) => switcher.match(/<a\b[^>]*>[^<]*<\/a>/g) ?? []);
  }

  /**
   * The switcher a visitor WITHOUT JavaScript uses: the first one in the
   * document, rendered before the query is read (the Suspense fallback).
   */
  async function anchorsOf(path: string): Promise<string[]> {
    return (await switchersOf(path))[0] as string[];
  }

  const hrefOf = (anchor: string) =>
    (/href="([^"]*)"/.exec(anchor)?.[1] ?? '').replaceAll('&amp;', '&');

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s renders one link per supported locale WITHOUT JavaScript, at each canonical address',
    async (path) => {
      // The links are in the server-rendered HTML, not produced by hydration.
      // A language switcher that needs JavaScript is unusable by exactly the
      // visitor most likely to need it. English is linked UNPREFIXED: a
      // switch to English never passes through the `/en` redirect.
      const anchors = await anchorsOf(path);

      expect(anchors.map(hrefOf)).toEqual(['/explore', '/ur/explore', '/ar/explore']);
    },
  );

  it.each([
    [`${PAGE.en}?a=1`, '?a=1'],
    [`${PAGE.ur}?a=1`, '?a=1'],
    [`${PAGE.ar}?x=1&x=2`, '?x=1&x=2'],
    [`${PAGE.en}?q=%D8%A7%D8%B1%D8%AF%D9%88`, '?q=%D8%A7%D8%B1%D8%AF%D9%88'],
  ])('%s keeps the path and the exact query in every locale', async (path, query) => {
    // The page renders per request, so the server streams the switcher that
    // KNOWS the query after its fallback. Each link is the target locale's
    // canonical address with the query unchanged — a repeated key kept, an
    // encoded value not re-encoded — and none is a `/en` hop. The fallback
    // carries no query; nothing else is admitted.
    const switchers = (await switchersOf(path)).map((anchors) => anchors.map(hrefOf));
    const plain = ['/explore', '/ur/explore', '/ar/explore'];
    const withQuery = plain.map((href) => `${href}${query}`);

    expect(switchers).toContainEqual(withQuery);
    for (const hrefs of switchers) {
      expect([plain, withQuery]).toContainEqual(hrefs);
      for (const href of hrefs) expect(href).not.toMatch(/^\/en(?:[/?#]|$)/);
    }

    // And each of those links is a working page in its language, directly.
    for (const [href, html] of [
      [withQuery[0], HTML.en],
      [withQuery[1], HTML.ur],
      [withQuery[2], HTML.ar],
    ] as const) {
      const response = await request(href as string);

      expect(response.status, href).toBe(200);
      expect(response.headers.get('location'), href).toBeNull();
      expect(openingTag(await response.text()), href).toContain(html);
    }
  });

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s labels the control for assistive technology',
    async (path) => {
      const html = await (await request(path)).text();

      expect(html).toMatch(/<nav[^>]*aria-label="[^"]+"/);
    },
  );

  it('translates the control label per locale', async () => {
    const labelOf = async (path: string) => {
      const html = await (await request(path)).text();
      return /<nav[^>]*aria-label="([^"]+)"/.exec(html)?.[1] ?? '';
    };

    const labels = await Promise.all([
      labelOf(PAGE.en),
      labelOf(PAGE.ur),
      labelOf(PAGE.ar),
    ]);

    expect(new Set(labels).size).toBe(3);
    for (const label of labels) expect(label.trim()).not.toBe('');
  });

  it.each([
    [PAGE.en, 'en'],
    [PAGE.ur, 'ur'],
    [PAGE.ar, 'ar'],
  ])('%s marks the active language with state, not colour', async (path, locale) => {
    const anchors = await anchorsOf(path);
    const current = anchors.filter((a) => a.includes('aria-current="page"'));

    expect(current).toHaveLength(1);
    expect(hrefOf(current[0] as string)).toBe(path);
    expect(current[0]).toContain(`lang="${locale}"`);
    // Weight and underline, both visible without perceiving colour.
    expect(current[0]).toMatch(/font-semibold/);
    expect(current[0]).toMatch(/underline/);
  });

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s gives every language label its own lang and dir',
    async (path) => {
      // The mixed-direction case: اردو inside an English document, `English`
      // inside an Arabic one (ARCHITECTURE.md §9).
      const anchors = (await anchorsOf(path)).join(' ');

      expect(anchors).toMatch(/lang="en"[^>]*dir="ltr"/);
      expect(anchors).toMatch(/lang="ur"[^>]*dir="rtl"/);
      expect(anchors).toMatch(/lang="ar"[^>]*dir="rtl"/);
    },
  );

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s writes each language name in its own script',
    async (path) => {
      const anchors = (await anchorsOf(path)).join(' ');

      expect(anchors).toContain('English');
      expect(anchors).toContain('اردو');
      expect(anchors).toContain('العربية');
    },
  );

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s uses text links, never an icon alone',
    async (path) => {
      for (const anchor of await anchorsOf(path)) {
        const text = anchor.replace(/<[^>]*>/g, '').trim();

        expect(text.length).toBeGreaterThan(0);
      }
    },
  );

  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s emits no off-site or absolute link',
    async (path) => {
      // Same-origin by construction: the builder takes a pathname, so no
      // request value can become a host. Asserted on the output as well.
      for (const anchor of await anchorsOf(path)) {
        const href = hrefOf(anchor);

        expect(href, anchor).toMatch(/^\//);
        expect(href, anchor).not.toMatch(/^\/\//);
        expect(href, anchor).not.toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:/);
      }
    },
  );

  it('follows a switch link to a working page in the chosen language', async () => {
    // End to end, in both directions: read the Urdu link off the English
    // page and the English link off the Arabic page, request each, and confirm
    // it serves that language directly — no redirect. A link that is merely
    // well-formed is not proof that it goes anywhere.
    for (const [from, target, html] of [
      [PAGE.en, 'ur', HTML.ur],
      [PAGE.ar, 'en', HTML.en],
    ] as const) {
      const anchors = await anchorsOf(from);
      const href = hrefOf(anchors.find((a) => a.includes(`lang="${target}"`)) ?? '');

      expect(href).toBe(PAGE[target]);

      const response = await request(href);

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toContain(html);
    }
  });
});

describe('no message catalogue is shipped to the browser', () => {
  it.each([PAGE.en, PAGE.ur, PAGE.ar])(
    '%s serialises the locale only, not the messages',
    async (path) => {
      // The client boundary exists for the switcher, which needs one string —
      // handed over as a prop. Serialising every message for it would put the
      // whole catalogue in the payload of every page.
      const html = await (await request(path)).text();

      expect(html).not.toContain('phaseLabel');
      expect(html).not.toContain('localeSwitcher');
      expect(html).not.toContain('"messages"');
    },
  );

  it('does not leak another locale’s catalogue into a page', async () => {
    const html = await (await request(PAGE.en)).text();

    // Urdu and Arabic prose from the other catalogues must be absent entirely;
    // only the endonyms, which are locale PROPERTIES rather than messages,
    // legitimately appear.
    expect(html).not.toContain('لوکلائزیشن');
    expect(html).not.toContain('أساس التوطين');
  });
});
