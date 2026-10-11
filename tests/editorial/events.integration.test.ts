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
import { syntheticStorageKey } from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  eventPathOf,
  eventTiming,
  foldOf,
  type ArticleDetail,
  type EditorialPublicReaderPort,
  type EventSummary,
  type EventWhen,
  type WorkflowAction,
} from '../../packages/contracts/src/editorial/index.ts';
import {
  createEditorialService,
  editorialFailure,
} from '../../apps/web/src/contexts/editorial/index.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';
import {
  createCentreReferences,
  createGlobalService,
} from '../../apps/web/src/contexts/global-network/index.ts';
import {
  createGalleryReferences,
  createMediaReadService,
  createMediaService,
} from '../../apps/web/src/contexts/media/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';

/**
 * Phase 14 — Events through the SHARED editorial workflow, on real SQL Server,
 * with real Global Network Centres and real Media Galleries.
 *
 * WHAT IS PROVED: separate live author, reviewer and publisher grants, with
 * neither the creator nor the editor of the current revision able to approve
 * it; stale saves and stale transitions refused; a schedule, Centre or Gallery
 * change being an ordinary edit that returns the Event to draft, clears its
 * approval and its publication schedule and is audited as its own fact without
 * any text or time; scheduled publication re-checking authority, catching up
 * once and tolerating a duplicate run; daylight-saving refusals surfacing as
 * their own reasons; the stated local time and its UTC instant round-tripping
 * exactly; an archived Centre or Gallery kept on re-save but never newly
 * chosen, and archiving either touching no Event row; the public reads being
 * published-only with a deterministic upcoming/past classification that agrees
 * with the pure rule; former slugs resolving only while published; the sitemap
 * listing exactly the current published addresses; no Global, Media or People
 * authority granting any Event authority; and no Search intent from any Event.
 *
 * EVERYTHING IS SYNTHETIC: titles say they are fixtures, Country codes are ISO
 * user-assigned ones, addresses are `.invalid`.
 */

const live = databaseConfigured ? describe : describe.skip;

const TITLE = 'Synthetic event proof';
const BODY_SENTINEL = 'EVENT-BODY-SENTINEL';
const document = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: `Synthetic event proof ${BODY_SENTINEL}.` }],
    },
  ],
});

let sequence = 0;
const unique = (prefix: string) => {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${randomUUID().slice(0, 8)}`;
};

interface Occurrence {
  readonly start: string;
  readonly startFold?: 'earlier' | 'later' | null;
  readonly end?: string | null;
  readonly endFold?: 'earlier' | 'later' | null;
}

/** The occurrence used where WHEN does not matter: a fixed Karachi evening. */
const KARACHI = {
  timezone: 'Asia/Karachi',
  occurrences: [{ start: '2041-11-14T19:00', end: '2041-11-14T21:00' }],
};

function content(
  overrides: {
    slug?: string;
    centreId?: string | null;
    galleryIds?: readonly string[];
    schedule?: { timezone: string; occurrences: readonly Occurrence[] };
    topicIds?: readonly string[];
    contributors?: readonly { personId: string; role: string }[];
    languages?: readonly ('en' | 'ur' | 'ar')[];
  } = {},
) {
  const languages = overrides.languages ?? ['en'];
  return {
    slug: overrides.slug ?? unique('event-proof'),
    primaryLanguage: languages[0],
    translations: languages.map((languageCode) => ({
      languageCode,
      title: TITLE,
      excerpt: 'Non-authoritative test fixture',
      seoTitle: '',
      seoDescription: '',
      document,
    })),
    topicIds: [...(overrides.topicIds ?? [])],
    contributors: [...(overrides.contributors ?? [])],
    centreId: overrides.centreId ?? null,
    schedule: overrides.schedule ?? KARACHI,
    galleryIds: [...(overrides.galleryIds ?? [])],
  };
}

live('Phase 14 Events against real SQL Server', () => {
  let db: DisposableDatabase;
  let service: ReturnType<typeof createEditorialService>;
  let reader: EditorialPublicReaderPort;
  let reads: ReturnType<typeof createEditorialReadService>;
  let global: ReturnType<typeof createGlobalService>;
  let media: ReturnType<typeof createMediaService>;
  let mediaReads: ReturnType<typeof createMediaReadService>;
  let galleries: ReturnType<typeof createGalleryReferences>;
  let people: Phase5Fixture;
  let author: string,
    editor: string,
    reviewer: string,
    publisher: string,
    stranger: string,
    globalAdministrator: string,
    mediaAdministrator: string;
  let topics: readonly string[];
  let countryId: string;
  const codes = ['QM', 'QN', 'QP'];
  /** The WORKFLOW clock: when an action happens. */
  let now = new Date('2035-01-01T00:00:00Z');
  /** The READ clock: the server instant that decides upcoming and past. */
  let readNow = new Date('2040-06-15T12:00:00Z');
  const errors: string[] = [];

  async function account(keys: readonly string[]): Promise<string> {
    const id = await createProofAccount(db.admin);
    if (keys.length === 0) return id;
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic event role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
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

  const count = async (sql: string) =>
    Number((await db.admin.query<{ n: number }>(sql))[0]?.n ?? -1);

  /* ---- Editorial helpers ------------------------------------------------ */

  const create = (value: unknown = content(), actor = author) =>
    service.create({ accountId: actor }, 'event', value);
  const revise = (row: ArticleDetail, value: unknown, actor = author) =>
    service.revise({ accountId: actor }, 'event', row.id, row.version, value);
  const detail = (id: string) => service.detail({ accountId: author }, 'event', id);
  const transition = (
    row: ArticleDetail,
    action: WorkflowAction,
    actor: string,
    scheduledAt: Date | null = null,
  ) =>
    service.transition({ accountId: actor }, 'event', {
      id: row.id,
      expectedVersion: row.version,
      action,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      timezone: scheduledAt ? 'Asia/Karachi' : null,
    });
  const approved = async (value: unknown = content()) =>
    transition(
      await transition(await create(value), 'submit', author),
      'approve',
      reviewer,
    );
  const reapproved = async (row: ArticleDetail) =>
    transition(await transition(row, 'submit', author), 'approve', reviewer);
  const published = async (value: unknown = content()) =>
    transition(await approved(value), 'publish', publisher);

  /* ---- Global and Media helpers ----------------------------------------- */

  const centreInput = (overrides: Record<string, unknown> = {}) => ({
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
  const centre = (overrides: Record<string, unknown> = {}) =>
    global.saveCentre(
      { accountId: globalAdministrator },
      null,
      null,
      centreInput(overrides),
    );
  const archiveCentre = async (id: string, slug: string) => {
    const current = await global.centre({ accountId: globalAdministrator }, id);
    if (current === null) throw new Error('Centre missing.');
    await global.saveCentre(
      { accountId: globalAdministrator },
      id,
      current.version,
      centreInput({ slug, state: 'archived' }),
    );
  };

  const galleryInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('gallery'),
    primaryLocale: 'en',
    state: 'draft',
    labels: [{ locale: 'en', title: 'Synthetic proof gallery', description: '' }],
    ...overrides,
  });
  const gallery = (overrides: Record<string, unknown> = {}) =>
    media.saveGallery(
      { accountId: mediaAdministrator },
      null,
      null,
      galleryInput(overrides),
    );
  const archiveGallery = async (id: string, slug: string) => {
    const current = await media.gallery({ accountId: mediaAdministrator }, id);
    if (current === null) throw new Error('Gallery missing.');
    await media.saveGallery(
      { accountId: mediaAdministrator },
      id,
      current.version,
      galleryInput({ slug, state: 'archived' }),
    );
  };
  /**
   * A published Photo with a clean asset, placed in a Gallery — written with
   * the migration principal, as the Phase-12 recovery fixture does, so the real
   * CHECKs and foreign keys apply without a scanner. What makes a Gallery
   * LISTED is exactly this: published, holding a public Photo.
   */
  const addPublicPhoto = async (galleryId: string) => {
    const assetId = randomUUID();
    const photoId = randomUUID();
    await db.admin.query(`
      INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[displayName],[updatedAt])
        VALUES (N'${assetId}', N'${syntheticStorageKey()}', N'image/png', 64, N'${'0'.repeat(64)}', N'clean', NULL, SYSUTCDATETIME());
      INSERT INTO [dbo].[Photo] ([id],[primaryLocale],[state],[credit],[takenYear],[takenMonth],[takenDay],[assetId],[width],[height],[version],[updatedAt])
        VALUES (N'${photoId}', N'en', N'published', NULL, NULL, NULL, NULL, N'${assetId}', 64, 40, 1, SYSUTCDATETIME());
      INSERT INTO [dbo].[PhotoLabel] ([photoId],[locale],[altText],[caption])
        VALUES (N'${photoId}', N'en', N'A synthetic gradient used by a proof.', NULL);
      INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position])
        VALUES (N'${galleryId}', N'${photoId}', 0);
    `);
    return photoId;
  };

  /** Every row an Event owns, so "nothing changed" is checked, not assumed. */
  const eventRows = async (id: string) =>
    JSON.stringify([
      await db.admin.query(`SELECT * FROM [Event] WHERE [id]=N'${id}';`),
      await db.admin.query(
        `SELECT * FROM [EventRevision] WHERE [ownerId]=N'${id}' ORDER BY [number];`,
      ),
      await db.admin.query(
        `SELECT * FROM [EventSchedule] WHERE [ownerId]=N'${id}' ORDER BY [revisionNumber],[position];`,
      ),
      await db.admin.query(
        `SELECT * FROM [EventGallery] WHERE [ownerId]=N'${id}' ORDER BY [revisionNumber],[position];`,
      ),
    ]);

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
      `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [targetId]=N'${id}' AND [action]=N'editorial.event.${action}';`,
    );

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
    const centres = createCentreReferences(database.createGlobalReferences());
    galleries = createGalleryReferences(database.createMediaReferences());
    reader = database.createEditorialPublicReader();
    reads = createEditorialReadService(reader, () => new Date(readNow));
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
        selectableCentre: (id) => centres.centreSelectable(id),
        selectableGallery: (id) => galleries.gallerySelectable(id),
      },
    });
    global = createGlobalService({
      persistence: database.createGlobalPersistence(),
      authority,
    });
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
    reviewer = await account(['content.read', 'content.review']);
    publisher = await account(['content.read', 'content.publish']);
    stranger = await account([]);
    globalAdministrator = await account(['global.read', 'global.administer']);
    mediaAdministrator = await account(['media.read', 'media.administer']);
    // A real account linked to a real Person holding all four profiles, and no
    // role: what a profile alone confers.
    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);

    const country = await global.saveCountry(
      { accountId: globalAdministrator },
      null,
      null,
      {
        code: codes[0],
        slug: unique('country'),
        primaryLocale: 'en',
        state: 'published',
        labels: [{ locale: 'en', name: 'Synthetic Country' }],
      },
    );
    countryId = country.id;
    topics = (
      await db.admin.query<{ id: string }>(
        "SELECT TOP 2 [id] FROM [Topic] WHERE [status]=N'active' ORDER BY [slug];",
      )
    ).map((row) => row.id);
    if (topics.length !== 2) throw new Error('Two active canonical topics are required.');
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it('starts with no published Event', async () => {
    expect(await reads.hasPublishedEvents()).toBe(false);
    expect(
      (await reads.events({ when: 'upcoming', offset: 0, centreIds: null })).items,
    ).toEqual([]);
  });

  describe('authority is the content.* keys, live, and nothing else', () => {
    it('requires separate grants and refuses approval by the creator or the editor', async () => {
      const row = await create();
      expect(
        await refusal(service.detail({ accountId: stranger }, 'event', row.id)),
      ).toBe('denied');
      expect(await refusal(create(content(), publisher))).toBe('denied');
      expect(await refusal(transition(row, 'publish', publisher))).toBe('invalid-state');

      // Another author edits it: the current revision is now THEIRS.
      const edited = await revise(row, content({ slug: row.slug }), editor);
      expect(edited.revision.editorId).toBe(editor);
      expect(edited.creatorId).toBe(author);
      const submitted = await transition(edited, 'submit', editor);
      // Neither its creator nor its editor may approve it, though both hold
      // content.review.
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
      const live = await transition(ok, 'publish', publisher);
      expect(live.state).toBe('published');
      expect(await reads.hasPublishedEvents()).toBe(true);

      // The database refuses self-approval whoever writes.
      const own = await transition(await create(), 'submit', author);
      await expect(
        db.admin.query(
          `UPDATE [Event] SET [approvedRevision]=[currentRevision],[approvedById]=N'${author}',[version]=[version]+1 WHERE [id]=N'${own.id}';`,
        ),
      ).rejects.toThrow();

      // The public record carries no authoring document and no workflow actor.
      const shown = await reads.event(row.slug);
      expect(shown?.translations[0]?.html).toContain(BODY_SENTINEL);
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

    it('grants nothing to global.*, media.* or a People profile', async () => {
      const row = await create(
        content({ contributors: [{ personId: people.linkedPersonId, role: 'speaker' }] }),
      );
      for (const actor of [globalAdministrator, mediaAdministrator, people.accountId]) {
        expect(await refusal(create(content(), actor)), actor).toBe('denied');
        expect(await refusal(service.detail({ accountId: actor }, 'event', row.id))).toBe(
          'denied',
        );
        expect(await refusal(revise(row, content({ slug: row.slug }), actor))).toBe(
          'denied',
        );
        expect(await refusal(transition(row, 'submit', actor))).toBe('denied');
      }
      // Credited on the Event and still nothing: a profile alone grants nothing.
      expect((await detail(row.id)).revision.contributors).toEqual([
        { personId: people.linkedPersonId, role: 'speaker' },
      ]);
      // And the reverse: full Editorial authority confers no Global or Media
      // authority over the Centre or Gallery an Event names.
      await expect(
        global.saveCentre({ accountId: author }, null, null, centreInput()),
      ).rejects.toMatchObject({ reason: 'denied' });
      await expect(
        media.saveGallery({ accountId: author }, null, null, galleryInput()),
      ).rejects.toMatchObject({ reason: 'denied' });
    });
  });

  describe('versions are the lock', () => {
    it('refuses a stale revise, approve, publish and archive', async () => {
      const row = await create();
      const revised = await revise(row, content({ slug: row.slug }));
      expect(await refusal(revise(row, content({ slug: row.slug })))).toBe('conflict');
      const submitted = await transition(revised, 'submit', author);
      expect(await refusal(transition(revised, 'approve', reviewer))).toBe('conflict');
      const ok = await transition(submitted, 'approve', reviewer);
      expect(await refusal(transition(submitted, 'publish', publisher))).toBe('conflict');
      const live = await transition(ok, 'publish', publisher);
      expect(await refusal(transition(ok, 'archive', publisher))).toBe('conflict');
      const archived = await transition(live, 'archive', publisher);
      expect(archived.state).toBe('archived');
    });

    it('lets exactly one of two concurrent saves of one version win', async () => {
      const row = await approved();
      const outcomes = await Promise.all(
        [1, 2].map(() => refusal(revise(row, content({ slug: row.slug })))),
      );
      expect(outcomes.sort()).toEqual(['accepted', 'conflict']);
      expect(await detail(row.id)).toMatchObject({
        currentRevision: 2,
        approvedRevision: null,
        state: 'draft',
      });
    });
  });

  describe('when an Event occurs', () => {
    it('stores the stated local time and its UTC instant, and round-trips both exactly', async () => {
      const schedule = {
        timezone: 'US/Eastern',
        occurrences: [
          { start: '2041-11-04T18:00', end: '2041-11-04T20:30' },
          // The REPEATED hour, the editor choosing the second (EST) instance.
          { start: '2041-11-03T01:30', startFold: 'later' as const },
        ],
      };
      const row = await create(content({ schedule }));
      const expected = {
        timezone: 'America/New_York',
        occurrences: [
          {
            startsLocal: '2041-11-03T01:30',
            startsAt: new Date('2041-11-03T06:30:00Z'),
            endsLocal: null,
            endsAt: null,
          },
          {
            startsLocal: '2041-11-04T18:00',
            startsAt: new Date('2041-11-04T23:00:00Z'),
            endsLocal: '2041-11-04T20:30',
            endsAt: new Date('2041-11-05T01:30:00Z'),
          },
        ],
      };
      expect(row.revision.schedule).toEqual(expected);
      expect((await detail(row.id)).revision.schedule).toEqual(expected);
      // The editor re-opening it sees the choice that was made.
      expect(
        foldOf('2041-11-03T01:30', 'America/New_York', new Date('2041-11-03T06:30:00Z')),
      ).toBe('later');

      // The columns themselves: wall time unconverted, instant in UTC, zone named.
      const rows = await db.admin.query<{
        position: number;
        local: string;
        instant: string;
        endLocal: string | null;
        endInstant: string | null;
        timezone: string;
      }>(
        `SELECT s.[position], CONVERT(nvarchar(19), s.[startsLocal], 126) AS [local], CONVERT(nvarchar(19), s.[startsAt], 126) AS [instant], CONVERT(nvarchar(19), s.[endsLocal], 126) AS [endLocal], CONVERT(nvarchar(19), s.[endsAt], 126) AS [endInstant], r.[timezone]
         FROM [EventSchedule] s JOIN [EventRevision] r ON r.[ownerId]=s.[ownerId] AND r.[number]=s.[revisionNumber]
         WHERE s.[ownerId]=N'${row.id}' ORDER BY s.[position];`,
      );
      expect(rows).toEqual([
        {
          position: 0,
          local: '2041-11-03T01:30:00',
          instant: '2041-11-03T06:30:00',
          endLocal: null,
          endInstant: null,
          timezone: 'America/New_York',
        },
        {
          position: 1,
          local: '2041-11-04T18:00:00',
          instant: '2041-11-04T23:00:00',
          endLocal: '2041-11-04T20:30:00',
          endInstant: '2041-11-05T01:30:00',
          timezone: 'America/New_York',
        },
      ]);

      const live = await transition(
        await transition(await transition(row, 'submit', author), 'approve', reviewer),
        'publish',
        publisher,
      );
      expect((await reads.event(live.slug))?.schedule).toEqual(expected);

      // Nothing retimes a stored revision: only a new revision can.
      for (const statement of [
        `UPDATE [EventSchedule] SET [startsAt]=DATEADD(HOUR,1,[startsAt]) WHERE [ownerId]=N'${row.id}';`,
        `DELETE FROM [EventSchedule] WHERE [ownerId]=N'${row.id}';`,
        `UPDATE [EventRevision] SET [timezone]=N'Asia/Karachi' WHERE [ownerId]=N'${row.id}';`,
      ])
        await expect(db.admin.query(statement), statement).rejects.toThrow();
    });

    it('refuses a skipped or repeated local time, a misordered and a duplicate occurrence, each by name', async () => {
      const before = await count('SELECT COUNT(*) AS n FROM [Event];');
      const zone = 'America/New_York';
      const cases: [readonly Occurrence[], string][] = [
        [[{ start: '2041-03-10T02:30' }], 'nonexistent-time'],
        [[{ start: '2041-03-10T01:00', end: '2041-03-10T02:15' }], 'nonexistent-time'],
        [[{ start: '2041-11-03T01:30' }], 'ambiguous-time'],
        [[{ start: '2041-11-03T00:30', end: '2041-11-03T01:30' }], 'ambiguous-time'],
        [[{ start: '2041-06-01T10:00', end: '2041-06-01T09:00' }], 'schedule-order'],
        [[{ start: '2041-06-01T10:00', end: '2041-06-01T10:00' }], 'schedule-order'],
        [
          [
            { start: '2041-06-01T10:00' },
            { start: '2041-06-01T10:00', end: '2041-06-01T11:00' },
          ],
          'duplicate-occurrence',
        ],
      ];
      for (const [occurrences, reason] of cases)
        expect(
          await refusal(create(content({ schedule: { timezone: zone, occurrences } }))),
          JSON.stringify(occurrences),
        ).toBe(reason);
      // Neither an offset nor an unknown zone is a time zone; refused, but not
      // given a schedule reason it does not have.
      for (const timezone of ['+05:00', 'EST', 'Etc/GMT+5', 'Mars/Olympus_Mons'])
        expect(
          await refusal(
            create(
              content({
                schedule: { timezone, occurrences: [{ start: '2041-06-01T10:00' }] },
              }),
            ),
          ),
          timezone,
        ).toBe('invalid');
      expect(await count('SELECT COUNT(*) AS n FROM [Event];')).toBe(before);

      // The same on an edit, which then changes nothing at all.
      const row = await create();
      const snapshot = await eventRows(row.id);
      expect(
        await refusal(
          revise(
            row,
            content({
              slug: row.slug,
              schedule: {
                timezone: 'Europe/London',
                occurrences: [{ start: '2041-03-31T01:30' }],
              },
            }),
          ),
        ),
      ).toBe('nonexistent-time');
      expect(await eventRows(row.id)).toBe(snapshot);
    });
  });

  describe('a schedule, Centre or Gallery change is an edit', () => {
    it('returns the Event to draft, clears approval and its publication schedule, and audits each fact without text', async () => {
      const first = await centre();
      const second = await centre();
      const g1 = await gallery();
      const g2 = await gallery({ state: 'published' });
      const base = { centreId: first.id, galleryIds: [g1.id] };
      const scheduled = await transition(
        await approved(content(base)),
        'schedule',
        publisher,
        new Date(now.getTime() + 60_000),
      );
      expect(scheduled).toMatchObject({ state: 'scheduled' });

      // Retimed: back to draft, approval and publication schedule gone.
      const retimed = await revise(
        scheduled,
        content({
          ...base,
          slug: scheduled.slug,
          schedule: {
            timezone: 'Asia/Karachi',
            occurrences: [{ start: '2041-11-15T19:00', end: '2041-11-15T21:00' }],
          },
        }),
      );
      expect(retimed).toMatchObject({
        state: 'draft',
        approvedRevision: null,
        approvedById: null,
        scheduledRevision: null,
        scheduledAt: null,
        scheduleStatus: 'cancelled',
      });
      // The cancelled publication never fires.
      now = new Date(now.getTime() + 120_000);
      expect(await service.runDue()).toBe(0);
      expect((await detail(scheduled.id)).state).toBe('draft');

      // Moved to another Centre.
      const moved = await revise(
        await reapproved(retimed),
        content({
          slug: scheduled.slug,
          centreId: second.id,
          galleryIds: [g1.id],
          schedule: {
            timezone: 'Asia/Karachi',
            occurrences: [{ start: '2041-11-15T19:00', end: '2041-11-15T21:00' }],
          },
        }),
      );
      expect(moved).toMatchObject({ state: 'draft', approvedRevision: null });
      expect(moved.revision.centreId).toBe(second.id);

      // Its Galleries changed — and their ORDER is part of what is reviewed.
      const regalleried = await revise(
        await reapproved(moved),
        content({
          slug: scheduled.slug,
          centreId: second.id,
          galleryIds: [g2.id, g1.id],
          schedule: {
            timezone: 'Asia/Karachi',
            occurrences: [{ start: '2041-11-15T19:00', end: '2041-11-15T21:00' }],
          },
        }),
      );
      expect(regalleried.revision.galleryIds).toEqual([g2.id, g1.id]);
      const reordered = await revise(
        regalleried,
        content({
          slug: scheduled.slug,
          centreId: second.id,
          galleryIds: [g1.id, g2.id],
          schedule: {
            timezone: 'Asia/Karachi',
            occurrences: [{ start: '2041-11-15T19:00', end: '2041-11-15T21:00' }],
          },
        }),
      );
      expect(reordered.revision.galleryIds).toEqual([g1.id, g2.id]);
      // An edit of the words alone records no schedule, Centre or Gallery fact.
      await revise(
        reordered,
        content({
          slug: scheduled.slug,
          centreId: second.id,
          galleryIds: [g1.id, g2.id],
          schedule: {
            timezone: 'Asia/Karachi',
            occurrences: [{ start: '2041-11-15T19:00', end: '2041-11-15T21:00' }],
          },
        }),
      );

      expect(await auditCount(scheduled.id, 'schedule-changed')).toBe(1);
      expect(await auditCount(scheduled.id, 'centre-changed')).toBe(1);
      expect(await auditCount(scheduled.id, 'galleries-changed')).toBe(2);
      expect(await auditCount(scheduled.id, 'revised')).toBe(5);

      // No title, body, local time, instant, zone, Centre or Gallery reaches the
      // audit log.
      const text = JSON.stringify(await audits(scheduled.id));
      for (const secret of [
        TITLE,
        BODY_SENTINEL,
        '2041',
        '19:00',
        '14:00',
        'Karachi',
        first.id,
        second.id,
        g1.id,
        g2.id,
      ])
        expect(text, secret).not.toContain(secret);

      // Each revision kept what it said: the history is immutable.
      const history = await service.revisions(
        { accountId: author },
        'event',
        scheduled.id,
      );
      expect(history.items.map((revision) => revision.centreId)).toEqual([
        second.id,
        second.id,
        second.id,
        second.id,
        first.id,
        first.id,
      ]);
      expect(history.items.at(-1)?.schedule.occurrences[0]?.startsLocal).toBe(
        '2041-11-14T19:00',
      );
    });
  });

  describe('scheduled publication', () => {
    it('publishes once when due, never early, and a duplicate run is harmless', async () => {
      const due = new Date(now.getTime() + 60_000);
      const row = await transition(await approved(), 'schedule', publisher, due);
      expect(await service.runDue()).toBe(0);
      expect(await reads.event(row.slug)).toBeNull();
      // Catch-up: the sweep runs long after the instant, and twice at once.
      now = new Date(due.getTime() + 3_600_000);
      const results = await Promise.all([service.runDue(), service.runDue()]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await service.runDue()).toBe(0);
      expect((await detail(row.id)).state).toBe('published');
      expect((await reads.event(row.slug))?.slug).toBe(row.slug);
      expect(await auditCount(row.id, 'publish')).toBe(1);

      // A cancelled schedule returns it to review and never fires.
      const cancelled = await transition(
        await transition(
          await approved(),
          'schedule',
          publisher,
          new Date(now.getTime() + 60_000),
        ),
        'cancel',
        publisher,
      );
      now = new Date(now.getTime() + 120_000);
      expect(await service.runDue()).toBe(0);
      expect((await detail(cancelled.id)).state).toBe('in-review');
    });

    it('re-checks authority when due: a revoked publisher’s schedule stops', async () => {
      const actor = await account(['content.read', 'content.publish']);
      const row = await transition(
        await approved(),
        'schedule',
        actor,
        new Date(now.getTime() + 60_000),
      );
      await db.admin.query(
        `UPDATE [RoleAssignment] SET [revokedAt]=SYSUTCDATETIME() WHERE [userId]=N'${actor}' AND [revokedAt] IS NULL;`,
      );
      now = new Date(now.getTime() + 120_000);
      expect(await service.runDue()).toBe(0);
      expect(await detail(row.id)).toMatchObject({
        state: 'scheduled',
        scheduleStatus: 'authority-revoked',
      });
      expect(await reads.event(row.slug)).toBeNull();
      expect(await auditCount(row.id, 'authority-revoked')).toBe(1);
      // A revoked schedule is not retried.
      now = new Date(now.getTime() + 120_000);
      expect(await service.runDue()).toBe(0);
    });

    it('bounds a sweep at 25 Events and catches up the remainder next time', async () => {
      const at = new Date(now.getTime() + 60_000);
      for (let index = 0; index < 26; index++)
        await transition(await approved(), 'schedule', publisher, at);
      now = new Date(at.getTime() + 1000);
      expect(await service.runDue()).toBe(25);
      expect(await service.runDue()).toBe(1);
      expect(await service.runDue()).toBe(0);
    });
  });

  describe('the Centre an Event is held at', () => {
    it('refuses an archived or absent Centre anew, keeps an archived one on re-save, and archiving touches no Event', async () => {
      const here = await centre();
      const row = await published(content({ centreId: here.id }));
      const draft = await create(content({ centreId: here.id }));
      const before = await eventRows(row.id);

      await archiveCentre(here.id, here.slug);
      expect(await eventRows(row.id)).toBe(before);
      expect((await reads.event(row.slug))?.centreId).toBe(here.id);

      expect(await refusal(create(content({ centreId: here.id })))).toBe('invalid');
      expect(await refusal(create(content({ centreId: randomUUID() })))).toBe('invalid');
      const elsewhere = await create(content({ centreId: (await centre()).id }));
      expect(
        await refusal(
          revise(elsewhere, content({ slug: elsewhere.slug, centreId: here.id })),
        ),
      ).toBe('invalid');
      // The Centre it already names is kept truthfully.
      const kept = await revise(draft, content({ slug: draft.slug, centreId: here.id }));
      expect(kept.revision.centreId).toBe(here.id);
      // Re-saving with the Centre REMOVED is allowed, and choosing it back is not.
      const cleared = await revise(kept, content({ slug: kept.slug, centreId: null }));
      expect(cleared.revision.centreId).toBeNull();
      expect(
        await refusal(
          revise(cleared, content({ slug: cleared.slug, centreId: here.id })),
        ),
      ).toBe('invalid');
    });
  });

  describe('the Galleries that photograph an Event', () => {
    it('refuses an archived or absent Gallery anew, keeps an archived one on re-save, and archiving touches no Event', async () => {
      const kept = await gallery({ state: 'published' });
      const other = await gallery();
      const row = await published(content({ galleryIds: [kept.id, other.id] }));
      expect((await reads.event(row.slug))?.galleryIds).toEqual([kept.id, other.id]);
      const draft = await create(content({ galleryIds: [kept.id] }));
      const before = await eventRows(row.id);

      await archiveGallery(kept.id, kept.slug);
      expect(await eventRows(row.id)).toBe(before);
      expect((await reads.event(row.slug))?.galleryIds).toEqual([kept.id, other.id]);

      expect(await refusal(create(content({ galleryIds: [kept.id] })))).toBe('invalid');
      expect(await refusal(create(content({ galleryIds: [randomUUID()] })))).toBe(
        'invalid',
      );
      expect(await refusal(create(content({ galleryIds: [other.id, other.id] })))).toBe(
        'invalid',
      );
      const thirteen = await Promise.all(Array.from({ length: 13 }, () => gallery()));
      expect(
        await refusal(create(content({ galleryIds: thirteen.map((entry) => entry.id) }))),
      ).toBe('invalid');
      expect(
        (
          await create(
            content({ galleryIds: thirteen.slice(0, 12).map((entry) => entry.id) }),
          )
        ).revision.galleryIds,
      ).toHaveLength(12);

      // Re-saving keeps the archived Gallery it already names, in place…
      const resaved = await revise(
        draft,
        content({ slug: draft.slug, galleryIds: [other.id, kept.id] }),
      );
      expect(resaved.revision.galleryIds).toEqual([other.id, kept.id]);
      // …but adding it to another Event is refused.
      const fresh = await create();
      expect(
        await refusal(
          revise(fresh, content({ slug: fresh.slug, galleryIds: [kept.id] })),
        ),
      ).toBe('invalid');
    });

    it('lets Media answer which Galleries are listed and which may be chosen', async () => {
      const listedA = await gallery({ state: 'published' });
      const listedB = await gallery({ state: 'published' });
      const empty = await gallery({ state: 'published' });
      const draft = await gallery();
      const archived = await gallery({ state: 'published' });
      await addPublicPhoto(listedA.id);
      await addPublicPhoto(listedB.id);
      await addPublicPhoto(draft.id);
      await addPublicPhoto(archived.id);
      await archiveGallery(archived.id, archived.slug);

      // Only LISTED Galleries — published, holding a public Photo — in the
      // caller's order, each once.
      const shown = await mediaReads.publicGalleries([
        listedB.id,
        empty.id,
        draft.id,
        archived.id,
        randomUUID(),
        listedA.id,
        listedB.id,
      ]);
      expect(shown.map((entry) => entry.id)).toEqual([listedB.id, listedA.id]);
      expect(shown[0]).toMatchObject({ slug: listedB.slug, photoCount: 1 });
      expect(await mediaReads.publicGalleries([])).toEqual([]);
      expect(() => mediaReads.publicGalleries(['not-an-id'])).toThrow();

      // Choosable: anything but archived. Shown truthfully: whatever its state.
      expect(await galleries.gallerySelectable(draft.id)).toBe(true);
      expect(await galleries.gallerySelectable(empty.id)).toBe(true);
      expect(await galleries.gallerySelectable(archived.id)).toBe(false);
      expect(await galleries.gallerySelectable(randomUUID())).toBe(false);
      expect(await galleries.gallerySelectable('not-an-id')).toBe(false);
      const byIds = await galleries.galleriesByIds([archived.id, draft.id]);
      expect(byIds.map((entry) => [entry.id, entry.state]).sort()).toEqual(
        [
          [archived.id, 'archived'],
          [draft.id, 'draft'],
        ].sort(),
      );
      const choices = (await galleries.galleryChoices(null)).map((entry) => entry.id);
      expect(choices).not.toContain(archived.id);
      // A reference answer carries no Photo, asset or membership.
      const reference = JSON.stringify(byIds);
      for (const field of ['photos', 'assetId', 'storageKey', 'cover'])
        expect(reference).not.toContain(field);
    });
  });

  describe('public reads', () => {
    /** A UTC wall time `hours` from the read clock. */
    const atHours = (hours: number) =>
      new Date(readNow.getTime() + hours * 3_600_000).toISOString().slice(0, 16);
    const span = (from: number, to: number | null): Occurrence => ({
      start: atHours(from),
      end: to === null ? null : atHours(to),
    });
    const held = (centreId: string, ...occurrences: Occurrence[]) =>
      content({ centreId, schedule: { timezone: 'UTC', occurrences } });

    it('shows a published Event only, and withdraws one revised back to draft or archived', async () => {
      const here = await centre();
      const upcoming = [span(24, 25)];
      const draft = await create(held(here.id, ...upcoming));
      const inReview = await transition(
        await create(held(here.id, ...upcoming)),
        'submit',
        author,
      );
      const approvedOnly = await approved(held(here.id, ...upcoming));
      const scheduled = await transition(
        await approved(held(here.id, ...upcoming)),
        'schedule',
        publisher,
        new Date(now.getTime() + 86_400_000),
      );
      const archived = await transition(
        await published(held(here.id, ...upcoming)),
        'archive',
        publisher,
      );
      const livePublished = await published(held(here.id, ...upcoming));
      const wasPublished = await published(held(here.id, ...upcoming));
      expect((await reads.event(wasPublished.slug))?.slug).toBe(wasPublished.slug);
      // Revised back to draft under the SAME slug: withdrawn at once.
      const revisedBack = await revise(wasPublished, {
        ...held(here.id, ...upcoming),
        slug: wasPublished.slug,
      });
      expect(revisedBack.state).toBe('draft');
      const hidden = [draft, inReview, approvedOnly, scheduled, archived, revisedBack];

      for (const row of hidden) {
        expect(await reads.event(row.slug), row.state).toBeNull();
        expect(await reads.eventCanonicalSlug(row.slug), row.state).toBeNull();
      }
      expect((await reads.event(livePublished.slug))?.slug).toBe(livePublished.slug);
      const listed = await reads.centreEvents(here.id, 'upcoming');
      expect(listed.items.map((item) => item.slug)).toEqual([livePublished.slug]);
      expect((await reads.centreEvents(here.id, 'past')).items).toEqual([]);

      // Cancel the pending publication so later sweeps stay exact.
      await transition(scheduled, 'cancel', publisher);
    });

    it('classifies upcoming and past as the pure rule does, in a total, bounded order', async () => {
      const here = await centre();
      const there = await centre();
      // Ends exactly NOW: not yet past, and keyed by its own start.
      const boundary = await published(held(here.id, span(-2, 0)));
      const ongoing = await published(held(here.id, span(-1, 1)));
      const soon = await published(held(here.id, span(24, null)));
      // A past occurrence and a future one: keyed by the one not yet over.
      const multi = await published(held(here.id, span(-240, -239), span(48, 49)));
      const tieOne = await published(held(here.id, span(72, 73)));
      const tieTwo = await published(held(here.id, span(72, 73)));
      const later = await published(held(here.id, span(96, null)));
      const recent = await published(held(here.id, span(-48, -47)));
      const old = await published(held(here.id, span(-480, null)));
      await create(held(here.id, span(30, 31)));
      const away = await published(held(there.id, span(36, 37)));

      const ties = [tieOne, tieTwo].sort((a, b) => (a.id < b.id ? -1 : 1));
      const upcomingOrder = [boundary, ongoing, soon, multi, ...ties, later].map(
        (row) => row.slug,
      );
      const pastOrder = [recent, old].map((row) => row.slug);

      const upcoming = await reads.events({
        when: 'upcoming',
        offset: 0,
        centreIds: [here.id],
      });
      expect(upcoming.items.map((item) => item.slug)).toEqual(upcomingOrder);
      expect(upcoming.more).toBe(false);
      const past = await reads.events({ when: 'past', offset: 0, centreIds: [here.id] });
      expect(past.items.map((item) => item.slug)).toEqual(pastOrder);

      // The SQL classification agrees with `eventTiming` on every card.
      const timing = (item: EventSummary) =>
        eventTiming(item.schedule.occurrences, readNow);
      expect(upcoming.items.map(timing)).toEqual([
        'upcoming',
        'ongoing',
        'upcoming',
        'upcoming',
        'upcoming',
        'upcoming',
        'upcoming',
      ]);
      expect(past.items.map(timing)).toEqual(['past', 'past']);
      // An ongoing Event is in the upcoming view only.
      expect(past.items.map((item) => item.slug)).not.toContain(ongoing.slug);

      // Bounded pages that tile the view exactly.
      const pages: string[] = [];
      for (let offset = 0; ; offset += 2) {
        const page = await reads.centreEvents(here.id, 'upcoming', offset, 2);
        expect(page.items.length).toBeLessThanOrEqual(2);
        pages.push(...page.items.map((item) => item.slug));
        if (!page.more) break;
        expect(offset).toBeLessThan(20);
      }
      expect(pages).toEqual(upcomingOrder);

      // The Centre filter narrows, unions, and an empty list matches nothing.
      expect(
        (
          await reads.events({ when: 'upcoming', offset: 0, centreIds: [there.id] })
        ).items.map((item) => item.slug),
      ).toEqual([away.slug]);
      const both = await reads.events({
        when: 'upcoming',
        offset: 0,
        centreIds: [here.id, there.id],
      });
      expect(both.items.map((item) => item.slug)).toEqual([
        boundary.slug,
        ongoing.slug,
        soon.slug,
        away.slug,
        multi.slug,
        ...ties.map((row) => row.slug),
        later.slug,
      ]);
      expect(await reads.events({ when: 'upcoming', offset: 0, centreIds: [] })).toEqual({
        items: [],
        more: false,
      });
      expect(
        (await reads.events({ when: 'upcoming', offset: 0, centreIds: [randomUUID()] }))
          .items,
      ).toEqual([]);

      // Unfiltered, every one of them is somewhere in the upcoming view.
      const everything: string[] = [];
      for (let offset = 0; ; offset += 20) {
        const page = await reads.events({ when: 'upcoming', offset, centreIds: null });
        everything.push(...page.items.map((item) => item.slug));
        if (!page.more) break;
      }
      for (const slug of [...upcomingOrder, away.slug])
        expect(everything).toContain(slug);
      for (const slug of pastOrder) expect(everything).not.toContain(slug);

      // A card is a summary: never a body or an authoring document.
      expect(JSON.stringify(upcoming)).not.toContain(BODY_SENTINEL);

      // Time moves on: at a later server instant the same Event is past.
      const before = readNow;
      try {
        readNow = new Date(readNow.getTime() + 1000 * 3_600_000);
        const after = await reads.events({
          when: 'past',
          offset: 0,
          centreIds: [here.id],
        });
        expect(after.items.map((item) => item.slug)).toContain(soon.slug);
        expect(
          (await reads.events({ when: 'upcoming', offset: 0, centreIds: [here.id] }))
            .items,
        ).toEqual([]);
      } finally {
        readNow = before;
      }
    });

    it('previews a topic’s upcoming Events, or its past ones when none is ahead', async () => {
      const [ahead, behind] = topics as [string, string];
      const atHoursTagged = (topicId: string, ...occurrences: Occurrence[]) => ({
        ...content({ topicIds: [topicId], schedule: { timezone: 'UTC', occurrences } }),
      });
      const next = await published(atHoursTagged(ahead, span(10, 11)));
      const gone = await published(atHoursTagged(ahead, span(-10, -9)));
      const onlyPast = await published(atHoursTagged(behind, span(-20, -19)));
      const draft = await create(atHoursTagged(behind, span(20, 21)));

      const forAhead = await reads.eventsOnTopic(ahead);
      expect(forAhead.when).toBe('upcoming');
      expect(forAhead.page.items.map((item) => item.slug)).toEqual([next.slug]);
      expect(forAhead.page.items.map((item) => item.slug)).not.toContain(gone.slug);

      const forBehind = await reads.eventsOnTopic(behind);
      expect(forBehind.when).toBe('past');
      expect(forBehind.page.items.map((item) => item.slug)).toEqual([onlyPast.slug]);
      expect(forBehind.page.items.map((item) => item.slug)).not.toContain(draft.slug);
    });

    it('resolves a former slug to the current one only while the Event is published', async () => {
      let row = await published();
      const first = row.slug;
      row = await revise(row, content());
      // Renamed but back in draft: nothing public answers either slug.
      expect(await reads.eventCanonicalSlug(first)).toBeNull();
      expect(await reads.eventCanonicalSlug(row.slug)).toBeNull();
      row = await transition(await reapproved(row), 'publish', publisher);
      expect(await reads.eventCanonicalSlug(first)).toBe(row.slug);
      expect(await reads.eventCanonicalSlug(row.slug)).toBe(row.slug);
      // The page answers only the current slug; the proxy redirects the former.
      expect(await reads.event(first)).toBeNull();
      expect((await reads.event(row.slug))?.slug).toBe(row.slug);
      expect(await auditCount(row.id, 'slug-changed')).toBe(1);
      // A reserved slug is never given to another Event.
      expect(await refusal(create(content({ slug: first })))).toBe('duplicate-slug');
      await expect(
        db.admin.query(`DELETE FROM [EventSlugHistory] WHERE [ownerId]=N'${row.id}';`),
      ).rejects.toThrow();
      // Withdrawn: the former slug resolves to nothing.
      await transition(row, 'archive', publisher);
      expect(await reads.eventCanonicalSlug(first)).toBeNull();
      expect(await reads.eventCanonicalSlug(row.slug)).toBeNull();
    });

    it('advertises exactly the current published Event URLs, in their genuine languages', async () => {
      await published(content({ languages: ['ur', 'en'] }));
      await published(content({ languages: ['ar'] }));
      const ORIGIN = 'https://events-sitemap.proof.invalid';
      process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = 'true';
      process.env['AUTH_BASE_URL'] = ORIGIN;
      try {
        const { eventSitemapPartitions } =
          await import('../../apps/web/src/seo/events-sitemap.ts');
        const partitions = await eventSitemapPartitions();
        expect(partitions.every((partition) => partition.segment === 'events')).toBe(
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
          `SELECT e.[slug], t.[languageCode] FROM [Event] e
           JOIN [EventRevisionTranslation] t ON t.[ownerId]=e.[id] AND t.[revisionNumber]=e.[currentRevision]
           WHERE e.[state]=N'published';`,
        );
        const expected = new Set(
          rows.map((row) => `${ORIGIN}/${row.languageCode}${eventPathOf(row.slug)}`),
        );
        expect(expected.size).toBeGreaterThan(0);
        expect(advertised).toEqual(expected);
        // Never a former slug, a query or a gallery view.
        const former = await db.admin.query<{ slug: string }>(
          `SELECT h.[slug] FROM [EventSlugHistory] h JOIN [Event] e ON e.[id]=h.[ownerId] WHERE h.[slug]<>e.[slug];`,
        );
        expect(former.length).toBeGreaterThan(0);
        for (const { slug } of former)
          for (const url of advertised)
            expect(url.endsWith(eventPathOf(slug))).toBe(false);
        for (const url of advertised) {
          expect(url).not.toContain('?');
          expect(url.endsWith('/gallery')).toBe(false);
        }

        process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = 'false';
        expect(await eventSitemapPartitions()).toEqual([]);
      } finally {
        delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];
      }
    });

    it('validates a public query again whatever the page tolerated', async () => {
      const when = 'whenever' as EventWhen;
      await expect(reads.events({ when, offset: 0, centreIds: null })).rejects.toThrow();
      await expect(
        reads.events({ when: 'past', offset: 25_001, centreIds: null }),
      ).rejects.toThrow();
      expect(await reads.event('')).toBeNull();
    });
  });

  it('requests no Search indexing for any Event', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM [Event];')).toBeGreaterThan(50);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM [SearchIndexRequest] WHERE [scopeId] IN (SELECT [id] FROM [Event]);',
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM [SearchIndexRequest] WHERE [scopeKind] LIKE N'%event%';",
      ),
    ).toBe(0);
  });

  it('has no silently swallowed scheduler errors', () => {
    expect(errors).toEqual([]);
  });
});
