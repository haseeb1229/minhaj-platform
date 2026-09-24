import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MediaPersistencePort } from '../../packages/contracts/src/media/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 11 — AudioTrack in the Search foundation, over REAL SQL Server
 * Full-Text Search.
 *
 * WHAT IS PROVED, and only against the live engine: a track is projected by
 * Media's own mutation and found at its CURRENT canonical Listen address; its
 * transcript is matched in its content language; the type, topic, language and
 * year filters combine over it; a draft is never indexed; a withdrawn track is
 * WITHHELD while its stale rows are still in the index and then leaves it; a
 * rebuild restores it from Media alone; reconciliation repairs what the index
 * lost or kept. An AudioSeries is NOT a searchable kind and never appears, and
 * nothing about a track's file reaches the index.
 *
 * THE FILE HALF IS NOT RE-PROVED HERE. A published track must have an audio
 * file, so each is given a Storage asset row and the relation through Media's
 * own adapter; streaming, sniffing and scanning a real file is
 * `tests/storage/media-audio.integration.test.ts`.
 *
 * EVERYTHING IS SYNTHETIC. Titles say they are fixtures and the words are
 * invented; no religious text is used.
 */

const live = databaseConfigured ? describe : describe.skip;

const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

function trackInput(title: string, overrides: Record<string, unknown> = {}) {
  return {
    slug: slug('audio-proof'),
    primaryLocale: 'en',
    state: 'draft',
    languageCode: 'en',
    labels: [{ locale: 'en', title, description: '' }],
    durationSeconds: null,
    recordedOn: null,
    transcript: null,
    seriesId: null,
    seriesPosition: null,
    speakerIds: [],
    topicIds: [],
    ...overrides,
  };
}

/** A track read back as the input that would save it unchanged. */
function editable(record: Record<string, unknown>): Record<string, unknown> {
  const {
    id: _id,
    version: _version,
    updatedAt: _updatedAt,
    assetId: _assetId,
    series,
    ...rest
  } = record;
  const ref = series as { id: string; position: number } | null;
  return { ...rest, seriesId: ref?.id ?? null, seriesPosition: ref?.position ?? null };
}

live('Phase 11 audio in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let persistence: MediaPersistencePort;
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
      `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'audio' AND [scopeId] = N'${id}';`,
    );
    return Number(row?.documents ?? 0);
  }

  /** Creates a track, gives it a cleared file, and saves it at `state`. */
  async function track(title: string, overrides: Record<string, unknown> = {}) {
    const state = (overrides['state'] as string | undefined) ?? 'published';
    const created = await h.media.saveAudioTrack(
      curator,
      null,
      null,
      trackInput(title, { ...overrides, state: 'draft' }),
    );
    const assetId = randomUUID();
    const hex = randomUUID().replaceAll('-', '');
    await db.admin.query(
      `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${assetId}',N'${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}',N'audio/mpeg',834,N'${'c'.repeat(64)}',N'clean',SYSUTCDATETIME());`,
    );
    const attached = await persistence.attachAudioAsset({
      actorId: curator.accountId,
      trackId: created.id,
      expectedVersion: created.version,
      assetId,
    });
    return state === 'draft'
      ? attached
      : h.media.saveAudioTrack(
          curator,
          attached.id,
          attached.version,
          editable({ ...attached, state } as unknown as Record<string, unknown>),
        );
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    const database = await import('../../packages/database/src/index.ts');
    persistence = database.createMediaPersistence();
    curator = await h.account(['media.administer', 'media.read']);

    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');
    educationTopic = topic.id;

    lecture = await track('Synthetic recording on reading rooms larchmoorfixture', {
      recordedOn: '2021-03-04',
      topicIds: [educationTopic],
      transcript:
        'The quenfordfixture transcript describes a catalogue of reading rooms.',
    });

    // Labelled only in English, SPOKEN in Urdu: its transcript is matched in an
    // Urdu document of its own.
    urdu = await track('Synthetic Urdu talk sorrelwickfixture', {
      languageCode: 'ur',
      transcript: 'کتب خانوں کے مطالعہ گاہوں پر ایک آزمائشی گفتگو',
    });

    draft = await track('Synthetic draft recording tamblinfixture', { state: 'draft' });

    // An AudioSeries named with a word no track carries: it is a grouping, not a
    // searchable kind, so it is never found.
    await h.media.saveAudioSeries(curator, null, null, {
      slug: slug('audio-series-proof'),
      primaryLocale: 'en',
      state: 'published',
      labels: [
        { locale: 'en', title: 'Synthetic audio series pellowfixture', description: '' },
      ],
    });

    await h.indexNow();
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('commits each track mutation’s search intent in the same transaction', async () => {
    const saved = await h.media.saveAudioTrack(
      curator,
      null,
      null,
      trackInput('Synthetic intent probe'),
    );
    const [row] = await db.admin.query<{ requests: number }>(
      `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'audio' AND [scopeId] = N'${saved.id}';`,
    );
    expect(Number(row?.requests)).toBe(1);
    await h.indexNow();
    expect(await documentsOf(saved.id)).toBe(0);
  });

  it('finds a track at its current Listen address, with its recording year', async () => {
    const hits = (await find('larchmoorfixture')).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: 'audio',
      href: `/listen/lectures/${lecture.slug}`,
      year: 2021,
      contentLanguage: 'en',
    });
  });

  it('projects nothing about the file', async () => {
    const [row] = await db.admin.query<{ leaked: number }>(
      `SELECT COUNT(*) AS leaked FROM [dbo].[SearchDocument] d
       JOIN [dbo].[AudioTrack] t ON t.[id] = d.[scopeId]
       JOIN [dbo].[Asset] a ON a.[id] = t.[assetId]
       WHERE d.[scopeKind] = N'audio'
         AND (d.[title] LIKE N'%' + a.[id] + N'%' OR d.[summary] LIKE N'%' + a.[id] + N'%'
              OR ISNULL(d.[matchEnglish], N'') LIKE N'%' + a.[storageKey] + N'%'
              OR ISNULL(d.[matchOther], N'') LIKE N'%' + a.[storageKey] + N'%');`,
    );
    expect(Number(row?.leaked)).toBe(0);
  });

  it('matches a transcript in the track’s CONTENT language, whatever its labels', async () => {
    expect(await kinds('quenfordfixture')).toEqual(['audio']);
    expect(await kinds('مطالعہ')).toEqual(['audio']);
    expect(await kinds('sorrelwickfixture', { language: 'ur' })).toEqual(['audio']);
    expect(await kinds('sorrelwickfixture', { language: 'en' })).toEqual([]);
    expect(urdu.id).toBeTruthy();
  });

  it('combines the type, topic and year filters over tracks', async () => {
    expect(await kinds('synthetic', { topic: 'education', type: 'audio' })).toEqual([
      'audio',
    ]);
    expect(
      await kinds('larchmoorfixture', { type: 'audio', from: '2021', to: '2021' }),
    ).toEqual(['audio']);
    expect(await kinds('larchmoorfixture', { type: 'audio', to: '2020' })).toEqual([]);
    expect(await kinds('larchmoorfixture', { type: 'video' })).toEqual([]);
  });

  it('never indexes a draft or an AudioSeries', async () => {
    expect(await kinds('tamblinfixture')).toEqual([]);
    expect(await documentsOf(draft.id)).toBe(0);
    expect(await kinds('pellowfixture')).toEqual([]);
  });

  it('addresses a renamed track at its CURRENT slug before any re-indexing', async () => {
    const current = await h.media.audioTrack(curator, lecture.id);
    if (current === null) throw new Error('fixture track missing');
    const renamed = slug('audio-renamed');
    lecture = await h.media.saveAudioTrack(curator, lecture.id, current.version, {
      ...editable(current as unknown as Record<string, unknown>),
      slug: renamed,
    });
    expect((await find('larchmoorfixture')).hits[0]?.href).toBe(
      `/listen/lectures/${renamed}`,
    );
    await h.indexNow();
  });

  describe('a stale index never discloses', () => {
    it('withholds an archived track while its rows remain, then drops them', async () => {
      const current = await h.media.audioTrack(curator, lecture.id);
      if (current === null) throw new Error('fixture track missing');
      lecture = await h.media.saveAudioTrack(curator, lecture.id, current.version, {
        ...editable(current as unknown as Record<string, unknown>),
        state: 'archived',
      });

      expect(await documentsOf(lecture.id)).toBeGreaterThan(0);
      const stale = await find('larchmoorfixture');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBeGreaterThanOrEqual(1);

      await h.indexNow();
      expect(await documentsOf(lecture.id)).toBe(0);
      expect((await find('larchmoorfixture')).withheld).toBe(0);
    });

    it('withholds a track unpublished with no request at all', async () => {
      await db.admin.query(
        `UPDATE [dbo].[AudioTrack] SET [state] = N'draft' WHERE [id] = N'${urdu.id}';`,
      );
      expect(await documentsOf(urdu.id)).toBeGreaterThan(0);
      const stale = await find('sorrelwickfixture');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBe(1);

      const summary = await h.search.reconcile();
      expect(summary.orphaned).toBeGreaterThanOrEqual(1);
      await h.indexNow();
      expect(await documentsOf(urdu.id)).toBe(0);

      await db.admin.query(
        `UPDATE [dbo].[AudioTrack] SET [state] = N'published', [version] = [version] + 1 WHERE [id] = N'${urdu.id}';`,
      );
      await h.search.reconcile();
      await h.indexNow();
      expect(await kinds('sorrelwickfixture')).toEqual(['audio']);
    });
  });

  describe('rebuild and reconciliation', () => {
    it('rebuilds the audio inventory from Media alone, starting from empty', async () => {
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
         DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
      );
      await h.engineSettled();
      expect(await kinds('sorrelwickfixture')).toEqual([]);

      await h.search.rebuild();
      await h.indexNow();

      const [inventory] = await db.admin.query<{ kinds: string }>(
        `SELECT STRING_AGG([kind], N',') WITHIN GROUP (ORDER BY [kind]) AS kinds
           FROM (SELECT DISTINCT [kind] FROM [dbo].[SearchDocument]) k;`,
      );
      expect(inventory?.kinds).toBe('audio,topic');
      expect(await kinds('larchmoorfixture')).toEqual([]);
      expect(await kinds('tamblinfixture')).toEqual([]);
      expect(await kinds('sorrelwickfixture')).toEqual(['audio']);
    });

    it('reconciles missing, stale and orphaned audio projections', async () => {
      const published = await track('Synthetic reconcile probe gorsebankfixture');
      await h.indexNow();

      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'audio' AND [scopeId] = N'${published.id}';`,
      );
      await db.admin.query(
        `UPDATE [dbo].[AudioTrackLabel] SET [title] = N'Synthetic Urdu talk nettlecombefixture' WHERE [trackId] = N'${urdu.id}';
         UPDATE [dbo].[AudioTrack] SET [version] = [version] + 1 WHERE [id] = N'${urdu.id}';`,
      );

      const summary = await h.search.reconcile();
      expect(summary.missing).toBeGreaterThanOrEqual(1);
      expect(summary.stale).toBeGreaterThanOrEqual(1);

      await h.indexNow();
      expect(await kinds('gorsebankfixture')).toEqual(['audio']);
      expect(await kinds('nettlecombefixture')).toEqual(['audio']);
    });
  });
});
