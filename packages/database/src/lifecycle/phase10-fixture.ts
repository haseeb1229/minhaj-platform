import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-10 STATE for the recovery rehearsals.
 *
 * WHAT IT PROVES THAT A SCHEMA CHECK DOES NOT. That Media came back with its
 * RELATIONSHIPS and its INVARIANTS, not merely its rows:
 *
 *   - a Video RENAMED once, so both slugs must come back reserved to it — a
 *     restore that lost the history would turn every old link into a 404;
 *   - a Series that became a PROGRAMME and was renamed, so its one canonical
 *     address and both reservations must survive;
 *   - an episode position within that Series, and a Playlist whose ORDER is its
 *     meaning, with two members in a deliberate order;
 *   - an ARCHIVED Video, so a rebuild after restore can be shown to return only
 *     what is public;
 *   - two YouTube identifiers differing ONLY in case, so the binary collation
 *     that keeps them two videos must survive the restore;
 *   - Urdu text read back character by character, typed speaker and topic
 *     relations, and a PENDING search intent — durable derived-work intent is
 *     authoritative state the indexer still owes (ARCHITECTURE.md §8.5).
 *
 * THE SEARCH PROJECTION IS NOT HERE: it is derived, and the Phase-10 restore
 * test proves it rebuilds from the restored owner. NO VIDEO BYTES EXIST to back
 * up — a Video is provider metadata.
 *
 * NOTHING HERE IS REAL. Every title says it is a recovery proof and every
 * provider identifier is invented.
 */

export interface Phase10Fixture {
  readonly runId: string;
  readonly videoId: string;
  readonly videoOriginalSlug: string;
  readonly videoSlug: string;
  readonly archivedVideoId: string;
  readonly seriesId: string;
  readonly seriesOriginalSlug: string;
  readonly seriesSlug: string;
  readonly playlistId: string;
  readonly playlistSlug: string;
}

export function newPhase10Fixture(): Phase10Fixture {
  const runId = randomUUID().replaceAll('-', '');
  return {
    runId,
    videoId: randomUUID(),
    videoOriginalSlug: `phase10-video-original-${runId}`,
    videoSlug: `phase10-video-current-${runId}`,
    archivedVideoId: randomUUID(),
    seriesId: randomUUID(),
    seriesOriginalSlug: `phase10-series-original-${runId}`,
    seriesSlug: `phase10-program-current-${runId}`,
    playlistId: randomUUID(),
    playlistSlug: `phase10-playlist-${runId}`,
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase10Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-10 fixture runId does not match the expected pattern.');
  }
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-z-]{1,120}$/.test(value)) {
      throw new Error(`Phase-10 fixture field '${name}' is not a safe generated value.`);
    }
  }
}

/** The words a rebuilt index must — and must not — answer to. */
export const PHASE10_RECOVERY_WORDS = Object.freeze({
  video: 'quillbrookfixture',
  archived: 'thistlewayfixture',
});

/**
 * Two synthetic YouTube-shaped identifiers that differ only in case, derived
 * from the run so reruns never collide on the provider uniqueness key.
 */
function providerIds(runId: string): readonly [string, string] {
  const stem = `ab${runId.slice(0, 9)}`;
  return [stem, stem.toUpperCase()];
}

const TEXT = {
  videoUr: 'بحالی کے ثبوت کی آزمائشی ویڈیو',
  descriptionUr: 'یہ صرف بحالی کے ثبوت کے لیے لکھی گئی آزمائشی تفصیل ہے۔',
} as const;

/**
 * Writes the populated Phase-10 state into the SOURCE database, before backup.
 *
 * Written with the MIGRATION principal, in dependency order, so the real foreign
 * keys, CHECK constraints, filtered index and slug-reservation triggers are
 * exercised — the renames are real UPDATEs the triggers observe.
 */
export async function writePhase10Fixture(
  sql: SqlSession,
  fixture: Phase10Fixture,
  references: { readonly personId: string; readonly topicId: string },
): Promise<void> {
  assertSafe(fixture);
  for (const value of Object.values(references)) {
    if (!/^[a-z0-9-]{1,36}$/i.test(value)) {
      throw new Error('Invalid synthetic Phase-10 fixture reference.');
    }
  }
  const f = fixture;
  const w = PHASE10_RECOVERY_WORDS;
  const [lower, upper] = providerIds(f.runId);

  await sql.query(`
    INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${f.seriesId}', N'${f.seriesOriginalSlug}', N'series', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Series] SET [slug]=N'${f.seriesSlug}', [kind]=N'program', [version]=2 WHERE [id]=N'${f.seriesId}';
    INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description])
      VALUES (N'${f.seriesId}', N'en', N'Synthetic recovery programme', N'');

    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[captions],[transcript],[seriesId],[seriesPosition],[version],[updatedAt])
    VALUES (N'${f.videoId}', N'${f.videoOriginalSlug}', N'ur', N'published', 1, N'youtube', '${lower}', N'available', N'lecture', N'ur', 3723, '2021-02-03', 1,
            N'Synthetic recovery transcript.', N'${f.seriesId}', 1, 1, SYSUTCDATETIME()),
           (N'${f.archivedVideoId}', N'phase10-archived-${f.runId}', N'en', N'archived', 0, N'youtube', '${upper}', N'unavailable', NULL, N'en', NULL, NULL, 0,
            NULL, NULL, NULL, 1, SYSUTCDATETIME());
    UPDATE [dbo].[Video] SET [slug]=N'${f.videoSlug}', [version]=2 WHERE [id]=N'${f.videoId}';
    INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES
      (N'${f.videoId}', N'ur', N'${TEXT.videoUr}', N'${TEXT.descriptionUr}'),
      (N'${f.videoId}', N'en', N'Synthetic recovery video ${w.video}', N''),
      (N'${f.archivedVideoId}', N'en', N'Synthetic withdrawn video ${w.archived}', N'');
    INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position])
      VALUES (N'${f.videoId}', N'${references.personId}', 0);
    INSERT INTO [dbo].[VideoTopic] ([videoId],[topicId])
      VALUES (N'${f.videoId}', N'${references.topicId}');

    INSERT INTO [dbo].[Playlist] ([id],[slug],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${f.playlistId}', N'${f.playlistSlug}', N'en', N'published', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[PlaylistLabel] ([playlistId],[locale],[title],[description])
      VALUES (N'${f.playlistId}', N'en', N'Synthetic recovery playlist', N'');
    INSERT INTO [dbo].[PlaylistVideo] ([playlistId],[videoId],[position]) VALUES
      (N'${f.playlistId}', N'${f.archivedVideoId}', 0),
      (N'${f.playlistId}', N'${f.videoId}', 1);

    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'video', N'${f.videoId}');
  `);
}

/** Every authoritative Phase-10 row this fixture wrote, in a stable order. */
export async function capturePhase10Fixture(
  sql: SqlSession,
  fixture: Phase10Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const videos = `N'${f.videoId}',N'${f.archivedVideoId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    ['Video', `SELECT * FROM [dbo].[Video] WHERE [id] IN (${videos}) ORDER BY [id]`, 2],
    [
      'VideoLabel',
      `SELECT * FROM [dbo].[VideoLabel] WHERE [videoId] IN (${videos}) ORDER BY [videoId],[locale]`,
      3,
    ],
    [
      'VideoSlugHistory',
      `SELECT * FROM [dbo].[VideoSlugHistory] WHERE [videoId] IN (${videos}) ORDER BY [slug]`,
      3,
    ],
    [
      'VideoSpeaker',
      `SELECT * FROM [dbo].[VideoSpeaker] WHERE [videoId]=N'${f.videoId}'`,
      1,
    ],
    ['VideoTopic', `SELECT * FROM [dbo].[VideoTopic] WHERE [videoId]=N'${f.videoId}'`, 1],
    ['Series', `SELECT * FROM [dbo].[Series] WHERE [id]=N'${f.seriesId}'`, 1],
    [
      'SeriesSlugHistory',
      `SELECT * FROM [dbo].[SeriesSlugHistory] WHERE [seriesId]=N'${f.seriesId}' ORDER BY [slug]`,
      2,
    ],
    ['Playlist', `SELECT * FROM [dbo].[Playlist] WHERE [id]=N'${f.playlistId}'`, 1],
    [
      'PlaylistVideo',
      `SELECT * FROM [dbo].[PlaylistVideo] WHERE [playlistId]=N'${f.playlistId}' ORDER BY [position]`,
      2,
    ],
    [
      'SearchIndexRequest',
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'video' AND [scopeId]=N'${f.videoId}'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-10 recovery expected ${expected} ${name} row(s), found ${data.length}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/**
 * Verifies the restored Media state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: the three slug-reservation triggers came back enabled; no
 * Media CHECK constraint came back disabled or untrusted; the filtered episode
 * index came back unique and filtered; the provider identifier kept its binary
 * collation, so the two case-distinct identifiers are still two videos; and the
 * Urdu text is exactly what was written.
 */
export async function verifyRestoredPhase10(
  sql: SqlSession,
  fixture: Phase10Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase10Fixture(sql, fixture),
    expected,
    'Phase-10 Media authoritative values changed during recovery.',
  );

  const [text] = await sql.query<{ title: string; description: string }>(
    `SELECT [title], [description] FROM [dbo].[VideoLabel]
     WHERE [videoId]=N'${fixture.videoId}' AND [locale]=N'ur';`,
  );
  if (text?.title !== TEXT.videoUr || text.description !== TEXT.descriptionUr) {
    throw new Error('Restored Urdu Phase-10 text does not match.');
  }

  const [triggers] = await sql.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM sys.triggers
     WHERE [name] IN (N'MediaReserveVideoSlug',N'MediaReserveSeriesSlug',N'MediaReservePlaylistSlug')
       AND [is_disabled]=0;`,
  );
  if (Number(triggers?.total ?? 0) !== 3) {
    throw new Error('Restored database lost a Phase-10 slug-reservation trigger.');
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (OBJECT_ID(N'Video'),OBJECT_ID(N'Series'),OBJECT_ID(N'Playlist'),
                                OBJECT_ID(N'VideoSpeaker'),OBJECT_ID(N'PlaylistVideo'))
       AND (is_disabled=1 OR is_not_trusted=1);`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-10 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [index] = await sql.query<{ filtered: number; collation: string | null }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.indexes
         WHERE [name]=N'Video_seriesId_seriesPosition_key' AND [is_unique]=1 AND [has_filter]=1) AS [filtered],
       (SELECT [collation_name] FROM sys.columns
         WHERE [object_id]=OBJECT_ID(N'Video') AND [name]=N'providerVideoId') AS [collation];`,
  );
  if (
    Number(index?.filtered ?? 0) !== 1 ||
    index?.collation !== 'Latin1_General_100_BIN2'
  ) {
    throw new Error(
      'Restored database lost the filtered episode index or the binary provider collation.',
    );
  }

  return 'videos, programme, playlist order, slug histories, case-distinct identifiers and search intent intact';
}
