import { localizedPath } from '../../packages/contracts/src/locale-path.ts';
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
  EditorialPersistencePort,
  EditorialPublicReaderPort,
  NewsKind,
  WorkflowAction,
} from '../../packages/contracts/src/editorial/index.ts';
import { createEditorialService } from '../../apps/web/src/contexts/editorial/index.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';

/**
 * Phase 13 — the four News families through the SHARED editorial workflow, on
 * real SQL Server.
 *
 * WHAT IS PROVED, per family: separate live author, reviewer and publisher
 * grants; approval of the exact current revision by someone other than its
 * creator or editor, with no Platform-Administrator exception; stale saves and
 * stale approvals refused; an edit invalidating approval and schedule; durable,
 * cancellable, catch-up scheduling that re-checks authority; permanent slug
 * reservations resolving in one step; immutable revisions; public DTOs without
 * authoring documents or workflow actors; and durable search intent committed in
 * the owner's transaction. Then what only News has: a NewsArticle slug can never
 * name a static `/news` sibling, a Statement names its issuer in every
 * translation, a MediaCoverage source is a safe HTTPS address or nothing, and
 * the archive and topic timeline read genuine publication instants.
 *
 * EVERYTHING IS SYNTHETIC. No real organisation, authority, outlet or event is
 * named: titles say they are fixtures and addresses are `.invalid`.
 */

const live = databaseConfigured ? describe : describe.skip;
const KINDS: readonly NewsKind[] = [
  'news-article',
  'press-release',
  'statement',
  'media-coverage',
];
const TABLE: Readonly<Record<NewsKind, string>> = {
  'news-article': 'NewsArticle',
  'press-release': 'PressRelease',
  statement: 'Statement',
  'media-coverage': 'MediaCoverage',
};
const BODY_SENTINEL = 'NEWS-BODY-SENTINEL';
const document = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: `Synthetic news proof ${BODY_SENTINEL}.` }],
    },
  ],
});

function content(kind: NewsKind, slug = 'news-proof-' + randomUUID().slice(0, 12)) {
  return {
    slug,
    primaryLanguage: 'en',
    translations: [
      {
        languageCode: 'en',
        title: 'Synthetic news proof',
        excerpt: 'Non-authoritative test fixture',
        seoTitle: '',
        seoDescription: '',
        document,
        ...(kind === 'statement' ? { issuer: 'Synthetic Issuing Office' } : {}),
      },
    ],
    topicIds: [] as string[],
    contributors: [] as { personId: string; role: string }[],
    ...(kind === 'media-coverage'
      ? {
          coverage: {
            outlet: 'Synthetic Outlet',
            sourceUrl: 'https://coverage.example.invalid/story',
            sourceDate: '2030-01-02',
          },
        }
      : {}),
  };
}

live('Phase 13 real SQL News workflow', () => {
  let db: DisposableDatabase;
  let service: ReturnType<typeof createEditorialService>;
  let store: EditorialPersistencePort;
  let reader: EditorialPublicReaderPort;
  let reads: ReturnType<typeof createEditorialReadService>;
  let author: string, reviewer: string, publisher: string, administrator: string;
  let topicId: string;
  let now = new Date('2035-01-01T00:00:00Z');
  const errors: string[] = [];
  const clock = () => new Date(now);

  async function account(keys: readonly string[]) {
    const id = await createProofAccount(db.admin),
      role = randomUUID();
    if (keys.length) {
      await db.admin.query(
        `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic news role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
      );
      for (const key of keys)
        await db.admin.query(
          `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
        );
    }
    return id;
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    const adapters =
      await import('../../packages/database/src/adapters/editorial/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createTaxonomyReader } =
      await import('../../packages/database/src/adapters/taxonomy/index.ts');
    const { createPeopleReader } =
      await import('../../packages/database/src/adapters/people-contributors/index.ts');
    const { createGlobalReferences } =
      await import('../../packages/database/src/adapters/global-network/index.ts');
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    store = adapters.createEditorialPersistence();
    reader = adapters.createEditorialPublicReader();
    reads = createEditorialReadService(reader);
    service = createEditorialService({
      persistence: store,
      authority: { permits: (id, key) => authorization.hasPermission(id, key) },
      now: clock,
      reportFailure: (operation) => errors.push(operation),
      references: {
        validTopics: async (ids) =>
          (await createTaxonomyReader().topicReferences(ids, 'en')).length === ids.length,
        validContributors: async (ids) =>
          (await createPeopleReader().contributorReferences([...new Set(ids)], 'en'))
            .length === new Set(ids).size,
        validLanguages: async (codes) => {
          const languages = await createTaxonomyReader().listLanguages({
            includeRetired: false,
          });
          return codes.every((code) =>
            languages.some((language) => language.code === code),
          );
        },
        selectableCentre: (id) => createGlobalReferences().centreSelectable(id),
        // No News family associates a Gallery; only an Event does (Phase 14).
        selectableGallery: async () => false,
        // No News family holds Collection members; only a Collection does (Phase 15).
        selectableMembers: async () => false,
        usableImage: async () => false,
      },
    });
    author = await account(['content.read', 'content.author', 'content.review']);
    reviewer = await account(['content.read', 'content.review']);
    publisher = await account(['content.read', 'content.publish']);
    administrator = await account([
      'content.read',
      'content.author',
      'content.review',
      'content.publish',
    ]);
    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');
    topicId = topic.id;
  }, 240000);
  afterAll(async () => {
    await db?.close();
  });

  const create = (kind: NewsKind, value: unknown = content(kind), actor = author) =>
    service.create({ accountId: actor }, kind, value);
  const transition = (
    kind: NewsKind,
    row: ArticleDetail,
    action: WorkflowAction,
    actor: string,
    scheduledAt: string | null = null,
  ) =>
    service.transition({ accountId: actor }, kind, {
      id: row.id,
      expectedVersion: row.version,
      action,
      scheduledAt,
      timezone: scheduledAt ? 'Asia/Karachi' : null,
    });
  const approved = async (kind: NewsKind, value: unknown = content(kind)) =>
    transition(
      kind,
      await transition(kind, await create(kind, value), 'submit', author),
      'approve',
      reviewer,
    );
  const published = async (kind: NewsKind, value: unknown = content(kind)) =>
    transition(kind, await approved(kind, value), 'publish', publisher);
  const requests = async (kind: NewsKind, id: string) =>
    Number(
      (
        await db.admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM [SearchIndexRequest] WHERE [scopeKind]=N'${kind}' AND [scopeId]=N'${id}';`,
        )
      )[0]?.total,
    );

  for (const kind of KINDS)
    describe(kind, () => {
      it('requires separate live grants and independent approval, even for an administrator', async () => {
        const row = await create(kind);
        const stranger = await account([]);
        await expect(
          service.detail({ accountId: stranger }, kind, row.id),
        ).rejects.toMatchObject({ reason: 'denied' });
        await expect(create(kind, content(kind), publisher)).rejects.toMatchObject({
          reason: 'denied',
        });
        await expect(transition(kind, row, 'publish', publisher)).rejects.toMatchObject({
          reason: 'invalid-state',
        });
        const submitted = await transition(kind, row, 'submit', author);
        await expect(
          transition(kind, submitted, 'approve', author),
        ).rejects.toMatchObject({ reason: 'self-approval' });
        await expect(
          transition(kind, submitted, 'publish', publisher),
        ).rejects.toMatchObject({ reason: 'approval-required' });
        await expect(
          transition(kind, submitted, 'approve', publisher),
        ).rejects.toMatchObject({ reason: 'denied' });
        const ok = await transition(kind, submitted, 'approve', reviewer);
        expect(ok.approvedRevision).toBe(ok.currentRevision);
        await expect(transition(kind, ok, 'publish', reviewer)).rejects.toMatchObject({
          reason: 'denied',
        });
        const live = await transition(kind, ok, 'publish', publisher);
        expect(live.state).toBe('published');
        // Durable search intent was committed with each public-state change.
        expect(await requests(kind, row.id)).toBeGreaterThan(0);

        const publicRow = await reads.news(kind, row.slug);
        expect(publicRow?.kind).toBe(kind);
        expect(publicRow?.translations[0]?.html).toContain(BODY_SENTINEL);
        for (const field of [
          'document',
          'creatorId',
          'editorId',
          'approvedById',
          'scheduledById',
          'version',
        ])
          expect(JSON.stringify(publicRow)).not.toContain(field);
        // Another family never answers this family's slug.
        for (const other of KINDS.filter((entry) => entry !== kind))
          expect(await reads.news(other, row.slug)).toBeNull();

        // An administrator holding every key still cannot approve their own work.
        const own = await transition(
          kind,
          await create(kind, content(kind), administrator),
          'submit',
          administrator,
        );
        await expect(
          transition(kind, own, 'approve', administrator),
        ).rejects.toMatchObject({ reason: 'self-approval' });

        await transition(kind, live, 'archive', publisher);
        expect(await reads.news(kind, row.slug)).toBeNull();
        expect(await reader.searchNews(kind, row.id)).toBeNull();
      });

      it('rejects concurrent stale saves and invalidates approval with a new immutable snapshot', async () => {
        const row = await approved(kind);
        const changed = content(kind, row.slug);
        const results = await Promise.allSettled(
          [1, 2].map(() =>
            service.revise({ accountId: author }, kind, row.id, row.version, changed),
          ),
        );
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((result) => result.status === 'rejected')).toMatchObject({
          reason: { reason: 'conflict' },
        });
        const current = await service.detail({ accountId: author }, kind, row.id);
        expect(current).toMatchObject({
          currentRevision: 2,
          approvedRevision: null,
          state: 'draft',
        });
        await expect(transition(kind, row, 'publish', publisher)).rejects.toMatchObject({
          reason: 'conflict',
        });
        const table = TABLE[kind];
        await expect(
          db.admin.query(
            `UPDATE [${table}RevisionTranslation] SET [title]=N'Tampered' WHERE [ownerId]=N'${row.id}' AND [revisionNumber]=1;`,
          ),
        ).rejects.toThrow();
        await expect(
          db.admin.query(
            `UPDATE [${table}] SET [currentRevision]=1 WHERE [id]=N'${row.id}';`,
          ),
        ).rejects.toThrow();
        await expect(
          db.admin.query(
            `UPDATE [${table}] SET [state]=N'published',[publishedAt]=SYSUTCDATETIME() WHERE [id]=N'${row.id}';`,
          ),
        ).rejects.toThrow();
        await expect(
          db.admin.query(`DELETE FROM [${table}Revision] WHERE [ownerId]=N'${row.id}';`),
        ).rejects.toThrow();
      });

      it('reserves every former slug and resolves it to the current one in one step', async () => {
        let row = await published(kind);
        const first = row.slug;
        for (let index = 0; index < 2; index++) {
          row = await service.revise(
            { accountId: author },
            kind,
            row.id,
            row.version,
            content(kind),
          );
          row = await transition(
            kind,
            await transition(kind, row, 'submit', author),
            'approve',
            reviewer,
          );
          row = await transition(kind, row, 'publish', publisher);
        }
        expect(await reads.newsCanonicalSlug(kind, first)).toBe(row.slug);
        expect((await reads.news(kind, first))?.slug).toBe(row.slug);
        await expect(create(kind, content(kind, first))).rejects.toMatchObject({
          reason: 'duplicate-slug',
        });
        await expect(
          db.admin.query(
            `DELETE FROM [${TABLE[kind]}SlugHistory] WHERE [ownerId]=N'${row.id}';`,
          ),
        ).rejects.toThrow();
        // Slug changes are audited as their own event.
        const [audit] = await db.admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM [AuditLog] WHERE [targetId]=N'${row.id}' AND [action]=N'editorial.${kind}.slug-changed';`,
        );
        expect(Number(audit?.total)).toBe(2);
      });

      it('catches up a due schedule once, never early, and honours cancellation and edits', async () => {
        const due = new Date(now.getTime() + 60000);
        const row = await transition(
          kind,
          await approved(kind),
          'schedule',
          publisher,
          due.toISOString(),
        );
        expect(await service.runDue()).toBe(0);
        now = new Date(due.getTime() + 3600000);
        const results = await Promise.all([service.runDue(), service.runDue()]);
        expect(results.reduce((a, b) => a + b, 0)).toBe(1);
        expect((await service.detail({ accountId: author }, kind, row.id)).state).toBe(
          'published',
        );
        const cancelled = await transition(
          kind,
          await approved(kind),
          'schedule',
          publisher,
          new Date(now.getTime() + 60000).toISOString(),
        );
        await transition(kind, cancelled, 'cancel', publisher);
        const edited = await transition(
          kind,
          await approved(kind),
          'schedule',
          publisher,
          new Date(now.getTime() + 60000).toISOString(),
        );
        await service.revise(
          { accountId: author },
          kind,
          edited.id,
          edited.version,
          content(kind, edited.slug),
        );
        now = new Date(now.getTime() + 120000);
        expect(await service.runDue()).toBe(0);
        expect(
          (await service.detail({ accountId: author }, kind, cancelled.id)).state,
        ).toBe('in-review');
        expect((await service.detail({ accountId: author }, kind, edited.id)).state).toBe(
          'draft',
        );
      });

      it('stops a schedule whose publisher lost authority before it fell due', async () => {
        const actor = await account(['content.read', 'content.publish']);
        const row = await transition(
          kind,
          await approved(kind),
          'schedule',
          actor,
          new Date(now.getTime() + 60000).toISOString(),
        );
        await db.admin.query(
          `UPDATE [RoleAssignment] SET [revokedAt]=SYSUTCDATETIME() WHERE [userId]=N'${actor}' AND [revokedAt] IS NULL;`,
        );
        now = new Date(now.getTime() + 120000);
        expect(await service.runDue()).toBe(0);
        expect(await service.detail({ accountId: author }, kind, row.id)).toMatchObject({
          state: 'scheduled',
          scheduleStatus: 'authority-revoked',
        });
      });

      it('refuses fields another family owns and unknown fields', async () => {
        const base = content(kind);
        await expect(create(kind, { ...base, isFeatured: true })).rejects.toMatchObject({
          reason: 'invalid',
        });
        await expect(
          create(kind, { ...base, heroImage: 'https://images.example.invalid/a.jpg' }),
        ).rejects.toMatchObject({ reason: 'invalid' });
        // An Event's own fields (Phase 14) belong to no News family.
        for (const eventField of [
          {
            schedule: {
              timezone: 'Asia/Karachi',
              occurrences: [{ start: '2041-11-14T19:00' }],
            },
          },
          { galleryIds: [randomUUID()] },
        ])
          await expect(create(kind, { ...base, ...eventField })).rejects.toMatchObject({
            reason: 'invalid',
          });
        if (kind !== 'statement')
          await expect(
            create(kind, {
              ...base,
              translations: base.translations.map((t) => ({ ...t, issuer: 'Injected' })),
            }),
          ).rejects.toMatchObject({ reason: 'invalid' });
        if (kind !== 'media-coverage')
          await expect(
            create(kind, {
              ...base,
              coverage: { outlet: 'Injected', sourceUrl: null, sourceDate: null },
            }),
          ).rejects.toMatchObject({ reason: 'invalid' });
      });
    });

  it('keeps every static News sibling out of the NewsArticle slug namespace', async () => {
    for (const reserved of [
      'archive',
      'press-releases',
      'statements',
      'media-coverage',
    ]) {
      await expect(
        create('news-article', content('news-article', reserved)),
      ).rejects.toMatchObject({ reason: 'invalid' });
      expect(await reads.news('news-article', reserved)).toBeNull();
      expect(await reads.newsCanonicalSlug('news-article', reserved)).toBeNull();
    }
    // The database refuses the same, whatever writes to it.
    const row = await create('news-article');
    await expect(
      db.admin.query(
        `INSERT INTO [NewsArticleSlugHistory] ([ownerId],[slug]) VALUES (N'${row.id}',N'archive');`,
      ),
    ).rejects.toThrow();
    // The other families may use these words beneath their own listing.
    const statement = await create('statement', content('statement', 'archive'));
    expect(statement.slug).toBe('archive');
  });

  it('requires a Statement issuer in every translation and audits a change without its text', async () => {
    const base = content('statement');
    await expect(
      create('statement', {
        ...base,
        translations: base.translations.map(({ issuer: _issuer, ...rest }) => rest),
      }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    await expect(
      create('statement', {
        ...base,
        translations: base.translations.map((t) => ({ ...t, issuer: '   ' })),
      }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    const row = await create('statement', base);
    expect(row.revision.translations[0]?.issuer).toBe('Synthetic Issuing Office');
    const renamed = {
      ...base,
      translations: base.translations.map((t) => ({
        ...t,
        issuer: 'Synthetic Renamed Office',
      })),
    };
    await service.revise(
      { accountId: author },
      'statement',
      row.id,
      row.version,
      renamed,
    );
    const audits = await db.admin.query<{ action: string; afterState: string }>(
      `SELECT [action],[afterState] FROM [AuditLog] WHERE [targetId]=N'${row.id}' ORDER BY [occurredAt];`,
    );
    expect(audits.map((entry) => entry.action)).toContain(
      'editorial.statement.issuer-changed',
    );
    const text = JSON.stringify(audits);
    for (const sentinel of [
      'Synthetic Renamed Office',
      BODY_SENTINEL,
      'Synthetic news proof',
    ])
      expect(text).not.toContain(sentinel);
    await expect(
      db.admin.query(
        `UPDATE [StatementRevisionTranslation] SET [issuer]=N'' WHERE [ownerId]=N'${row.id}';`,
      ),
    ).rejects.toThrow();
  });

  it('accepts only a safe HTTPS coverage source and audits a source change without it', async () => {
    const base = content('media-coverage');
    for (const sourceUrl of [
      'http://coverage.example.invalid/story',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      '//coverage.example.invalid/story',
      'https://user:secret@coverage.example.invalid/story',
      'ftp://coverage.example.invalid/story',
      'not a url',
      'https://' + 'a'.repeat(2050) + '.invalid/',
    ])
      await expect(
        create('media-coverage', { ...base, coverage: { ...base.coverage, sourceUrl } }),
      ).rejects.toMatchObject({ reason: 'invalid' });
    for (const coverage of [
      { ...base.coverage, outlet: '  ' },
      { ...base.coverage, sourceDate: '2030-02-30' },
      { outlet: 'Synthetic Outlet', sourceUrl: null },
    ])
      await expect(create('media-coverage', { ...base, coverage })).rejects.toMatchObject(
        { reason: 'invalid' },
      );

    // Nothing but an outlet is required: an unknown address and date stay unknown.
    const minimal = await create('media-coverage', {
      ...content('media-coverage'),
      coverage: { outlet: 'Synthetic Outlet', sourceUrl: null, sourceDate: null },
    });
    expect(minimal.revision.coverage).toEqual({
      outlet: 'Synthetic Outlet',
      sourceUrl: null,
      sourceDate: null,
    });
    const row = await create('media-coverage', {
      ...base,
      coverage: { ...base.coverage, sourceUrl: 'HTTPS://Coverage.Example.Invalid/story' },
    });
    // Stored in its normalised form.
    expect(row.revision.coverage?.sourceUrl).toBe(
      'https://coverage.example.invalid/story',
    );
    await service.revise({ accountId: author }, 'media-coverage', row.id, row.version, {
      ...base,
      slug: row.slug,
      coverage: { ...base.coverage, sourceDate: '2030-03-04' },
    });
    const audits = await db.admin.query<{ action: string; afterState: string }>(
      `SELECT [action],[afterState] FROM [AuditLog] WHERE [targetId]=N'${row.id}';`,
    );
    expect(audits.map((entry) => entry.action)).toContain(
      'editorial.media-coverage.source-changed',
    );
    expect(JSON.stringify(audits)).not.toContain('coverage.example.invalid');
    // The database refuses an unsafe address from any writer.
    await expect(
      db.admin.query(
        `UPDATE [MediaCoverageRevision] SET [sourceUrl]=N'http://coverage.example.invalid/' WHERE [ownerId]=N'${row.id}';`,
      ),
    ).rejects.toThrow();
  });

  it('reads the archive and a topic timeline from genuine publication instants only', async () => {
    const tagged = (kind: NewsKind) => ({ ...content(kind), topicIds: [topicId] });
    // Publication instants are the clock's; place them in known months.
    now = new Date('2040-03-15T10:00:00Z');
    const march = await published('press-release', tagged('press-release'));
    now = new Date('2040-04-01T00:30:00Z');
    const april = await published('statement', tagged('statement'));
    const draft = await create('news-article', tagged('news-article'));
    now = new Date('2041-01-01T00:00:00Z');

    const periods = await reads.newsArchivePeriods();
    expect(periods).toEqual(
      expect.arrayContaining([
        { year: 2040, month: 3, count: 1 },
        { year: 2040, month: 4, count: 1 },
      ]),
    );
    // News & Events Part 1: a period is read through each family's own listing
    // (the archive is an index into them); the draft is in none of them.
    const inPeriod = async (kind: NewsKind, month: number | null = null) =>
      (await reads.newsListing({ kind, year: 2040, month })).items.map((item) => [
        item.kind,
        item.slug,
      ]);
    expect(await inPeriod('statement')).toEqual([['statement', april.slug]]);
    expect(await inPeriod('press-release')).toEqual([['press-release', march.slug]]);
    expect(await inPeriod('news-article')).toEqual([]);
    expect(await inPeriod('press-release', 3)).toEqual([['press-release', march.slug]]);
    expect(await inPeriod('statement', 3)).toEqual([]);
    await expect(
      reads.newsListing({ kind: 'press-release', year: null, month: 3 }),
    ).rejects.toThrow();

    const onTopic = await reads.newsOnTopic(topicId);
    const slugs = onTopic.items.map((item) => item.slug);
    expect(slugs).toContain(april.slug);
    expect(slugs).toContain(march.slug);
    expect(slugs).not.toContain(draft.slug);
    // Every card is a summary: never a body or an authoring document.
    expect(JSON.stringify(onTopic)).not.toContain(BODY_SENTINEL);

    // Listings are bounded pages in a deterministic order.
    const list = await reads.newsList('statement', 0);
    expect(list.items.length).toBeLessThanOrEqual(20);
    const times = list.items.map((item) => item.publishedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // Withdrawal leaves the archive at once.
    await transition(
      'statement',
      await service.detail({ accountId: author }, 'statement', april.id),
      'archive',
      publisher,
    );
    const after = await reads.newsListing({ kind: 'statement', year: 2040, month: 4 });
    expect(after.items.map((item) => item.slug)).not.toContain(april.slug);
    expect(after.total).toBe(0);
    expect(
      (await reads.newsArchivePeriods()).find(
        (period) => period.year === 2040 && period.month === 4,
      ),
    ).toBeUndefined();
  });

  it('narrows by content language and family, and orders a preferred language first (R2)', async () => {
    // Placed in a month no other proof uses, so the archive read is exact.
    now = new Date('2044-06-10T09:00:00Z');
    const english = await published('statement');
    now = new Date('2044-06-20T09:00:00Z');
    const urdu = await published('statement', {
      ...content('statement'),
      primaryLanguage: 'ur',
      translations: [
        {
          languageCode: 'ur',
          title: 'مصنوعی بیان',
          excerpt: '',
          seoTitle: '',
          seoDescription: '',
          document,
          issuer: 'مصنوعی دفتر',
        },
      ],
    });
    const press = await published('press-release');
    now = new Date('2045-01-01T00:00:00Z');

    const only = await reads.newsList('statement', 0, { only: 'ur' });
    expect(only.items.map((item) => item.slug)).toContain(urdu.slug);
    expect(only.items.map((item) => item.slug)).not.toContain(english.slug);

    // Preferring Urdu puts the Urdu statement before the newer-or-older English
    // one; preferring English puts it after, and both stay listed.
    const position = async (prefer: 'en' | 'ur') => {
      const slugs = (await reads.newsList('statement', 0, { prefer })).items.map(
        (item) => item.slug,
      );
      return { urdu: slugs.indexOf(urdu.slug), english: slugs.indexOf(english.slug) };
    };
    const ur = await position('ur');
    expect(ur.urdu).toBeGreaterThanOrEqual(0);
    expect(ur.urdu).toBeLessThan(ur.english);
    const en = await position('en');
    expect(en.english).toBeGreaterThanOrEqual(0);
    expect(en.english).toBeLessThan(en.urdu);

    // The same narrowing through each family's listing (News & Events Part 1).
    const month = { year: 2044, month: 6 } as const;
    const slugs = async (query: Record<string, unknown>) =>
      (await reads.newsListing({ ...month, ...query })).items.map((i) => i.slug);
    expect(await slugs({ kind: 'statement' })).toEqual([urdu.slug, english.slug]);
    expect(await slugs({ kind: 'statement', language: 'ur' })).toEqual([urdu.slug]);
    expect(await slugs({ kind: 'press-release', language: 'ur' })).toEqual([]);
    expect(await slugs({ kind: 'press-release' })).toEqual([press.slug]);
    // Preferring a language orders the listing too, and narrowing ignores it.
    expect(await slugs({ kind: 'statement', prefer: 'en' })).toEqual([
      english.slug,
      urdu.slug,
    ]);
    expect(await slugs({ kind: 'statement', language: 'ur', prefer: 'en' })).toEqual([
      urdu.slug,
    ]);
    expect(await reads.newsArchivePeriods({ kind: 'statement', language: 'ur' })).toEqual(
      expect.arrayContaining([{ year: 2044, month: 6, count: 1 }]),
    );
    expect(
      (await reads.newsArchivePeriods({ kind: 'press-release' })).find(
        (period) => period.year === 2044 && period.month === 6,
      )?.count,
    ).toBe(1);
  });

  it('lists one family with its total, counted facets, pages and neighbours (News & Events Part 1)', async () => {
    // A year no other proof uses, so every count below is exact.
    const coverage = (outlet: string) => ({
      ...content('media-coverage'),
      coverage: { outlet, sourceUrl: null, sourceDate: null },
    });
    const slugsOf = (page: { readonly items: readonly { readonly slug: string }[] }) =>
      page.items.map((item) => item.slug);
    now = new Date('2047-02-01T09:00:00Z');
    const a = await published('media-coverage', {
      ...coverage('Synthetic Outlet A'),
      topicIds: [topicId],
    });
    now = new Date('2047-02-10T09:00:00Z');
    const b = await published('media-coverage', coverage('Synthetic Outlet B'));
    now = new Date('2047-05-03T09:00:00Z');
    const c = await published('media-coverage', {
      ...coverage('Synthetic Outlet A'),
      primaryLanguage: 'ur',
      translations: [
        {
          languageCode: 'ur',
          title: 'مصنوعی کوریج',
          excerpt: '',
          seoTitle: '',
          seoDescription: '',
          document,
        },
      ],
    });
    const draft = await create('media-coverage', coverage('Synthetic Outlet A'));
    now = new Date('2048-01-01T00:00:00Z');

    const year = { kind: 'media-coverage', year: 2047 } as const;
    const all = await reads.newsListing(year);
    expect(slugsOf(all)).toEqual([c.slug, b.slug, a.slug]);
    expect(all).toMatchObject({ total: 3, hasMore: false });
    expect(JSON.stringify(all)).not.toContain(draft.slug);
    expect(JSON.stringify(all)).not.toContain(BODY_SENTINEL);
    expect(slugsOf(await reads.newsListing({ ...year, sort: 'oldest' }))).toEqual([
      a.slug,
      b.slug,
      c.slug,
    ]);

    // Bounded pages that know the view's total, and an honest page past the end.
    const first = await reads.newsListing({ ...year, limit: 2 });
    expect(slugsOf(first)).toEqual([c.slug, b.slug]);
    expect(first).toMatchObject({ total: 3, hasMore: true });
    const second = await reads.newsListing({ ...year, limit: 2, offset: 2 });
    expect(slugsOf(second)).toEqual([a.slug]);
    expect(second).toMatchObject({ total: 3, hasMore: false });
    expect(await reads.newsListing({ ...year, offset: 20 })).toEqual({
      items: [],
      total: 3,
      hasMore: false,
    });

    // Each filter narrows; none widens.
    expect(
      slugsOf(await reads.newsListing({ ...year, outlet: 'Synthetic Outlet A' })),
    ).toEqual([c.slug, a.slug]);
    expect(slugsOf(await reads.newsListing({ ...year, outlet: 'Nobody' }))).toEqual([]);
    expect(slugsOf(await reads.newsListing({ ...year, topic: topicId }))).toEqual([
      a.slug,
    ]);
    expect(slugsOf(await reads.newsListing({ ...year, month: 2 }))).toEqual([
      b.slug,
      a.slug,
    ]);
    expect(slugsOf(await reads.newsListing({ ...year, language: 'ur' }))).toEqual([
      c.slug,
    ]);
    // Another family never answers for this one.
    expect((await reads.newsListing({ ...year, kind: 'statement' })).total).toBe(0);

    // Each facet counts under every OTHER filter, its own left out.
    const facets = await reads.newsListingFacets({
      ...year,
      outlet: 'Synthetic Outlet A',
    });
    expect(facets.kinds).toEqual([
      { kind: 'news-article', records: 0 },
      { kind: 'press-release', records: 0 },
      { kind: 'statement', records: 0 },
      // The tabs keep the period but not the outlet, which is coverage's own.
      { kind: 'media-coverage', records: 3 },
    ]);
    expect(facets.outlets).toEqual({
      items: [
        { name: 'Synthetic Outlet A', records: 2 },
        { name: 'Synthetic Outlet B', records: 1 },
      ],
      hasMore: false,
    });
    expect(facets.months).toEqual([
      { month: 2, records: 1 },
      { month: 5, records: 1 },
    ]);
    expect(facets.languages).toEqual([
      { code: 'en', records: 1 },
      { code: 'ur', records: 1 },
    ]);
    expect(facets.topics).toEqual({
      items: [{ id: topicId, records: 1 }],
      hasMore: false,
    });
    expect(facets.years.find((entry) => entry.year === 2047)).toEqual({
      year: 2047,
      records: 2,
    });
    // The whole family's figures, never narrowed.
    expect(facets.all.records).toBeGreaterThanOrEqual(3);
    expect(facets.all.outlets).toBeGreaterThanOrEqual(2);
    expect(facets.all.languages).toBeGreaterThanOrEqual(2);
    expect(facets.all.lastYear).toBe(2047);
    expect(facets.all.firstYear).toBeLessThanOrEqual(2047);
    // Other families name no outlet and read no month without a year.
    const statements = await reads.newsListingFacets({ kind: 'statement' });
    expect(statements.outlets).toEqual({ items: [], hasMore: false });
    expect(statements.months).toEqual([]);
    expect(statements.all.outlets).toBe(0);

    // A record's newer and older neighbours in its own family.
    expect(await reads.newsNeighbours('media-coverage', b.slug)).toMatchObject({
      newer: { kind: 'media-coverage', slug: c.slug },
      older: { kind: 'media-coverage', slug: a.slug },
    });
    expect((await reads.newsNeighbours('media-coverage', c.slug)).newer).toBeNull();
    expect(await reads.newsNeighbours('media-coverage', draft.slug)).toEqual({
      newer: null,
      older: null,
    });
    expect(await reads.newsNeighbours('statement', b.slug)).toEqual({
      newer: null,
      older: null,
    });

    // Two records at one instant: the neighbours follow the listing's own
    // tie-break, and a withdrawn record is skipped.
    now = new Date('2047-08-01T00:00:00Z');
    const x = await published('media-coverage', coverage('Synthetic Outlet B'));
    const y = await published('media-coverage', coverage('Synthetic Outlet B'));
    now = new Date('2048-01-01T00:00:00Z');
    const [p, q] = slugsOf(await reads.newsListing({ ...year, month: 8 }));
    expect([p, q].sort()).toEqual([x.slug, y.slug].sort());
    expect((await reads.newsNeighbours('media-coverage', p!)).older?.slug).toBe(q);
    expect((await reads.newsNeighbours('media-coverage', q!)).newer?.slug).toBe(p);
    expect((await reads.newsNeighbours('media-coverage', q!)).older?.slug).toBe(c.slug);
    await transition(
      'media-coverage',
      await service.detail({ accountId: author }, 'media-coverage', c.id),
      'archive',
      publisher,
    );
    expect((await reads.newsNeighbours('media-coverage', q!)).older?.slug).toBe(b.slug);
    expect((await reads.newsListing(year)).total).toBe(4);
  });

  it('bounds a scheduler sweep for each family and catches up the remainder next time', async () => {
    const at = new Date(now.getTime() + 60000);
    for (let index = 0; index < 26; index++)
      await transition(
        'press-release',
        await approved('press-release'),
        'schedule',
        publisher,
        at.toISOString(),
      );
    now = new Date(at.getTime() + 1000);
    expect(await service.runDue()).toBe(25);
    expect(await service.runDue()).toBe(1);
    expect(await service.runDue()).toBe(0);
  });

  it('advertises exactly the current published detail URLs in the news sitemap', async () => {
    const ORIGIN = 'https://news-sitemap.proof.invalid';
    process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = 'true';
    process.env['AUTH_BASE_URL'] = ORIGIN;
    try {
      const { newsSitemapPartitions } =
        await import('../../apps/web/src/seo/news-sitemap.ts');
      const { newsPathOf } =
        await import('../../packages/contracts/src/editorial/index.ts');
      const partitions = await newsSitemapPartitions();
      expect(partitions.every((partition) => partition.segment === 'news')).toBe(true);
      const advertised = new Set(
        partitions.flatMap((partition) => partition.urls.map((url) => url.loc)),
      );
      // Expected: every PUBLISHED record's CURRENT slug, in each language it
      // genuinely has — never a draft, a scheduled or archived record, a former
      // slug or a query.
      const expected = new Set<string>();
      for (const kind of KINDS) {
        const rows = await db.admin.query<{ slug: string; languageCode: string }>(
          `SELECT r.[slug], t.[languageCode] FROM [${TABLE[kind]}] r
           JOIN [${TABLE[kind]}RevisionTranslation] t ON t.[ownerId]=r.[id] AND t.[revisionNumber]=r.[currentRevision]
           WHERE r.[state]=N'published';`,
        );
        for (const row of rows)
          expected.add(
            `${ORIGIN}${localizedPath(row.languageCode, newsPathOf(kind, row.slug))}`,
          );
        const former = await db.admin.query<{ slug: string }>(
          `SELECT h.[slug] FROM [${TABLE[kind]}SlugHistory] h JOIN [${TABLE[kind]}] r ON r.[id]=h.[ownerId] WHERE h.[slug]<>r.[slug];`,
        );
        expect(former.length, kind).toBeGreaterThan(0);
        for (const { slug } of former)
          for (const url of advertised) expect(url.endsWith(`/${slug}`)).toBe(false);
      }
      expect(expected.size).toBeGreaterThan(0);
      expect(advertised).toEqual(expected);
      for (const url of advertised) expect(url).not.toContain('?');

      process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = 'false';
      expect(await newsSitemapPartitions()).toEqual([]);
    } finally {
      delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];
    }
  });

  it('has no silently swallowed scheduler errors', () => {
    expect(errors).toEqual([]);
  });
});
