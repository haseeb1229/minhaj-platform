import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';
import type {
  EditorialContent,
  EditorialKind,
  ArticleDetail,
  WorkflowAction,
  EditorialPersistencePort,
  EditorialPublicReaderPort,
  CorrespondencePersistencePort,
} from '../../packages/contracts/src/editorial/index.ts';
import {
  createEditorialService,
  createCorrespondenceService,
} from '../../apps/web/src/contexts/editorial/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
const live = databaseConfigured ? describe : describe.skip;
const document = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Synthetic editorial proof. Non-authoritative.' }],
    },
  ],
});
const content = (slug = 'proof-' + randomUUID()): EditorialContent => ({
  slug,
  primaryLanguage: 'en',
  translations: [
    {
      languageCode: 'en',
      title: 'Synthetic editorial proof',
      excerpt: 'Non-authoritative test fixture',
      seoTitle: '',
      seoDescription: '',
      document,
    },
  ],
  topicIds: [],
  contributors: [],
});
live('Phase 6 real SQL Editorial workflow and correspondence', () => {
  let db: DisposableDatabase;
  let service: ReturnType<typeof createEditorialService>;
  let store: EditorialPersistencePort;
  let reader: EditorialPublicReaderPort;
  let correspondence: ReturnType<typeof createCorrespondenceService>;
  let authorization: ReturnType<typeof createAuthorizationService>;
  let correspondenceStore: CorrespondencePersistencePort;
  let author: string,
    reviewer: string,
    publisher: string,
    operator: string,
    stranger: string;
  let now = new Date('2035-01-01T00:00:00Z');
  const errors: string[] = [];
  const clock = () => new Date(now);
  async function account(keys: readonly string[]) {
    const id = await createProofAccount(db.admin),
      role = randomUUID();
    if (keys.length) {
      await db.admin.query(
        `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic editorial role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
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
    const { createRateLimiter, rateLimitKey } =
      await import('../../packages/database/src/index.ts');
    const { createTaxonomyReader } =
      await import('../../packages/database/src/adapters/taxonomy/index.ts');
    const { createPeopleReader } =
      await import('../../packages/database/src/adapters/people-contributors/index.ts');
    authorization = createAuthorizationService({ reader: createAuthorizationReader() });
    const authority = {
      permits: (id: string, key: string) => authorization.hasPermission(id, key),
    };
    store = adapters.createEditorialPersistence();
    reader = adapters.createEditorialPublicReader();
    correspondenceStore = adapters.createCorrespondencePersistence();
    service = createEditorialService({
      persistence: store,
      authority,
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
      },
    });
    const configuration = {
      digestKey: 'synthetic-editorial-proof-digest-key-00000000',
      digestKeyVersion: 1,
    };
    correspondence = createCorrespondenceService({
      persistence: correspondenceStore,
      authority,
      now: clock,
      retentionDays: 30,
      limiter: createRateLimiter(configuration),
      key: (kind, subject) =>
        rateLimitKey({ purpose: 'editorial-' + kind, subject, configuration }),
    });
    author = await account(['content.read', 'content.author', 'content.review']);
    reviewer = await account(['content.read', 'content.review']);
    publisher = await account(['content.read', 'content.publish']);
    operator = await account(['correspondence.read', 'correspondence.administer']);
    stranger = await account([]);
  }, 240000);
  afterAll(async () => {
    await db?.close();
  });
  async function create(kind: EditorialKind, value = content()) {
    return service.create(
      { accountId: author },
      kind,
      value,
      kind === 'page' ? 'help-article' : null,
    );
  }
  async function transition(
    kind: EditorialKind,
    row: ArticleDetail,
    action: WorkflowAction,
    actor: string,
    scheduledAt: string | null = null,
  ) {
    return service.transition({ accountId: actor }, kind, {
      id: row.id,
      expectedVersion: row.version,
      action,
      scheduledAt,
      timezone: scheduledAt ? 'Asia/Karachi' : null,
    });
  }
  async function approved(kind: EditorialKind) {
    return transition(
      kind,
      await transition(kind, await create(kind), 'submit', author),
      'approve',
      reviewer,
    );
  }
  for (const kind of ['article', 'page'] as const)
    describe(kind, () => {
      it('requires separate live grants, independent approval, and exact versions', async () => {
        const row = await create(kind);
        await expect(
          service.detail({ accountId: stranger }, kind, row.id),
        ).rejects.toMatchObject({ reason: 'denied' });
        await expect(
          service.create({ accountId: publisher }, kind, content(), 'help-article'),
        ).rejects.toMatchObject({ reason: 'denied' });
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
        await expect(transition(kind, row, 'approve', reviewer)).rejects.toMatchObject({
          reason: 'conflict',
        });
        const approved = await transition(kind, submitted, 'approve', reviewer);
        expect(approved.approvedRevision).toBe(approved.currentRevision);
        await expect(
          transition(kind, approved, 'publish', reviewer),
        ).rejects.toMatchObject({ reason: 'denied' });
        const published = await transition(kind, approved, 'publish', publisher);
        expect(published.state).toBe('published');
        const publicRow =
          kind === 'article'
            ? await reader.publicArticle(row.slug)
            : await reader.publicPage('help-article', row.slug);
        expect(publicRow?.translations[0]?.html).toContain('Synthetic editorial proof');
        for (const field of [
          'document',
          'creatorId',
          'editorId',
          'approvedById',
          'scheduledById',
        ])
          expect(JSON.stringify(publicRow)).not.toContain(field);
        await transition(kind, published, 'archive', publisher);
        expect(
          kind === 'article'
            ? await reader.publicArticle(row.slug)
            : await reader.publicPage('help-article', row.slug),
        ).toBeNull();
      });
      it('rejects concurrent stale saves and invalidates approval with a new immutable snapshot', async () => {
        const row = await approved(kind),
          changed = content(row.slug);
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
        const history = await service.revisions({ accountId: author }, kind, row.id);
        expect(history.items.map((row) => row.number)).toEqual([2, 1]);
        const table = kind === 'article' ? 'Article' : 'Page';
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
      });
      it('reserves all old slugs permanently and resolves each directly to the latest published slug', async () => {
        let row = await approved(kind);
        const first = row.slug;
        row = await transition(kind, row, 'publish', publisher);
        for (let index = 0; index < 2; index++) {
          row = await service.revise(
            { accountId: author },
            kind,
            row.id,
            row.version,
            content(),
          );
          row = await transition(
            kind,
            await transition(kind, row, 'submit', author),
            'approve',
            reviewer,
          );
          row = await transition(kind, row, 'publish', publisher);
        }
        expect(
          (kind === 'article'
            ? await reader.publicArticle(first)
            : await reader.publicPage('help-article', first)
          )?.slug,
        ).toBe(row.slug);
        await expect(create(kind, content(first))).rejects.toMatchObject({
          reason: 'duplicate-slug',
        });
        const table = kind === 'article' ? 'Article' : 'Page';
        await expect(
          db.admin.query(
            `DELETE FROM [${table}SlugHistory] WHERE [ownerId]=N'${row.id}';`,
          ),
        ).rejects.toThrow();
      });
      it('durably catches up due schedules once, never early, and respects cancellation and edits', async () => {
        const due = new Date(now.getTime() + 60000);
        let row = await transition(
          kind,
          await approved(kind),
          'schedule',
          publisher,
          due.toISOString(),
        );
        expect(await service.runDue()).toBe(0);
        const stored = await service.detail({ accountId: author }, kind, row.id);
        expect(stored.scheduledAt?.toISOString()).toBe(due.toISOString());
        now = new Date(due.getTime() + 3600000);
        const results = await Promise.all([service.runDue(), service.runDue()]);
        expect(results.reduce((a, b) => a + b, 0)).toBe(1);
        expect(await service.runDue()).toBe(0);
        row = await transition(
          kind,
          await approved(kind),
          'schedule',
          publisher,
          new Date(now.getTime() + 60000).toISOString(),
        );
        await transition(kind, row, 'cancel', publisher);
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
          content(edited.slug),
        );
        now = new Date(now.getTime() + 120000);
        expect(await service.runDue()).toBe(0);
      });
      it('fails closed when reviewer or publisher authority is revoked before due execution', async () => {
        for (const permission of ['content.review', 'content.publish']) {
          const actor = await account(['content.read', permission]);
          let row = await transition(kind, await create(kind), 'submit', author);
          row = await transition(
            kind,
            row,
            'approve',
            permission === 'content.review' ? actor : reviewer,
          );
          row = await transition(
            kind,
            row,
            'schedule',
            permission === 'content.publish' ? actor : publisher,
            new Date(now.getTime() + 60000).toISOString(),
          );
          await db.admin.query(
            `UPDATE [RoleAssignment] SET [revokedAt]=SYSUTCDATETIME() WHERE [userId]=N'${actor}' AND [revokedAt] IS NULL;`,
          );
          now = new Date(now.getTime() + 120000);
          expect(await service.runDue()).toBe(0);
          expect(await service.detail({ accountId: author }, kind, row.id)).toMatchObject(
            { state: 'scheduled', scheduleStatus: 'authority-revoked' },
          );
        }
      });
    });
  it('rejects foreign reference IDs and route hijacking in the service and SQL', async () => {
    await expect(
      create('article', { ...content(), topicIds: [randomUUID()] }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    await expect(
      create('article', {
        ...content(),
        contributors: [{ personId: randomUUID(), role: 'author' }],
      }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    await expect(
      service.create({ accountId: author }, 'page', content('page'), '/quran'),
    ).rejects.toMatchObject({ reason: 'invalid' });
    const row = await service.create(
      { accountId: author },
      'page',
      content('page'),
      '/legal/privacy',
    );
    await expect(
      db.admin.query(
        `UPDATE [Page] SET [routeBinding]=N'/quran' WHERE [id]=N'${row.id}';`,
      ),
    ).rejects.toThrow();
    await expect(
      db.admin.query(
        `UPDATE [Page] SET [routeBinding]=N'/legal/terms' WHERE [id]=N'${row.id}';`,
      ),
    ).rejects.toThrow();
  });
  it('projects content.review from actual active Identity grants and revocation', async () => {
    const actor = await account(['content.review']);
    expect((await authorization.contributorCapabilities(actor)).canReviewContent).toBe(
      true,
    );
    await db.admin.query(
      `UPDATE [User] SET [status]=N'disabled' WHERE [id]=N'${actor}';`,
    );
    expect((await authorization.contributorCapabilities(actor)).canReviewContent).toBe(
      false,
    );
  });
  it('keeps correspondence distinct, validates, rate-limits, triages with versions, and purges bounded expired rows', async () => {
    const input = {
      name: 'Synthetic correspondent',
      email: 'synthetic@proof.invalid',
      subject: 'Synthetic contact',
      body: 'PRIVATE-CORRESPONDENCE-SENTINEL',
    };
    await expect(
      correspondence.submit('contact', { ...input, email: 'invalid' }, 'bad'),
    ).rejects.toThrow();
    for (let index = 0; index < 5; index++)
      await correspondence.submit('contact', input, 'bounded-contact');
    await expect(
      correspondence.submit('contact', input, 'bounded-contact'),
    ).rejects.toMatchObject({ reason: 'denied' });
    await correspondence.submit(
      'feedback',
      { category: 'problem', body: 'PRIVATE-FEEDBACK-SENTINEL' },
      'feedback-subject',
    );
    await expect(
      correspondence.directory({ accountId: author }, 'contact', 0),
    ).rejects.toMatchObject({ reason: 'denied' });
    const contacts = await correspondence.directory(
        { accountId: operator },
        'contact',
        0,
      ),
      feedback = await correspondence.directory({ accountId: operator }, 'feedback', 0);
    expect(contacts.items).toHaveLength(5);
    expect(feedback.items).toHaveLength(1);
    const row = contacts.items[0]!;
    await correspondence.triage({ accountId: operator }, 'contact', {
      id: row.id,
      expectedVersion: row.version,
      state: 'spam',
      note: 'PRIVATE-NOTE-SENTINEL',
    });
    await expect(
      correspondence.triage({ accountId: operator }, 'contact', {
        id: row.id,
        expectedVersion: row.version,
        state: 'triaged',
        note: '',
      }),
    ).rejects.toMatchObject({ reason: 'conflict' });
    const audits = await db.admin.query<{ afterState: string; beforeState: string }>(
      `SELECT [afterState],[beforeState] FROM [AuditLog] WHERE [targetType] IN (N'contact',N'feedback');`,
    );
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain('PRIVATE-');
    expect(
      await correspondenceStore.purgeExpired(new Date('2050-01-01T00:00:00Z'), 2),
    ).toBe(3);
    expect(
      (await correspondence.directory({ accountId: operator }, 'contact', 0)).items,
    ).toHaveLength(3);
  });
  it('keeps intake inactive without an accepted retention setting', async () => {
    const { createCorrespondenceIntake } =
      await import('../../apps/web/src/contexts/editorial/index.ts');
    const intake = createCorrespondenceIntake({
      persistence: correspondenceStore,
      retentionDays: null,
      limiter: {
        consume: async () => {
          throw new Error('Limiter must not run while disabled.');
        },
      },
      key: () => 'unused',
    });
    await expect(
      intake.submit(
        'feedback',
        { category: 'problem', body: 'Synthetic gated proof' },
        'gated',
      ),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    const rows = await db.admin.query<{ count: number }>(
      `SELECT COUNT(*) AS [count] FROM [Feedback] WHERE [body]=N'Synthetic gated proof';`,
    );
    expect(rows[0]?.count).toBe(0);
  });
  it('bounds a scheduler sweep and catches up the remainder on the next sweep', async () => {
    const at = new Date(now.getTime() + 60000);
    for (let index = 0; index < 26; index++)
      await transition(
        'article',
        await approved('article'),
        'schedule',
        publisher,
        at.toISOString(),
      );
    now = new Date(at.getTime() + 1000);
    expect(await service.runDue()).toBe(25);
    expect(await service.runDue()).toBe(1);
    expect(await service.runDue()).toBe(0);
  });
  it('has no silently swallowed scheduler errors', () => {
    expect(errors).toEqual([]);
  });
});
