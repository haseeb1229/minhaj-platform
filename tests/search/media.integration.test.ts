import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 10 — Video in the Search foundation, over REAL SQL Server Full-Text
 * Search.
 *
 * WHAT IS PROVED, and only against the live engine: a Video is projected by
 * Media's own mutation and found at its CURRENT canonical address; its
 * transcript is matched in its content language; the type, topic, language and
 * year filters combine over it; a draft is never indexed; a withdrawn Video is
 * WITHHELD while its stale rows are still in the index and then leaves it; a
 * rebuild restores it from Media alone; reconciliation repairs what the index
 * lost or kept. Series and Playlists are NOT searchable kinds and never appear.
 *
 * EVERYTHING IS SYNTHETIC. Titles say they are fixtures and the words are
 * invented; no religious text is used.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
const youtubeId = () => `Sr${randomUUID().replaceAll('-', '').slice(0, 9)}`;

function videoInput(title: string, overrides: Record<string, unknown> = {}) {
  return {
    slug: slug('video-proof'),
    primaryLocale: 'en',
    state: 'published',
    isFeatured: false,
    provider: 'youtube',
    providerReference: youtubeId(),
    availability: 'available',
    format: 'lecture',
    languageCode: 'en',
    labels: [{ locale: 'en', title, description: '' }],
    durationSeconds: null,
    publishedOn: null,
    thumbnailUrl: null,
    captions: false,
    transcript: null,
    seriesId: null,
    seriesPosition: null,
    speakerIds: [],
    topicIds: [],
    ...overrides,
  };
}

/** A Video read back as the input that would save it unchanged. */
function editable(record: Record<string, unknown>): Record<string, unknown> {
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

live('Phase 10 Video in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let curator: { accountId: string };
  let educationTopic: string;
  let lecture: { id: string; slug: string; version: number };
  let urdu: { id: string };
  let draft: { id: string };

  async function find(q: string, extra: Record<string, string> = {}) {
    const outcome = await h.search.search({ q, ...extra }, { locale: 'en' });
    if (outcome.state !== 'results') {
      throw new Error(`Expected results for a proof query, got ${outcome.state}.`);
    }
    return outcome.results;
  }

  async function kinds(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.kind).sort();
  }

  async function documentsOf(id: string): Promise<number> {
    const [row] = await db.admin.query<{ documents: number }>(
      `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'video' AND [scopeId] = N'${id}';`,
    );
    return Number(row?.documents ?? 0);
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    curator = await h.account(['media.administer', 'media.read']);

    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');
    educationTopic = topic.id;

    const save = (value: unknown) => h.media.saveVideo(curator, null, null, value);

    lecture = await save(
      videoInput('Synthetic lecture on reading rooms marrowfenfixture', {
        publishedOn: '2022-06-01',
        topicIds: [educationTopic],
        transcript:
          'The ashgrovefixture transcript describes a catalogue of reading rooms.',
      }),
    );

    // Labelled only in English, SPOKEN in Urdu: its transcript is matched in an
    // Urdu document of its own, and every document carries Urdu content.
    urdu = await save(
      videoInput('Synthetic Urdu talk brindlefixture', {
        languageCode: 'ur',
        transcript: 'کتب خانوں کے مطالعہ گاہوں پر ایک آزمائشی گفتگو',
      }),
    );

    draft = await save(videoInput('Synthetic draft cobblefixture', { state: 'draft' }));

    // A Series and a Playlist named with a word no Video carries: neither is a
    // searchable kind, so neither is ever found.
    await h.media.saveSeries(curator, null, null, {
      slug: slug('series-proof'),
      kind: 'series',
      primaryLocale: 'en',
      state: 'published',
      labels: [{ locale: 'en', title: 'Synthetic series groutfixture', description: '' }],
    });
    await h.media.savePlaylist(curator, null, null, {
      slug: slug('playlist-proof'),
      primaryLocale: 'en',
      state: 'published',
      labels: [
        { locale: 'en', title: 'Synthetic playlist groutfixture', description: '' },
      ],
    });

    await h.indexNow();
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('commits each Video mutation’s search intent in the same transaction', async () => {
    const saved = await h.media.saveVideo(
      curator,
      null,
      null,
      videoInput('Synthetic intent probe', { state: 'draft' }),
    );
    const [row] = await db.admin.query<{ requests: number }>(
      `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'video' AND [scopeId] = N'${saved.id}';`,
    );
    expect(Number(row?.requests)).toBe(1);
    await h.indexNow();
    // A draft owes a projection request and projects nothing.
    expect(await documentsOf(saved.id)).toBe(0);
  });

  it('finds a Video at its current Watch address, with its provider year', async () => {
    const hits = (await find('marrowfenfixture')).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: 'video',
      href: `/watch/videos/${lecture.slug}`,
      year: 2022,
      contentLanguage: 'en',
    });
  });

  it('matches a transcript in the Video’s CONTENT language, whatever its labels', async () => {
    expect(await kinds('ashgrovefixture')).toEqual(['video']);
    expect(await kinds('مطالعہ')).toEqual(['video']);
    expect(await kinds('brindlefixture', { language: 'ur' })).toEqual(['video']);
    expect(await kinds('brindlefixture', { language: 'en' })).toEqual([]);
    expect(urdu.id).toBeTruthy();
  });

  it('combines the type, topic and year filters over Videos', async () => {
    const education = { topic: 'education' };
    expect(await kinds('synthetic', { ...education, type: 'video' })).toEqual(['video']);
    expect(
      await kinds('marrowfenfixture', { type: 'video', from: '2022', to: '2022' }),
    ).toEqual(['video']);
    expect(await kinds('marrowfenfixture', { type: 'video', to: '2021' })).toEqual([]);
    expect(await kinds('marrowfenfixture', { type: 'research' })).toEqual([]);
  });

  it('never indexes a draft, a Series or a Playlist', async () => {
    expect(await kinds('cobblefixture')).toEqual([]);
    expect(await documentsOf(draft.id)).toBe(0);
    expect(await kinds('groutfixture')).toEqual([]);
  });

  it('addresses a renamed Video at its CURRENT slug before any re-indexing', async () => {
    const current = await h.media.video(curator, lecture.id);
    if (current === null) throw new Error('fixture video missing');
    const renamed = slug('video-renamed');
    lecture = await h.media.saveVideo(curator, lecture.id, current.version, {
      ...editable(current as unknown as Record<string, unknown>),
      slug: renamed,
    });
    expect((await find('marrowfenfixture')).hits[0]?.href).toBe(
      `/watch/videos/${renamed}`,
    );
    await h.indexNow();
  });

  describe('a stale index never discloses', () => {
    it('withholds a withdrawn Video while its rows remain, then drops them', async () => {
      const current = await h.media.video(curator, lecture.id);
      if (current === null) throw new Error('fixture video missing');
      lecture = await h.media.saveVideo(curator, lecture.id, current.version, {
        ...editable(current as unknown as Record<string, unknown>),
        state: 'archived',
      });

      // The stale rows are still there — and nothing of them is returned.
      expect(await documentsOf(lecture.id)).toBeGreaterThan(0);
      const stale = await find('marrowfenfixture');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBeGreaterThanOrEqual(1);

      await h.indexNow();
      expect(await documentsOf(lecture.id)).toBe(0);
      expect((await find('marrowfenfixture')).withheld).toBe(0);
    });

    it('withholds a Video unpublished with no request at all', async () => {
      await db.admin.query(
        `UPDATE [dbo].[Video] SET [state] = N'draft' WHERE [id] = N'${urdu.id}';`,
      );
      // No owner mutation, so nothing asked to re-index: the ONLY protection left
      // is the query-time visibility recheck.
      expect(await documentsOf(urdu.id)).toBeGreaterThan(0);
      const stale = await find('brindlefixture');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBe(1);

      const summary = await h.search.reconcile();
      expect(summary.orphaned).toBeGreaterThanOrEqual(1);
      await h.indexNow();
      expect(await documentsOf(urdu.id)).toBe(0);

      await db.admin.query(
        `UPDATE [dbo].[Video] SET [state] = N'published', [version] = [version] + 1 WHERE [id] = N'${urdu.id}';`,
      );
      await h.search.reconcile();
      await h.indexNow();
      expect(await kinds('brindlefixture')).toEqual(['video']);
    });
  });

  describe('rebuild and reconciliation', () => {
    it('rebuilds the Video inventory from Media alone, starting from empty', async () => {
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
         DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
      );
      await h.engineSettled();
      expect(await kinds('brindlefixture')).toEqual([]);

      await h.search.rebuild();
      await h.indexNow();

      const [inventory] = await db.admin.query<{ kinds: string }>(
        `SELECT STRING_AGG([kind], N',') WITHIN GROUP (ORDER BY [kind]) AS kinds
           FROM (SELECT DISTINCT [kind] FROM [dbo].[SearchDocument]) k;`,
      );
      // The withdrawn lecture stays out, the draft never enters, and no Series
      // or Playlist kind exists to appear.
      expect(inventory?.kinds).toBe('topic,video');
      expect(await kinds('marrowfenfixture')).toEqual([]);
      expect(await kinds('cobblefixture')).toEqual([]);
      expect(await kinds('brindlefixture')).toEqual(['video']);
    });

    it('reconciles missing, stale and orphaned Video projections', async () => {
      const published = await h.media.saveVideo(
        curator,
        null,
        null,
        videoInput('Synthetic reconcile probe wickerfixture'),
      );
      await h.indexNow();

      // MISSING: the index lost a Video without being told.
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'video' AND [scopeId] = N'${published.id}';`,
      );
      // STALE: a label changed with no request (as a restore might).
      await db.admin.query(
        `UPDATE [dbo].[VideoLabel] SET [title] = N'Synthetic Urdu talk hazelmerefixture' WHERE [videoId] = N'${urdu.id}';
         UPDATE [dbo].[Video] SET [version] = [version] + 1 WHERE [id] = N'${urdu.id}';`,
      );

      const summary = await h.search.reconcile();
      expect(summary.missing).toBeGreaterThanOrEqual(1);
      expect(summary.stale).toBeGreaterThanOrEqual(1);

      await h.indexNow();
      expect(await kinds('wickerfixture')).toEqual(['video']);
      expect(await kinds('hazelmerefixture')).toEqual(['video']);
    });
  });
});
