import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-11 STATE for the recovery rehearsals, and the synthetic audio
 * every Phase-11 proof plays.
 *
 * WHAT IT PROVES THAT A SCHEMA CHECK DOES NOT. That Media's audio came back with
 * its RELATIONSHIPS and its INVARIANTS, not merely its rows:
 *
 *   - a track RENAMED once, so both slugs must come back reserved to it;
 *   - an AudioSeries renamed, with the track at its place in it;
 *   - the typed relation from a published track to its Storage ASSET, and a
 *     DRAFT track with an asset of its own — so after a restore the published
 *     file must serve and the draft's must still be refused;
 *   - an ARCHIVED track, so a rebuild after restore returns only what is public;
 *   - Urdu text read back character by character, typed speaker and topic
 *     relations, and a PENDING search intent.
 *
 * AUDIO IS AUTHORITATIVE BYTES, so the SQL rows here are half of it. The storage
 * half — the same synthetic bytes at the recorded keys, and their checksums — is
 * restored alongside by the Storage recovery rehearsal
 * (`tests/storage/audio-recovery.integration.test.ts`); this module supplies
 * the bytes and the rows so both halves describe the same file.
 *
 * NOTHING HERE IS REAL. Every title says it is a recovery proof, and the audio
 * is generated silence — no recording of any person, and nothing copyrighted.
 */

/* ===========================================================================
 * Synthetic audio
 * ========================================================================= */

/**
 * `frames` frames of MPEG-1 Layer III silence: 128 kbit/s, 44.1 kHz, mono, no
 * ID3 tag — about 26 ms per frame.
 *
 * GENERATED, NOT RECORDED. Each frame is a valid header followed by zeroed side
 * information and main data, which a decoder plays as silence. With no tag, the
 * file begins with its first frame, which is exactly the shape Storage's
 * structural MPEG sniff has to recognise.
 */
export function syntheticSilentMp3(frames: number): Uint8Array {
  if (!Number.isInteger(frames) || frames < 2 || frames > 20_000) {
    throw new Error('A synthetic recording needs between 2 and 20,000 frames.');
  }
  // 144 × 128000 / 44100 = 417 bytes per frame, without padding.
  const FRAME = 417;
  const bytes = new Uint8Array(FRAME * frames);
  for (let frame = 0; frame < frames; frame += 1) {
    bytes.set([0xff, 0xfb, 0x90, 0xc4], frame * FRAME);
  }
  return bytes;
}

/** SHA-256 of `bytes`, lowercase hex — how Storage records a checksum. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A storage key in the exact shape Storage generates. */
export function syntheticStorageKey(): string {
  const hex = randomBytes(16).toString('hex');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}

/* ===========================================================================
 * The populated recovery fixture
 * ========================================================================= */

export interface Phase11Fixture {
  readonly runId: string;
  readonly trackId: string;
  readonly trackOriginalSlug: string;
  readonly trackSlug: string;
  readonly draftTrackId: string;
  readonly archivedTrackId: string;
  readonly seriesId: string;
  readonly seriesOriginalSlug: string;
  readonly seriesSlug: string;
  readonly assetId: string;
  readonly assetKey: string;
  readonly draftAssetId: string;
  readonly draftAssetKey: string;
}

/** The synthetic recording both fixture assets hold. */
export const PHASE11_AUDIO: Uint8Array = syntheticSilentMp3(40);

export function newPhase11Fixture(): Phase11Fixture {
  const runId = randomUUID().replaceAll('-', '');
  return {
    runId,
    trackId: randomUUID(),
    trackOriginalSlug: `phase11-track-original-${runId}`,
    trackSlug: `phase11-track-current-${runId}`,
    draftTrackId: randomUUID(),
    archivedTrackId: randomUUID(),
    seriesId: randomUUID(),
    seriesOriginalSlug: `phase11-series-original-${runId}`,
    seriesSlug: `phase11-series-current-${runId}`,
    assetId: randomUUID(),
    assetKey: syntheticStorageKey(),
    draftAssetId: randomUUID(),
    draftAssetKey: syntheticStorageKey(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase11Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-11 fixture runId does not match the expected pattern.');
  }
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-z/-]{1,120}$/.test(value)) {
      throw new Error(`Phase-11 fixture field '${name}' is not a safe generated value.`);
    }
  }
}

/** The words a rebuilt index must — and must not — answer to. */
export const PHASE11_RECOVERY_WORDS = Object.freeze({
  audio: 'larkspurfixture',
  archived: 'fernhollowfixture',
});

const TEXT = {
  trackUr: 'بحالی کے ثبوت کی آزمائشی آڈیو',
  descriptionUr: 'یہ صرف بحالی کے ثبوت کے لیے لکھی گئی آزمائشی تفصیل ہے۔',
} as const;

/**
 * Writes the populated Phase-11 state into the SOURCE database, before backup.
 *
 * Written with the MIGRATION principal, in dependency order, so the real foreign
 * keys, CHECK constraints, filtered indexes and slug-reservation triggers are
 * exercised — the renames are real UPDATEs the triggers observe. The two Asset
 * rows are written as Storage would leave them after a clean scan of
 * `PHASE11_AUDIO`.
 */
export async function writePhase11Fixture(
  sql: SqlSession,
  fixture: Phase11Fixture,
  references: { readonly personId: string; readonly topicId: string },
): Promise<void> {
  assertSafe(fixture);
  for (const value of Object.values(references)) {
    if (!/^[a-z0-9-]{1,36}$/i.test(value)) {
      throw new Error('Invalid synthetic Phase-11 fixture reference.');
    }
  }
  const f = fixture;
  const w = PHASE11_RECOVERY_WORDS;
  const checksum = sha256(PHASE11_AUDIO);
  const size = PHASE11_AUDIO.byteLength;

  await sql.query(`
    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[displayName],[updatedAt]) VALUES
      (N'${f.assetId}', N'${f.assetKey}', N'audio/mpeg', ${String(size)}, N'${checksum}', N'clean', N'synthetic-recovery.mp3', SYSUTCDATETIME()),
      (N'${f.draftAssetId}', N'${f.draftAssetKey}', N'audio/mpeg', ${String(size)}, N'${checksum}', N'clean', NULL, SYSUTCDATETIME());

    INSERT INTO [dbo].[AudioSeries] ([id],[slug],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${f.seriesId}', N'${f.seriesOriginalSlug}', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[AudioSeries] SET [slug]=N'${f.seriesSlug}', [version]=2 WHERE [id]=N'${f.seriesId}';
    INSERT INTO [dbo].[AudioSeriesLabel] ([seriesId],[locale],[title],[description])
      VALUES (N'${f.seriesId}', N'en', N'Synthetic recovery audio series', N'');

    INSERT INTO [dbo].[AudioTrack] ([id],[slug],[primaryLocale],[state],[languageCode],[durationSeconds],[recordedOn],[transcript],[assetId],[seriesId],[seriesPosition],[version],[updatedAt])
    VALUES (N'${f.trackId}', N'${f.trackOriginalSlug}', N'ur', N'published', N'ur', 1, '2019-04-05',
            N'Synthetic recovery transcript.', N'${f.assetId}', N'${f.seriesId}', 1, 1, SYSUTCDATETIME()),
           (N'${f.draftTrackId}', N'phase11-draft-${f.runId}', N'en', N'draft', N'en', NULL, NULL,
            NULL, N'${f.draftAssetId}', NULL, NULL, 1, SYSUTCDATETIME()),
           (N'${f.archivedTrackId}', N'phase11-archived-${f.runId}', N'en', N'archived', N'en', NULL, NULL,
            NULL, NULL, NULL, NULL, 1, SYSUTCDATETIME());
    UPDATE [dbo].[AudioTrack] SET [slug]=N'${f.trackSlug}', [version]=2 WHERE [id]=N'${f.trackId}';
    INSERT INTO [dbo].[AudioTrackLabel] ([trackId],[locale],[title],[description]) VALUES
      (N'${f.trackId}', N'ur', N'${TEXT.trackUr}', N'${TEXT.descriptionUr}'),
      (N'${f.trackId}', N'en', N'Synthetic recovery recording ${w.audio}', N''),
      (N'${f.draftTrackId}', N'en', N'Synthetic draft recording', N''),
      (N'${f.archivedTrackId}', N'en', N'Synthetic withdrawn recording ${w.archived}', N'');
    INSERT INTO [dbo].[AudioTrackSpeaker] ([trackId],[personId],[position])
      VALUES (N'${f.trackId}', N'${references.personId}', 0);
    INSERT INTO [dbo].[AudioTrackTopic] ([trackId],[topicId])
      VALUES (N'${f.trackId}', N'${references.topicId}');

    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'audio', N'${f.trackId}');
  `);
}

/** Every authoritative Phase-11 row this fixture wrote, in a stable order. */
export async function capturePhase11Fixture(
  sql: SqlSession,
  fixture: Phase11Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const tracks = `N'${f.trackId}',N'${f.draftTrackId}',N'${f.archivedTrackId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'Asset',
      `SELECT [id],[storageKey],[mediaType],[byteSize],[checksum],[state] FROM [dbo].[Asset] WHERE [id] IN (N'${f.assetId}',N'${f.draftAssetId}') ORDER BY [id]`,
      2,
    ],
    [
      'AudioTrack',
      `SELECT * FROM [dbo].[AudioTrack] WHERE [id] IN (${tracks}) ORDER BY [id]`,
      3,
    ],
    [
      'AudioTrackLabel',
      `SELECT * FROM [dbo].[AudioTrackLabel] WHERE [trackId] IN (${tracks}) ORDER BY [trackId],[locale]`,
      4,
    ],
    [
      'AudioTrackSlugHistory',
      `SELECT * FROM [dbo].[AudioTrackSlugHistory] WHERE [trackId] IN (${tracks}) ORDER BY [slug]`,
      4,
    ],
    [
      'AudioTrackSpeaker',
      `SELECT * FROM [dbo].[AudioTrackSpeaker] WHERE [trackId]=N'${f.trackId}'`,
      1,
    ],
    [
      'AudioTrackTopic',
      `SELECT * FROM [dbo].[AudioTrackTopic] WHERE [trackId]=N'${f.trackId}'`,
      1,
    ],
    ['AudioSeries', `SELECT * FROM [dbo].[AudioSeries] WHERE [id]=N'${f.seriesId}'`, 1],
    [
      'AudioSeriesSlugHistory',
      `SELECT * FROM [dbo].[AudioSeriesSlugHistory] WHERE [seriesId]=N'${f.seriesId}' ORDER BY [slug]`,
      2,
    ],
    [
      'SearchIndexRequest',
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'audio' AND [scopeId]=N'${f.trackId}'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-11 recovery expected ${expected} ${name} row(s), found ${data.length}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/**
 * Verifies the restored audio state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: the two slug-reservation triggers came back enabled; no
 * audio CHECK constraint came back disabled or untrusted — including the one that
 * keeps a published track from having no file; both filtered unique indexes came
 * back unique and filtered; the Asset foreign key came back trusted; and the
 * Urdu text is exactly what was written.
 */
export async function verifyRestoredPhase11(
  sql: SqlSession,
  fixture: Phase11Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase11Fixture(sql, fixture),
    expected,
    'Phase-11 audio authoritative values changed during recovery.',
  );

  const [text] = await sql.query<{ title: string; description: string }>(
    `SELECT [title], [description] FROM [dbo].[AudioTrackLabel]
     WHERE [trackId]=N'${fixture.trackId}' AND [locale]=N'ur';`,
  );
  if (text?.title !== TEXT.trackUr || text.description !== TEXT.descriptionUr) {
    throw new Error('Restored Urdu Phase-11 text does not match.');
  }

  const [triggers] = await sql.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM sys.triggers
     WHERE [name] IN (N'MediaReserveAudioTrackSlug',N'MediaReserveAudioSeriesSlug')
       AND [is_disabled]=0;`,
  );
  if (Number(triggers?.total ?? 0) !== 2) {
    throw new Error('Restored database lost a Phase-11 slug-reservation trigger.');
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (OBJECT_ID(N'AudioTrack'),OBJECT_ID(N'AudioSeries'),
                                OBJECT_ID(N'AudioTrackSpeaker'),OBJECT_ID(N'AudioTrackLabel'))
       AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE [name]=N'AudioTrack_assetId_fkey' AND (is_disabled=1 OR is_not_trusted=1);`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-11 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [indexes] = await sql.query<{ filtered: number }>(
    `SELECT COUNT_BIG(*) AS [filtered] FROM sys.indexes
     WHERE [name] IN (N'AudioTrack_seriesId_seriesPosition_key',N'AudioTrack_assetId_key')
       AND [is_unique]=1 AND [has_filter]=1;`,
  );
  if (Number(indexes?.filtered ?? 0) !== 2) {
    throw new Error('Restored database lost a filtered unique Phase-11 index.');
  }

  return 'tracks, audio series, asset relations, slug histories and search intent intact';
}
