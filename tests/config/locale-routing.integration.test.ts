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
 * behaviour a visitor gets. The redirect status, the `Location`, the cookie
 * attributes and the terminal outcome of a bad locale are all observable only
 * here.
 *
 * No browser and no Playwright: every property below is expressible over HTTP,
 * and the one that is not — restoring the query string after hydration — is
 * proven directly on its own function in `tests/config/messages.test.ts`.
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
      const probe = await fetch(`${base}/en`, { redirect: 'manual' });
      const html = await probe.text();

      if (!html.includes('<html lang="en" dir="ltr">')) {
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
// Resolution order — ROUTE_MAP.md §1.1
// ===========================================================================

describe('`/` resolves a locale and redirects with 307', () => {
  it('sends a visitor with no preference to `/en`', async () => {
    const response = await request('/');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/en');
  });

  it('uses 307 exactly — not 301, 302 or 308', async () => {
    // The target varies by visitor. A 301 would let any intermediary cache one
    // visitor's language as the permanent answer for everyone behind it, which
    // is why §1.1 names the status rather than leaving it to the framework.
    const response = await request('/');

    expect(response.status).not.toBe(301);
    expect(response.status).not.toBe(302);
    expect(response.status).not.toBe(308);
    expect(response.status).toBe(307);
  });

  it('honours `Accept-Language: ur`', async () => {
    const response = await request('/', { 'accept-language': 'ur' });

    expect(response.headers.get('location')).toBe('/ur');
  });

  it('honours `Accept-Language: ar`', async () => {
    const response = await request('/', { 'accept-language': 'ar' });

    expect(response.headers.get('location')).toBe('/ar');
  });

  it('matches a regional tag to its supported language', async () => {
    // `ur-PK` is what a real Pakistani browser sends. Treating it as
    // unsupported would send most Urdu speakers to the English site.
    const response = await request('/', { 'accept-language': 'ur-PK,ur;q=0.9' });

    expect(response.headers.get('location')).toBe('/ur');
  });

  it('falls back to `en` when nothing in `Accept-Language` is supported', async () => {
    const response = await request('/', { 'accept-language': 'de,fr;q=0.9,es;q=0.8' });

    expect(response.headers.get('location')).toBe('/en');
  });

  it('lets a STORED preference beat `Accept-Language`', async () => {
    // The ordering that makes the whole contract a contract: someone who chose
    // Arabic keeps Arabic on a browser configured for Urdu.
    const response = await request('/', {
      'accept-language': 'ur',
      cookie: 'NEXT_LOCALE=ar',
    });

    expect(response.headers.get('location')).toBe('/ar');
  });

  it.each(['de', 'EN', 'en-GB', '', '../ar', 'en ar'])(
    'ignores an unsupported stored preference %j rather than routing to it',
    async (stored) => {
      // A cookie is visitor-controlled input. An unsupported value must not
      // become a path segment, and must not suppress the rest of the
      // resolution order either — negotiation continues to `ur` here.
      const response = await request('/', {
        'accept-language': 'ur',
        cookie: `NEXT_LOCALE=${stored}`,
      });

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/ur');
    },
  );
});

// ===========================================================================
// Locale roots and deep paths
// ===========================================================================

describe('every locale root serves', () => {
  it.each([
    ['en', 'ltr'],
    ['ur', 'rtl'],
    ['ar', 'rtl'],
  ])('/%s renders 200 with lang=%s and the accepted direction', async (locale, dir) => {
    const response = await request(`/${locale}`);

    expect(response.status).toBe(200);

    const html = await response.text();
    const openingTag = html.match(/<html[^>]*>/)?.[0] ?? '';

    expect(openingTag).toContain(`lang="${locale}"`);
    expect(openingTag).toContain(`dir="${dir}"`);
  });

  it('renders with no cookie and no session of any kind', async () => {
    // ARCHITECTURE.md §8: the public tree must never depend on session state,
    // and must not degrade when there is none. Phase 3A has no Identity at
    // all, so the meaningful assertion is that a bare request works fully.
    const response = await request('/ur');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<html lang="ur" dir="rtl">');
    expect(html).toContain('<nav');
  });
});

describe('an unprefixed path is redirected with its path and query intact', () => {
  it('preserves a deep path', async () => {
    const response = await request('/library/books/al-minhaj');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/en/library/books/al-minhaj');
  });

  it('preserves the query string', async () => {
    const response = await request('/search?q=minhaj&page=2');

    expect(response.headers.get('location')).toBe('/en/search?q=minhaj&page=2');
  });

  it('preserves a REPEATED query key', async () => {
    const response = await request('/library?topic=fiqh&topic=tafsir');

    expect(response.headers.get('location')).toBe('/en/library?topic=fiqh&topic=tafsir');
  });

  it('preserves a percent-encoded value without re-encoding it', async () => {
    const response = await request('/search?q=%D8%A7%D8%B1%D8%AF%D9%88');

    expect(response.headers.get('location')).toBe(
      '/en/search?q=%D8%A7%D8%B1%D8%AF%D9%88',
    );
  });

  it('carries the resolved locale, not always `en`', async () => {
    const response = await request('/quran/surah/2', { 'accept-language': 'ar' });

    expect(response.headers.get('location')).toBe('/ar/quran/surah/2');
  });

  it('normalises a trailing slash to the canonical form', async () => {
    // ROUTE_MAP.md §2.1 allows one canonical URL per resource, and `/en/` and
    // `/en` would otherwise be two. The routing policy keeps no trailing
    // slash, so the slashed form redirects to the canonical one rather than
    // serving a duplicate.
    const response = await request('/en/');

    expect([301, 307, 308]).toContain(response.status);
    expect(response.headers.get('location')).toBe('/en');
  });

  it('normalises a trailing slash on a deep unprefixed path', async () => {
    const response = await request('/library/');
    const location = response.headers.get('location') as string;

    expect(location).not.toBeNull();
    // Whether the slash or the locale prefix is resolved first, the visitor
    // must not be left on a slashed, locale-less URL.
    expect(new URL(location, base).pathname).not.toMatch(/\/$/);
  });
});

// ===========================================================================
// The authoritative invalid-locale guard
// ===========================================================================

describe('an unsupported locale terminates at 404, never a localised 200', () => {
  it.each(['/de', '/de/deep', '/zz', '/quran'])(
    '%s is redirected under a supported locale rather than served',
    async (path) => {
      const response = await request(path);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`/en${path}`);
    },
  );

  it.each(['/en/de', '/en/de/deep', '/ur/zz', '/ar/nonexistent'])(
    '%s is a terminal 404',
    async (path) => {
      const response = await request(path);

      expect(response.status).toBe(404);
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('never renders unsupported-locale content as a valid localised page', async () => {
    // The guard that matters if the proxy is ever bypassed or its matcher
    // changed: the render tree validates `[locale]` itself, so `/de` cannot
    // become a page in some unsupported language whatever routing does.
    const response = await request('/en/de');
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).not.toContain('lang="de"');
  });

  it('canonicalises a case variant of a supported locale to the supported one', async () => {
    // `/EN` is NOT an unsupported locale. BCP 47 language tags are
    // case-insensitive (RFC 5646 §2.1.1), so `EN` names the same language as
    // `en`; next-intl redirects it to the canonical lowercase form rather than
    // serving two URLs for one page (ROUTE_MAP.md §2.1, §10 rule 5).
    //
    // The security property still holds and is what is asserted: the value
    // that reaches the render tree is a SUPPORTED locale, and the response for
    // the non-canonical spelling is a redirect, never a 200.
    const response = await request('/EN');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/en');
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
  ])('does not add a locale prefix to %s', async (_label, path) => {
    // None of these is IMPLEMENTED yet — they all 404 today. What is proven is
    // that they are not REDIRECTED: a locale prefix bolted onto a webhook or a
    // health probe is a silent integration failure on the day it arrives.
    const response = await request(path);

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).not.toBe(307);
  });

  it('still locale-routes the HUMAN-readable sitemap page', async () => {
    // ROUTE_MAP.md §3.1 lists `/sitemap` as an ordinary public page, while
    // §3.10 lists `/sitemap.xml` as unprefixed. A `sitemap` PREFIX exclusion
    // would have swallowed both.
    const response = await request('/sitemap');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/en/sitemap');
  });

  it('still locale-routes a path that merely starts like an excluded one', async () => {
    // The exclusions are segment-anchored, not prefix matches: `/apiary` and
    // `/rssfeed` are ordinary application paths.
    for (const path of ['/apiary', '/rssfeed']) {
      const response = await request(path);

      expect(response.headers.get('location'), path).toBe(`/en${path}`);
    }
  });
});

// ===========================================================================
// Security — SECURITY_BASELINE.md §9
// ===========================================================================

describe('nothing a visitor controls can move a redirect off this site', () => {
  /**
   * Every redirect target must resolve back to THIS origin.
   *
   * Asserted by resolving the `Location` the way a browser would, rather than
   * by banning a hostile substring. The substring test is the tempting one and
   * it is wrong in both directions: it fails a perfectly safe
   * `/en?next=%2F%2Fevil.example.com`, where the hostile string is an inert
   * query VALUE being carried along, and it would pass any off-site host whose
   * name the test did not happen to enumerate.
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

  it('ignores a forwarded host', async () => {
    const response = await request('/', {
      'x-forwarded-host': 'evil.example.com',
      'x-forwarded-proto': 'https',
    });

    expectInternal(response.headers.get('location'));
  });

  it('ignores a spoofed Host header', async () => {
    const response = await request('/', { host: 'evil.example.com' });

    expectInternal(response.headers.get('location'));
  });

  it.each([
    'evil.example.com',
    '//evil.example.com',
    'https://evil.example.com',
    'en, //evil.example.com',
  ])('ignores hostile Accept-Language %j', async (value) => {
    const response = await request('/', { 'accept-language': value });

    expectInternal(response.headers.get('location'));
    expect(['/en', '/ur', '/ar']).toContain(response.headers.get('location'));
  });

  it('cannot be steered by a query parameter', async () => {
    // A query parameter is data carried along, never a destination. The
    // hostile text survives INSIDE the query — it has to, because dropping
    // query parameters would break every filtered route — and the destination
    // is still this site.
    const response = await request(
      '/?next=//evil.example.com&returnTo=https://evil.example.com',
    );
    const location = response.headers.get('location') as string;

    expectInternal(location);
    expect(location).toMatch(/^\/en\?/);
    expect(new URL(location, base).pathname).toBe('/en');
  });

  it('does not treat a protocol-relative-looking path as a host', async () => {
    for (const path of ['/%5Cevil.example.com', '/%2F%2Fevil.example.com']) {
      const response = await request(path);

      expectInternal(response.headers.get('location'));
    }
  });

  it('never emits an absolute URL as a redirect target', async () => {
    for (const path of ['/', '/de', '/EN', '/deep/path?a=1', '/sitemap']) {
      const location = (await request(path)).headers.get('location');

      expectInternal(location);
    }
  });
});

describe('the locale cookie is a preference and carries no authority', () => {
  /**
   * A response that genuinely stores a preference.
   *
   * Arriving at `/ar` from a browser configured for English is the case the
   * cookie exists for: the visitor's choice differs from what their browser
   * would have negotiated, so it is worth remembering.
   */
  async function localeCookie(): Promise<string> {
    const response = await request('/ar', { 'accept-language': 'en' });
    const cookie = response.headers.get('set-cookie');

    expect(cookie, 'choosing a locale must store the preference').not.toBeNull();

    return cookie as string;
  }

  it('stores the chosen locale', async () => {
    expect(await localeCookie()).toMatch(/^NEXT_LOCALE=ar/);
  });

  it('stores nothing when the preference would merely restate the browser', async () => {
    // A visitor whose browser already asks for Arabic needs no cookie: the
    // negotiation reaches the same answer on every request. Not writing one is
    // the correct amount of state to keep about an anonymous visitor.
    const response = await request('/', { 'accept-language': 'ar' });

    expect(response.headers.get('location')).toBe('/ar');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('is scoped to the whole site', async () => {
    expect(await localeCookie()).toMatch(/;\s*Path=\//i);
  });

  it('is SameSite=Lax, so a cross-site subrequest cannot carry it', async () => {
    expect(await localeCookie()).toMatch(/;\s*SameSite=lax/i);
  });

  it('is Secure in production', async () => {
    // This server runs with NODE_ENV=production, which is what makes the
    // assertion meaningful rather than a restatement of a default.
    expect(await localeCookie()).toMatch(/;\s*Secure/i);
  });

  it('expires, rather than pinning a language forever', async () => {
    const cookie = await localeCookie();
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1] ?? NaN);

    expect(Number.isFinite(maxAge)).toBe(true);
    expect(maxAge).toBeGreaterThan(0);
  });

  it('carries only a locale, and no identity or capability', async () => {
    const cookie = await localeCookie();
    const value = /NEXT_LOCALE=([^;]*)/.exec(cookie)?.[1] ?? '';

    // The whole value is one supported locale. Nothing here is a token, a
    // session, a role or a signature, so there is nothing for the server to
    // trust beyond which language to render.
    expect(['en', 'ur', 'ar']).toContain(value);
  });

  it('grants nothing: a forged value only chooses a language', async () => {
    // The adversarial case. A visitor can write any cookie they like; the
    // strongest thing an unsupported one can do is be ignored, and the
    // strongest thing a supported one can do is select a public page that is
    // already served to everyone.
    const response = await request('/ur', { cookie: 'NEXT_LOCALE=ar' });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html lang="ur" dir="rtl">');
  });
});

// ===========================================================================
// The Phase 4 SEO boundary — ROUTE_MAP.md §9.2
// ===========================================================================

describe('locale availability is not advertised as content availability', () => {
  it.each(['/en', '/ur', '/ar'])(
    '%s declares no alternate language versions',
    async (path) => {
      // Three interface locales now exist. That is NOT evidence that the
      // CONTENT of a page exists in three languages, and §9.2 requires every
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
    // next-intl's `Link` puts `hreflang` on the ANCHOR when a link changes
    // language. That is the HTML meaning of the attribute — "the thing at the
    // other end of this link is in that language" — and it is true: the target
    // IS the interface in that language. It is not an alternates declaration,
    // it makes no claim about any OTHER page, and search engines take the
    // `<link rel="alternate">` form as authoritative.
    //
    // The distinction is worth pinning, because "no hreflang anywhere" is the
    // assertion someone would reach for, and it would forbid correct markup
    // while leaving the declaration that actually matters unchecked.
    const html = await (await request('/en')).text();
    const anchorHints = html.match(/hrefLang="[a-z]{2}"/gi) ?? [];

    expect(anchorHints.length).toBeGreaterThan(0);

    // Every one of them sits inside the switcher, on an anchor.
    const nav = /<nav[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';

    expect((nav.match(/hrefLang=/gi) ?? []).length).toBe(anchorHints.length);
  });

  it('emits no `Link` alternates header either', async () => {
    // next-intl sets one by default. Turning it off is the same decision as
    // omitting the markup, and it is invisible in the HTML.
    for (const path of ['/en', '/ur', '/ar', '/']) {
      const link = (await request(path)).headers.get('link') ?? '';

      expect(link, path).not.toMatch(/alternate/i);
    }
  });

  it.each(['/en', '/ur', '/ar'])(
    '%s stays noindex while nothing is published',
    async (path) => {
      const html = await (await request(path)).text();

      expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\/?>/);
    },
  );

  it.each(['/en', '/ur', '/ar'])('%s declares no canonical URL yet', async (path) => {
    const html = await (await request(path)).text();

    expect(html).not.toMatch(/rel="canonical"/);
  });
});

// ===========================================================================
// Public caching — ARCHITECTURE.md §8
// ===========================================================================

describe('locale routes stay publicly cacheable', () => {
  it.each(['/en', '/ur', '/ar'])(
    '%s is served as prerendered static content',
    async (path) => {
      const response = await request(path);

      // A prerendered route is served with a shared-cache directive. A dynamic
      // one would be `private, no-store`, which is the regression this catches.
      expect(response.headers.get('cache-control')).toMatch(/s-maxage/);
    },
  );

  it.each(['/en', '/ur', '/ar'])(
    '%s does not vary by cookie or language',
    async (path) => {
      // A `Vary: Cookie` or `Vary: Accept-Language` on a public page fragments
      // the shared cache per visitor. Locale is in the URL precisely so it does
      // not have to be in the cache key.
      const vary = (await request(path)).headers.get('vary') ?? '';

      expect(vary.toLowerCase()).not.toContain('cookie');
      expect(vary.toLowerCase()).not.toContain('accept-language');
    },
  );

  it('serves the same cached document whatever the query string', async () => {
    const [plain, withQuery] = await Promise.all([
      (await request('/en')).text(),
      (await request('/en?page=2')).text(),
    ]);

    expect(withQuery).toBe(plain);
  });
});

// ===========================================================================
// The locale switcher — ROUTE_MAP.md §1.3, WCAG 2.2
// ===========================================================================

describe('the locale switcher is present, accessible and same-origin', () => {
  /** The switcher's anchors, as raw markup. */
  async function anchorsOf(path: string): Promise<string[]> {
    const html = await (await request(path)).text();

    return html.match(/<a\b[^>]*>[^<]*<\/a>/g) ?? [];
  }

  it.each(['/en', '/ur', '/ar'])(
    '%s renders one link per supported locale WITHOUT JavaScript',
    async (path) => {
      // The links are in the prerendered HTML, not produced by hydration. A
      // language switcher that needs JavaScript is unusable by exactly the
      // visitor most likely to need it.
      const anchors = await anchorsOf(path);

      expect(anchors).toHaveLength(3);
      expect(anchors.join(' ')).toContain('href="/en"');
      expect(anchors.join(' ')).toContain('href="/ur"');
      expect(anchors.join(' ')).toContain('href="/ar"');
    },
  );

  it.each(['/en', '/ur', '/ar'])(
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

    const labels = await Promise.all([labelOf('/en'), labelOf('/ur'), labelOf('/ar')]);

    expect(new Set(labels).size).toBe(3);
    for (const label of labels) expect(label.trim()).not.toBe('');
  });

  it.each([
    ['/en', 'en'],
    ['/ur', 'ur'],
    ['/ar', 'ar'],
  ])('%s marks the active language with state, not colour', async (path, locale) => {
    const anchors = await anchorsOf(path);
    const current = anchors.filter((a) => a.includes('aria-current="page"'));

    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="/${locale}"`);
    // Weight and underline, both visible without perceiving colour.
    expect(current[0]).toMatch(/font-semibold/);
    expect(current[0]).toMatch(/underline/);
  });

  it.each(['/en', '/ur', '/ar'])(
    '%s gives every language label its own lang and dir',
    async (path) => {
      // The mixed-direction case Phase 3A genuinely has: اردو inside an
      // English document, `English` inside an Arabic one (ARCHITECTURE.md §9).
      const anchors = (await anchorsOf(path)).join(' ');

      expect(anchors).toMatch(/lang="en"[^>]*dir="ltr"/);
      expect(anchors).toMatch(/lang="ur"[^>]*dir="rtl"/);
      expect(anchors).toMatch(/lang="ar"[^>]*dir="rtl"/);
    },
  );

  it.each(['/en', '/ur', '/ar'])(
    '%s writes each language name in its own script',
    async (path) => {
      const anchors = (await anchorsOf(path)).join(' ');

      expect(anchors).toContain('English');
      expect(anchors).toContain('اردو');
      expect(anchors).toContain('العربية');
    },
  );

  it.each(['/en', '/ur', '/ar'])(
    '%s uses text links, never an icon alone',
    async (path) => {
      for (const anchor of await anchorsOf(path)) {
        const text = anchor.replace(/<[^>]*>/g, '').trim();

        expect(text.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(['/en', '/ur', '/ar'])(
    '%s emits no off-site or absolute link',
    async (path) => {
      // Same-origin by construction: the helpers take a pathname, so no request
      // value can become a host. Asserted on the output as well as by design.
      for (const anchor of await anchorsOf(path)) {
        const href = /href="([^"]*)"/.exec(anchor)?.[1] ?? '';

        expect(href, anchor).toMatch(/^\//);
        expect(href, anchor).not.toMatch(/^\/\//);
        expect(href, anchor).not.toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:/);
      }
    },
  );

  it('follows a switch link to a working page in the chosen language', async () => {
    // End to end: read the Urdu link off the English page, request it, and
    // confirm it serves Urdu. A link that is merely well-formed is not proof
    // that it goes anywhere.
    const anchors = await anchorsOf('/en');
    const urdu = anchors.find((a) => a.includes('lang="ur"')) ?? '';
    const href = /href="([^"]*)"/.exec(urdu)?.[1] ?? '';

    expect(href).toBe('/ur');

    const response = await request(href);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html lang="ur" dir="rtl">');
  });
});

describe('no message catalogue is shipped to the browser', () => {
  it.each(['/en', '/ur', '/ar'])(
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
    const html = await (await request('/en')).text();

    // Urdu and Arabic prose from the other catalogues must be absent entirely;
    // only the endonyms, which are locale PROPERTIES rather than messages,
    // legitimately appear.
    expect(html).not.toContain('لوکلائزیشن');
    expect(html).not.toContain('أساس التوطين');
  });
});
