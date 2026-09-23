import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProofDatabase, databaseConfigured } from '../identity/harness.ts';
import type { DisposableDatabase } from '../identity/harness.ts';
import {
  PROOF_ACTOR,
  createPeopleHarness,
  freshSlug,
  type PeopleHarness,
} from './harness.ts';

/**
 * PHASE 5 — the SEO contract for the contributor profile.
 *
 * WHY THIS SUITE NEEDS A DATABASE. Every claim ROUTE_MAP.md §9 makes about a
 * contributor turns on which languages the record GENUINELY exists in, and that
 * is a property of stored rows rather than of a configuration. A unit test over
 * an invented `contentLocales` array would prove the formatter; this proves the
 * thing the formatter is fed.
 *
 * THE INDEXING POSTURE IS SET PER TEST, and set to ENABLED for most of them.
 * The deployed posture is pre-adoption — the whole site is `noindex` and
 * advertises no sitemap (§9.5) — which means the interesting assertions would
 * all be vacuously satisfied by "nothing is emitted". §41 of the phase contract
 * calls this the "synthetic indexable proof": the switch is flipped in-process
 * so the canonical URL, the alternates and the `lastmod` can be checked, and
 * the fail-closed behaviour is asserted separately with it off.
 *
 * `MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED` is what `next.config.ts` substitutes
 * into every server chunk, so setting it here is setting the same value the
 * application reads — not a second switch invented for the test.
 */

const describeLive = databaseConfigured ? describe : describe.skip;

const ORIGIN = 'https://people-seo.proof.invalid';

/**
 * Loads the SEO modules under one indexing posture.
 *
 * DYNAMIC IMPORT WITH A RESET MODULE REGISTRY, because `publicIndexingEnabled()`
 * reads the substituted constant at call time but the composition roots hold a
 * per-process singleton. Re-importing gives each posture its own graph.
 */
async function withIndexing(enabled: boolean) {
  vi.resetModules();

  process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';
  process.env['AUTH_BASE_URL'] = ORIGIN;

  // BOTH SITEMAP MODULES, because the split between them is part of what this
  // suite checks: `sitemap.ts` is build-bound and reaches no database, and
  // `people-sitemap.ts` is the content half that does.
  const metadata = await import('../../apps/web/src/seo/metadata.ts');
  const shell = await import('../../apps/web/src/seo/sitemap.ts');
  const people = await import('../../apps/web/src/seo/people-sitemap.ts');

  return { ...metadata, ...shell, ...people };
}

describeLive('Phase 5 — the contributor profile SEO contract', () => {
  let database: DisposableDatabase;
  let harness: PeopleHarness;

  beforeAll(async () => {
    database = await createProofDatabase();
    harness = await createPeopleHarness();
  }, 240_000);

  afterAll(async () => {
    delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];
    await database?.close();
  });

  /** A published contributor in the given locales, the first being primary. */
  async function publish(
    locales: readonly ('en' | 'ur' | 'ar')[],
  ): Promise<{ slug: string; id: string }> {
    const [primary, ...rest] = locales;
    if (primary === undefined) throw new Error('at least one locale is required');

    const slug = freshSlug('seo');
    const created = await harness.people.createPerson(PROOF_ACTOR, {
      slug,
      primaryLocale: primary,
      name: `Name in ${primary}`,
      biography: null,
    });
    if (!created.ok) throw new Error(`createPerson: ${created.failure}`);

    for (const locale of rest) {
      const added = await harness.people.setTranslation(PROOF_ACTOR, {
        personId: created.person.id,
        locale,
        name: `Name in ${locale}`,
        biography: null,
      });
      if (!added.ok) throw new Error(`setTranslation: ${added.failure}`);
    }

    const published = await harness.people.setStatus(PROOF_ACTOR, {
      personId: created.person.id,
      status: 'published',
    });
    if (!published.ok) throw new Error(`setStatus: ${published.failure}`);

    return { slug, id: created.person.id };
  }

  /** The metadata one contributor's page would emit, in one locale. */
  async function metadataFor(slug: string, locale: 'en' | 'ur' | 'ar', enabled = true) {
    const seo = await withIndexing(enabled);
    const profile = await harness.people.publicProfile({ slug, locale });
    if (profile === null) throw new Error('the contributor is not public');

    return seo.contentMetadata({
      locale,
      contentLocales: profile.contentLocales,
      primaryLocale: profile.primaryLocale,
      pathFor: (target) => `/${target}/people/${slug}`,
      title: profile.label.name,
    });
  }

  /* =====================================================================
   * Canonical and alternates
   * =================================================================== */

  describe('canonical URLs and hreflang alternates', () => {
    it('lists only the languages the contributor genuinely exists in', async () => {
      // ROUTE_MAP.md §9.2: "Untranslated content is never listed as an
      // alternate. Announcing a `ur` alternate that serves English content is a
      // false signal; the alternate is simply omitted."
      const { slug } = await publish(['en', 'ur']);

      const metadata = await metadataFor(slug, 'en');
      const languages = metadata.alternates?.languages ?? {};

      expect(Object.keys(languages).sort()).toEqual(['en', 'ur', 'x-default']);
      expect(languages).not.toHaveProperty('ar');
    });

    it('self-canonicalises when the requested language exists', async () => {
      const { slug } = await publish(['en', 'ur']);

      const metadata = await metadataFor(slug, 'ur');

      expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/ur/people/${slug}`);
    });

    it('canonicalises to the EXISTING language when the requested one does not', async () => {
      // §9.3: "canonical points to the existing-language URL, not the fallback
      // URL". A page serving Urdu because no Arabic version exists must not put
      // its own Arabic address forward as the one to index.
      const { slug } = await publish(['ur']);

      const metadata = await metadataFor(slug, 'ar');

      expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/ur/people/${slug}`);
      expect(Object.keys(metadata.alternates?.languages ?? {}).sort()).toEqual([
        'ur',
        'x-default',
      ]);
    });
  });

  /* =====================================================================
   * x-default — conditional, never assumed
   * =================================================================== */

  describe('x-default is resolved rather than defaulted to English', () => {
    it('points at English when a canonical English version exists', async () => {
      const { slug } = await publish(['ur', 'en']);

      const languages = (await metadataFor(slug, 'ur')).alternates?.languages ?? {};

      expect(languages['x-default']).toBe(`${ORIGIN}/en/people/${slug}`);
    });

    it('points at the ORIGINAL language when there is no English version', async () => {
      // §9.2.1: "No English version, but one or more other languages exist →
      // the canonical URL of the most appropriate existing language — normally
      // the content's original language." This is why `primaryLocale` is stored
      // rather than inferred.
      const { slug } = await publish(['ar', 'ur']);

      const languages = (await metadataFor(slug, 'ur')).alternates?.languages ?? {};

      expect(languages['x-default']).toBe(`${ORIGIN}/ar/people/${slug}`);
      expect(languages['x-default']).not.toBe(`${ORIGIN}/en/people/${slug}`);
    });

    it('never names a language version that does not exist', async () => {
      // "`x-default` never points at a URL that is not itself a listed, valid
      // `hreflang` target." Checked as a property over every locale a page may
      // be read in, rather than for one case.
      const { slug } = await publish(['ur']);

      for (const locale of ['en', 'ur', 'ar'] as const) {
        const languages = (await metadataFor(slug, locale)).alternates?.languages ?? {};
        const fallback = languages['x-default'];

        expect(fallback, `read in ${locale}`).toBeDefined();
        expect(
          Object.entries(languages)
            .filter(([key]) => key !== 'x-default')
            .map(([, url]) => url),
          `read in ${locale}`,
        ).toContain(fallback);
      }
    });
  });

  /* =====================================================================
   * Fail closed
   * =================================================================== */

  describe('the pre-adoption posture fails closed', () => {
    it('emits noindex and NO canonical while indexing is disabled', async () => {
      // §9.5: the pre-adoption origin is entirely `noindex` with no submitted
      // sitemaps. A canonical link is a claim that this URL is the one to index,
      // and a page that must not be indexed has no such claim to make.
      const { slug } = await publish(['en']);

      const metadata = await metadataFor(slug, 'en', false);

      expect(metadata.robots).toEqual({ index: false, follow: false });
      expect(metadata.alternates).toBeUndefined();
    });

    it('produces no contributor sitemap partition while indexing is disabled', async () => {
      await publish(['en']);

      const seo = await withIndexing(false);

      expect(await seo.peopleSitemapPartitions()).toEqual([]);
      expect(await seo.allSitemapPartitions()).toEqual([]);
      expect(await seo.findSitemapPartition('people-en.xml')).toBeNull();
    });

    it('suppresses structured data by the same condition metadata uses', async () => {
      // ONE FUNCTION DECIDES BOTH, so a page cannot say `noindex` while
      // publishing a machine-readable claim about a real person.
      const disabled = await withIndexing(false);
      expect(disabled.isContentIndexable({ contentLocales: ['en'] })).toBe(false);

      const enabled = await withIndexing(true);
      expect(enabled.isContentIndexable({ contentLocales: ['en'] })).toBe(true);
      // And a record with no language version is never indexable, whatever the
      // deployment posture is.
      expect(enabled.isContentIndexable({ contentLocales: [] })).toBe(false);
    });
  });

  /* =====================================================================
   * The sitemap partition
   * =================================================================== */

  describe('the people sitemap partition', () => {
    it('lists a contributor only in the locales they exist in', async () => {
      const { slug } = await publish(['ur']);
      const seo = await withIndexing(true);

      const partitions = await seo.peopleSitemapPartitions();
      const urls = (locale: string) =>
        partitions
          .filter((partition) => partition.locale === locale)
          .flatMap((partition) => partition.urls.map((entry) => entry.loc));

      expect(urls('ur')).toContain(`${ORIGIN}/ur/people/${slug}`);
      expect(urls('en')).not.toContain(`${ORIGIN}/en/people/${slug}`);
      expect(urls('ar')).not.toContain(`${ORIGIN}/ar/people/${slug}`);
    });

    it('carries a genuine lastmod, and moves it when the record changes', async () => {
      // §9.4: "`lastmod` reflects genuine content modification, never build or
      // deploy time." Proved by CHANGING the record and watching the value move
      // — a constant would satisfy "a lastmod exists" and nothing else.
      const { slug, id } = await publish(['en']);

      const before = await lastmodFor(slug);
      expect(before).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 20));
      const translated = await harness.people.setTranslation(PROOF_ACTOR, {
        personId: id,
        locale: 'en',
        name: 'A corrected name',
        biography: null,
      });
      expect(translated.ok).toBe(true);

      const after = await lastmodFor(slug);

      expect(new Date(after ?? 0).getTime()).toBeGreaterThan(
        new Date(before ?? 0).getTime(),
      );
    });

    it('omits draft and archived contributors entirely', async () => {
      const draftSlug = freshSlug('seo-draft');
      const draft = await harness.people.createPerson(PROOF_ACTOR, {
        slug: draftSlug,
        primaryLocale: 'en',
        name: 'Not published',
        biography: null,
      });
      expect(draft.ok).toBe(true);

      const { slug: archivedSlug, id } = await publish(['en']);
      await harness.people.setStatus(PROOF_ACTOR, { personId: id, status: 'archived' });

      const seo = await withIndexing(true);
      const urls = (await seo.peopleSitemapPartitions()).flatMap((partition) =>
        partition.urls.map((entry) => entry.loc),
      );

      expect(urls.some((url) => url.includes(draftSlug))).toBe(false);
      expect(urls.some((url) => url.includes(archivedSlug))).toBe(false);
    });

    it('lists no alias and no redirect source', async () => {
      // §9.4: "Only canonical, indexable URLs appear. Never filtered views,
      // `noindex` pages, authenticated routes or redirect sources."
      await publish(['en', 'ur']);
      const seo = await withIndexing(true);

      const urls = (await seo.peopleSitemapPartitions()).flatMap((partition) =>
        partition.urls.map((entry) => entry.loc),
      );

      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url.startsWith(`${ORIGIN}/`), url).toBe(true);
        expect(url, url).toContain('/people/');
        expect(url, url).not.toContain('/authors/');
        expect(url, url).not.toContain('/library/');
        expect(url, url).not.toContain('/admin');
        expect(url, url).not.toContain('?');
      }
    });

    it('is reachable by the filename the index advertises, and nothing else', async () => {
      await publish(['en']);
      const seo = await withIndexing(true);

      const partitions = await seo.allSitemapPartitions();
      const people = partitions.find((partition) => partition.segment === 'people');
      expect(people).toBeDefined();

      const filename = seo.partitionPath(people!).slice('/sitemaps/'.length);
      expect(await seo.findSitemapPartition(filename)).not.toBeNull();

      // A filename nothing produces is a 404, because the lookup matches
      // against produced partitions rather than parsing a segment out of it.
      expect(await seo.findSitemapPartition('quran-en.xml')).toBeNull();
      expect(await seo.findSitemapPartition('people-de.xml')).toBeNull();
      expect(await seo.findSitemapPartition('../../etc/passwd')).toBeNull();
    });

    it('keeps the BUILD-BOUND shell partitions beside it, unchanged', async () => {
      // Phase 4's `pages` segment is derived from the route registry and must
      // still be produced, still carry no `lastmod`, and still be resolvable
      // without touching a database.
      await publish(['en']);
      const seo = await withIndexing(true);

      const partitions = await seo.allSitemapPartitions();
      const segments = [...new Set(partitions.map((partition) => partition.segment))];

      // Phase 17: the canonical topic hubs are delivered, and the nineteen seeded
      // canonical topics are genuine public pages in every database — so the
      // `topics` segment is present beside these two.
      expect(segments.sort()).toEqual(['pages', 'people', 'topics']);

      const pages = partitions.filter((partition) => partition.segment === 'pages');
      expect(pages.length).toBe(3);
      for (const partition of pages) {
        for (const entry of partition.urls) {
          expect(entry.lastmod, entry.loc).toBeUndefined();
        }
      }
    });

    it('renders lastmod into the document only where one exists', async () => {
      await publish(['en']);
      const seo = await withIndexing(true);

      const partitions = await seo.allSitemapPartitions();
      const people = partitions.find((partition) => partition.segment === 'people');
      const pages = partitions.find((partition) => partition.segment === 'pages');

      expect(seo.renderSitemapPartition(people!)).toContain('<lastmod>');
      expect(seo.renderSitemapPartition(pages!)).not.toContain('<lastmod>');
    });

    it('lists record 5001 and splits a large locale segment numerically', async () => {
      await database.admin.query(`
          BEGIN TRAN;

          ;WITH numbers AS (
            SELECT TOP (5001)
              ROW_NUMBER() OVER (ORDER BY a.[object_id], b.[object_id]) AS n
            FROM sys.all_objects a
            CROSS JOIN sys.all_objects b
          )
          INSERT INTO [dbo].[Person]
            ([id], [slug], [primaryLocale], [status], [createdAt], [updatedAt])
          SELECT
            CONVERT(nvarchar(36), NEWID()),
            CONCAT(N'sitemap-volume-', RIGHT(N'00000' + CONVERT(nvarchar(5), n), 5)),
            N'en',
            N'published',
            SYSUTCDATETIME(),
            SYSUTCDATETIME()
          FROM numbers;

          INSERT INTO [dbo].[PersonTranslation] ([personId], [locale], [name])
          SELECT [id], N'en', CONCAT(N'Volume contributor ', [slug])
          FROM [dbo].[Person]
          WHERE [slug] LIKE N'sitemap-volume-%';

          COMMIT TRAN;
        `);

      const seo = await withIndexing(true);
      const partitions = (await seo.peopleSitemapPartitions()).filter(
        (partition) => partition.locale === 'en',
      );
      const volumeUrls = partitions
        .flatMap((partition) => partition.urls)
        .map((entry) => entry.loc)
        .filter((url) => url.includes('/people/sitemap-volume-'));

      expect(partitions.map(seo.partitionPath)).toContain('/sitemaps/people-en-2.xml');
      expect(partitions.every((partition) => partition.urls.length <= 5_000)).toBe(true);
      expect(volumeUrls).toHaveLength(5_001);
      expect(new Set(volumeUrls).size).toBe(5_001);
      expect(volumeUrls).toContain(`${ORIGIN}/en/people/sitemap-volume-05001`);
    }, 60_000);
  });

  /** The `lastmod` the people partition carries for one contributor. */
  async function lastmodFor(slug: string): Promise<string | undefined> {
    const seo = await withIndexing(true);
    const partitions = await seo.peopleSitemapPartitions();

    for (const partition of partitions) {
      const entry = partition.urls.find((url) => url.loc.endsWith(`/people/${slug}`));
      if (entry !== undefined) return entry.lastmod;
    }

    return undefined;
  }
});
