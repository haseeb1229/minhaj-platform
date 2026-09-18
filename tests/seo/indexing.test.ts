import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireRoute } from '../../apps/web/src/shell/registry.ts';

/**
 * PHASE 4 — the indexing posture, the canonical URL system, `robots.txt` and
 * the sitemap index.
 *
 * TWO CONFIGURATIONS ARE EXERCISED, and both matter.
 *
 * The one this deployment actually runs in is NON-INDEXABLE: a
 * developer-controlled pre-adoption origin must not compete with, or appear to
 * impersonate, the official organisation site (ROUTE_MAP.md §9.5,
 * PRODUCT_SCOPE.md). Most of the assertions below are about what is NOT
 * emitted in that state, because "nothing is emitted" is the claim, and a
 * missing negative test is how a `Sitemap:` line or a stray canonical survives
 * unnoticed.
 *
 * The other is a SYNTHETIC INDEXABLE configuration. The helpers have to be
 * proved correct before the launch transition that switches them on, not
 * afterwards — but exercising them here activates nothing: the environment
 * lives inside this process, and the deployed posture is whatever its own
 * environment says.
 *
 * EVERY MODULE IS RE-IMPORTED PER CASE. The environment is parsed once and
 * cached, exactly as it is in a running process, so a test that merely reset a
 * variable would read a value another test had already frozen.
 */

const ORIGIN = 'https://shell.proof.invalid';

/** The environment a case runs under, applied before the modules load. */
async function withIndexing(enabled: boolean) {
  vi.resetModules();

  process.env['AUTH_BASE_URL'] = ORIGIN;
  process.env['PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';
  process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';

  const [metadata, sitemap, robots] = await Promise.all([
    import('../../apps/web/src/seo/metadata.ts'),
    import('../../apps/web/src/seo/sitemap.ts'),
    import('../../apps/web/src/app/robots.ts'),
  ]);

  return { ...metadata, ...sitemap, robots: robots.default };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

/* ===========================================================================
 * The pre-adoption posture — the one this deployment runs in
 * ========================================================================= */

describe('while public indexing is disabled', () => {
  it('emits noindex, nofollow on a route that would otherwise be eligible', async () => {
    const { shellMetadata } = await withIndexing(false);

    const meta = shellMetadata({
      locale: 'en',
      route: requireRoute('home'),
      description: 'proof',
    });

    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('emits no canonical link and no alternates at all', async () => {
    // A canonical link is a claim that THIS URL is the one to index. A page
    // that must not be indexed has no such claim to make, and a canonical
    // pointing anywhere at all on a pre-adoption origin is exactly what §9.5
    // prohibits.
    const { shellMetadata } = await withIndexing(false);

    for (const key of ['home', 'explore', 'sitemap']) {
      const meta = shellMetadata({ locale: 'ur', route: requireRoute(key) });

      expect(meta.alternates, key).toBeUndefined();
    }
  });

  it('reports no route as indexable', async () => {
    const { isIndexable } = await withIndexing(false);

    expect(isIndexable(requireRoute('home'))).toBe(false);
    expect(isIndexable(requireRoute('explore'))).toBe(false);
  });

  it('disallows the whole site in robots.txt', async () => {
    const { robots } = await withIndexing(false);
    const rules = robots().rules;

    expect(rules).toEqual([{ userAgent: '*', disallow: '/' }]);
  });

  it('advertises no sitemap, and leaks no configuration detail', async () => {
    const { robots } = await withIndexing(false);
    const result = robots();

    expect(result.sitemap).toBeUndefined();

    // Nothing in the emitted document may name the variable that produced it,
    // the environment, or any path worth probing.
    const serialised = JSON.stringify(result);

    expect(serialised).not.toContain('PUBLIC_INDEXING');
    expect(serialised).not.toContain('AUTH_BASE_URL');
    expect(serialised).not.toContain(ORIGIN);
  });

  it('produces no sitemap partitions', async () => {
    const { sitemapPartitions, partitionNamed } = await withIndexing(false);

    expect(sitemapPartitions()).toEqual([]);
    expect(partitionNamed('pages-en.xml')).toBeNull();
  });
});

/* ===========================================================================
 * The synthetic indexable configuration
 * ========================================================================= */

describe('under a synthetic indexable configuration', () => {
  it('emits an absolute, locale-prefixed, lowercase canonical', async () => {
    const { shellMetadata } = await withIndexing(true);

    const meta = shellMetadata({ locale: 'ur', route: requireRoute('explore') });

    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/ur/explore`);
  });

  it('emits reciprocal alternates for the three locales the shell exists in', async () => {
    const { shellMetadata } = await withIndexing(true);

    const languages = shellMetadata({ locale: 'en', route: requireRoute('explore') })
      .alternates?.languages;

    expect(languages).toMatchObject({
      en: `${ORIGIN}/en/explore`,
      ur: `${ORIGIN}/ur/explore`,
      ar: `${ORIGIN}/ar/explore`,
    });
  });

  it('resolves x-default to the English canonical, and lists it as a real alternate', async () => {
    // §9.2.1: `x-default` never points at a URL that is not itself a listed,
    // valid `hreflang` target. Asserting the relationship rather than the
    // literal keeps the test meaningful when a later phase's content has no
    // English version and the resolution changes.
    const { shellMetadata } = await withIndexing(true);

    const languages = shellMetadata({ locale: 'ar', route: requireRoute('home') })
      .alternates?.languages as Record<string, string>;

    expect(languages['x-default']).toBe(languages['en']);
    expect(Object.values(languages)).toContain(languages['x-default']);
  });

  it('still refuses a canonical for a reserved placeholder', async () => {
    // The route exists and answers, but it carries a "not yet published"
    // notice and no body. Indexing it would advertise an empty page, so the
    // deployment being indexable changes nothing for it.
    const { shellMetadata, isIndexable } = await withIndexing(true);

    const route = requireRoute('legal.privacy');
    const meta = shellMetadata({ locale: 'en', route, title: 'Privacy Policy' });

    expect(isIndexable(route)).toBe(false);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('still refuses a canonical for the private account area', async () => {
    const { shellMetadata, isIndexable } = await withIndexing(true);

    const route = requireRoute('my-minhaj');

    expect(isIndexable(route)).toBe(false);
    expect(
      shellMetadata({ locale: 'en', route, title: 'My Minhaj' }).alternates,
    ).toBeUndefined();
  });

  it('partitions the sitemap by segment and locale', async () => {
    const { sitemapPartitions, partitionPath } = await withIndexing(true);
    const partitions = sitemapPartitions();

    expect(partitions.map(partitionPath)).toEqual([
      '/sitemaps/pages-en.xml',
      '/sitemaps/pages-ur.xml',
      '/sitemaps/pages-ar.xml',
    ]);
  });

  it('lists only eligible canonical URLs, and never a placeholder or a private route', async () => {
    const { sitemapPartitions } = await withIndexing(true);

    const urls = sitemapPartitions().flatMap((partition) => partition.urls);

    expect(urls).toContain(`${ORIGIN}/en`);
    expect(urls).toContain(`${ORIGIN}/ar/explore`);
    expect(urls).toContain(`${ORIGIN}/ur/sitemap`);

    for (const url of urls) {
      expect(url.startsWith(ORIGIN), url).toBe(true);
      expect(url).not.toContain('/my');
      expect(url).not.toContain('/admin');
      expect(url).not.toContain('/legal/');
      expect(url).not.toContain('/explore/');
      expect(url).not.toContain('/signin');
      expect(url).not.toContain('?');
    }
  });

  it('emits no lastmod anywhere', async () => {
    // It must reflect genuine content modification and never build or deploy
    // time (§9.4). The shell has no such timestamp, so the element is absent
    // rather than invented.
    const { sitemapPartitions, renderSitemapPartition, renderSitemapIndex } =
      await withIndexing(true);

    const partitions = sitemapPartitions();
    const documents = [
      renderSitemapIndex(partitions),
      ...partitions.map(renderSitemapPartition),
    ];

    for (const document of documents) {
      expect(document).not.toContain('lastmod');
    }
  });

  it('produces well-formed index and partition documents', async () => {
    const { sitemapPartitions, renderSitemapIndex, renderSitemapPartition } =
      await withIndexing(true);

    const partitions = sitemapPartitions();
    const index = renderSitemapIndex(partitions);

    expect(index).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(index).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(index).toContain(`<loc>${ORIGIN}/sitemaps/pages-en.xml</loc>`);

    const first = partitions[0];
    expect(first).toBeDefined();

    const child = renderSitemapPartition(first!);
    expect(child).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(child).toContain(`<loc>${ORIGIN}/en</loc>`);
  });

  it('resolves only partitions that genuinely exist', async () => {
    // The filename is matched against produced partitions rather than parsed,
    // so no request can name a segment into being.
    const { partitionNamed } = await withIndexing(true);

    expect(partitionNamed('pages-en.xml')).not.toBeNull();
    expect(partitionNamed('quran-en.xml')).toBeNull();
    expect(partitionNamed('pages-de.xml')).toBeNull();
    expect(partitionNamed('../../etc/passwd')).toBeNull();
  });

  it('disallows the API and the two authenticated areas, per locale', async () => {
    const { robots } = await withIndexing(true);
    const [rule] = robots().rules as { disallow: string[] }[];

    expect(rule?.disallow).toEqual([
      '/api/',
      '/en/my',
      '/en/admin',
      '/ur/my',
      '/ur/admin',
      '/ar/my',
      '/ar/admin',
    ]);
  });

  it('leaves the authentication routes crawlable so their noindex can be read', async () => {
    // A crawler must be allowed to FETCH a page to see that it says `noindex`.
    // Disallowing `/signin` would leave it indexable by reference while
    // forbidding the fetch that proves it must not be.
    const { robots } = await withIndexing(true);
    const [rule] = robots().rules as { disallow: string[] }[];

    for (const path of rule?.disallow ?? []) {
      expect(path).not.toContain('signin');
      expect(path).not.toContain('signup');
      expect(path).not.toContain('reset-password');
      expect(path).not.toContain('verify-email');
    }
  });

  it('advertises the sitemap index once it has something to advertise', async () => {
    const { robots } = await withIndexing(true);

    expect(robots().sitemap).toBe(`${ORIGIN}/sitemap.xml`);
  });
});

/* ===========================================================================
 * Fail-closed
 * ========================================================================= */

describe('the indexing control fails closed', () => {
  it('treats an unset variable as disabled', async () => {
    vi.resetModules();
    process.env['AUTH_BASE_URL'] = ORIGIN;
    delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];

    const { publicIndexingEnabled } =
      await import('../../apps/web/src/config/indexing.ts');

    expect(publicIndexingEnabled()).toBe(false);
  });

  it('treats any impossible internal build value as disabled', async () => {
    // The source variable is validated by `parsePrerenderEnv` before Next
    // builds. This internal value is artifact data, but it still fails closed
    // if a malformed artifact is evaluated.
    for (const value of ['yes', '1', 'TRUE', 'on']) {
      process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = value;
      vi.resetModules();

      const { publicIndexingEnabled } =
        await import('../../apps/web/src/config/indexing.ts');

      expect(publicIndexingEnabled(), value).toBe(false);
    }
  });

  it('treats a declared-but-empty value as unset, and therefore as disabled', async () => {
    // `.env.example` ships every key valueless, which is how a developer
    // discovers what to set. An empty value is the repository's convention for
    // "not configured" and resolves to the schema default — which for this
    // variable is the safe direction.
    process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = '';
    vi.resetModules();

    const { publicIndexingEnabled } =
      await import('../../apps/web/src/config/indexing.ts');

    expect(publicIndexingEnabled()).toBe(false);
  });
});

/* ===========================================================================
 * The origin
 * ========================================================================= */

describe('the canonical origin', () => {
  it('is the one application origin, with no path, query or fragment', async () => {
    vi.resetModules();
    process.env['AUTH_BASE_URL'] = 'https://example.invalid/app?a=1#b';

    const { applicationOrigin, absoluteUrl } =
      await import('../../apps/web/src/config/origin.ts');

    expect(applicationOrigin()).toBe('https://example.invalid');
    expect(absoluteUrl('/EN/Explore')).toBe('https://example.invalid/en/explore');
  });

  it('hard-codes neither the official origin nor the developer origin', async () => {
    // Neither may appear in reusable code: the first would be an adoption claim
    // the platform has not been granted, the second would pin a developer's
    // host into the product (PRODUCT_SCOPE.md).
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { repoRoot } = await import('../architecture/architecture-harness.ts');

    for (const file of [
      'apps/web/src/config/origin.ts',
      'apps/web/src/seo/metadata.ts',
      'apps/web/src/seo/sitemap.ts',
      'apps/web/src/app/robots.ts',
      'apps/web/src/shell/registry.ts',
    ]) {
      const source = await readFile(path.join(repoRoot, file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

      expect(code, file).not.toContain('minhaj.org');
      expect(code, file).not.toContain('haseebliaqat');
    }
  });
});
