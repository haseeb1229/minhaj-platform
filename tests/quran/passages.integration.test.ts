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
  createLibraryReadService,
  createLibraryService,
  libraryFailure,
} from '../../apps/web/src/contexts/library/index.ts';
import {
  createMediaReadService,
  createMediaService,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';

/**
 * Quran Part 8 against real SQL Server — the Quran passages a Library Work and
 * a Media Video explain, through each OWNER's own service and public read:
 *
 *   - an editor's add, move and remove, each under the version the editor saw,
 *     advancing it, and each audited with the passages before and after;
 *   - a stale version is a conflict that changes nothing; a reader, or an
 *     account without the owner's administer key, changes nothing;
 *   - the operator command's set never overwrites an editor's passage;
 *   - the public "what explains this passage" reads: only public owners, by
 *     overlap with a range, ordered by passage, and the per-Surah counts;
 *   - a lecture's start offset round-trips.
 *
 * Synthetic records only; no Quran text is involved — a passage is a citation
 * value, and no Quran corpus is needed for any of this.
 */

const live = databaseConfigured ? describe : describe.skip;

let sequence = 0;
const unique = (prefix: string) => {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${Date.now().toString(36)}`;
};
const youtubeId = () => `Qp${randomUUID().replaceAll('-', '').slice(0, 9)}`;

const kahf = { surah: 18, ayahFrom: 1, ayahTo: 10 };
const kursi = { surah: 2, ayahFrom: 255, ayahTo: 255 };
const fatiha = { surah: 1, ayahFrom: 1, ayahTo: 7 };

live('Quran Part 8 — Quran passages against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let library: ReturnType<typeof createLibraryService>;
  let media: ReturnType<typeof createMediaService>;
  let libraryReads: ReturnType<typeof createLibraryReadService>;
  let mediaReads: ReturnType<typeof createMediaReadService>;
  let editor: { accountId: string };
  let onlyReads: { accountId: string };

  async function account(keys: readonly string[]): Promise<{ accountId: string }> {
    const id = await createProofAccount(db.admin);
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic passage role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
    );
    for (const key of keys)
      await db.admin.query(
        `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
      );
    return { accountId: id };
  }

  const refusal = async (work: Promise<unknown>, of: (error: unknown) => string) => {
    try {
      await work;
    } catch (error) {
      return of(error);
    }
    return 'accepted';
  };

  /** A published Work with a published Edition — public, so its passages are. */
  async function publicWork(state: 'published' | 'draft' = 'published') {
    const work = await library.saveWork(editor, null, null, {
      slug: unique('passage-work'),
      primaryLocale: 'en',
      state,
      isFeatured: false,
      labels: [{ locale: 'en', title: 'Synthetic tafsir book', description: '' }],
      contributors: [{ personId: people.linkedPersonId, role: 'author' }],
      topicIds: [],
      salePointIds: [],
    });
    await library.saveEdition(editor, null, null, {
      workId: work.id,
      label: 'Synthetic edition',
      languageCode: 'en',
      state: 'published',
      publisher: null,
      publicationYear: 2020,
      isbn: null,
      pageCount: null,
      reading: 'unavailable',
      download: 'denied',
      readableAssetId: null,
      downloadAssetId: null,
      document: null,
    });
    const detail = await library.work(editor, work.id);
    if (detail === null) throw new Error('The synthetic Work is missing.');
    return detail;
  }

  async function video(state: 'published' | 'draft' = 'published') {
    return media.saveVideo(editor, null, null, {
      slug: unique('passage-video'),
      primaryLocale: 'en',
      state,
      isFeatured: false,
      provider: 'youtube',
      providerReference: youtubeId(),
      availability: 'available',
      format: 'lecture',
      languageCode: 'en',
      labels: [{ locale: 'en', title: 'Synthetic tafsir lecture', description: '' }],
      durationSeconds: 3600,
      publishedOn: null,
      thumbnailUrl: null,
      captions: false,
      transcript: null,
      seriesId: null,
      seriesPosition: null,
      speakerIds: [people.linkedPersonId],
      topicIds: [],
    });
  }

  const audits = (targetId: string) =>
    db.admin.query<{ action: string; beforeState: string; afterState: string }>(
      `SELECT [action],[beforeState],[afterState] FROM [dbo].[AuditLog] WHERE [targetId]=N'${targetId}' AND [action] LIKE N'%passages%' ORDER BY [occurredAt],[id];`,
    );

  beforeAll(async () => {
    db = await createProofDatabase();
    const {
      createLibraryPersistence,
      createLibraryPublicReader,
      createMediaPersistence,
      createMediaPublicReader,
    } = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createPeopleReader } =
      await import('../../packages/database/src/adapters/people-contributors/index.ts');
    const { createTaxonomyReader } =
      await import('../../packages/database/src/adapters/taxonomy/index.ts');

    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    const references = {
      validPeople: async (ids: readonly string[]) =>
        ids.length === 0 ||
        (await createPeopleReader().contributorReferences([...new Set(ids)], 'en'))
          .length === new Set(ids).size,
      validTopics: async (ids: readonly string[]) =>
        ids.length === 0 ||
        (await createTaxonomyReader().topicReferences(ids, 'en')).length === ids.length,
      validLanguage: async (code: string) =>
        (await createTaxonomyReader().listLanguages({ includeRetired: false })).some(
          (language) => language.code === code,
        ),
    };
    const permits = (id: string, key: string) => authorization.hasPermission(id, key);
    library = createLibraryService({
      persistence: createLibraryPersistence(),
      authority: { permits },
      references,
    });
    media = createMediaService({
      persistence: createMediaPersistence(),
      authority: { permits },
      references,
    });
    libraryReads = createLibraryReadService(createLibraryPublicReader());
    mediaReads = createMediaReadService(createMediaPublicReader());
    editor = await account([
      'library.read',
      'library.administer',
      'media.read',
      'media.administer',
    ]);
    onlyReads = await account(['library.read', 'media.read']);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('a Work’s passages (Library)', () => {
    it('adds, moves and removes under the version the editor saw, auditing each', async () => {
      const work = await publicWork();
      const added = await library.changeWorkQuranPassages(editor, work.id, work.version, {
        op: 'add',
        passage: kahf,
      });
      expect(added.quranPassages).toEqual([kahf]);
      expect(added.version).toBe(work.version + 1);
      const second = await library.changeWorkQuranPassages(
        editor,
        work.id,
        added.version,
        {
          op: 'add',
          passage: fatiha,
        },
      );
      const moved = await library.changeWorkQuranPassages(
        editor,
        work.id,
        second.version,
        {
          op: 'move',
          position: 1,
          direction: 'earlier',
        },
      );
      expect(moved.quranPassages).toEqual([fatiha, kahf]);
      const removed = await library.changeWorkQuranPassages(
        editor,
        work.id,
        moved.version,
        {
          op: 'remove',
          position: 1,
        },
      );
      expect(removed.quranPassages).toEqual([fatiha]);
      expect((await library.work(editor, work.id))?.quranPassages).toEqual([fatiha]);

      const trail = await audits(work.id);
      expect(trail.map((row) => row.action)).toEqual([
        'library.work.passages-add',
        'library.work.passages-add',
        'library.work.passages-move',
        'library.work.passages-remove',
      ]);
      expect(JSON.parse(trail[2]?.beforeState ?? '{}')).toMatchObject({
        passages: '18:1-10 1:1-7',
      });
      expect(JSON.parse(trail[2]?.afterState ?? '{}')).toMatchObject({
        passages: '1:1-7 18:1-10',
        origin: 'editor',
      });
    });

    it('refuses a stale version, a reader and a repeat — changing nothing', async () => {
      const work = await publicWork();
      const saved = await library.changeWorkQuranPassages(editor, work.id, work.version, {
        op: 'add',
        passage: kursi,
      });
      expect(
        await refusal(
          library.changeWorkQuranPassages(editor, work.id, work.version, {
            op: 'add',
            passage: kahf,
          }),
          libraryFailure,
        ),
      ).toBe('conflict');
      expect(
        await refusal(
          library.changeWorkQuranPassages(onlyReads, work.id, saved.version, {
            op: 'add',
            passage: kahf,
          }),
          libraryFailure,
        ),
      ).toBe('denied');
      expect(
        await refusal(
          library.changeWorkQuranPassages(editor, work.id, saved.version, {
            op: 'add',
            passage: kursi,
          }),
          libraryFailure,
        ),
      ).toBe('duplicate-passage');
      const after = await library.work(editor, work.id);
      expect(after?.quranPassages).toEqual([kursi]);
      expect(after?.version).toBe(saved.version);
    });

    it('applies a title-proposed set once, audited as the operator command’s, never over an editor’s', async () => {
      const work = await publicWork();
      const applied = await library.applyTitleQuranPassages(
        editor,
        work.id,
        work.version,
        [fatiha],
      );
      expect(applied.quranPassages).toEqual([fatiha]);
      const [entry] = await audits(work.id);
      expect(entry?.action).toBe('library.work.passages-proposed');
      expect(JSON.parse(entry?.afterState ?? '{}')).toMatchObject({
        origin: 'operator:tafsir-passages',
      });
      expect(
        await refusal(
          library.applyTitleQuranPassages(editor, work.id, applied.version, [kahf]),
          libraryFailure,
        ),
      ).toBe('conflict');
    });

    it('keeps a Work’s passages when the Work itself is saved again', async () => {
      const work = await publicWork();
      const added = await library.changeWorkQuranPassages(editor, work.id, work.version, {
        op: 'add',
        passage: kahf,
      });
      await library.saveWork(editor, work.id, added.version, {
        slug: added.slug,
        primaryLocale: 'en',
        state: 'published',
        isFeatured: true,
        labels: [
          { locale: 'en', title: 'Synthetic tafsir book, renamed', description: '' },
        ],
        contributors: [],
        topicIds: [],
        salePointIds: [],
      });
      expect((await library.work(editor, work.id))?.quranPassages).toEqual([kahf]);
    });
  });

  describe('a Video’s passages (Media)', () => {
    it('adds with a start, moves and removes, auditing each, and refuses a start beyond the video', async () => {
      const lecture = await video();
      const added = await media.changeVideoQuranPassages(
        editor,
        lecture.id,
        lecture.version,
        {
          op: 'add',
          passage: { ...kursi, startSeconds: 754 },
        },
      );
      expect(added.quranPassages).toEqual([{ ...kursi, startSeconds: 754 }]);
      const second = await media.changeVideoQuranPassages(
        editor,
        lecture.id,
        added.version,
        {
          op: 'add',
          passage: { ...kahf, startSeconds: null },
        },
      );
      const moved = await media.changeVideoQuranPassages(
        editor,
        lecture.id,
        second.version,
        {
          op: 'move',
          position: 0,
          direction: 'later',
        },
      );
      expect(moved.quranPassages).toEqual([
        { ...kahf, startSeconds: null },
        { ...kursi, startSeconds: 754 },
      ]);
      expect(
        await refusal(
          media.changeVideoQuranPassages(editor, lecture.id, moved.version, {
            op: 'add',
            passage: { ...fatiha, startSeconds: 3600 },
          }),
          mediaFailure,
        ),
      ).toBe('invalid');
      expect(
        await refusal(
          media.changeVideoQuranPassages(editor, lecture.id, added.version, {
            op: 'remove',
            position: 0,
          }),
          mediaFailure,
        ),
      ).toBe('conflict');
      const trail = await audits(lecture.id);
      expect(trail.map((row) => row.action)).toEqual([
        'media.video.passages.changed',
        'media.video.passages.changed',
        'media.video.passages.changed',
      ]);
      expect(JSON.parse(trail[0]?.afterState ?? '{}')).toMatchObject({
        change: 'add',
        passages: '2:255-255@754',
      });
    });

    it('applies a title-proposed set once, never over an editor’s', async () => {
      const lecture = await video();
      const applied = await media.applyTitleQuranPassages(
        editor,
        lecture.id,
        lecture.version,
        [{ ...kahf, startSeconds: null }],
      );
      expect(applied.quranPassages).toEqual([{ ...kahf, startSeconds: null }]);
      expect((await audits(lecture.id))[0]?.action).toBe('media.video.passages.proposed');
      expect(
        await refusal(
          media.applyTitleQuranPassages(editor, lecture.id, applied.version, [
            { ...fatiha, startSeconds: null },
          ]),
          mediaFailure,
        ),
      ).toBe('conflict');
    });
  });

  describe('the public reads the Tafsir hub composes', () => {
    it('answers only public owners, by overlap, ordered by passage, with counts per Surah', async () => {
      const surah = 99; // A Surah no other test in this database touches.
      const zalzala = { surah, ayahFrom: 1, ayahTo: 8 };
      const early = { surah, ayahFrom: 1, ayahTo: 3 };
      const late = { surah, ayahFrom: 6, ayahTo: 8 };

      const wholeBook = await publicWork();
      await library.changeWorkQuranPassages(editor, wholeBook.id, wholeBook.version, {
        op: 'add',
        passage: zalzala,
      });
      const lateBook = await publicWork();
      await library.changeWorkQuranPassages(editor, lateBook.id, lateBook.version, {
        op: 'add',
        passage: late,
      });
      const draftBook = await publicWork('draft');
      await library.changeWorkQuranPassages(editor, draftBook.id, draftBook.version, {
        op: 'add',
        passage: zalzala,
      });

      const earlyLecture = await video();
      await media.changeVideoQuranPassages(
        editor,
        earlyLecture.id,
        earlyLecture.version,
        {
          op: 'add',
          passage: { ...early, startSeconds: 120 },
        },
      );
      const draftLecture = await video('draft');
      await media.changeVideoQuranPassages(
        editor,
        draftLecture.id,
        draftLecture.version,
        {
          op: 'add',
          passage: { ...early, startSeconds: null },
        },
      );

      const books = await libraryReads.quranPassageWorks({
        surah,
        ayahFrom: 2,
        ayahTo: 2,
      });
      expect(books.map((book) => book.id)).toEqual([wholeBook.id]);
      const allBooks = await libraryReads.quranPassageWorks({ surah });
      expect(allBooks.map((book) => book.id)).toEqual([wholeBook.id, lateBook.id]);
      expect(allBooks[0]?.year).toBe(2020);
      expect(allBooks[0]?.contributors).toEqual([
        { personId: people.linkedPersonId, role: 'author' },
      ]);

      const lectures = await mediaReads.quranPassageVideos({
        surah,
        ayahFrom: 3,
        ayahTo: 3,
      });
      expect(lectures.map((lecture) => [lecture.id, lecture.passages])).toEqual([
        [earlyLecture.id, [{ ...early, startSeconds: 120 }]],
      ]);
      expect(
        await mediaReads.quranPassageVideos({ surah, ayahFrom: 7, ayahTo: 8 }),
      ).toEqual([]);

      expect(
        (await libraryReads.quranPassageCounts()).find((row) => row.surah === surah),
      ).toEqual({
        surah,
        owners: 2,
      });
      expect(
        (await mediaReads.quranPassageCounts()).find((row) => row.surah === surah),
      ).toEqual({
        surah,
        owners: 1,
      });
    });

    it('refuses a malformed query before any read', async () => {
      await expect(libraryReads.quranPassageWorks({ surah: 115 })).rejects.toThrow();
      await expect(
        mediaReads.quranPassageVideos({ surah: 2, ayahFrom: 9, ayahTo: 3 }),
      ).rejects.toThrow();
    });
  });
});
