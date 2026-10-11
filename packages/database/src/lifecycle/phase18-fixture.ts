import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-18 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That a Quran
 * corpus came back with its CITATION IDENTITY, its IMMUTABLE HISTORY and its
 * EVIDENCE, and with every layered work still typed to the Ayah it describes:
 *
 *   - a registered FIXTURE source with two Surahs and five ayat, and a second
 *     fixture source carrying one corrected Ayah;
 *   - the canonical Juz, Surahs and ayat materialised from the first source,
 *     each with its version-1 revision, under a PASSED acceptance run;
 *   - a FAILED verification run, with its first mismatch located;
 *   - a CORRECTION: Ayah 1:2 at version 2 from the second source, its revision
 *     carrying actor, step-up grant and reason, under its own passed run;
 *   - the corpus ACTIVATED in fixture mode;
 *   - Surah display names in three locales, the names version advanced once;
 *   - a published translation with texts and a contributor, a draft
 *     transliteration with text, a published tafsir with an entry and a
 *     contributor, a published recitation by a fictional reciter whose segment
 *     names a Storage Asset, a published tajweed rule with its text, an Ayah
 *     topic assignment, and the `quran-ayah` search intent still owed.
 *
 * NOTHING HERE IS SCRIPTURE. Every text is a `NON_QURAN_FIXTURE_…` sentinel
 * followed by the Arabic phrase for "non-Quranic test text"; the structure —
 * two Surahs of three and two ayat across two Juz — is FICTIONAL, not a real
 * count or boundary; the reciter is "Fixture Reciter One"; and every source is
 * of `fixture` authority, so no approved corpus is ever implied. Canonical rows
 * are written directly by the owner, as only the owner may: the recovery
 * databases are disposable and created by the run that writes them, and the
 * canonical write path itself is proved by `db:migrate:test` and
 * `db:test:permissions`.
 */

/** Neutral Arabic: "non-Quranic test text". */
const SENTINEL = 'نص اختبار غير قرآني';

/** The fictional structure: [surah, ayah, juz]. Not a real count or boundary. */
const AYAT = [
  [1, 1, 1],
  [1, 2, 1],
  [1, 3, 1],
  [2, 1, 1],
  [2, 2, 2],
] as const;

const SURAHS = [
  [1, 3],
  [2, 2],
] as const;

/** The one Ayah the second source corrects. */
const CORRECTED: readonly [number, number] = [1, 2];

function text(label: string, surah: number, ayah: number): string {
  return `NON_QURAN_FIXTURE_${label}_${String(surah)}_${String(ayah)} ${SENTINEL}`;
}

const TEXT = {
  correction: text('CORRECTED', 1, 2),
  reason: 'NON_QURAN_FIXTURE recovery correction against a registered fixture source.',
  reciter: 'Fixture Reciter One',
  operator: 'NON_QURAN_FIXTURE recovery operator',
  audio: 'NON_QURAN_FIXTURE synthetic audio bytes',
} as const;

export interface Phase18Fixture {
  readonly runId: string;
  readonly sourceId: string;
  readonly sourceCode: string;
  readonly correctionSourceId: string;
  readonly correctionSourceCode: string;
  readonly acceptanceRunId: string;
  readonly failedRunId: string;
  readonly correctionRunId: string;
  /** A HISTORICAL step-up identifier: the grant row expires, the evidence stays. */
  readonly stepUpGrantId: string;
  readonly translationId: string;
  readonly transliterationId: string;
  readonly tafsirId: string;
  readonly tafsirEntryId: string;
  readonly reciterId: string;
  readonly recitationId: string;
  readonly segmentId: string;
  readonly assetId: string;
  readonly assetKey: string;
  readonly ruleId: string;
}

export interface Phase18References {
  /** The account recorded as the canonical actor. */
  readonly actorId: string;
  /** A contributor to the translation and tafsir. */
  readonly personId: string;
  readonly topicId: string;
}

export function newPhase18Fixture(): Phase18Fixture {
  const runId = randomUUID().replaceAll('-', '');
  const stem = runId.slice(0, 16);
  return {
    runId,
    sourceId: randomUUID(),
    sourceCode: `NON_QURAN_FIXTURE_RECOVERY_${stem}`,
    correctionSourceId: randomUUID(),
    correctionSourceCode: `NON_QURAN_FIXTURE_RECOVERY_CORRECTION_${stem}`,
    acceptanceRunId: randomUUID(),
    failedRunId: randomUUID(),
    correctionRunId: randomUUID(),
    stepUpGrantId: randomUUID(),
    translationId: randomUUID(),
    transliterationId: randomUUID(),
    tafsirId: randomUUID(),
    tafsirEntryId: randomUUID(),
    reciterId: randomUUID(),
    recitationId: randomUUID(),
    segmentId: randomUUID(),
    assetId: randomUUID(),
    assetKey: `phase18/${runId}`,
    ruleId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase18Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-18 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (name.endsWith('Code')) {
      if (!/^NON_QURAN_FIXTURE_RECOVERY_(CORRECTION_)?[0-9a-f]{16}$/.test(value))
        throw new Error('Phase-18 fixture source code is not a sentinel code.');
      continue;
    }
    if (name === 'assetKey') {
      if (!/^phase18\/[0-9a-f]{32}$/.test(value))
        throw new Error('Phase-18 fixture asset key is not a generated key.');
      continue;
    }
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-18 fixture field '${name}' is not a generated identifier.`);
  }
}

function slugs(fixture: Phase18Fixture) {
  const stem = fixture.runId.slice(0, 16);
  return {
    translation: `phase18-translation-${stem}`,
    transliteration: `phase18-transliteration-${stem}`,
    tafsir: `phase18-tafsir-${stem}`,
    recitation: `phase18-recitation-${stem}`,
    rule: `phase18-tajweed-${stem}`,
    reciter: `phase18-fixture-reciter-${stem}`,
  };
}

/**
 * Writes the populated Phase-18 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real keys, CHECKs and triggers are
 * exercised: every canonical row lands where the corpus triggers allow it, the
 * correction's revision exists before the Ayah moves to it, activation is
 * checked against the source, and every work is published only once it has
 * its text, its audio and a registered source.
 */
export async function writePhase18Fixture(
  sql: SqlSession,
  fixture: Phase18Fixture,
  references: Phase18References,
): Promise<void> {
  assertSafe(fixture);
  for (const value of Object.values(references))
    if (!/^[a-z0-9-]{1,36}$/i.test(value))
      throw new Error('Invalid synthetic Phase-18 fixture reference.');
  const f = fixture;
  const s = slugs(f);
  const { actorId, personId, topicId } = references;
  const [cs, ca] = CORRECTED;

  // ---- the two registered fixture sources ------------------------------------
  await sql.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script]) VALUES
      (N'${f.sourceId}', N'${f.sourceCode}', N'fixture', N'NON_QURAN_FIXTURE recovery source', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE'),
      (N'${f.correctionSourceId}', N'${f.correctionSourceCode}', N'fixture', N'NON_QURAN_FIXTURE recovery correction source', N'fixture-2', N'utf-8', NULL);
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation]) VALUES
      ${SURAHS.map(([number, count]) => `(N'${f.sourceId}', ${String(number)}, ${String(count)}, NULL)`).join(',')},
      (N'${f.correctionSourceId}', ${String(cs)}, 3, NULL);
    INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES
      ${AYAT.map(([surah, ayah, juz]) => `(N'${f.sourceId}', ${String(surah)}, ${String(ayah)}, ${String(juz)}, N'${text('CANONICAL', surah, ayah)}')`).join(',')},
      (N'${f.correctionSourceId}', ${String(cs)}, ${String(ca)}, 1, N'${TEXT.correction}');
  `);

  // ---- the corpus, accepted: evidence first, then structure, text, history ----
  await sql.query(`
    INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[firstSurah],[firstAyah],[firstOffset],[firstReason],[actorId],[createdAt]) VALUES
      (N'${f.failedRunId}', N'corpus-acceptance', N'failed', N'${f.sourceId}', 5, 1, 1, 3, 30, N'text-mismatch', N'${actorId}', '2026-10-02T08:00:00'),
      (N'${f.acceptanceRunId}', N'corpus-acceptance', N'passed', N'${f.sourceId}', 5, 0, NULL, NULL, NULL, NULL, N'${actorId}', '2026-10-02T08:05:00');
    INSERT INTO [dbo].[Juz] ([number],[sourceId],[createdAt]) VALUES
      (1, N'${f.sourceId}', '2026-10-02T08:05:00'), (2, N'${f.sourceId}', '2026-10-02T08:05:00');
    INSERT INTO [dbo].[Surah] ([number],[ayahCount],[revelation],[nameArabic],[sourceId],[createdAt],[updatedAt]) VALUES
      ${SURAHS.map(([number, count]) => `(${String(number)}, ${String(count)}, NULL, NULL, N'${f.sourceId}', '2026-10-02T08:05:00', '2026-10-02T08:05:00')`).join(',')};
    INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],[version],[createdAt],[updatedAt])
      SELECT [surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],1,'2026-10-02T08:05:00','2026-10-02T08:05:00'
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId]=N'${f.sourceId}';
    INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason],[createdAt])
      SELECT [surahNumber],[ayahNumber],1,[text],[sourceId],N'${f.acceptanceRunId}',N'${actorId}',N'${f.stepUpGrantId}',NULL,'2026-10-02T08:05:00'
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId]=N'${f.sourceId}';
  `);

  // ---- one correction, recorded before the Ayah moves to it -------------------
  await sql.query(`
    INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
      VALUES (N'${f.correctionRunId}', N'ayah-correction', N'passed', N'${f.correctionSourceId}', 1, 0, N'${actorId}', '2026-10-02T09:00:00');
    INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason],[createdAt])
      VALUES (${String(cs)}, ${String(ca)}, 2, N'${TEXT.correction}', N'${f.correctionSourceId}', N'${f.correctionRunId}', N'${actorId}', N'${f.stepUpGrantId}', N'${TEXT.reason}', '2026-10-02T09:00:00');
    UPDATE [dbo].[Ayah] SET [text]=N'${TEXT.correction}', [sourceId]=N'${f.correctionSourceId}', [version]=2, [updatedAt]='2026-10-02T09:00:00'
      WHERE [surahNumber]=${String(cs)} AND [ayahNumber]=${String(ca)};
  `);

  // ---- fixture-mode activation, and Surah display names ----------------------
  await sql.query(`
    INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[activatedAt],[authorisedBy])
      VALUES (1, N'${f.sourceId}', '2026-10-02T09:30:00', N'${TEXT.operator}');
    INSERT INTO [dbo].[SurahName] ([surahNumber],[locale],[name]) VALUES
      (1, N'en', N'NON_QURAN_FIXTURE Surah One'),
      (1, N'ur', N'NON_QURAN_FIXTURE ${SENTINEL} 1'),
      (1, N'ar', N'NON_QURAN_FIXTURE ${SENTINEL} 1'),
      (2, N'en', N'NON_QURAN_FIXTURE Surah Two');
    UPDATE [dbo].[Surah] SET [namesVersion]=[namesVersion]+1, [updatedAt]='2026-10-02T09:30:00' WHERE [number]=1;
  `);

  // ---- the layered works ------------------------------------------------------
  const checksum = createHash('sha256').update(TEXT.audio).digest('hex');
  await sql.query(`
    INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${f.reciterId}', N'${s.reciter}', N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES (N'${f.reciterId}', N'en', N'${TEXT.reciter}', NULL);
    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[displayName],[updatedAt]) VALUES
      (N'${f.assetId}', N'${f.assetKey}', N'audio/mpeg', ${String(Buffer.byteLength(TEXT.audio))}, N'${checksum}', N'clean', N'non-quran-fixture.mp3', '2026-10-02T10:00:00');

    INSERT INTO [dbo].[QuranTranslation] ([id],[slug],[languageCode],[name],[description],[attribution],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.translationId}', N'${s.translation}', N'en', N'NON_QURAN_FIXTURE translation', N'NON_QURAN_FIXTURE recovery translation.', N'NON_QURAN_FIXTURE attribution', N'draft', 1, '2026-10-02T10:00:00', '2026-10-02T10:00:00');
    INSERT INTO [dbo].[QuranTranslationContributor] ([translationId],[personId],[role],[position]) VALUES (N'${f.translationId}', N'${personId}', N'translator', 0);
    INSERT INTO [dbo].[QuranTranslationText] ([translationId],[surahNumber],[ayahNumber],[text]) VALUES
      (N'${f.translationId}', 1, 1, N'${text('TRANSLATION', 1, 1)}'),
      (N'${f.translationId}', 1, 2, N'${text('TRANSLATION', 1, 2)}');
    UPDATE [dbo].[QuranTranslation] SET [state]=N'published', [sourceId]=N'${f.sourceId}', [publishedAt]='2026-10-02T10:05:00', [version]=2, [updatedAt]='2026-10-02T10:05:00' WHERE [id]=N'${f.translationId}';

    INSERT INTO [dbo].[QuranTransliteration] ([id],[slug],[languageCode],[name],[scheme],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.transliterationId}', N'${s.transliteration}', N'en', N'NON_QURAN_FIXTURE transliteration', N'NON_QURAN_FIXTURE scheme', N'draft', 1, '2026-10-02T10:00:00', '2026-10-02T10:00:00');
    INSERT INTO [dbo].[QuranTransliterationText] ([transliterationId],[surahNumber],[ayahNumber],[text]) VALUES
      (N'${f.transliterationId}', 2, 1, N'NON_QURAN_FIXTURE_TRANSLITERATION_2_1');

    INSERT INTO [dbo].[QuranTafsir] ([id],[slug],[languageCode],[name],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.tafsirId}', N'${s.tafsir}', N'ur', N'NON_QURAN_FIXTURE tafsir', N'draft', 1, '2026-10-02T10:00:00', '2026-10-02T10:00:00');
    INSERT INTO [dbo].[QuranTafsirContributor] ([tafsirId],[personId],[role],[position]) VALUES (N'${f.tafsirId}', N'${personId}', N'author', 0);
    INSERT INTO [dbo].[QuranTafsirText] ([id],[tafsirId],[surahNumber],[startAyah],[endAyah],[text]) VALUES
      (N'${f.tafsirEntryId}', N'${f.tafsirId}', 1, 1, 3, N'${text('TAFSIR', 1, 1)}');
    UPDATE [dbo].[QuranTafsir] SET [state]=N'published', [sourceId]=N'${f.sourceId}', [publishedAt]='2026-10-02T10:05:00', [version]=2, [updatedAt]='2026-10-02T10:05:00' WHERE [id]=N'${f.tafsirId}';

    INSERT INTO [dbo].[QuranRecitation] ([id],[slug],[personId],[name],[style],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.recitationId}', N'${s.recitation}', N'${f.reciterId}', N'NON_QURAN_FIXTURE recitation', N'NON_QURAN_FIXTURE style', N'draft', 1, '2026-10-02T10:00:00', '2026-10-02T10:00:00');
    INSERT INTO [dbo].[QuranRecitationSegment] ([id],[recitationId],[surahNumber],[startAyah],[endAyah],[assetId],[createdAt]) VALUES
      (N'${f.segmentId}', N'${f.recitationId}', 2, 1, 2, N'${f.assetId}', '2026-10-02T10:00:00');
    UPDATE [dbo].[QuranRecitation] SET [state]=N'published', [sourceId]=N'${f.sourceId}', [publishedAt]='2026-10-02T10:05:00', [version]=2, [updatedAt]='2026-10-02T10:05:00' WHERE [id]=N'${f.recitationId}';

    INSERT INTO [dbo].[QuranTajweedRule] ([id],[slug],[position],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.ruleId}', N'${s.rule}', 0, N'draft', 1, '2026-10-02T10:00:00', '2026-10-02T10:00:00');
    INSERT INTO [dbo].[QuranTajweedRuleText] ([ruleId],[languageCode],[title],[body]) VALUES
      (N'${f.ruleId}', N'en', N'NON_QURAN_FIXTURE rule', N'NON_QURAN_FIXTURE rule body: بَ differs from بِ.');
    UPDATE [dbo].[QuranTajweedRule] SET [state]=N'published', [sourceId]=N'${f.sourceId}', [publishedAt]='2026-10-02T10:05:00', [version]=2, [updatedAt]='2026-10-02T10:05:00' WHERE [id]=N'${f.ruleId}';

    INSERT INTO [dbo].[QuranTopic] ([surahNumber],[ayahNumber],[topicId],[createdAt]) VALUES (1, 1, N'${topicId}', '2026-10-02T10:00:00');
    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'quran-ayah', N'${String(cs)}:${String(ca)}');
  `);
}

/** Every authoritative Phase-18 row this fixture wrote, in a stable order. */
export async function capturePhase18Fixture(
  sql: SqlSession,
  fixture: Phase18Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const sources = `N'${f.sourceId}',N'${f.correctionSourceId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'QuranSource',
      `SELECT * FROM [dbo].[QuranSource] WHERE [id] IN (${sources}) ORDER BY [code]`,
      2,
    ],
    [
      'QuranSourceSurah',
      `SELECT * FROM [dbo].[QuranSourceSurah] WHERE [sourceId] IN (${sources}) ORDER BY [sourceId],[number]`,
      3,
    ],
    [
      'QuranSourceAyah',
      `SELECT * FROM [dbo].[QuranSourceAyah] WHERE [sourceId] IN (${sources}) ORDER BY [sourceId],[surahNumber],[ayahNumber]`,
      6,
    ],
    ['QuranActivation', 'SELECT * FROM [dbo].[QuranActivation]', 1],
    ['Juz', 'SELECT * FROM [dbo].[Juz] ORDER BY [number]', 2],
    ['Surah', 'SELECT * FROM [dbo].[Surah] ORDER BY [number]', 2],
    ['Ayah', 'SELECT * FROM [dbo].[Ayah] ORDER BY [surahNumber],[ayahNumber]', 5],
    [
      'QuranAyahRevision',
      'SELECT * FROM [dbo].[QuranAyahRevision] ORDER BY [surahNumber],[ayahNumber],[version]',
      6,
    ],
    [
      'QuranVerificationRun',
      'SELECT * FROM [dbo].[QuranVerificationRun] ORDER BY [createdAt]',
      3,
    ],
    ['SurahName', 'SELECT * FROM [dbo].[SurahName] ORDER BY [surahNumber],[locale]', 4],
    [
      'QuranTranslation',
      `SELECT * FROM [dbo].[QuranTranslation] WHERE [id]=N'${f.translationId}'`,
      1,
    ],
    [
      'QuranTranslationContributor',
      `SELECT * FROM [dbo].[QuranTranslationContributor] WHERE [translationId]=N'${f.translationId}'`,
      1,
    ],
    [
      'QuranTranslationText',
      `SELECT * FROM [dbo].[QuranTranslationText] WHERE [translationId]=N'${f.translationId}' ORDER BY [surahNumber],[ayahNumber]`,
      2,
    ],
    [
      'QuranTransliteration',
      `SELECT * FROM [dbo].[QuranTransliteration] WHERE [id]=N'${f.transliterationId}'`,
      1,
    ],
    [
      'QuranTransliterationText',
      `SELECT * FROM [dbo].[QuranTransliterationText] WHERE [transliterationId]=N'${f.transliterationId}'`,
      1,
    ],
    ['QuranTafsir', `SELECT * FROM [dbo].[QuranTafsir] WHERE [id]=N'${f.tafsirId}'`, 1],
    [
      'QuranTafsirContributor',
      `SELECT * FROM [dbo].[QuranTafsirContributor] WHERE [tafsirId]=N'${f.tafsirId}'`,
      1,
    ],
    [
      'QuranTafsirText',
      `SELECT * FROM [dbo].[QuranTafsirText] WHERE [tafsirId]=N'${f.tafsirId}'`,
      1,
    ],
    [
      'QuranRecitation',
      `SELECT * FROM [dbo].[QuranRecitation] WHERE [id]=N'${f.recitationId}'`,
      1,
    ],
    [
      'QuranRecitationSegment',
      `SELECT * FROM [dbo].[QuranRecitationSegment] WHERE [recitationId]=N'${f.recitationId}'`,
      1,
    ],
    [
      'QuranTajweedRule',
      `SELECT * FROM [dbo].[QuranTajweedRule] WHERE [id]=N'${f.ruleId}'`,
      1,
    ],
    [
      'QuranTajweedRuleText',
      `SELECT * FROM [dbo].[QuranTajweedRuleText] WHERE [ruleId]=N'${f.ruleId}'`,
      1,
    ],
    [
      'QuranTopic',
      'SELECT * FROM [dbo].[QuranTopic] ORDER BY [surahNumber],[ayahNumber],[topicId]',
      1,
    ],
    ['Reciter', `SELECT * FROM [dbo].[Person] WHERE [id]=N'${f.reciterId}'`, 1],
    [
      'ReciterName',
      `SELECT * FROM [dbo].[PersonTranslation] WHERE [personId]=N'${f.reciterId}'`,
      1,
    ],
    ['Asset', `SELECT * FROM [dbo].[Asset] WHERE [id]=N'${f.assetId}'`, 1],
    [
      'QuranAyahSearchIntent',
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'quran-ayah'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-18 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-18 tables whose constraints and triggers must return intact. */
const PHASE18_TABLES = [
  'QuranSource',
  'QuranSourceSurah',
  'QuranSourceAyah',
  'QuranActivation',
  'Juz',
  'Surah',
  'Ayah',
  'QuranVerificationRun',
  'QuranAyahRevision',
  'SurahName',
  'QuranTranslation',
  'QuranTranslationContributor',
  'QuranTranslationText',
  'QuranTransliteration',
  'QuranTransliterationText',
  'QuranTafsir',
  'QuranTafsirContributor',
  'QuranTafsirText',
  'QuranRecitation',
  'QuranRecitationSegment',
  'QuranTajweedRule',
  'QuranTajweedRuleText',
  'QuranTopic',
] as const;

const PROCEDURES = [
  'QuranAcceptCorpus',
  'QuranAssertCanonicalAuthority',
  'QuranCorrectAyah',
  'QuranRecordVerificationFailure',
] as const;

/**
 * Verifies the restored Quran state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: every canonical and source text is still an unmistakable
 * sentinel and every source still of `fixture` authority, so a restore can never
 * turn the fixture into something that reads as scripture or as approved; the
 * citation is still the key; the corrected Ayah's text is byte for byte its
 * version-2 revision's and its source's, while version 1 still holds the
 * original; the evidence is two passes and one located failure; every layered
 * row still resolves through its typed key to a real Ayah, Person, Topic and
 * Asset; the twenty-five triggers are enabled and every Phase-18 CHECK and
 * foreign key enabled, trusted and non-cascading; the four procedures and the
 * three permission keys, bundled, are back.
 */
export async function verifyRestoredPhase18(
  sql: SqlSession,
  fixture: Phase18Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase18References,
): Promise<string> {
  deepStrictEqual(
    await capturePhase18Fixture(sql, fixture),
    expected,
    'Phase-18 Quran authoritative values changed during recovery.',
  );
  const f = fixture;
  const [cs, ca] = CORRECTED;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Ayah] WHERE [text] NOT LIKE N'NON[_]QURAN[_]FIXTURE[_]%' OR [text] NOT LIKE N'%${SENTINEL}') AS [ayat],
      (SELECT COUNT(*) FROM [dbo].[QuranAyahRevision] WHERE [text] NOT LIKE N'NON[_]QURAN[_]FIXTURE[_]%' OR [text] NOT LIKE N'%${SENTINEL}') AS [revisions],
      (SELECT COUNT(*) FROM [dbo].[QuranSourceAyah] WHERE [text] NOT LIKE N'NON[_]QURAN[_]FIXTURE[_]%') AS [sourceAyat],
      (SELECT COUNT(*) FROM [dbo].[QuranSource] WHERE [authority]<>N'fixture' OR [code] NOT LIKE N'NON[_]QURAN[_]FIXTURE[_]%') AS [sources],
      (SELECT COUNT(*) FROM [dbo].[QuranActivation] v JOIN [dbo].[QuranSource] q ON q.[id]=v.[sourceId] WHERE q.[authority]=N'fixture') AS [fixtureMode],
      (SELECT COUNT(*) FROM [dbo].[SurahName] WHERE [name] NOT LIKE N'NON[_]QURAN[_]FIXTURE%') AS [names],
      (SELECT COUNT(*) FROM (
         SELECT [name] FROM [dbo].[QuranTranslation] UNION ALL SELECT [name] FROM [dbo].[QuranTransliteration]
         UNION ALL SELECT [name] FROM [dbo].[QuranTafsir] UNION ALL SELECT [name] FROM [dbo].[QuranRecitation]
         UNION ALL SELECT [title] FROM [dbo].[QuranTajweedRuleText]) w
       WHERE w.[name] NOT LIKE N'NON[_]QURAN[_]FIXTURE%') AS [works];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"ayat":0,"revisions":0,"sourceAyat":0,"sources":0,"fixtureMode":1,"names":0,"works":0}'
  ) {
    throw new Error(
      `Restored Phase-18 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  const [corrected] = await sql.query<Record<string, number | string>>(`
    SELECT a.[version], a.[sourceId],
      CASE WHEN CAST(a.[text] AS VARBINARY(8000))=CAST(r.[text] AS VARBINARY(8000))
            AND CAST(a.[text] AS VARBINARY(8000))=CAST(s.[text] AS VARBINARY(8000)) THEN 1 ELSE 0 END AS [exact],
      (SELECT COUNT(*) FROM [dbo].[QuranAyahRevision] o JOIN [dbo].[QuranSourceAyah] c
         ON c.[sourceId]=N'${f.sourceId}' AND c.[surahNumber]=o.[surahNumber] AND c.[ayahNumber]=o.[ayahNumber]
        WHERE o.[surahNumber]=${String(cs)} AND o.[ayahNumber]=${String(ca)} AND o.[version]=1
          AND CAST(o.[text] AS VARBINARY(8000))=CAST(c.[text] AS VARBINARY(8000))) AS [original],
      r.[actorId], r.[stepUpGrantId], r.[verificationRunId]
    FROM [dbo].[Ayah] a
    JOIN [dbo].[QuranAyahRevision] r ON r.[surahNumber]=a.[surahNumber] AND r.[ayahNumber]=a.[ayahNumber] AND r.[version]=a.[version]
    JOIN [dbo].[QuranSourceAyah] s ON s.[sourceId]=a.[sourceId] AND s.[surahNumber]=a.[surahNumber] AND s.[ayahNumber]=a.[ayahNumber]
    WHERE a.[surahNumber]=${String(cs)} AND a.[ayahNumber]=${String(ca)};
  `);
  if (
    JSON.stringify(corrected) !==
    JSON.stringify({
      version: 2,
      sourceId: f.correctionSourceId,
      exact: 1,
      original: 1,
      actorId: references.actorId,
      stepUpGrantId: f.stepUpGrantId,
      verificationRunId: f.correctionRunId,
    })
  ) {
    throw new Error(
      `Restored Phase-18 correction lost its citation, history or source: ${JSON.stringify(corrected)}.`,
    );
  }

  const [evidence] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[QuranVerificationRun] WHERE [id]=N'${f.acceptanceRunId}' AND [outcome]=N'passed' AND [checked]=5) AS [accepted],
      (SELECT COUNT(*) FROM [dbo].[QuranVerificationRun] WHERE [id]=N'${f.failedRunId}' AND [outcome]=N'failed'
         AND [firstSurah]=1 AND [firstAyah]=3 AND [firstOffset]=30 AND [firstReason]=N'text-mismatch') AS [failed],
      (SELECT COUNT(*) FROM [dbo].[QuranVerificationRun] WHERE [id]=N'${f.correctionRunId}' AND [kind]=N'ayah-correction' AND [outcome]=N'passed') AS [correction],
      (SELECT COUNT(*) FROM [dbo].[QuranAyahRevision] WHERE [version]=1 AND [verificationRunId]=N'${f.acceptanceRunId}') AS [versionOne],
      (SELECT COUNT(*) FROM [dbo].[Ayah] a JOIN [dbo].[Juz] j ON j.[number]=a.[juzNumber] JOIN [dbo].[Surah] h ON h.[number]=a.[surahNumber]) AS [placed];
  `);
  if (
    JSON.stringify(evidence) !==
    '{"accepted":1,"failed":1,"correction":1,"versionOne":5,"placed":5}'
  ) {
    throw new Error(
      `Restored Phase-18 evidence is incomplete: ${JSON.stringify(evidence)}.`,
    );
  }

  // Every layered row resolves through its TYPED key to a real owner row.
  const [typed] = await sql.query<Record<string, number | string>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[QuranTranslationText] t JOIN [dbo].[Ayah] a ON a.[surahNumber]=t.[surahNumber] AND a.[ayahNumber]=t.[ayahNumber]
         WHERE t.[translationId]=N'${f.translationId}') AS [translationAyat],
      (SELECT COUNT(*) FROM [dbo].[QuranTranslationContributor] c JOIN [dbo].[Person] p ON p.[id]=c.[personId]
         WHERE c.[translationId]=N'${f.translationId}' AND p.[id]=N'${references.personId}') AS [translator],
      (SELECT COUNT(*) FROM [dbo].[QuranTafsirText] t
         JOIN [dbo].[Ayah] s ON s.[surahNumber]=t.[surahNumber] AND s.[ayahNumber]=t.[startAyah]
         JOIN [dbo].[Ayah] e ON e.[surahNumber]=t.[surahNumber] AND e.[ayahNumber]=t.[endAyah]
         WHERE t.[tafsirId]=N'${f.tafsirId}') AS [tafsirRange],
      (SELECT pt.[name] FROM [dbo].[QuranRecitation] r JOIN [dbo].[Person] p ON p.[id]=r.[personId]
         JOIN [dbo].[PersonTranslation] pt ON pt.[personId]=p.[id] AND pt.[locale]=N'en'
         WHERE r.[id]=N'${f.recitationId}') AS [reciter],
      (SELECT COUNT(*) FROM [dbo].[QuranRecitationSegment] g JOIN [dbo].[Asset] x ON x.[id]=g.[assetId]
         JOIN [dbo].[Ayah] a ON a.[surahNumber]=g.[surahNumber] AND a.[ayahNumber]=g.[endAyah]
         WHERE g.[id]=N'${f.segmentId}' AND x.[state]=N'clean') AS [segmentAudio],
      (SELECT COUNT(*) FROM [dbo].[QuranTopic] q JOIN [dbo].[Topic] t ON t.[id]=q.[topicId]
         JOIN [dbo].[Ayah] a ON a.[surahNumber]=q.[surahNumber] AND a.[ayahNumber]=q.[ayahNumber]
         WHERE t.[id]=N'${references.topicId}') AS [topic],
      (SELECT COUNT(*) FROM [dbo].[QuranTajweedRuleText] WHERE [ruleId]=N'${f.ruleId}'
         AND [body] LIKE N'%بَ%' AND [body] LIKE N'%بِ%') AS [marks];
  `);
  if (
    JSON.stringify(typed) !==
    JSON.stringify({
      translationAyat: 2,
      translator: 1,
      tafsirRange: 1,
      reciter: TEXT.reciter,
      segmentAudio: 1,
      topic: 1,
      marks: 1,
    })
  ) {
    throw new Error(
      `Restored Phase-18 typed relationships are broken: ${JSON.stringify(typed)}.`,
    );
  }

  const tables = PHASE18_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1
            OR delete_referential_action<>0 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-18 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: number;
    procedures: number;
    bundled: number;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT COUNT_BIG(*) FROM sys.triggers WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.procedures WHERE [name] IN (${PROCEDURES.map((name) => `N'${name}'`).join(',')})) AS [procedures],
       (SELECT COUNT_BIG(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id]=rp.[roleId]
          WHERE r.[key]=N'platform-administrator'
            AND rp.[permissionKey] IN (N'quran.read', N'quran.administer', N'quran.editCanonical')) AS [bundled];`,
  );
  // 39 CHECKs, 41 foreign keys and 25 triggers, exactly as the migration
  // creates them: a restore that silently lost one would otherwise read as
  // "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 39 ||
    Number(counts?.keys ?? 0) !== 41 ||
    Number(counts?.triggers ?? 0) !== 25 ||
    Number(counts?.procedures ?? 0) !== PROCEDURES.length ||
    Number(counts?.bundled ?? 0) !== 3
  ) {
    throw new Error(
      `Restored Phase-18 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'fixture-mode corpus by citation, version-1 history and a recorded version-2 correction, passed and failed evidence, published layered works typed to Ayah, Person, Topic and Asset, sentinel labels intact';
}
