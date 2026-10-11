import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  collectionPathOf,
  memberToken,
  type ArticleDetail,
  type CollectionMember,
  type CollectionMemberKind,
  type EditorialKind,
  type WorkflowAction,
} from '../../packages/contracts/src/editorial/index.ts';
import {
  createEditorialService,
  editorialFailure,
} from '../../apps/web/src/contexts/editorial/index.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';
import {
  createLibraryReadService,
  createLibraryService,
} from '../../apps/web/src/contexts/library/index.ts';
import {
  createMediaReadService,
  createMediaService,
} from '../../apps/web/src/contexts/media/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
// Types only: the module itself is imported after the proof database exists.
import type { resolveCollectionMembers as ResolveCollectionMembers } from '../../apps/web/src/composition/collection-members.ts';

/**
 * Phase 15 — Collections through the SHARED editorial workflow, on real SQL
 * Server, with real members owned by Editorial (Articles and News), Library
 * (Works) and Media (Videos).
 *
 * WHAT IS PROVED: separate live author, reviewer and publisher grants, with
 * neither the creator nor the editor of the current revision able to approve
 * it and no Library, Media or People authority conferring any; stale and
 * concurrent saves, reorders and transitions refused as conflicts; ONE global
 * member order across every type, written and read back exactly; a membership
 * change, a reorder and a topic change each returning the Collection to draft,
 * clearing approval and its publication schedule, and audited as its own fact
 * carrying only a member count; a newly added member having to be public NOW
 * by its OWNER's predicate, asked through the real Layer-4 resolver — while a
 * member the current revision already holds may be kept after its owner
 * withdraws it; scheduled publication re-checking authority, tolerating a
 * duplicate run and bounding a sweep; public reads being published-only, a
 * withdrawn member vanishing from resolution while the Collection still reads,
 * and archiving or shrinking a Collection changing no member's row; former
 * slugs resolving only while published; the listing, topic preview and sitemap
 * being exact and deterministic; and no Search intent from any Collection.
 *
 * EVERYTHING IS SYNTHETIC: titles say they are fixtures, and the "draft" titles
 * are sentinels whose absence from every refusal and public answer is checked.
 */

const live = databaseConfigured ? describe : describe.skip;

const TITLE = 'Synthetic collection proof';
const BODY_SENTINEL = 'COLLECTION-BODY-SENTINEL';
const TARGET_TITLE = 'Synthetic public member';
const DRAFT_TITLE = 'DRAFT-MEMBER-TITLE-SENTINEL';
const document = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

let sequence = 0;
const unique = (prefix: string) => {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${randomUUID().slice(0, 8)}`;
};

/** The shared editorial content, with no member field: an Article's or a News record's. */
function words(
  overrides: {
    slug?: string;
    title?: string;
    excerpt?: string;
    topicIds?: readonly string[];
    contributors?: readonly { personId: string; role: string }[];
    languages?: readonly ('en' | 'ur' | 'ar')[];
  } = {},
) {
  const languages = overrides.languages ?? ['en'];
  return {
    slug: overrides.slug ?? unique('collection-proof'),
    primaryLanguage: languages[0],
    translations: languages.map((languageCode) => ({
      languageCode,
      title: overrides.title ?? TITLE,
      excerpt: overrides.excerpt ?? 'Non-authoritative test fixture',
      seoTitle: '',
      seoDescription: '',
      document: document(`${overrides.title ?? TITLE} ${BODY_SENTINEL}.`),
    })),
    topicIds: [...(overrides.topicIds ?? [])],
    contributors: [...(overrides.contributors ?? [])],
  };
}

function content(
  members: readonly CollectionMember[],
  overrides: Parameters<typeof words>[0] = {},
) {
  return { ...words(overrides), members: [...members] };
}

live('Phase 15 Collections against real SQL Server', () => {
  let db: DisposableDatabase;
  let service: ReturnType<typeof createEditorialService>;
  let reads: ReturnType<typeof createEditorialReadService>;
  let library: ReturnType<typeof createLibraryService>;
  let libraryReads: ReturnType<typeof createLibraryReadService>;
  let media: ReturnType<typeof createMediaService>;
  let mediaReads: ReturnType<typeof createMediaReadService>;
  let resolve: typeof ResolveCollectionMembers;
  let people: Phase5Fixture;
  let author: string,
    editor: string,
    authorOnly: string,
    readerOnly: string,
    reviewer: string,
    publisher: string,
    stranger: string,
    libraryAdministrator: string,
    mediaAdministrator: string;
  let topics: readonly string[];
  /** The WORKFLOW clock: when an action happens. */
  let now = new Date('2035-01-01T00:00:00Z');
  const tick = (ms = 1000) => {
    now = new Date(now.getTime() + ms);
  };
  const errors: string[] = [];
  /** Members created once and reused where WHICH member does not matter. */
  let anyPublic: CollectionMember;

  async function account(keys: readonly string[]): Promise<string> {
    const id = await createProofAccount(db.admin);
    if (keys.length === 0) return id;
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic collection role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
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
      return editorialFailure(error);
    }
    return 'accepted';
  };
  /** The refusal itself, so what it says can be inspected. */
  const thrown = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('Expected a refusal.');
  };

  const count = async (sql: string) =>
    Number((await db.admin.query<{ n: number }>(sql))[0]?.n ?? -1);

  /* ---- Editorial workflow, for any kind ---------------------------------- */

  const transitionOf = (
    kind: EditorialKind,
    row: ArticleDetail,
    action: WorkflowAction,
    actor: string,
    scheduledAt: Date | null = null,
  ) =>
    service.transition({ accountId: actor }, kind, {
      id: row.id,
      expectedVersion: row.version,
      action,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      timezone: scheduledAt ? 'Asia/Karachi' : null,
    });
  const publishedOf = async (kind: EditorialKind, value: unknown) => {
    const created = await service.create({ accountId: author }, kind, value);
    const approved = await transitionOf(
      kind,
      await transitionOf(kind, created, 'submit', author),
      'approve',
      reviewer,
    );
    return transitionOf(kind, approved, 'publish', publisher);
  };

  /* ---- Collection helpers ------------------------------------------------- */

  const create = (value: unknown, actor = author) =>
    service.create({ accountId: actor }, 'collection', value);
  const revise = (row: ArticleDetail, value: unknown, actor = author) =>
    service.revise({ accountId: actor }, 'collection', row.id, row.version, value);
  const detail = (id: string) => service.detail({ accountId: author }, 'collection', id);
  const transition = (
    row: ArticleDetail,
    action: WorkflowAction,
    actor: string,
    scheduledAt: Date | null = null,
  ) => transitionOf('collection', row, action, actor, scheduledAt);
  const approved = async (value: unknown) =>
    transition(
      await transition(await create(value), 'submit', author),
      'approve',
      reviewer,
    );
  const reapproved = async (row: ArticleDetail) =>
    transition(await transition(row, 'submit', author), 'approve', reviewer);
  const published = async (value: unknown) => {
    tick();
    return transition(await approved(value), 'publish', publisher);
  };
  /** The content a Collection row holds now, re-submitted with changes. */
  const same = (row: ArticleDetail, overrides: Parameters<typeof words>[0] = {}) =>
    content(row.revision.members ?? [], { slug: row.slug, ...overrides });

  /* ---- Members, created through their real owners ------------------------ */

  const article = async (title = TARGET_TITLE): Promise<CollectionMember> => ({
    kind: 'article',
    id: (await publishedOf('article', words({ title }))).id,
  });
  const draftArticle = async (): Promise<CollectionMember> => ({
    kind: 'article',
    id: (
      await service.create(
        { accountId: author },
        'article',
        words({ title: DRAFT_TITLE }),
      )
    ).id,
  });
  const news = async (
    kind: 'news-article' | 'press-release' = 'news-article',
  ): Promise<CollectionMember> => ({
    kind,
    id: (await publishedOf(kind, words({ title: TARGET_TITLE }))).id,
  });
  const archiveArticle = async (id: string) => {
    const row = await service.detail({ accountId: author }, 'article', id);
    await transitionOf('article', row, 'archive', publisher);
  };

  const workInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('work'),
    primaryLocale: 'en',
    state: 'published',
    isFeatured: false,
    labels: [{ locale: 'en', title: TARGET_TITLE, description: '' }],
    contributors: [],
    topicIds: [],
    salePointIds: [],
    ...overrides,
  });
  const editionInput = (workId: string) => ({
    workId,
    label: 'Synthetic edition',
    languageCode: 'en',
    state: 'published' as const,
    publisher: null,
    publicationYear: null,
    isbn: null,
    pageCount: null,
    reading: 'allowed' as const,
    download: 'denied' as const,
    readableAssetId: null,
    downloadAssetId: null,
    document: {
      sections: [{ key: 'opening', title: 'Opening', paragraphs: ['Synthetic text.'] }],
    },
  });
  /** A PUBLIC Work: published, with a published Edition. */
  const work = async (): Promise<CollectionMember & { slug: string }> => {
    const saved = await library.saveWork(
      { accountId: libraryAdministrator },
      null,
      null,
      workInput(),
    );
    await library.saveEdition(
      { accountId: libraryAdministrator },
      null,
      null,
      editionInput(saved.id),
    );
    return { kind: 'work', id: saved.id, slug: saved.slug };
  };
  const withdrawWork = async (id: string) => {
    const current = await library.work({ accountId: libraryAdministrator }, id);
    if (current === null) throw new Error('Work missing.');
    await library.saveWork(
      { accountId: libraryAdministrator },
      id,
      current.version,
      workInput({ slug: current.slug, state: 'draft' }),
    );
  };

  const videoInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('video'),
    primaryLocale: 'en',
    state: 'published',
    isFeatured: false,
    provider: 'youtube',
    providerReference: `Zc${randomUUID().replaceAll('-', '').slice(0, 9)}`,
    availability: 'available',
    format: 'lecture',
    languageCode: 'en',
    labels: [{ locale: 'en', title: TARGET_TITLE, description: '' }],
    durationSeconds: 600,
    publishedOn: null,
    thumbnailUrl: null,
    captions: false,
    transcript: null,
    seriesId: null,
    seriesPosition: null,
    speakerIds: [],
    topicIds: [],
    ...overrides,
  });
  const video = async (
    overrides: Record<string, unknown> = {},
  ): Promise<CollectionMember & { slug: string }> => {
    const saved = await media.saveVideo(
      { accountId: mediaAdministrator },
      null,
      null,
      videoInput(overrides),
    );
    return { kind: 'video', id: saved.id, slug: saved.slug };
  };
  const withdrawVideo = async (id: string) => {
    const current = await media.video({ accountId: mediaAdministrator }, id);
    if (current === null) throw new Error('Video missing.');
    await media.saveVideo(
      { accountId: mediaAdministrator },
      id,
      current.version,
      videoInput({
        slug: current.slug,
        providerReference: current.providerVideoId,
        state: 'draft',
      }),
    );
  };

  /** Every row the members own, so "nothing changed" is checked, not assumed. */
  const targetRows = async (members: readonly CollectionMember[]) => {
    const tables: Record<CollectionMemberKind, string[]> = {
      article: ['Article'],
      'news-article': ['NewsArticle'],
      'press-release': ['PressRelease'],
      statement: ['Statement'],
      'media-coverage': ['MediaCoverage'],
      work: ['Work', 'WorkLabel:workId', 'Edition:workId'],
      video: ['Video', 'VideoLabel:videoId'],
    };
    const rows: unknown[] = [];
    for (const entry of members)
      for (const table of tables[entry.kind]) {
        const [name, column = 'id'] = table.split(':');
        rows.push(
          await db.admin.query(
            `SELECT * FROM [${name ?? ''}] WHERE [${column}]=N'${entry.id}' ORDER BY 1;`,
          ),
        );
      }
    return JSON.stringify(rows);
  };

  const audits = (id: string) =>
    db.admin.query<{
      action: string;
      beforeState: string | null;
      afterState: string | null;
    }>(
      `SELECT [action],[beforeState],[afterState] FROM [AuditLog] WHERE [targetId]=N'${id}' ORDER BY [occurredAt];`,
    );
  const auditCount = (id: string, action: string) =>
    count(
      `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [targetId]=N'${id}' AND [action]=N'editorial.collection.${action}';`,
    );

  beforeAll(async () => {
    db = await createProofDatabase();
    const database = await import('../../packages/database/src/index.ts');
    // The REAL Layer-4 resolver: each member asked of its owner's public read.
    resolve = (await import('../../apps/web/src/composition/collection-members.ts'))
      .resolveCollectionMembers;
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    const authority = {
      permits: (id: string, key: string) => authorization.hasPermission(id, key),
    };
    reads = createEditorialReadService(database.createEditorialPublicReader());
    service = createEditorialService({
      persistence: database.createEditorialPersistence(),
      authority,
      now: () => new Date(now),
      reportFailure: (operation) => errors.push(operation),
      references: {
        validTopics: async (ids) =>
          (await database.createTaxonomyReader().topicReferences(ids, 'en')).length ===
          ids.length,
        validContributors: async (ids) =>
          (
            await database
              .createPeopleReader()
              .contributorReferences([...new Set(ids)], 'en')
          ).length === new Set(ids).size,
        validLanguages: async (codes) => {
          const languages = await database.createTaxonomyReader().listLanguages({
            includeRetired: false,
          });
          return codes.every((code) => languages.some((entry) => entry.code === code));
        },
        // Neither a Centre nor a Gallery is any Collection's.
        selectableCentre: async () => false,
        selectableGallery: async () => false,
        // Exactly what `composition/editorial.ts` wires: every member's OWNER
        // asked in one grouped read, strict, so "could not ask" is never "no".
        async selectableMembers(members) {
          const { targets } = await resolve(members, { strict: true });
          return members.every((entry) => targets.has(memberToken(entry)));
        },
      },
    });
    library = createLibraryService({
      persistence: database.createLibraryPersistence(),
      authority,
      references: {
        validPeople: async () => true,
        validTopics: async () => true,
        validLanguage: async () => true,
      },
    });
    libraryReads = createLibraryReadService(database.createLibraryPublicReader());
    media = createMediaService({
      persistence: database.createMediaPersistence(),
      authority,
      references: {
        validPeople: async () => true,
        validTopics: async () => true,
        validLanguage: async () => true,
      },
    });
    mediaReads = createMediaReadService(database.createMediaPublicReader());

    author = await account(['content.read', 'content.author', 'content.review']);
    editor = await account(['content.read', 'content.author', 'content.review']);
    authorOnly = await account(['content.read', 'content.author']);
    readerOnly = await account(['content.read']);
    reviewer = await account(['content.read', 'content.review']);
    publisher = await account(['content.read', 'content.publish']);
    stranger = await account([]);
    libraryAdministrator = await account(['library.read', 'library.administer']);
    mediaAdministrator = await account(['media.read', 'media.administer']);
    // A real account linked to a real Person holding all four profiles, and no
    // role: what a profile alone confers.
    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);

    topics = (
      await db.admin.query<{ id: string }>(
        "SELECT TOP 2 [id] FROM [Topic] WHERE [status]=N'active' ORDER BY [slug];",
      )
    ).map((row) => row.id);
    if (topics.length !== 2) throw new Error('Two active canonical topics are required.');
    anyPublic = await article();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it('starts with no published Collection', async () => {
    expect(await reads.collections(0)).toEqual({ items: [], more: false });
    expect(await count('SELECT COUNT(*) AS n FROM [Collection];')).toBe(0);
  });

  describe('authority is the content.* keys, live, and nothing else', () => {
    it('requires separate grants and refuses approval by the creator or the editor', async () => {
      const row = await create(content([anyPublic]));
      expect(
        await refusal(service.detail({ accountId: stranger }, 'collection', row.id)),
      ).toBe('denied');
      expect(await refusal(create(content([anyPublic]), publisher))).toBe('denied');
      expect(await refusal(transition(row, 'publish', publisher))).toBe('invalid-state');

      // Another author edits it: the current revision is now THEIRS.
      const edited = await revise(row, same(row, { excerpt: 'Edited' }), editor);
      expect(edited.revision.editorId).toBe(editor);
      expect(edited.creatorId).toBe(author);
      const submitted = await transition(edited, 'submit', editor);
      // Neither its creator nor its editor may approve it, though both hold
      // content.review — there is no administrator exception.
      expect(await refusal(transition(submitted, 'approve', author))).toBe(
        'self-approval',
      );
      expect(await refusal(transition(submitted, 'approve', editor))).toBe(
        'self-approval',
      );
      expect(await refusal(transition(submitted, 'publish', publisher))).toBe(
        'approval-required',
      );
      expect(await refusal(transition(submitted, 'approve', publisher))).toBe('denied');
      const ok = await transition(submitted, 'approve', reviewer);
      expect(ok.approvedRevision).toBe(ok.currentRevision);
      expect(await refusal(transition(ok, 'publish', reviewer))).toBe('denied');
      tick();
      const live = await transition(ok, 'publish', publisher);
      expect(live.state).toBe('published');

      // The database refuses self-approval whoever writes.
      const own = await transition(await create(content([anyPublic])), 'submit', author);
      await expect(
        db.admin.query(
          `UPDATE [Collection] SET [approvedRevision]=[currentRevision],[approvedById]=N'${author}',[version]=[version]+1 WHERE [id]=N'${own.id}';`,
        ),
      ).rejects.toThrow();

      // The public record carries no authoring document and no workflow actor.
      const shown = await reads.collection(row.slug);
      expect(shown?.translations[0]?.html).toContain(BODY_SENTINEL);
      expect(shown?.members).toEqual([anyPublic]);
      for (const field of [
        'document',
        'creatorId',
        'editorId',
        'approvedById',
        'scheduledById',
        'version',
        author,
        editor,
        reviewer,
        publisher,
      ])
        expect(JSON.stringify(shown)).not.toContain(field);
    });

    it('lets content.read only read, and content.author neither review nor publish', async () => {
      const row = await create(content([anyPublic]));
      expect(
        (await service.detail({ accountId: readerOnly }, 'collection', row.id)).id,
      ).toBe(row.id);
      expect(await refusal(create(content([anyPublic]), readerOnly))).toBe('denied');
      expect(await refusal(revise(row, same(row), readerOnly))).toBe('denied');
      expect(await refusal(transition(row, 'submit', readerOnly))).toBe('denied');

      const submitted = await transition(row, 'submit', author);
      expect(await refusal(transition(submitted, 'approve', authorOnly))).toBe('denied');
      const ok = await transition(submitted, 'approve', reviewer);
      expect(await refusal(transition(ok, 'publish', authorOnly))).toBe('denied');
      expect(
        await refusal(
          transition(ok, 'schedule', authorOnly, new Date(now.getTime() + 60_000)),
        ),
      ).toBe('denied');
      expect((await detail(row.id)).state).toBe('in-review');
    });

    it('grants nothing to library.*, media.* or a People profile', async () => {
      const row = await create(
        content([anyPublic], {
          contributors: [{ personId: people.linkedPersonId, role: 'speaker' }],
        }),
      );
      for (const actor of [libraryAdministrator, mediaAdministrator, people.accountId]) {
        expect(await refusal(create(content([anyPublic]), actor)), actor).toBe('denied');
        expect(
          await refusal(service.detail({ accountId: actor }, 'collection', row.id)),
        ).toBe('denied');
        expect(await refusal(revise(row, same(row), actor))).toBe('denied');
        expect(await refusal(transition(row, 'submit', actor))).toBe('denied');
        expect(await refusal(service.directory({ accountId: actor }, 'collection'))).toBe(
          'denied',
        );
      }
      // Credited on the Collection and still nothing: a profile alone grants nothing.
      expect((await detail(row.id)).revision.contributors).toEqual([
        { personId: people.linkedPersonId, role: 'speaker' },
      ]);
      // And the reverse: full Editorial authority confers no Library or Media
      // authority over the members a Collection names.
      await expect(
        library.saveWork({ accountId: author }, null, null, workInput()),
      ).rejects.toMatchObject({ reason: 'denied' });
      await expect(
        media.saveVideo({ accountId: author }, null, null, videoInput()),
      ).rejects.toMatchObject({ reason: 'denied' });
    });
  });

  describe('ONE ordered list of typed members', () => {
    it('writes and reads back a mixed list in exactly its one global order', async () => {
      const a1 = await article();
      const n1 = await news();
      const p1 = await news('press-release');
      const w1 = await work();
      const v1 = await video();
      const a2 = await article();
      const order = [v1, a1, w1, n1, a2, p1].map(({ kind, id }) => ({ kind, id }));
      const row = await create(content(order));
      expect(row.revision.members).toEqual(order);
      expect((await detail(row.id)).revision.members).toEqual(order);

      // Each place is one row, one typed column, in the order given.
      const items = await db.admin.query<Record<string, string | number | null>>(
        `SELECT [position],[articleId],[newsArticleId],[pressReleaseId],[statementId],[mediaCoverageId],[workId],[videoId]
         FROM [CollectionItem] WHERE [ownerId]=N'${row.id}' AND [revisionNumber]=1 ORDER BY [position];`,
      );
      const column: Record<CollectionMemberKind, string> = {
        article: 'articleId',
        'news-article': 'newsArticleId',
        'press-release': 'pressReleaseId',
        statement: 'statementId',
        'media-coverage': 'mediaCoverageId',
        work: 'workId',
        video: 'videoId',
      };
      expect(items).toHaveLength(order.length);
      items.forEach((item, index) => {
        const expected = order[index] as CollectionMember;
        expect(item['position']).toBe(index);
        for (const [kind, name] of Object.entries(column))
          expect(item[name], `${String(index)} ${kind}`).toBe(
            kind === expected.kind ? expected.id : null,
          );
      });

      // A revision with the same members reversed keeps ITS order; the first
      // revision keeps its own.
      const reversed = [...order].reverse();
      const next = await revise(row, content(reversed, { slug: row.slug }));
      expect(next.revision.members).toEqual(reversed);
      const history = await service.revisions(
        { accountId: author },
        'collection',
        row.id,
      );
      expect(history.items.map((revision) => revision.members)).toEqual([
        reversed,
        order,
      ]);

      // Published, the public record names the members in that order.
      const live = await transition(await reapproved(next), 'publish', publisher);
      expect((await reads.collection(live.slug))?.members).toEqual(reversed);

      // Nothing rewrites a stored revision's membership: only a new revision can.
      for (const statement of [
        `UPDATE [CollectionItem] SET [position]=[position] WHERE [ownerId]=N'${row.id}';`,
        `DELETE FROM [CollectionItem] WHERE [ownerId]=N'${row.id}' AND [revisionNumber]=1;`,
        `INSERT INTO [CollectionItem] ([ownerId],[revisionNumber],[position],[articleId]) VALUES (N'${row.id}',1,50,N'${anyPublic.id}');`,
      ])
        await expect(db.admin.query(statement), statement).rejects.toThrow();
    });

    it('refuses an empty, oversized or duplicated list and a member of an unsupported type', async () => {
      const before = await count('SELECT COUNT(*) AS n FROM [Collection];');
      expect(await refusal(create(content([])))).toBe('invalid');
      expect(await refusal(create(content([anyPublic, { ...anyPublic }])))).toBe(
        'invalid',
      );
      expect(
        await refusal(
          create(
            content(
              Array.from({ length: 101 }, () => ({
                kind: 'article' as const,
                id: randomUUID(),
              })),
            ),
          ),
        ),
      ).toBe('invalid');
      expect(
        await refusal(
          create({
            ...content([anyPublic]),
            members: [{ kind: 'event', id: randomUUID() }],
          }),
        ),
      ).toBe('invalid');
      // Another family's fields are not a Collection's.
      for (const extra of [
        { centreId: null },
        { galleryIds: [] },
        {
          schedule: {
            timezone: 'Asia/Karachi',
            occurrences: [{ start: '2041-11-14T19:00' }],
          },
        },
      ])
        expect(await refusal(create({ ...content([anyPublic]), ...extra }))).toBe(
          'invalid',
        );
      // And a Collection's member field is no other family's.
      expect(
        await refusal(
          service.create({ accountId: author }, 'article', {
            ...words(),
            members: [anyPublic],
          }),
        ),
      ).toBe('invalid');
      expect(await count('SELECT COUNT(*) AS n FROM [Collection];')).toBe(before);
    });
  });

  describe('versions are the lock', () => {
    it('refuses a stale revise, approve, publish and archive', async () => {
      const row = await create(content([anyPublic]));
      const revised = await revise(row, same(row, { excerpt: 'Once' }));
      expect(await refusal(revise(row, same(row, { excerpt: 'Twice' })))).toBe(
        'conflict',
      );
      const submitted = await transition(revised, 'submit', author);
      expect(await refusal(transition(revised, 'approve', reviewer))).toBe('conflict');
      const ok = await transition(submitted, 'approve', reviewer);
      expect(await refusal(transition(submitted, 'publish', publisher))).toBe('conflict');
      const live = await transition(ok, 'publish', publisher);
      expect(await refusal(transition(ok, 'archive', publisher))).toBe('conflict');
      const archived = await transition(live, 'archive', publisher);
      expect(archived.state).toBe('archived');
    });

    it('lets exactly one of two concurrent metadata saves of one version win', async () => {
      const row = await approved(content([anyPublic]));
      const outcomes = await Promise.all(
        ['First', 'Second'].map((excerpt) =>
          refusal(revise(row, same(row, { excerpt }))),
        ),
      );
      expect(outcomes.sort()).toEqual(['accepted', 'conflict']);
      expect(await detail(row.id)).toMatchObject({
        currentRevision: 2,
        approvedRevision: null,
        state: 'draft',
      });
    });

    it('lets exactly one of two concurrent reorders of one version win', async () => {
      const a = await article();
      const b = await article();
      const c = await article();
      const row = await create(content([a, b, c]));
      const outcomes = await Promise.all(
        [
          [c, b, a],
          [b, a, c],
        ].map((members) => refusal(revise(row, content(members, { slug: row.slug })))),
      );
      expect(outcomes.sort()).toEqual(['accepted', 'conflict']);
      const after = await detail(row.id);
      expect(after.currentRevision).toBe(2);
      expect([
        [c, b, a],
        [b, a, c],
      ]).toContainEqual(after.revision.members);
      expect(await auditCount(row.id, 'members-reordered')).toBe(1);
    });
  });

  describe('a membership, order or topic change is an edit', () => {
    it('returns the Collection to draft, clears approval and its publication schedule, and audits each fact with only a count', async () => {
      const a = await article();
      const w = await work();
      const v = await video();
      const [first, second] = topics as [string, string];
      const base = [a, w].map(({ kind, id }) => ({ kind, id }));
      const scheduled = await transition(
        await approved(content(base, { topicIds: [first] })),
        'schedule',
        publisher,
        new Date(now.getTime() + 60_000),
      );
      expect(scheduled).toMatchObject({ state: 'scheduled' });

      // A member added: back to draft, approval and publication schedule gone.
      const grown = [...base, { kind: v.kind, id: v.id }];
      const added = await revise(
        scheduled,
        content(grown, { slug: scheduled.slug, topicIds: [first] }),
      );
      expect(added).toMatchObject({
        state: 'draft',
        approvedRevision: null,
        approvedById: null,
        scheduledRevision: null,
        scheduledAt: null,
        scheduleStatus: 'cancelled',
      });
      // The cancelled publication never fires.
      tick(120_000);
      expect(await service.runDue()).toBe(0);
      expect((await detail(scheduled.id)).state).toBe('draft');

      // The same members in another order: a reorder, and again a fresh review.
      const reordered = await revise(
        await reapproved(added),
        content([...grown].reverse(), { slug: scheduled.slug, topicIds: [first] }),
      );
      expect(reordered).toMatchObject({ state: 'draft', approvedRevision: null });
      expect(reordered.revision.members).toEqual([...grown].reverse());

      // Rescheduled, then its topics changed: back to draft once more.
      const rescheduled = await transition(
        await reapproved(reordered),
        'schedule',
        publisher,
        new Date(now.getTime() + 60_000),
      );
      const retopiced = await revise(
        rescheduled,
        content([...grown].reverse(), {
          slug: scheduled.slug,
          topicIds: [second, first],
        }),
      );
      expect(retopiced).toMatchObject({
        state: 'draft',
        approvedRevision: null,
        scheduledRevision: null,
        scheduledAt: null,
        scheduleStatus: 'cancelled',
      });

      // A member removed is a membership change too.
      const shrunk = await revise(
        retopiced,
        content([{ kind: w.kind, id: w.id }], {
          slug: scheduled.slug,
          topicIds: [second, first],
        }),
      );
      expect(shrunk.revision.members).toEqual([{ kind: w.kind, id: w.id }]);
      // An edit of the words alone records no member or topic fact — the
      // topics are a set, so submitting them in another order changes nothing.
      await revise(
        shrunk,
        content([{ kind: w.kind, id: w.id }], {
          slug: scheduled.slug,
          topicIds: [first, second],
          excerpt: 'Words only',
        }),
      );

      expect(await auditCount(scheduled.id, 'created')).toBe(1);
      expect(await auditCount(scheduled.id, 'members-changed')).toBe(2);
      expect(await auditCount(scheduled.id, 'members-reordered')).toBe(1);
      expect(await auditCount(scheduled.id, 'topics-changed')).toBe(1);
      expect(await auditCount(scheduled.id, 'revised')).toBe(5);

      // What each membership fact records: the workflow fields and the COUNT.
      const rows = await audits(scheduled.id);
      const counts = rows
        .filter((row) =>
          /editorial\.collection\.(created|members-changed|members-reordered)$/u.test(
            row.action,
          ),
        )
        .map((row) => [
          row.action.replace('editorial.collection.', ''),
          (JSON.parse(row.afterState ?? '{}') as Record<string, string>)['members'],
        ]);
      expect(counts).toEqual([
        ['created', '2'],
        ['members-changed', '3'],
        ['members-reordered', '3'],
        ['members-changed', '1'],
      ]);
      for (const row of rows)
        for (const key of Object.keys(JSON.parse(row.afterState ?? '{}') as object))
          expect(
            [
              'version',
              'state',
              'revision',
              'approvedRevision',
              'scheduledRevision',
              'scheduledAt',
              'scheduleStatus',
              'members',
            ],
            `${row.action} ${key}`,
          ).toContain(key);

      // No title, body, member title, member or topic identifier reaches the
      // audit log.
      const text = JSON.stringify(rows);
      for (const secret of [
        TITLE,
        TARGET_TITLE,
        BODY_SENTINEL,
        'Words only',
        a.id,
        w.id,
        v.id,
        first,
        second,
      ])
        expect(text, secret).not.toContain(secret);
    });
  });

  describe('a newly added member must be public NOW, by its owner', () => {
    it('refuses a draft Article, a non-public Work and an unpublished Video, and leaks none of their titles', async () => {
      const draft = await draftArticle();
      const inReview = {
        kind: 'article' as const,
        id: (
          await transitionOf(
            'article',
            await service.create(
              { accountId: author },
              'article',
              words({ title: DRAFT_TITLE }),
            ),
            'submit',
            author,
          )
        ).id,
      };
      const draftNews = {
        kind: 'statement' as const,
        id: (
          await service.create({ accountId: author }, 'statement', {
            ...words({ title: DRAFT_TITLE }),
            translations: words({ title: DRAFT_TITLE }).translations.map((t) => ({
              ...t,
              issuer: 'Synthetic Issuing Office',
            })),
          })
        ).id,
      };
      // Published, but with no published Edition: NOT a public Work.
      const editionless = await library.saveWork(
        { accountId: libraryAdministrator },
        null,
        null,
        workInput({ labels: [{ locale: 'en', title: DRAFT_TITLE, description: '' }] }),
      );
      // A draft Work, even with a published Edition.
      const draftWork = await library.saveWork(
        { accountId: libraryAdministrator },
        null,
        null,
        workInput({
          state: 'draft',
          labels: [{ locale: 'en', title: DRAFT_TITLE, description: '' }],
        }),
      );
      await library.saveEdition(
        { accountId: libraryAdministrator },
        null,
        null,
        editionInput(draftWork.id),
      );
      const draftVideo = await video({
        state: 'draft',
        labels: [{ locale: 'en', title: DRAFT_TITLE, description: '' }],
      });
      const refused: CollectionMember[] = [
        draft,
        inReview,
        draftNews,
        { kind: 'work', id: editionless.id },
        { kind: 'work', id: draftWork.id },
        { kind: draftVideo.kind, id: draftVideo.id },
        // A record that does not exist at all, of every type.
        ...(
          [
            'article',
            'news-article',
            'press-release',
            'statement',
            'media-coverage',
            'work',
            'video',
          ] as const
        ).map((kind) => ({ kind, id: randomUUID() })),
        // A real record under the WRONG type: an Article's id is no Work.
        { kind: 'work', id: anyPublic.id },
      ];

      const before = await count('SELECT COUNT(*) AS n FROM [Collection];');
      const existing = await create(content([anyPublic]));
      for (const member of refused) {
        const error = await thrown(create(content([anyPublic, member])));
        expect(editorialFailure(error), JSON.stringify(member)).toBe('invalid');
        const said = `${String(error)} ${JSON.stringify(error)} ${(error as Error).message ?? ''}`;
        expect(said, JSON.stringify(member)).not.toContain(DRAFT_TITLE);
        expect(
          await refusal(
            revise(existing, content([anyPublic, member], { slug: existing.slug })),
          ),
          JSON.stringify(member),
        ).toBe('invalid');
      }
      expect(await count('SELECT COUNT(*) AS n FROM [Collection];')).toBe(before + 1);
      expect((await detail(existing.id)).currentRevision).toBe(1);

      // Nor does any owner OFFER a draft to the editor's selector.
      const { collectionMemberChoices } =
        await import('../../apps/web/src/composition/collection-members.ts');
      const offered = await collectionMemberChoices(DRAFT_TITLE);
      expect(offered).toEqual([]);
      expect(JSON.stringify(await reads.memberChoices('article', DRAFT_TITLE))).toBe(
        '[]',
      );
      expect(await libraryReads.workChoices(DRAFT_TITLE)).toEqual([]);
      expect(await mediaReads.videoChoices(DRAFT_TITLE)).toEqual([]);
      // While a public record of each owner IS offered.
      const choices = await collectionMemberChoices(TARGET_TITLE);
      expect(new Set(choices.map((choice) => choice.kind))).toEqual(
        new Set(['article', 'news-article', 'press-release', 'work', 'video']),
      );
      expect(JSON.stringify(choices)).not.toContain(DRAFT_TITLE);
    });

    it('keeps a member the current revision holds after its owner withdraws it, but never adds it anew', async () => {
      const a = await article();
      const keep = await article();
      const w = await work();
      const v = await video();
      const members = [a, w, v, keep].map(({ kind, id }) => ({ kind, id }));
      const row = await create(content(members));

      await archiveArticle(a.id);
      await withdrawWork(w.id);
      await withdrawVideo(v.id);
      const { targets } = await resolve(members);
      expect([...targets.keys()]).toEqual([memberToken(keep)]);

      // Re-saved with its words changed, every withdrawn member is kept, in place.
      const resaved = await revise(
        row,
        content(members, { slug: row.slug, excerpt: 'Kept' }),
      );
      expect(resaved.revision.members).toEqual(members);
      // …and may even be reordered, since none is NEW to the revision.
      const shuffled = [
        members[3],
        members[0],
        members[2],
        members[1],
      ] as CollectionMember[];
      const moved = await revise(resaved, content(shuffled, { slug: row.slug }));
      expect(moved.revision.members).toEqual(shuffled);

      // Adding any of them to another Collection is refused.
      const other = await create(content([keep]));
      for (const withdrawn of members.slice(0, 3)) {
        expect(await refusal(create(content([keep, withdrawn])))).toBe('invalid');
        expect(
          await refusal(revise(other, content([keep, withdrawn], { slug: other.slug }))),
        ).toBe('invalid');
      }
      // Removed, then chosen back: it is NEW again, and refused.
      const without = await revise(
        moved,
        content([keep, { kind: w.kind, id: w.id }, { kind: v.kind, id: v.id }], {
          slug: row.slug,
        }),
      );
      expect(
        await refusal(
          revise(
            without,
            content([keep, { kind: w.kind, id: w.id }, { kind: v.kind, id: v.id }, a], {
              slug: row.slug,
            }),
          ),
        ),
      ).toBe('invalid');
    });
  });

  describe('scheduled publication', () => {
    it('publishes a due Collection beside a due Article once, never early, and a duplicate run is harmless', async () => {
      const due = new Date(now.getTime() + 60_000);
      const row = await transition(
        await approved(content([anyPublic])),
        'schedule',
        publisher,
        due,
      );
      const neighbour = await transitionOf(
        'article',
        await transitionOf(
          'article',
          await transitionOf(
            'article',
            await service.create({ accountId: author }, 'article', words()),
            'submit',
            author,
          ),
          'approve',
          reviewer,
        ),
        'schedule',
        publisher,
        due,
      );
      expect(await service.runDue()).toBe(0);
      expect(await reads.collection(row.slug)).toBeNull();
      // Catch-up: the sweep runs long after the instant, and twice at once.
      now = new Date(due.getTime() + 3_600_000);
      const results = await Promise.all([service.runDue(), service.runDue()]);
      expect(results.reduce((x, y) => x + y, 0)).toBe(2);
      expect(await service.runDue()).toBe(0);
      expect((await detail(row.id)).state).toBe('published');
      expect(
        (await service.detail({ accountId: author }, 'article', neighbour.id)).state,
      ).toBe('published');
      expect((await reads.collection(row.slug))?.slug).toBe(row.slug);
      expect(await auditCount(row.id, 'publish')).toBe(1);

      // A cancelled schedule returns it to review and never fires.
      const cancelled = await transition(
        await transition(
          await approved(content([anyPublic])),
          'schedule',
          publisher,
          new Date(now.getTime() + 60_000),
        ),
        'cancel',
        publisher,
      );
      tick(120_000);
      expect(await service.runDue()).toBe(0);
      expect((await detail(cancelled.id)).state).toBe('in-review');
    });

    it('re-checks authority when due: a revoked publisher’s schedule stops', async () => {
      const actor = await account(['content.read', 'content.publish']);
      const row = await transition(
        await approved(content([anyPublic])),
        'schedule',
        actor,
        new Date(now.getTime() + 60_000),
      );
      await db.admin.query(
        `UPDATE [RoleAssignment] SET [revokedAt]=SYSUTCDATETIME() WHERE [userId]=N'${actor}' AND [revokedAt] IS NULL;`,
      );
      tick(120_000);
      expect(await service.runDue()).toBe(0);
      expect(await detail(row.id)).toMatchObject({
        state: 'scheduled',
        scheduleStatus: 'authority-revoked',
      });
      expect(await reads.collection(row.slug)).toBeNull();
      expect(await auditCount(row.id, 'authority-revoked')).toBe(1);
      tick(120_000);
      expect(await service.runDue()).toBe(0);
    });

    it('bounds a sweep at 25 Collections and catches up the remainder next time', async () => {
      const at = new Date(now.getTime() + 60_000);
      for (let index = 0; index < 26; index++)
        await transition(await approved(content([anyPublic])), 'schedule', publisher, at);
      now = new Date(at.getTime() + 1000);
      expect(await service.runDue()).toBe(25);
      expect(await service.runDue()).toBe(1);
      expect(await service.runDue()).toBe(0);
    });
  });

  describe('public reads', () => {
    it('shows a published Collection only, and withdraws one revised back to draft or archived', async () => {
      const draft = await create(content([anyPublic]));
      const inReview = await transition(
        await create(content([anyPublic])),
        'submit',
        author,
      );
      const approvedOnly = await approved(content([anyPublic]));
      const scheduled = await transition(
        await approved(content([anyPublic])),
        'schedule',
        publisher,
        new Date(now.getTime() + 86_400_000),
      );
      const archived = await transition(
        await published(content([anyPublic])),
        'archive',
        publisher,
      );
      const livePublished = await published(content([anyPublic]));
      const wasPublished = await published(content([anyPublic]));
      expect((await reads.collection(wasPublished.slug))?.slug).toBe(wasPublished.slug);
      const revisedBack = await revise(
        wasPublished,
        same(wasPublished, { excerpt: 'Back' }),
      );
      expect(revisedBack.state).toBe('draft');

      for (const row of [
        draft,
        inReview,
        approvedOnly,
        scheduled,
        archived,
        revisedBack,
      ]) {
        expect(await reads.collection(row.slug), row.state).toBeNull();
        expect(await reads.collectionCanonicalSlug(row.slug), row.state).toBeNull();
      }
      expect((await reads.collection(livePublished.slug))?.slug).toBe(livePublished.slug);
      const listed = new Set<string>();
      for (let offset = 0; ; offset += 20) {
        const page = await reads.collections(offset);
        for (const item of page.items) listed.add(item.slug);
        if (!page.more) break;
      }
      expect(listed).toContain(livePublished.slug);
      for (const row of [draft, inReview, approvedOnly, scheduled, archived, revisedBack])
        expect(listed, row.state).not.toContain(row.slug);

      // Cancel the pending publication so later sweeps stay exact.
      await transition(scheduled, 'cancel', publisher);
    });

    it('resolves only currently public members, in order, and omits a withdrawn one while the Collection still reads', async () => {
      const a1 = await article();
      const a2 = await article();
      const n1 = await news();
      const w1 = await work();
      const v1 = await video();
      const order = [a1, n1, w1, v1, a2].map(({ kind, id }) => ({ kind, id }));
      const row = await published(content(order));
      const shown = await reads.collection(row.slug);
      expect(shown?.members).toEqual(order);

      const all = await resolve(order);
      expect(all.unavailable.size).toBe(0);
      expect(order.every((entry) => all.targets.has(memberToken(entry)))).toBe(true);
      expect(all.targets.get(memberToken(w1))?.slug).toBe(w1.slug);
      expect(all.targets.get(memberToken(v1))?.titles).toEqual([
        { languageCode: 'en', title: TARGET_TITLE },
      ]);

      // Editorial's own read answers for its OWN published records only.
      const draft = await draftArticle();
      const editorial = await reads.memberTargets([...order, draft]);
      expect([...editorial.keys()].sort()).toEqual(
        [a1, n1, a2].map((entry) => memberToken(entry)).sort(),
      );
      expect(JSON.stringify([...editorial.values()])).not.toContain(DRAFT_TITLE);

      // An Article member is withdrawn by its owner.
      await archiveArticle(a1.id);
      const still = await reads.collection(row.slug);
      expect(still?.members).toEqual(order);
      const after = await resolve(order);
      expect(after.targets.has(memberToken(a1))).toBe(false);
      expect(
        order.filter((entry) => after.targets.has(memberToken(entry))).map(memberToken),
      ).toEqual([n1, w1, v1, a2].map((entry) => memberToken(entry)));
      expect((await reads.memberTargets(order)).has(memberToken(a1))).toBe(false);

      // Archiving the Collection, and dropping a member from another, changes no
      // member's row.
      const before = await targetRows(order);
      const sibling = await create(content([a2, { kind: w1.kind, id: w1.id }]));
      await revise(sibling, content([a2], { slug: sibling.slug }));
      await transition(await detail(row.id), 'archive', publisher);
      expect(await targetRows(order)).toBe(before);
      expect(await reads.collection(row.slug)).toBeNull();
      expect(
        (await libraryReads.workReferences([w1.id])).map((entry) => entry.id),
      ).toEqual([w1.id]);
      expect(
        (await mediaReads.videoReferences([v1.id])).map((entry) => entry.id),
      ).toEqual([v1.id]);
      // Every typed member key is NO ACTION both ways: nothing cascades from a
      // Collection into a member, or from a member into a Collection.
      const keys = await db.admin.query<{
        target: string;
        onDelete: string;
        onUpdate: string;
      }>(
        `SELECT OBJECT_NAME(fk.referenced_object_id) AS [target], fk.delete_referential_action_desc AS [onDelete], fk.update_referential_action_desc AS [onUpdate]
         FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID(N'[dbo].[CollectionItem]') ORDER BY [target];`,
      );
      expect(keys.map((key) => key.target).sort()).toEqual(
        [
          'Article',
          'CollectionRevision',
          'MediaCoverage',
          'NewsArticle',
          'PressRelease',
          'Statement',
          'Video',
          'Work',
        ].sort(),
      );
      for (const key of keys) {
        expect(key.onDelete, key.target).toBe('NO_ACTION');
        expect(key.onUpdate, key.target).toBe('NO_ACTION');
      }
    });

    it('resolves a former slug to the current one only while the Collection is published', async () => {
      let row = await published(content([anyPublic]));
      const first = row.slug;
      row = await revise(row, content([anyPublic]));
      expect(await reads.collectionCanonicalSlug(first)).toBeNull();
      expect(await reads.collectionCanonicalSlug(row.slug)).toBeNull();
      row = await transition(await reapproved(row), 'publish', publisher);
      expect(await reads.collectionCanonicalSlug(first)).toBe(row.slug);
      expect(await reads.collectionCanonicalSlug(row.slug)).toBe(row.slug);
      expect(await reads.collection(first)).toBeNull();
      expect((await reads.collection(row.slug))?.slug).toBe(row.slug);
      expect(await auditCount(row.id, 'slug-changed')).toBe(1);
      // A reserved slug is never given to another Collection.
      expect(await refusal(create(content([anyPublic], { slug: first })))).toBe(
        'duplicate-slug',
      );
      await expect(
        db.admin.query(
          `DELETE FROM [CollectionSlugHistory] WHERE [ownerId]=N'${row.id}';`,
        ),
      ).rejects.toThrow();
      await transition(row, 'archive', publisher);
      expect(await reads.collectionCanonicalSlug(first)).toBeNull();
      expect(await reads.collectionCanonicalSlug(row.slug)).toBeNull();
    });

    it('lists newest publication first, ties by identifier, in bounded pages that tile exactly', async () => {
      const oldest = await published(content([anyPublic]));
      const middle = await published(content([anyPublic]));
      // Two published at the same instant: the identifier decides.
      tick();
      const twinOne = await transition(
        await approved(content([anyPublic])),
        'publish',
        publisher,
      );
      const twinTwo = await transition(
        await approved(content([anyPublic])),
        'publish',
        publisher,
      );
      const twins = (
        await db.admin.query<{ slug: string }>(
          `SELECT [slug] FROM [Collection] WHERE [id] IN (N'${twinOne.id}',N'${twinTwo.id}') ORDER BY [id];`,
        )
      ).map((entry) => entry.slug);

      const firstPage = await reads.collections(0);
      expect(firstPage.items.slice(0, 4).map((item) => item.slug)).toEqual([
        ...twins,
        middle.slug,
        oldest.slug,
      ]);
      // Republishing keeps the FIRST publication instant: no queue-jumping.
      const republished = await transition(
        await reapproved(await revise(oldest, same(oldest, { excerpt: 'Again' }))),
        'publish',
        publisher,
      );
      expect(republished.state).toBe('published');
      expect(
        (await reads.collections(0)).items.slice(0, 4).map((item) => item.slug),
      ).toEqual([...twins, middle.slug, oldest.slug]);

      const expected = (
        await db.admin.query<{ slug: string }>(
          "SELECT [slug] FROM [Collection] WHERE [state]=N'published' ORDER BY [publishedAt] DESC, [id] ASC;",
        )
      ).map((entry) => entry.slug);
      expect(expected.length).toBeGreaterThan(20);
      const pages: string[] = [];
      for (let offset = 0; ; offset += 20) {
        const page = await reads.collections(offset);
        expect(page.items.length).toBeLessThanOrEqual(20);
        pages.push(...page.items.map((item) => item.slug));
        if (!page.more) break;
        expect(offset).toBeLessThan(1000);
      }
      expect(pages).toEqual(expected);
      // A card is a summary: never a body, an authoring document or the members.
      expect(JSON.stringify(firstPage)).not.toContain(BODY_SENTINEL);
      expect(JSON.stringify(firstPage)).not.toContain(anyPublic.id);
      expect(Object.keys(firstPage.items[0] ?? {}).sort()).toEqual([
        'primaryLanguage',
        'slug',
        'topicIds',
        'translations',
      ]);
    });

    it('previews a topic’s most recent published Collections only', async () => {
      const [onTopic, offTopic] = topics as [string, string];
      const older = await published(content([anyPublic], { topicIds: [onTopic] }));
      const newer = await published(
        content([anyPublic], { topicIds: [onTopic, offTopic] }),
      );
      const elsewhere = await published(content([anyPublic], { topicIds: [offTopic] }));
      const unpublished = await create(content([anyPublic], { topicIds: [onTopic] }));
      const preview = await reads.collectionsOnTopic(onTopic);
      const slugs = preview.items.map((item) => item.slug);
      expect(slugs.slice(0, 2)).toEqual([newer.slug, older.slug]);
      expect(slugs).not.toContain(elsewhere.slug);
      expect(slugs).not.toContain(unpublished.slug);
      expect(preview.items.length).toBeLessThanOrEqual(6);
      for (const item of preview.items) expect(item.topicIds).toContain(onTopic);
      // Its topic withdrawn by a new revision, it leaves the hub with publication.
      await revise(newer, same(newer, { topicIds: [offTopic] }));
      expect(
        (await reads.collectionsOnTopic(onTopic)).items.map((item) => item.slug),
      ).not.toContain(newer.slug);
    });

    it('advertises exactly the current published Collection URLs, in their genuine languages', async () => {
      await published(content([anyPublic], { languages: ['ur', 'en'] }));
      await published(content([anyPublic], { languages: ['ar'] }));
      const ORIGIN = 'https://collections-sitemap.proof.invalid';
      process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = 'true';
      process.env['AUTH_BASE_URL'] = ORIGIN;
      try {
        const { collectionSitemapPartitions } =
          await import('../../apps/web/src/seo/collections-sitemap.ts');
        const partitions = await collectionSitemapPartitions();
        expect(partitions.every((partition) => partition.segment === 'collections')).toBe(
          true,
        );
        expect(partitions.map((partition) => partition.locale).sort()).toEqual([
          'ar',
          'en',
          'ur',
        ]);
        const advertised = new Set(
          partitions.flatMap((partition) => partition.urls.map((url) => url.loc)),
        );
        const rows = await db.admin.query<{ slug: string; languageCode: string }>(
          `SELECT c.[slug], t.[languageCode] FROM [Collection] c
           JOIN [CollectionRevisionTranslation] t ON t.[ownerId]=c.[id] AND t.[revisionNumber]=c.[currentRevision]
           WHERE c.[state]=N'published';`,
        );
        const expected = new Set(
          rows.map((row) => `${ORIGIN}/${row.languageCode}${collectionPathOf(row.slug)}`),
        );
        expect(expected.size).toBeGreaterThan(0);
        expect(advertised).toEqual(expected);
        // Never a former slug, a query or a member's address.
        const former = await db.admin.query<{ slug: string }>(
          `SELECT h.[slug] FROM [CollectionSlugHistory] h JOIN [Collection] c ON c.[id]=h.[ownerId] WHERE h.[slug]<>c.[slug];`,
        );
        expect(former.length).toBeGreaterThan(0);
        for (const { slug } of former)
          for (const url of advertised)
            expect(url.endsWith(collectionPathOf(slug))).toBe(false);
        for (const url of advertised) {
          expect(url).not.toContain('?');
          expect(url).toContain('/collections/');
        }
        // The read service answers the same rows.
        const entries = await reads.collectionSitemap(0, 5000);
        expect(new Set(entries.map((entry) => entry.slug))).toEqual(
          new Set(rows.map((row) => row.slug)),
        );

        process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = 'false';
        expect(await collectionSitemapPartitions()).toEqual([]);
      } finally {
        delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];
      }
    });

    it('validates a public query again whatever the page tolerated', async () => {
      await expect(async () => reads.collections(-1)).rejects.toThrow();
      await expect(async () => reads.collections(25_001)).rejects.toThrow();
      await expect(async () => reads.collectionsOnTopic('not-an-id')).rejects.toThrow();
      expect(await reads.collection('')).toBeNull();
      expect(await reads.collectionCanonicalSlug('')).toBeNull();
    });
  });

  it('requests no Search indexing for any Collection', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM [Collection];')).toBeGreaterThan(50);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM [SearchIndexRequest] WHERE [scopeId] IN (SELECT [id] FROM [Collection]);',
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM [SearchIndexRequest] WHERE [scopeKind] LIKE N'%collection%';",
      ),
    ).toBe(0);
  });

  it('has no silently swallowed scheduler errors', () => {
    expect(errors).toEqual([]);
  });
});
