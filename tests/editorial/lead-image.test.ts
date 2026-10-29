import { describe, expect, it } from 'vitest';

import {
  EDITORIAL_DATED_FAMILIES,
  EDITORIAL_LEAD_FAMILIES,
  editorialContentSchemaFor,
  latestPlausibleDate,
  leadImagePath,
  leadImagePreviewPath,
  type ArticleDetail,
  type EditorialPersistencePort,
  type EditorialReferencesPort,
  type EditorialWrite,
  type EditorialEdit,
} from '../../packages/contracts/src/editorial/index.ts';
import { createEditorialService } from '../../apps/web/src/contexts/editorial/application/editorial-service.ts';
import { createLeadImagePolicy } from '../../apps/web/src/contexts/editorial/application/asset-policy.ts';
import { chronologyUpdate } from '../../packages/database/src/adapters/editorial/workflow.ts';

/**
 * Phase 30-R — Editorial's optional lead image and source chronology: the
 * strict family shapes, the keep-on-omit revision rule, Storage's veto over a
 * new image, the chronology a publication records, and the serving policy.
 * The SQL columns and CHECKs are proved by the database migration proof.
 */

const ASSET = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const OTHER_ASSET = '7a1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const RECORD = '11111111-2222-4333-8444-555555555555';
const ACTOR = { accountId: 'synthetic-author' };
const document = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
const translation = {
  languageCode: 'en' as const,
  title: 'Synthetic title',
  excerpt: '',
  seoTitle: '',
  seoDescription: '',
  document,
};
const base = {
  slug: 'synthetic-record',
  primaryLanguage: 'en' as const,
  translations: [translation],
  topicIds: [],
  contributors: [],
};
const lead = { assetId: ASSET, width: 1200, height: 800, credit: null };

describe('the lead image and source date in each family shape', () => {
  it('admits a lead image, alt text and a source date on the dated families', () => {
    for (const kind of EDITORIAL_DATED_FAMILIES) {
      const parsed = editorialContentSchemaFor(kind).safeParse({
        ...base,
        translations: [{ ...translation, leadAlt: '  A synthetic picture  ' }],
        leadImage: lead,
        sourcePublishedOn: '2014-03-09',
      });
      expect(parsed.success, kind).toBe(true);
      expect(parsed.data?.translations[0]?.leadAlt).toBe('A synthetic picture');
    }
  });

  it('admits a lead image on a Page but refuses a source date there', () => {
    const page = editorialContentSchemaFor('page');
    expect(page.safeParse({ ...base, leadImage: lead }).success).toBe(true);
    expect(page.safeParse({ ...base, sourcePublishedOn: '2014-03-09' }).success).toBe(
      false,
    );
  });

  it.each([
    [
      'statement',
      { ...base, translations: [{ ...translation, issuer: 'Synthetic Authority' }] },
    ],
    [
      'media-coverage',
      {
        ...base,
        coverage: { outlet: 'Synthetic Outlet', sourceUrl: null, sourceDate: null },
      },
    ],
  ] as const)('refuses a lead image, alt text or source date on a %s', (kind, valid) => {
    const schema = editorialContentSchemaFor(kind);
    // The valid record parses; each Phase-30-R field added to it does not.
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, leadImage: lead }).success).toBe(false);
    expect(schema.safeParse({ ...valid, sourcePublishedOn: '2014-03-09' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        ...valid,
        translations: valid.translations.map((entry) => ({ ...entry, leadAlt: 'words' })),
      }).success,
    ).toBe(false);
  });

  it('lists exactly the lead and dated families', () => {
    expect([...EDITORIAL_LEAD_FAMILIES]).toEqual([
      'article',
      'page',
      'news-article',
      'press-release',
    ]);
    expect([...EDITORIAL_DATED_FAMILIES]).toEqual([
      'article',
      'news-article',
      'press-release',
    ]);
  });

  it('bounds the image box, the credit and the asset identifier', () => {
    const article = editorialContentSchemaFor('article');
    for (const leadImage of [
      { ...lead, width: 0 },
      { ...lead, height: 16_385 },
      { ...lead, width: 1.5 },
      { ...lead, assetId: 'https://www.minhaj.org/logo.png' },
      { ...lead, credit: '' },
      { ...lead, credit: 'x'.repeat(201) },
      { ...lead, extra: true },
    ])
      expect(article.safeParse({ ...base, leadImage }).success).toBe(false);
    expect(
      article.safeParse({
        ...base,
        translations: [{ ...translation, leadAlt: 'x'.repeat(301) }],
      }).success,
    ).toBe(false);
  });

  it('refuses a future or impossible source date, and accepts today anywhere', () => {
    const article = editorialContentSchemaFor('article');
    expect(article.safeParse({ ...base, sourcePublishedOn: '2999-01-01' }).success).toBe(
      false,
    );
    expect(article.safeParse({ ...base, sourcePublishedOn: '2014-02-30' }).success).toBe(
      false,
    );
    expect(
      article.safeParse({ ...base, sourcePublishedOn: latestPlausibleDate() }).success,
    ).toBe(true);
    // The furthest-ahead zone is fourteen hours past UTC.
    expect(latestPlausibleDate(new Date('2026-10-29T10:30:00.000Z'))).toBe('2026-10-30');
    expect(latestPlausibleDate(new Date('2026-10-29T09:59:00.000Z'))).toBe('2026-10-29');
  });

  it('addresses a published image and its preview through Editorial’s own routes', () => {
    const image = { family: 'news-article' as const, recordId: RECORD, assetId: ASSET };
    expect(leadImagePath(image)).toBe(
      `/assets/editorial/news-article/${RECORD}/${ASSET}`,
    );
    expect(leadImagePreviewPath(image)).toBe(
      `/assets/editorial/previews/news-article/${RECORD}/${ASSET}`,
    );
  });
});

/* ===========================================================================
 * The service: Storage's veto, and omitted keeps / null clears
 * ========================================================================= */

function detailWith(revision: Partial<ArticleDetail['revision']>): ArticleDetail {
  return {
    id: RECORD,
    slug: 'synthetic-record',
    state: 'published',
    version: 3,
    currentRevision: 1,
    title: 'Synthetic title',
    updatedAt: new Date(),
    scheduledAt: null,
    scheduleStatus: null,
    creatorId: 'synthetic-creator',
    approvedRevision: 1,
    approvedById: 'synthetic-reviewer',
    scheduledById: null,
    scheduledRevision: null,
    revision: {
      number: 1,
      editorId: 'synthetic-creator',
      createdAt: new Date(),
      ...base,
      translations: [{ ...translation, html: '<p></p>', leadAlt: 'Kept words' }],
      leadImage: lead,
      sourcePublishedOn: '2011-05-04',
      ...revision,
    },
  };
}

function harness(images: readonly string[]) {
  const writes: EditorialWrite[] = [];
  const asked: string[] = [];
  const stored = detailWith({});
  const persistence = {
    article: async () => stored,
    createArticle: async (input: EditorialWrite) => (writes.push(input), stored),
    reviseArticle: async (input: EditorialEdit) => (writes.push(input), stored),
  } as unknown as EditorialPersistencePort;
  const references: EditorialReferencesPort = {
    validTopics: async () => true,
    validContributors: async () => true,
    validLanguages: async () => true,
    selectableCentre: async () => true,
    selectableGallery: async () => true,
    selectableMembers: async () => true,
    usableImage: async (id) => (asked.push(id), images.includes(id)),
  };
  const service = createEditorialService({
    persistence,
    authority: { permits: async () => true },
    references,
    reportFailure: () => undefined,
  });
  return { service, writes, asked };
}

describe('the editorial service', () => {
  it('asks Storage about a NEW image and refuses one that is not a servable still image', async () => {
    const refused = harness([]);
    await expect(
      refused.service.create(ACTOR, 'article', { ...base, leadImage: lead }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    expect(refused.asked).toEqual([ASSET]);
    expect(refused.writes).toEqual([]);

    const admitted = harness([ASSET]);
    await admitted.service.create(ACTOR, 'article', {
      ...base,
      leadImage: lead,
      sourcePublishedOn: '2012-01-02',
    });
    const content = admitted.writes[0]?.content;
    expect(content?.leadImage).toEqual(lead);
    expect(content?.sourcePublishedOn).toBe('2012-01-02');
    // Omitted alt text on a creation is none at all.
    expect(content?.translations[0]?.leadAlt).toBe('');
  });

  it('creates with no image and no source date when the input names neither', async () => {
    const { service, writes, asked } = harness([]);
    await service.create(ACTOR, 'article', base);
    expect(writes[0]?.content.leadImage).toBeNull();
    expect(writes[0]?.content.sourcePublishedOn).toBeNull();
    expect(asked).toEqual([]);
  });

  it('KEEPS the current image, its alt text and the source date a revision omits — without asking Storage again', async () => {
    const { service, writes, asked } = harness([]);
    await service.revise(ACTOR, 'article', RECORD, 3, base);
    const content = writes[0]?.content;
    expect(content?.leadImage).toEqual(lead);
    expect(content?.translations[0]?.leadAlt).toBe('Kept words');
    expect(content?.sourcePublishedOn).toBe('2011-05-04');
    expect(asked).toEqual([]);
  });

  it('CLEARS what a revision names as null, and asks Storage only about a replacement', async () => {
    const cleared = harness([]);
    await cleared.service.revise(ACTOR, 'article', RECORD, 3, {
      ...base,
      leadImage: null,
      sourcePublishedOn: null,
    });
    expect(cleared.writes[0]?.content.leadImage).toBeNull();
    expect(cleared.writes[0]?.content.sourcePublishedOn).toBeNull();
    // No image, so no description of one survives.
    expect(cleared.writes[0]?.content.translations[0]?.leadAlt).toBe('');

    const replaced = harness([OTHER_ASSET]);
    await replaced.service.revise(ACTOR, 'article', RECORD, 3, {
      ...base,
      leadImage: { ...lead, assetId: OTHER_ASSET },
    });
    expect(replaced.asked).toEqual([OTHER_ASSET]);
    expect(replaced.writes[0]?.content.leadImage?.assetId).toBe(OTHER_ASSET);
  });
});

/* ===========================================================================
 * The chronology a publication records
 * ========================================================================= */

describe('the chronology a publication records', () => {
  const now = new Date('2026-10-30T08:00:00.000Z');
  const source = new Date('2011-05-04T00:00:00.000Z');

  it('is the source date when the published revision states one', () => {
    expect(
      chronologyUpdate({ updatedAt: now, state: 'published', publishedAt: now }, source),
    ).toEqual({ chronologyAt: source });
  });

  it('is the first publication instant otherwise', () => {
    const first = new Date('2026-10-29T15:00:00.000Z');
    expect(
      chronologyUpdate({ updatedAt: now, state: 'published', publishedAt: first }, null),
    ).toEqual({ chronologyAt: first });
  });

  it('is untouched by every other transition', () => {
    expect(chronologyUpdate({ updatedAt: now, state: 'archived' }, source)).toEqual({});
    expect(chronologyUpdate({ updatedAt: now, state: 'in-review' }, source)).toEqual({});
    expect(chronologyUpdate({ updatedAt: now }, source)).toEqual({});
  });
});

/* ===========================================================================
 * The serving policy
 * ========================================================================= */

describe('the lead-image serving policy', () => {
  const asset = { assetId: ASSET, mediaType: 'image/jpeg', byteSize: 10, checksum: 'a' };
  const named =
    (recorded: { family: string; recordId: string; assetId: string } | null) =>
    async (family: string, recordId: string, assetId: string) =>
      recorded !== null &&
      recorded.family === family &&
      recorded.recordId === recordId &&
      recorded.assetId === assetId;
  const recorded = { family: 'article', recordId: RECORD, assetId: ASSET };

  it('allows only the asset the published revision names', async () => {
    const policy = createLeadImagePolicy({
      request: { family: 'article', recordId: RECORD, assetId: ASSET },
      relation: named(recorded),
    });
    expect(await policy.decide(asset)).toBe('allow');
  });

  it.each([
    ['an unpublished record (no relation)', null, 'article', RECORD, ASSET, asset],
    [
      'another record',
      recorded,
      'article',
      '99999999-2222-4333-8444-555555555555',
      ASSET,
      asset,
    ],
    ['another asset of the record', recorded, 'article', RECORD, OTHER_ASSET, asset],
    ['another family', recorded, 'page', RECORD, ASSET, asset],
    ['a family that carries no image', recorded, 'statement', RECORD, ASSET, asset],
    ['a malformed record id', recorded, 'article', 'not-an-id', ASSET, asset],
    [
      'an asset that is not an image',
      recorded,
      'article',
      RECORD,
      ASSET,
      { ...asset, mediaType: 'application/pdf' },
    ],
    [
      'a resolved asset other than the named one',
      recorded,
      'article',
      RECORD,
      ASSET,
      { ...asset, assetId: OTHER_ASSET },
    ],
  ])('denies %s', async (_label, relation, family, recordId, assetId, resolved) => {
    const policy = createLeadImagePolicy({
      request: { family, recordId, assetId },
      relation: named(relation),
    });
    expect(await policy.decide(resolved)).toBe('deny');
  });

  it('previews only for a LIVE content.read', async () => {
    const preview = (permits: boolean) =>
      createLeadImagePolicy({
        request: { family: 'article', recordId: RECORD, assetId: ASSET },
        relation: named(recorded),
        preview: {
          accountId: 'synthetic-reviewer',
          authority: { permits: async () => permits },
        },
      });
    expect(await preview(true).decide(asset)).toBe('allow');
    expect(await preview(false).decide(asset)).toBe('deny');
  });
});
