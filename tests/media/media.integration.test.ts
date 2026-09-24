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
  createMediaReadService,
  createMediaService,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';

/**
 * Phase 10 — Video, Series and Playlist over a REAL SQL Server, through the real
 * Media service, adapter and public reader.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that a slug is reserved for ever by a
 * trigger no writer can skip; that a renamed series which became a programme
 * resolves to ONE current address; that a provider identifier is unique exactly
 * and case-sensitively; that an episode position is unique within its Series;
 * that a stale save and a stale playlist change conflict inside the writing
 * transaction; that the audit and the search intent commit with the change; and
 * that every public read withholds what is not published.
 *
 * EVERYTHING IS SYNTHETIC — titles, people and provider identifiers.
 */

const live = databaseConfigured ? describe : describe.skip;

/** What a read carries that an input never does, and how a record re-saves. */
function editableVideo(record: Record<string, unknown>): Record<string, unknown> {
  const {
    id: _id,
    version: _version,
    updatedAt: _updatedAt,
    series,
    providerVideoId,
    ...rest
  } = record;
  const ref = series as { id: string; position: number } | null;
  return {
    ...rest,
    providerReference: providerVideoId,
    seriesId: ref?.id ?? null,
    seriesPosition: ref?.position ?? null,
  };
}

function editableGroup(record: Record<string, unknown>): Record<string, unknown> {
  const {
    id: _id,
    version: _version,
    updatedAt: _updatedAt,
    videos: _videos,
    ...rest
  } = record;
  return rest;
}

let sequence = 0;
const unique = (prefix: string) => {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${Date.now().toString(36)}`;
};

/** An eleven-character YouTube-shaped identifier, fresh per call. */
const youtubeId = () => `Zx${randomUUID().replaceAll('-', '').slice(0, 9)}`;

live('Phase 10 Media against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let topicId: string;
  let service: ReturnType<typeof createMediaService>;
  let reads: ReturnType<typeof createMediaReadService>;
  let curator: { accountId: string };
  let reader: { accountId: string };
  let outsider: { accountId: string };

  async function account(keys: readonly string[]): Promise<{ accountId: string }> {
    const id = await createProofAccount(db.admin);
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic media role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
    );
    for (const key of keys) {
      await db.admin.query(
        `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
      );
    }
    return { accountId: id };
  }

  const label = (title: string, locale: 'en' | 'ur' | 'ar' = 'en') => ({
    locale,
    title,
    description: '',
  });

  const videoInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('video'),
    primaryLocale: 'en',
    state: 'published',
    isFeatured: false,
    provider: 'youtube',
    providerReference: youtubeId(),
    availability: 'available',
    format: 'lecture',
    languageCode: 'en',
    labels: [label('Synthetic non-authoritative video')],
    durationSeconds: 600,
    publishedOn: null,
    thumbnailUrl: null,
    captions: false,
    transcript: null,
    seriesId: null,
    seriesPosition: null,
    speakerIds: [people.linkedPersonId],
    topicIds: [topicId],
    ...overrides,
  });

  const seriesInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('series'),
    kind: 'series',
    primaryLocale: 'en',
    state: 'published',
    labels: [label('Synthetic series')],
    ...overrides,
  });

  const playlistInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('playlist'),
    primaryLocale: 'en',
    state: 'published',
    labels: [label('Synthetic playlist')],
    ...overrides,
  });

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return mediaFailure(error);
    }
    return 'accepted';
  };

  const count = async (sql: string): Promise<number> => {
    const [row] = await db.admin.query<{ n: number }>(sql);
    return Number(row?.n ?? -1);
  };

  beforeAll(async () => {
    db = await createProofDatabase();

    const { createMediaPersistence, createMediaPublicReader } =
      await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createPeopleReader } =
      await import('../../packages/database/src/adapters/people-contributors/index.ts');
    const { createTaxonomyReader } =
      await import('../../packages/database/src/adapters/taxonomy/index.ts');

    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);
    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT TOP 1 [id] FROM [Topic] WHERE [status]=N'active' ORDER BY [id];",
    );
    if (topic === undefined) throw new Error('No seeded Topic is available.');
    topicId = topic.id;

    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    service = createMediaService({
      persistence: createMediaPersistence(),
      authority: { permits: (id, key) => authorization.hasPermission(id, key) },
      references: {
        validPeople: async (ids) =>
          ids.length === 0 ||
          (await createPeopleReader().contributorReferences([...new Set(ids)], 'en'))
            .length === new Set(ids).size,
        validTopics: async (ids) =>
          ids.length === 0 ||
          (await createTaxonomyReader().topicReferences(ids, 'en')).length === ids.length,
        validLanguage: async (code) =>
          (await createTaxonomyReader().listLanguages({ includeRetired: false })).some(
            (language) => language.code === code,
          ),
      },
    });
    reads = createMediaReadService(createMediaPublicReader());

    curator = await account(['media.read', 'media.administer']);
    reader = await account(['media.read']);
    outsider = await account([]);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('authority, live from Identity', () => {
    it('refuses a reader a change and an outsider a read', async () => {
      expect(await refusal(service.saveVideo(reader, null, null, videoInput()))).toBe(
        'denied',
      );
      expect(await refusal(service.videos(outsider))).toBe('denied');
      expect(await refusal(service.saveVideo(outsider, null, null, videoInput()))).toBe(
        'denied',
      );
    });

    it('grants nothing to a speaker for being named on a Video', async () => {
      const saved = await service.saveVideo(curator, null, null, videoInput());
      expect(saved.speakerIds).toEqual([people.linkedPersonId]);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [RolePermission] WHERE [permissionKey] LIKE N'media.%' AND [roleId] IN (SELECT [roleId] FROM [RoleAssignment] WHERE [userId] IN (SELECT [userId] FROM [Person] WHERE [id]=N'${people.linkedPersonId}' AND [userId] IS NOT NULL));`,
        ),
      ).toBe(0);
    });
  });

  describe('one Video entity, at most one Series, many Playlists', () => {
    it('keeps a provider identifier unique — exactly, and case-sensitively', async () => {
      const id = youtubeId();
      await service.saveVideo(curator, null, null, videoInput({ providerReference: id }));
      expect(
        await refusal(
          service.saveVideo(
            curator,
            null,
            null,
            videoInput({ providerReference: `https://youtu.be/${id}` }),
          ),
        ),
      ).toBe('duplicate-video');
      // The same letters in another case are another YouTube video.
      const swapped = [...id]
        .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
        .join('');
      const other = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({ providerReference: swapped }),
      );
      expect(other.providerVideoId).toBe(swapped);
    });

    it('places a Video in at most one Series, at a unique episode position', async () => {
      const first = await service.saveSeries(curator, null, null, seriesInput());
      const second = await service.saveSeries(curator, null, null, seriesInput());
      const episode = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({ seriesId: first.id, seriesPosition: 1 }),
      );
      expect(
        await refusal(
          service.saveVideo(
            curator,
            null,
            null,
            videoInput({ seriesId: first.id, seriesPosition: 1 }),
          ),
        ),
      ).toBe('duplicate-position');

      // Moving it to another Series LEAVES the first: one column, one Series.
      const moved = await service.saveVideo(curator, episode.id, episode.version, {
        ...editableVideo(episode as unknown as Record<string, unknown>),
        seriesId: second.id,
        seriesPosition: 3,
      });
      expect(moved.series?.id).toBe(second.id);
      expect((await reads.seriesVideos(first.id)).items.map((v) => v.id)).not.toContain(
        episode.id,
      );
      expect((await reads.seriesVideos(second.id)).items.map((v) => v.id)).toContain(
        episode.id,
      );
    });

    it('lists one Video in many Playlists, and never deletes it with one', async () => {
      const video = await service.saveVideo(curator, null, null, videoInput());
      const lists = await Promise.all(
        [1, 2].map(() => service.savePlaylist(curator, null, null, playlistInput())),
      );
      for (const list of lists) {
        await service.changePlaylist(curator, list.id, list.version, {
          op: 'add',
          videoId: video.id,
        });
      }
      expect((await reads.videoPlaylists(video.id)).map((p) => p.id).sort()).toEqual(
        lists.map((list) => list.id).sort(),
      );

      // Archiving a Playlist withdraws the list, not the Video.
      const [first] = lists;
      if (first === undefined) throw new Error('unreachable');
      const current = await service.playlist(curator, first.id);
      if (current === null) throw new Error('playlist missing');
      await service.savePlaylist(
        curator,
        first.id,
        current.version,
        editableGroup({ ...current, state: 'archived' }),
      );
      expect(await reads.video(video.slug)).not.toBeNull();
      expect((await reads.videoPlaylists(video.id)).map((p) => p.id)).toEqual([
        lists[1]?.id,
      ]);
    });
  });

  describe('native slug history, one hop, never reused', () => {
    it('answers a former Video slug with the current one, and refuses its reuse', async () => {
      const video = await service.saveVideo(curator, null, null, videoInput());
      const renamed = unique('renamed-video');
      const saved = await service.saveVideo(curator, video.id, video.version, {
        ...editableVideo(video as unknown as Record<string, unknown>),
        slug: renamed,
      });
      expect(await reads.videoCanonicalSlug(video.slug)).toBe(renamed);
      expect(await reads.video(video.slug)).toBeNull();
      expect(
        await refusal(
          service.saveVideo(curator, null, null, videoInput({ slug: video.slug })),
        ),
      ).toBe('duplicate-slug');
      // Returning to its own former slug is not reuse.
      const back = await service.saveVideo(curator, video.id, saved.version, {
        ...editableVideo(saved as unknown as Record<string, unknown>),
        slug: video.slug,
      });
      expect(back.slug).toBe(video.slug);
    });

    it('resolves a renamed series that became a programme to ONE current address', async () => {
      const series = await service.saveSeries(curator, null, null, seriesInput());
      const programSlug = unique('program');
      await service.saveSeries(curator, series.id, series.version, {
        ...editableGroup(series as unknown as Record<string, unknown>),
        slug: programSlug,
        kind: 'program',
      });
      expect(await reads.seriesCanonical(series.slug)).toEqual({
        kind: 'program',
        slug: programSlug,
      });
      // The programme has ONE family: never rendered as a series.
      expect(await reads.series('series', programSlug)).toBeNull();
      expect((await reads.series('program', programSlug))?.id).toBe(series.id);
    });

    it('answers a former Playlist slug with the current one', async () => {
      const list = await service.savePlaylist(curator, null, null, playlistInput());
      const renamed = unique('renamed-playlist');
      await service.savePlaylist(curator, list.id, list.version, {
        ...editableGroup(list as unknown as Record<string, unknown>),
        slug: renamed,
      });
      expect(await reads.playlistCanonicalSlug(list.slug)).toBe(renamed);
    });

    it('resolves nothing for a withdrawn record, so no redirect leads to a 404', async () => {
      const video = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({ state: 'draft' }),
      );
      expect(await reads.videoCanonicalSlug(video.slug)).toBeNull();
    });
  });

  describe('concurrency, audit and durable search intent', () => {
    it('refuses a stale Video save, and leaves the first save intact', async () => {
      const video = await service.saveVideo(curator, null, null, videoInput());
      const editable = editableVideo(video as unknown as Record<string, unknown>);
      await service.saveVideo(curator, video.id, video.version, {
        ...editable,
        labels: [label('First writer wins')],
      });
      expect(
        await refusal(
          service.saveVideo(curator, video.id, video.version, {
            ...editable,
            labels: [label('Second writer is stale')],
          }),
        ),
      ).toBe('conflict');
      expect((await service.video(curator, video.id))?.labels[0]?.title).toBe(
        'First writer wins',
      );
    });

    it('refuses the second of two changes made to one Playlist version', async () => {
      const [a, b] = await Promise.all(
        [1, 2].map(() => service.saveVideo(curator, null, null, videoInput())),
      );
      if (a === undefined || b === undefined) throw new Error('unreachable');
      const list = await service.savePlaylist(curator, null, null, playlistInput());
      const outcomes = await Promise.allSettled([
        service.changePlaylist(curator, list.id, list.version, {
          op: 'add',
          videoId: a.id,
        }),
        service.changePlaylist(curator, list.id, list.version, {
          op: 'add',
          videoId: b.id,
        }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(
        1,
      );
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(mediaFailure((rejected as PromiseRejectedResult).reason)).toBe('conflict');
      expect((await service.playlist(curator, list.id))?.videos).toHaveLength(1);
    });

    it('reorders a Playlist densely, under its version', async () => {
      const videos = await Promise.all(
        [1, 2, 3].map(() => service.saveVideo(curator, null, null, videoInput())),
      );
      let list = await service.playlist(
        curator,
        (await service.savePlaylist(curator, null, null, playlistInput())).id,
      );
      for (const video of videos) {
        if (list === null) throw new Error('playlist missing');
        list = await service.changePlaylist(curator, list.id, list.version, {
          op: 'add',
          videoId: video.id,
        });
      }
      if (list === null) throw new Error('playlist missing');
      const moved = await service.changePlaylist(curator, list.id, list.version, {
        op: 'move',
        videoId: videos[2]?.id ?? '',
        direction: 'earlier',
      });
      expect(moved.videos.map((v) => v.id)).toEqual([
        videos[0]?.id,
        videos[2]?.id,
        videos[1]?.id,
      ]);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [PlaylistVideo] WHERE [playlistId]=N'${list.id}' AND [position] BETWEEN 0 AND 2;`,
        ),
      ).toBe(3);
      // The public order is the curated order.
      expect((await reads.playlistVideos(list.id)).items.map((v) => v.id)).toEqual(
        moved.videos.map((v) => v.id),
      );
    });

    it('commits the audit entry and the search intent with the change', async () => {
      const video = await service.saveVideo(curator, null, null, videoInput());
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [SearchIndexRequest] WHERE [scopeKind]=N'video' AND [scopeId]=N'${video.id}';`,
        ),
      ).toBe(1);
      const [audit] = await db.admin.query<{
        afterState: string;
        authorisingSource: string;
      }>(
        `SELECT [afterState],[authorisingSource] FROM [AuditLog] WHERE [action]=N'media.video.created' AND [targetId]=N'${video.id}';`,
      );
      expect(audit?.authorisingSource).toBe('media.administer');
      // Identifiers and counts only — never a title, a description or a transcript.
      expect(audit?.afterState).not.toContain('Synthetic');
      const list = await service.savePlaylist(curator, null, null, playlistInput());
      await service.changePlaylist(curator, list.id, list.version, {
        op: 'add',
        videoId: video.id,
      });
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [action]=N'media.playlist.membership.changed' AND [targetId]=N'${list.id}';`,
        ),
      ).toBe(1);
    });
  });

  describe('the public predicate', () => {
    it('never returns a draft or archived Video, anywhere', async () => {
      const draft = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({ state: 'draft' }),
      );
      const archived = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({ state: 'archived' }),
      );
      for (const record of [draft, archived]) {
        expect(await reads.video(record.slug)).toBeNull();
        expect(
          (await reads.videos({ topic: topicId, offset: 0 })).items.map((v) => v.id),
        ).not.toContain(record.id);
      }
      expect(await reads.video('Not A Slug')).toBeNull();
    });

    it('shows a Video’s Series only while that Series is published', async () => {
      const series = await service.saveSeries(
        curator,
        null,
        null,
        seriesInput({ state: 'draft' }),
      );
      const video = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({ seriesId: series.id, seriesPosition: 1 }),
      );
      expect((await reads.video(video.slug))?.series).toBeNull();
      expect((await reads.seriesVideos(series.id)).items).toEqual([]);
      expect((await service.video(curator, video.id))?.series?.id).toBe(series.id);
    });

    it('lists only a published Playlist’s published Videos', async () => {
      const shown = await service.saveVideo(curator, null, null, videoInput());
      const hidden = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({ state: 'draft' }),
      );
      let list = await service.playlist(
        curator,
        (
          await service.savePlaylist(
            curator,
            null,
            null,
            playlistInput({ state: 'draft' }),
          )
        ).id,
      );
      for (const video of [hidden, shown]) {
        if (list === null) throw new Error('playlist missing');
        list = await service.changePlaylist(curator, list.id, list.version, {
          op: 'add',
          videoId: video.id,
        });
      }
      if (list === null) throw new Error('playlist missing');
      expect(await reads.playlist(list.slug)).toBeNull();
      expect((await reads.playlistVideos(list.id)).items).toEqual([]);
      const published = await service.savePlaylist(
        curator,
        list.id,
        list.version,
        editableGroup({ ...list, state: 'published' }),
      );
      expect((await reads.playlistVideos(published.id)).items.map((v) => v.id)).toEqual([
        shown.id,
      ]);
    });

    it('narrows by format, language, speaker, Series and featured, newest first', async () => {
      const series = await service.saveSeries(curator, null, null, seriesInput());
      const marker = await service.saveVideo(
        curator,
        null,
        null,
        videoInput({
          format: 'documentary',
          languageCode: 'ur',
          isFeatured: true,
          publishedOn: '2030-01-02',
          seriesId: series.id,
          seriesPosition: 1,
        }),
      );
      const ids = async (query: Record<string, unknown>) =>
        (await reads.videos(query)).items.map((v) => v.id);
      expect(await ids({ format: 'documentary' })).toContain(marker.id);
      expect(await ids({ format: 'interview' })).not.toContain(marker.id);
      expect(await ids({ language: 'ur' })).toContain(marker.id);
      expect(await ids({ series: series.id })).toEqual([marker.id]);
      expect(await ids({ speaker: people.linkedPersonId })).toContain(marker.id);
      expect(await ids({ featured: true })).toContain(marker.id);
      // Newest provider date first: a 2030 video leads the unfiltered listing.
      expect((await ids({}))[0]).toBe(marker.id);
      // A filter can only narrow: an unknown key is refused, never ignored.
      expect(() => reads.videos({ state: 'draft' })).toThrow();
    });

    it('counts speakers over published Videos only', async () => {
      const facets = await reads.speakerFacets(0);
      const facet = facets.items.find((entry) => entry.id === people.linkedPersonId);
      const published = await count(
        `SELECT COUNT(*) AS n FROM [VideoSpeaker] vs JOIN [Video] v ON v.[id]=vs.[videoId] WHERE vs.[personId]=N'${people.linkedPersonId}' AND v.[state]=N'published';`,
      );
      expect(facet?.videos).toBe(published);
    });
  });
});
