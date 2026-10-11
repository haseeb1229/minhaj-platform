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
    const year = await reads.newsArchive({ year: 2040, month: null, offset: 0 });
    expect(year.items.map((item) => [item.kind, item.slug])).toEqual([
      ['statement', april.slug],
      ['press-release', march.slug],
    ]);
    const month = await reads.newsArchive({ year: 2040, month: 3, offset: 0 });
    expect(month.items.map((item) => item.slug)).toEqual([march.slug]);
    await expect(
      reads.newsArchive({ year: null, month: 3, offset: 0 }),
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
    const after = await reads.newsArchive({ year: 2040, month: 4, offset: 0 });
    expect(after.items.map((item) => item.slug)).not.toContain(april.slug);
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
          expected.add(`${ORIGIN}/${row.languageCode}${newsPathOf(kind, row.slug)}`);
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
