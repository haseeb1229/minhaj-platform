import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';
import type {
  ArticleDetail,
  WorkflowAction,
} from '../../packages/contracts/src/editorial/index.ts';
import type { CentreDetail } from '../../packages/contracts/src/global/index.ts';
import { createEditorialService } from '../../apps/web/src/contexts/editorial/index.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';
import {
  createCentreReferences,
  createGlobalReadService,
  createGlobalService,
  globalFailure,
} from '../../apps/web/src/contexts/global-network/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';

/**
 * Phase 16 — the Global Network over a REAL SQL Server, through the real Global
 * service, adapter and public reader, and centre-scoped News through the real
 * Editorial workflow.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that a parent from another Country is
 * refused whoever writes; that a stale save, a stale contact change and a stale
 * served-City change conflict inside the writing transaction; that a Region or
 * City never leaves its Country; that moving a City between Regions moves its
 * Centres with it; that every public read withholds a record beneath a withheld
 * ancestor; that a City finder includes served Centres exactly once; that a
 * former slug resolves in ONE step and is never reused; and that a Centre on a
 * NewsArticle revision rides the ordinary review workflow and never cascades.
 *
 * EVERYTHING IS SYNTHETIC — names say they are fixtures, contacts are
 * `.invalid`, and every Country code is an ISO user-assigned one.
 */

const live = databaseConfigured ? describe : describe.skip;

let sequence = 0;
const unique = (prefix: string) => {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${randomUUID().slice(0, 8)}`;
};

/**
 * ISO 3166-1 USER-ASSIGNED codes only — `QM`–`QZ` and `XA`–`XZ` — so no real
 * Country is ever named. Forty, each used once in this disposable database.
 */
const CODES = [
  ...'MNOPQRSTUVWXYZ'.split('').map((letter) => `Q${letter}`),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `X${letter}`),
];
let codeIndex = 0;
const code = () => {
  const next = CODES[codeIndex];
  codeIndex += 1;
  if (next === undefined)
    throw new Error('The synthetic Country code pool is exhausted.');
  return next;
};

const document = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Synthetic centre news.' }] },
  ],
});

function news(centreId: string | null, slug = unique('centre-news')) {
  return {
    slug,
    primaryLanguage: 'en',
    translations: [
      {
        languageCode: 'en',
        title: 'Synthetic centre news proof',
        excerpt: 'Non-authoritative test fixture',
        seoTitle: '',
        seoDescription: '',
        document,
      },
    ],
    topicIds: [] as string[],
    contributors: [] as { personId: string; role: string }[],
    centreId,
  };
}

live('Phase 16 Global Network against real SQL Server', () => {
  let db: DisposableDatabase;
  let service: ReturnType<typeof createGlobalService>;
  let reads: ReturnType<typeof createGlobalReadService>;
  let editorial: ReturnType<typeof createEditorialService>;
  let newsReads: ReturnType<typeof createEditorialReadService>;
  let administrator: { accountId: string };
  let readerOnly: { accountId: string };
  let editor: { accountId: string };
  let outsider: { accountId: string };
  let author: string, reviewer: string, publisher: string;

  async function account(keys: readonly string[]): Promise<string> {
    const id = await createProofAccount(db.admin);
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic global role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
    );
    for (const key of keys)
      await db.admin.query(
        `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
      );
    return id;
  }

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return globalFailure(error);
    }
    return 'accepted';
  };

  const names = (name: string) => [{ locale: 'en' as const, name }];

  const country = (overrides: Record<string, unknown> = {}) =>
    service.saveCountry(administrator, null, null, {
      code: code(),
      slug: unique('country'),
      primaryLocale: 'en',
      state: 'published',
      labels: names('Synthetic Country'),
      ...overrides,
    });
  const region = (countryId: string, overrides: Record<string, unknown> = {}) =>
    service.saveRegion(administrator, null, null, {
      countryId,
      slug: unique('region'),
      primaryLocale: 'en',
      state: 'published',
      labels: names('Synthetic Region'),
      ...overrides,
    });
  const city = (
    countryId: string,
    regionId: string | null,
    overrides: Record<string, unknown> = {},
  ) =>
    service.saveCity(administrator, null, null, {
      countryId,
      regionId,
      slug: unique('city'),
      primaryLocale: 'en',
      state: 'published',
      labels: names('Synthetic City'),
      ...overrides,
    });
  const centreInput = (countryId: string, overrides: Record<string, unknown> = {}) => ({
    countryId,
    regionId: null,
    cityId: null,
    isVirtual: false,
    coordinates: null,
    slug: unique('centre'),
    primaryLocale: 'en',
    state: 'published',
    labels: [
      {
        locale: 'en',
        name: 'Synthetic Centre',
        description: null,
        address: '1 Synthetic Street',
      },
    ],
    ...overrides,
  });
  const centre = (countryId: string, overrides: Record<string, unknown> = {}) =>
    service.saveCentre(administrator, null, null, centreInput(countryId, overrides));

  const transition = (row: ArticleDetail, action: WorkflowAction, actor: string) =>
    editorial.transition({ accountId: actor }, 'news-article', {
      id: row.id,
      expectedVersion: row.version,
      action,
      scheduledAt: null,
      timezone: null,
    });
  const publishedNews = async (centreId: string | null) => {
    const created = await editorial.create(
      { accountId: author },
      'news-article',
      news(centreId),
    );
    const submitted = await transition(created, 'submit', author);
    const approved = await transition(submitted, 'approve', reviewer);
    return transition(approved, 'publish', publisher);
  };

  beforeAll(async () => {
    db = await createProofDatabase();
    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    const authority = {
      permits: (id: string, key: string) => authorization.hasPermission(id, key),
    };
    service = createGlobalService({
      persistence: database.createGlobalPersistence(),
      authority,
    });
    reads = createGlobalReadService(database.createGlobalPublicReader());
    const centres = createCentreReferences(database.createGlobalReferences());
    editorial = createEditorialService({
      persistence: database.createEditorialPersistence(),
      authority,
      reportFailure: () => undefined,
      references: {
        validTopics: async () => true,
        validContributors: async () => true,
        validLanguages: async (codes) => codes.every((value) => value === 'en'),
        selectableCentre: (id) => centres.centreSelectable(id),
        // Only an Event associates a Gallery; this suite writes News alone.
        selectableGallery: async () => false,
        // Nor Collection members; this suite writes News alone.
        selectableMembers: async () => false,
      },
    });
    newsReads = createEditorialReadService(database.createEditorialPublicReader());

    administrator = { accountId: await account(['global.read', 'global.administer']) };
    readerOnly = { accountId: await account(['global.read']) };
    // Full Editorial authority confers no Global authority, and the reverse.
    editor = {
      accountId: await account([
        'content.read',
        'content.author',
        'content.review',
        'content.publish',
      ]),
    };
    outsider = { accountId: await account([]) };
    author = await account(['content.read', 'content.author']);
    reviewer = await account(['content.read', 'content.review']);
    publisher = await account(['content.read', 'content.publish']);
  }, 240000);

  afterAll(async () => {
    await db?.close();
  });

  describe('authority is the two Global keys, live, and nothing else', () => {
    it('lets global.read read but never mutate, and grants nothing to content.* or no role', async () => {
      const created = await country();
      expect((await service.country(readerOnly, created.id))?.id).toBe(created.id);
      expect(
        await refusal(
          service.saveCountry(readerOnly, null, null, {
            code: code(),
            slug: unique('country'),
            primaryLocale: 'en',
            state: 'draft',
            labels: names('Synthetic Country'),
          }),
        ),
      ).toBe('denied');
      for (const actor of [editor, outsider]) {
        expect(await refusal(service.country(actor, created.id))).toBe('denied');
        expect(await refusal(service.countries(actor))).toBe('denied');
      }
      // A Global administrator cannot author News.
      await expect(
        editorial.create(
          { accountId: administrator.accountId },
          'news-article',
          news(null),
        ),
      ).rejects.toMatchObject({ reason: 'denied' });
    });
  });

  describe('flexible geography, refused across Countries by the database', () => {
    it('supports a Country with no Region, a City directly under it, and a City in a Region', async () => {
      const bare = await country();
      const direct = await city(bare.id, null);
      expect(direct.regionId).toBeNull();
      expect(await reads.countryRegions(bare.id)).toEqual([]);

      const regional = await country();
      const area = await region(regional.id);
      const inArea = await city(regional.id, area.id);
      expect(inArea.regionId).toBe(area.id);
    });

    it('refuses a Region, a City or a served City from another Country', async () => {
      const a = await country();
      const b = await country();
      const regionOfB = await region(b.id);
      const cityOfB = await city(b.id, regionOfB.id);
      expect(await refusal(city(a.id, regionOfB.id))).toBe('invalid');
      expect(await refusal(centre(a.id, { cityId: cityOfB.id }))).toBe('invalid');
      expect(await refusal(centre(a.id, { regionId: regionOfB.id }))).toBe('invalid');

      const inA = await centre(a.id);
      expect(
        await refusal(
          service.changeServedCities(administrator, inA.id, inA.version, {
            op: 'add',
            cityId: cityOfB.id,
          }),
        ),
      ).toBe('invalid');
    });

    it('holds a virtual Centre with no City and refuses one with a place', async () => {
      const home = await country();
      const town = await city(home.id, null);
      const online = await centre(home.id, {
        isVirtual: true,
        labels: [
          {
            locale: 'en',
            name: 'Synthetic Online Centre',
            description: null,
            address: null,
          },
        ],
      });
      expect(online.isVirtual).toBe(true);
      expect(online.cityId).toBeNull();
      expect(await refusal(centre(home.id, { isVirtual: true, cityId: town.id }))).toBe(
        'invalid',
      );
    });

    it('keeps a Region and a City in their Country, and moves Centres with a City between Regions', async () => {
      const home = await country();
      const elsewhere = await country();
      const north = await region(home.id);
      const south = await region(home.id);
      const town = await city(home.id, north.id);
      const here = await centre(home.id, { cityId: town.id });

      expect(
        await refusal(
          service.saveRegion(administrator, north.id, north.version, {
            countryId: elsewhere.id,
            slug: north.slug,
            primaryLocale: 'en',
            state: 'published',
            labels: names('Synthetic Region'),
          }),
        ),
      ).toBe('country-fixed');
      expect(
        await refusal(
          service.saveCity(administrator, town.id, town.version, {
            countryId: elsewhere.id,
            regionId: null,
            slug: town.slug,
            primaryLocale: 'en',
            state: 'published',
            labels: names('Synthetic City'),
          }),
        ),
      ).toBe('country-fixed');

      // Re-parenting within the Country is one row: the Centre stores no Region
      // of its own, so it follows its City.
      await service.saveCity(administrator, town.id, town.version, {
        countryId: home.id,
        regionId: south.id,
        slug: town.slug,
        primaryLocale: 'en',
        state: 'published',
        labels: names('Synthetic City'),
      });
      const inSouth = await reads.centresIn(
        { countryId: home.id, regionId: south.id, cityId: null },
        0,
      );
      expect(inSouth.items.map((item) => item.id)).toContain(here.id);
      const inNorth = await reads.centresIn(
        { countryId: home.id, regionId: north.id, cityId: null },
        0,
      );
      expect(inNorth.items.map((item) => item.id)).not.toContain(here.id);
    });

    it('refuses moving a Centre to another Country while it serves Cities', async () => {
      const home = await country();
      const elsewhere = await country();
      const served = await city(home.id, null);
      const here = await centre(home.id);
      const serving = await service.changeServedCities(
        administrator,
        here.id,
        here.version,
        {
          op: 'add',
          cityId: served.id,
        },
      );
      expect(
        await refusal(
          service.saveCentre(
            administrator,
            here.id,
            serving.version,
            centreInput(elsewhere.id, { slug: here.slug }),
          ),
        ),
      ).toBe('served-cities');
    });
  });

  describe('expected versions are the lock', () => {
    it('refuses a stale save, a stale contact change and a stale served-City change', async () => {
      const home = await country();
      const town = await city(home.id, null);
      const here = await centre(home.id);
      const first = await service.saveCentre(
        administrator,
        here.id,
        here.version,
        centreInput(home.id, { slug: here.slug, state: 'draft' }),
      );
      expect(first.version).toBe(here.version + 1);
      expect(
        await refusal(
          service.saveCentre(
            administrator,
            here.id,
            here.version,
            centreInput(home.id, { slug: here.slug }),
          ),
        ),
      ).toBe('conflict');
      expect(
        await refusal(
          service.changeContacts(administrator, here.id, here.version, {
            op: 'add',
            contact: { channel: 'phone', value: '+00 000 0001' },
          }),
        ),
      ).toBe('conflict');
      expect(
        await refusal(
          service.changeServedCities(administrator, here.id, here.version, {
            op: 'add',
            cityId: town.id,
          }),
        ),
      ).toBe('conflict');
    });

    it('lets exactly one of two concurrent saves of one version win', async () => {
      const created = await country();
      const save = (name: string) =>
        refusal(
          service.saveCountry(administrator, created.id, created.version, {
            code: created.code,
            slug: created.slug,
            primaryLocale: 'en',
            state: 'published',
            labels: names(name),
          }),
        );
      const outcomes = await Promise.all([save('Synthetic A'), save('Synthetic B')]);
      expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'conflict')).toHaveLength(1);
    });
  });

  describe('contacts and served Cities', () => {
    it('validates, orders and audits contacts by channel only', async () => {
      const home = await country();
      let here: CentreDetail | null = await service.centre(
        administrator,
        (await centre(home.id)).id,
      );
      if (here === null) throw new Error('Centre missing.');
      for (const contact of [
        { channel: 'phone', value: '+00 000 0002' },
        { channel: 'email', value: 'proof@example.invalid' },
        { channel: 'website', value: 'https://centre.example.invalid/' },
      ])
        here = await service.changeContacts(administrator, here.id, here.version, {
          op: 'add',
          contact,
        });
      expect(here.contacts.map((contact) => contact.channel)).toEqual([
        'phone',
        'email',
        'website',
      ]);
      for (const value of [
        'http://centre.example.invalid/',
        'javascript:alert(1)',
        '//centre.example.invalid/',
        'https://user:secret@centre.example.invalid/',
      ])
        expect(
          await refusal(
            service.changeContacts(administrator, here.id, here.version, {
              op: 'add',
              contact: { channel: 'website', value },
            }),
          ),
        ).toBe('invalid');
      expect(
        await refusal(
          service.changeContacts(administrator, here.id, here.version, {
            op: 'add',
            contact: { channel: 'phone', value: '+00 000 0002' },
          }),
        ),
      ).toBe('duplicate-contact');
      here = await service.changeContacts(administrator, here.id, here.version, {
        op: 'move',
        position: 2,
        direction: 'earlier',
      });
      expect(here.contacts.map((contact) => contact.channel)).toEqual([
        'phone',
        'website',
        'email',
      ]);

      const audits = await db.admin.query<{ action: string; afterState: string | null }>(
        `SELECT [action],[afterState] FROM [AuditLog] WHERE [targetId]=N'${here.id}';`,
      );
      expect(audits.map((row) => row.action)).toContain('global.centre.contacts.changed');
      const payload = audits.map((row) => row.afterState ?? '').join(' ');
      for (const secret of [
        '000 0002',
        'proof@example',
        'centre.example',
        'Synthetic Street',
      ])
        expect(payload).not.toContain(secret);
    });
  });

  describe('the public directory fails closed under a withheld ancestor', () => {
    it('hides drafts, and anything beneath a non-public Country, Region or City', async () => {
      const home = await country();
      const closed = await region(home.id, { state: 'archived' });
      const town = await city(home.id, closed.id);
      const underRegion = await centre(home.id, { regionId: closed.id });
      const underCity = await centre(home.id, { cityId: town.id });
      const draft = await centre(home.id, { state: 'draft' });
      const visible = await centre(home.id);

      for (const hidden of [underRegion, underCity, draft])
        expect(await reads.centre(hidden.slug), hidden.slug).toBeNull();
      expect((await reads.centre(visible.slug))?.id).toBe(visible.id);
      expect(await reads.region(home.slug, closed.slug)).toBeNull();
      expect(await reads.city(home.slug, town.slug)).toBeNull();

      const hiddenCountry = await country({ state: 'draft' });
      const orphan = await centre(hiddenCountry.id);
      expect(await reads.country(hiddenCountry.slug)).toBeNull();
      expect(await reads.centre(orphan.slug)).toBeNull();
      expect(
        (await reads.centreReferences([orphan.id, visible.id])).map((row) => row.id),
      ).toEqual([visible.id]);
      const sitemap = await reads.centreSitemap(0, 1000);
      expect(sitemap.map((row) => row.slug)).toContain(visible.slug);
      for (const hidden of [underRegion, underCity, draft, orphan])
        expect(sitemap.map((row) => row.slug)).not.toContain(hidden.slug);
    });

    it('finds a City’s Centres in it and serving it, once each, and refuses a withheld filter', async () => {
      const home = await country();
      const area = await region(home.id);
      const town = await city(home.id, area.id);
      const hiddenTown = await city(home.id, null, { state: 'draft' });
      const inTown = await centre(home.id, { cityId: town.id });
      // Serves the City it is in as well: still listed once.
      const both = await service.changeServedCities(
        administrator,
        inTown.id,
        inTown.version,
        {
          op: 'add',
          cityId: town.id,
        },
      );
      expect(both.servedCities).toHaveLength(1);
      const online = await centre(home.id, {
        isVirtual: true,
        labels: [
          {
            locale: 'en',
            name: 'Synthetic Online Centre',
            description: null,
            address: null,
          },
        ],
      });
      await service.changeServedCities(administrator, online.id, online.version, {
        op: 'add',
        cityId: town.id,
      });

      const result = await reads.find({ country: home.slug, city: town.slug });
      if (result.status !== 'ok') throw new Error('The finder refused a public City.');
      const ids = result.page.items.map((item) => item.id);
      expect(ids.sort()).toEqual([inTown.id, online.id].sort());

      const byRegion = await reads.find({ country: home.slug, region: area.slug });
      if (byRegion.status !== 'ok')
        throw new Error('The finder refused a public Region.');
      expect(byRegion.page.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([inTown.id, online.id]),
      );

      expect(
        (await reads.find({ country: home.slug, city: hiddenTown.slug })).status,
      ).toBe('invalid');
      expect((await reads.find({ region: area.slug })).status).toBe('invalid');
      expect(
        (await reads.find({ country: home.slug, region: area.slug, city: town.slug }))
          .status,
      ).toBe('invalid');
      const empty = await reads.find({ country: (await country()).slug });
      expect(empty.status === 'ok' && empty.page.items.length === 0).toBe(true);
      expect(empty.status === 'ok' && empty.inventoryEmpty).toBe(false);
    });
  });

  describe('permanent slugs, one hop', () => {
    it('resolves former Country, Region, City and Centre slugs to the current ones together', async () => {
      const home = await country();
      const area = await region(home.id);
      const town = await city(home.id, area.id);
      const here = await centre(home.id, { cityId: town.id });

      const renamedCountry = await service.saveCountry(
        administrator,
        home.id,
        home.version,
        {
          code: home.code,
          slug: unique('country-renamed'),
          primaryLocale: 'en',
          state: 'published',
          labels: names('Synthetic Country'),
        },
      );
      const renamedRegion = await service.saveRegion(
        administrator,
        area.id,
        area.version,
        {
          countryId: home.id,
          slug: unique('region-renamed'),
          primaryLocale: 'en',
          state: 'published',
          labels: names('Synthetic Region'),
        },
      );
      const renamedCity = await service.saveCity(administrator, town.id, town.version, {
        countryId: home.id,
        regionId: area.id,
        slug: unique('city-renamed'),
        primaryLocale: 'en',
        state: 'published',
        labels: names('Synthetic City'),
      });
      const renamedCentre = await service.saveCentre(
        administrator,
        here.id,
        here.version,
        centreInput(home.id, { cityId: town.id, slug: unique('centre-renamed') }),
      );

      expect(await reads.countryCanonicalSlug(home.slug)).toBe(renamedCountry.slug);
      // BOTH former slugs at once resolve to BOTH current ones in one answer.
      expect(await reads.regionCanonical(home.slug, area.slug)).toEqual({
        country: renamedCountry.slug,
        region: renamedRegion.slug,
      });
      expect(await reads.cityCanonical(home.slug, town.slug)).toEqual({
        country: renamedCountry.slug,
        city: renamedCity.slug,
      });
      expect(await reads.centreCanonicalSlug(here.slug)).toBe(renamedCentre.slug);

      // A former slug is never reused by another record of the same scope.
      expect(await refusal(centre(home.id, { slug: here.slug }))).toBe('duplicate-slug');
      expect(await refusal(region(home.id, { slug: area.slug }))).toBe('duplicate-slug');
      // The same Region slug in ANOTHER Country is a different address.
      const other = await country();
      expect((await region(other.id, { slug: area.slug })).slug).toBe(area.slug);

      // A withdrawn record's former slug resolves to nothing.
      await service.saveCentre(
        administrator,
        renamedCentre.id,
        renamedCentre.version,
        centreInput(home.id, {
          cityId: town.id,
          slug: renamedCentre.slug,
          state: 'archived',
        }),
      );
      expect(await reads.centreCanonicalSlug(here.slug)).toBeNull();
    });
  });

  describe('centre-scoped News is the Editorial NewsArticle, under its own workflow', () => {
    it('carries a selectable Centre on the revision and lists the published article on it', async () => {
      const home = await country();
      const here = await centre(home.id);
      const article = await publishedNews(here.id);
      expect(article.revision.centreId).toBe(here.id);
      expect((await newsReads.news('news-article', article.slug))?.centreId).toBe(
        here.id,
      );
      const listed = await newsReads.centreNews(here.id);
      expect(listed.items.map((item) => item.slug)).toEqual([article.slug]);
      // General News names no Centre.
      const general = await publishedNews(null);
      expect((await newsReads.news('news-article', general.slug))?.centreId).toBeNull();
    });

    it('refuses an archived or absent Centre, and a Centre on any other News family', async () => {
      const home = await country();
      const closed = await centre(home.id, { state: 'archived' });
      for (const centreId of [closed.id, randomUUID()])
        await expect(
          editorial.create({ accountId: author }, 'news-article', news(centreId)),
        ).rejects.toMatchObject({ reason: 'invalid' });
      const open = await centre(home.id);
      await expect(
        editorial.create({ accountId: author }, 'press-release', news(open.id)),
      ).rejects.toMatchObject({ reason: 'invalid' });
    });

    it('treats changing the Centre as an edit: back to draft, approval cleared, audited', async () => {
      const home = await country();
      const first = await centre(home.id);
      const second = await centre(home.id);
      const article = await publishedNews(first.id);
      const revised = await editorial.revise(
        { accountId: author },
        'news-article',
        article.id,
        article.version,
        news(second.id, article.slug),
      );
      expect(revised.state).toBe('draft');
      expect(revised.approvedRevision).toBeNull();
      expect(revised.revision.centreId).toBe(second.id);
      // Withdrawn from both Centres until it is reviewed and published again.
      expect((await newsReads.centreNews(first.id)).items).toEqual([]);
      expect((await newsReads.centreNews(second.id)).items).toEqual([]);
      const [audit] = await db.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM [AuditLog] WHERE [targetId]=N'${article.id}' AND [action]=N'editorial.news-article.centre-changed';`,
      );
      expect(Number(audit?.total)).toBe(1);
      // A stale revise is refused, Centre or not.
      await expect(
        editorial.revise(
          { accountId: author },
          'news-article',
          article.id,
          article.version,
          news(first.id, article.slug),
        ),
      ).rejects.toMatchObject({ reason: 'conflict' });
    });

    it('archiving a Centre touches no News: the article stays public and its Centre degrades', async () => {
      const home = await country();
      const here = await centre(home.id);
      const article = await publishedNews(here.id);
      const current = await service.centre(administrator, here.id);
      if (current === null) throw new Error('Centre missing.');
      await service.saveCentre(
        administrator,
        here.id,
        current.version,
        centreInput(home.id, { slug: here.slug, state: 'archived' }),
      );
      const still = await newsReads.news('news-article', article.slug);
      expect(still?.centreId).toBe(here.id);
      expect(await reads.centreReferences([here.id])).toEqual([]);
      const [row] = await db.admin.query<{ state: string }>(
        `SELECT [state] FROM [NewsArticle] WHERE [id]=N'${article.id}';`,
      );
      expect(row?.state).toBe('published');

      // Re-saving the article KEEPS its now-archived Centre truthfully; choosing
      // it anew would be refused.
      const kept = await editorial.revise(
        { accountId: author },
        'news-article',
        article.id,
        article.version,
        news(here.id, article.slug),
      );
      expect(kept.revision.centreId).toBe(here.id);
    });
  });

  describe('Phase 14 — where a Centre physically is, for the Event filters', () => {
    it('resolves a Country or a City to the public Centres PHYSICALLY in it, never those serving it', async () => {
      const home = await country();
      const town = await city(home.id, null);
      const elsewhere = await city(home.id, null);
      const closedRegion = await region(home.id, { state: 'archived' });
      const inTown = await centre(home.id, { cityId: town.id });
      const noCity = await centre(home.id);
      const servingOnly = await centre(home.id, { cityId: elsewhere.id });
      await service.changeServedCities(
        administrator,
        servingOnly.id,
        servingOnly.version,
        {
          op: 'add',
          cityId: town.id,
        },
      );
      const online = await centre(home.id, {
        isVirtual: true,
        labels: [
          {
            locale: 'en',
            name: 'Synthetic Online Centre',
            description: null,
            address: null,
          },
        ],
      });
      await service.changeServedCities(administrator, online.id, online.version, {
        op: 'add',
        cityId: town.id,
      });
      const draft = await centre(home.id, { cityId: town.id, state: 'draft' });
      const withheld = await centre(home.id, { regionId: closedRegion.id });

      const inCountry = await reads.physicalCentreIds(
        { countryId: home.id, cityId: null },
        10,
      );
      expect([...(inCountry ?? [])].sort()).toEqual(
        [inTown.id, noCity.id, servingOnly.id].sort(),
      );
      // A City: only the Centre IN it — not the one serving it from another
      // City, not the virtual one serving it, and never a withheld one.
      expect(
        await reads.physicalCentreIds({ countryId: home.id, cityId: town.id }, 10),
      ).toEqual([inTown.id]);
      for (const absent of [online.id, draft.id, withheld.id])
        expect(inCountry).not.toContain(absent);
      // A City of ANOTHER Country names nothing in this one.
      const other = await country();
      expect(
        await reads.physicalCentreIds({ countryId: other.id, cityId: town.id }, 10),
      ).toEqual([]);
    });

    it('signals overflow with limit + 1 so the caller refuses rather than truncates', async () => {
      const database = await import('../../packages/database/src/index.ts');
      const reader = database.createGlobalPublicReader();
      const home = await country();
      const made = [await centre(home.id), await centre(home.id), await centre(home.id)];
      const scope = { countryId: home.id, cityId: null };
      // The adapter answers one more than asked for…
      const raw = await reader.physicalCentreIds(scope, 2);
      expect(raw).toHaveLength(3);
      expect([...raw].sort()).toEqual(made.map((row) => row.id).sort());
      // …and the read service turns that into a refusal, never a subset.
      expect(await reads.physicalCentreIds(scope, 2)).toBeNull();
      expect(await reads.physicalCentreIds(scope, 3)).toHaveLength(3);
      await expect(reads.physicalCentreIds(scope, 0)).rejects.toThrow();
      await expect(reads.physicalCentreIds(scope, 5001)).rejects.toThrow();
      await expect(
        reads.physicalCentreIds({ countryId: 'not-an-id', cityId: null }, 2),
      ).rejects.toThrow();
    });

    it('summarises only public Centres, with where they are', async () => {
      const home = await country();
      const area = await region(home.id);
      const town = await city(home.id, area.id);
      const here = await centre(home.id, { cityId: town.id });
      const draft = await centre(home.id, { state: 'draft' });
      const summaries = await reads.centreSummaries([here.id, draft.id, randomUUID()]);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: here.id,
        slug: here.slug,
        isVirtual: false,
        country: { id: home.id },
        region: { id: area.id },
        city: { id: town.id },
      });
      expect(summaries[0]?.labels[0]?.address).toBe('1 Synthetic Street');
      expect(await reads.centreSummaries([])).toEqual([]);
    });

    it('resolves a geography filter to identifiers, or to nothing when it names nothing public', async () => {
      const home = await country();
      const town = await city(home.id, null);
      const hiddenTown = await city(home.id, null, { state: 'draft' });
      expect(await reads.scope({ country: home.slug, city: town.slug })).toEqual({
        countryId: home.id,
        regionId: null,
        cityId: town.id,
      });
      expect(await reads.scope({ country: home.slug, city: hiddenTown.slug })).toBeNull();
      expect(await reads.scope({ city: town.slug })).toBeNull();
      expect(await reads.scope({ country: 'Not A Slug' })).toBeNull();
      expect(await reads.scope({ country: home.slug, extra: 1 })).toBeNull();
    });
  });
});
