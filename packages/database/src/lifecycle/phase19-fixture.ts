import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-19 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That Hadith
 * came back with its SOURCE-QUALIFIED IDENTITY, its IMMUTABLE HISTORY and its
 * EVIDENCE, and with every layered record still typed to the record it
 * describes:
 *
 *   - two registered FIXTURE source systems, each carrying one edition of one
 *     collection, the collection's display names in three locales;
 *   - a book in each edition and a chapter in the first, with display names;
 *   - two records with the SAME apparent source reference, one per edition,
 *     both candidates for the same public citation number;
 *   - the first record at version 2 by a recorded CORRECTION, its version-1
 *     revision and gradings still intact beside the version-2 ones, verified
 *     at both versions;
 *   - the citation mapped to the first record with its revision, and the
 *     conflict evidence the correction produced against the second record;
 *   - fixture-mode activation of the collection;
 *   - a published translation with a contributor, a published commentary with
 *     an entry and a contributor, a published science with its text, a record
 *     topic assignment, and the `hadith` search intent still owed.
 *
 * NOTHING HERE IS A HADITH. Every text, chain, grading, grader and reference is
 * a `NON_HADITH_FIXTURE_…` sentinel; the Arabic is the neutral phrase "test
 * text" and two marked letters that prove combining marks survive byte for
 * byte; every source system is of `fixture` authority, so no approved
 * collection is ever implied. Canonical rows are written directly by the
 * owner, as only the owner may: the recovery databases are disposable and
 * created by the run that writes them, and the canonical write path itself is
 * proved by `db:migrate:test` and `db:test:permissions`.
 */

/** Neutral Arabic "test text", and two letters differing only by their mark. */
const ARABIC = 'نص اختبار بَ بِ';

const TEXT = {
  original: `NON_HADITH_FIXTURE_TEXT_1 ${ARABIC}`,
  corrected: `NON_HADITH_FIXTURE_TEXT_2 ${ARABIC}`,
  chain: 'NON_HADITH_FIXTURE_CHAIN_1',
  reference: 'NON_HADITH_FIXTURE_REFERENCE_7',
  evidence: 'NON_HADITH_FIXTURE_EVIDENCE_1',
  reason: 'NON_HADITH_FIXTURE recovery correction against a registered fixture source.',
  operator: 'NON_HADITH_FIXTURE recovery operator',
} as const;

/** The collection-local number both records are candidates for. */
const CITATION = 7;

export interface Phase19Fixture {
  readonly runId: string;
  readonly sourceAId: string;
  readonly sourceACode: string;
  readonly sourceBId: string;
  readonly sourceBCode: string;
  readonly collectionId: string;
  readonly editionAId: string;
  readonly editionBId: string;
  readonly bookAId: string;
  readonly bookBId: string;
  readonly chapterId: string;
  readonly recordAId: string;
  readonly recordBId: string;
  readonly verificationOneId: string;
  readonly verificationTwoId: string;
  readonly citationId: string;
  readonly conflictId: string;
  /** A HISTORICAL step-up identifier: the grant row expires, the evidence stays. */
  readonly stepUpGrantId: string;
  readonly translationId: string;
  readonly commentaryId: string;
  readonly scienceId: string;
}

export interface Phase19References {
  /** The account recorded as the canonical actor. */
  readonly actorId: string;
  /** A contributor to the translation and commentary. */
  readonly personId: string;
  readonly topicId: string;
}

export function newPhase19Fixture(): Phase19Fixture {
  const runId = randomUUID().replaceAll('-', '');
  const stem = runId.slice(0, 16);
  return {
    runId,
    sourceAId: randomUUID(),
    sourceACode: `NON_HADITH_FIXTURE_RECOVERY_A_${stem}`,
    sourceBId: randomUUID(),
    sourceBCode: `NON_HADITH_FIXTURE_RECOVERY_B_${stem}`,
    collectionId: randomUUID(),
    editionAId: randomUUID(),
    editionBId: randomUUID(),
    bookAId: randomUUID(),
    bookBId: randomUUID(),
    chapterId: randomUUID(),
    recordAId: randomUUID(),
    recordBId: randomUUID(),
    verificationOneId: randomUUID(),
    verificationTwoId: randomUUID(),
    citationId: randomUUID(),
    conflictId: randomUUID(),
    stepUpGrantId: randomUUID(),
    translationId: randomUUID(),
    commentaryId: randomUUID(),
    scienceId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase19Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-19 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (name.endsWith('Code')) {
      if (!/^NON_HADITH_FIXTURE_RECOVERY_[AB]_[0-9a-f]{16}$/.test(value))
        throw new Error('Phase-19 fixture source code is not a sentinel code.');
      continue;
    }
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-19 fixture field '${name}' is not a generated identifier.`);
  }
}

function slugs(fixture: Phase19Fixture) {
  const stem = fixture.runId.slice(0, 16);
  return {
    collection: `fixture-collection-${stem}`,
    bookA: `fixture-book-a-${stem}`,
    bookB: `fixture-book-b-${stem}`,
    chapter: `fixture-chapter-a-${stem}`,
    commentary: `fixture-commentary-${stem}`,
    science: `fixture-science-${stem}`,
  };
}

/** The UTF-16LE bytes SQL Server stores for an NVARCHAR value, as upper hex. */
function utf16(text: string): string {
  return Buffer.from(text, 'utf16le').toString('hex').toUpperCase();
}

/**
 * Writes the populated Phase-19 state into the SOURCE database, before backup,
 * with the MIGRATION principal, in dependency order, so the real keys, CHECKs
 * and triggers are exercised: every record lands in a structure of its own
 * edition, the correction's revision exists before the record moves to it, the
 * citation is mapped while it is free of conflict evidence, activation finds a
 * mapped citation, and every layered work is published only once it has its
 * text and a registered source system.
 */
export async function writePhase19Fixture(
  sql: SqlSession,
  fixture: Phase19Fixture,
  references: Phase19References,
): Promise<void> {
  assertSafe(fixture);
  for (const value of Object.values(references))
    if (!/^[a-z0-9-]{1,36}$/i.test(value))
      throw new Error('Invalid synthetic Phase-19 fixture reference.');
  const f = fixture;
  const s = slugs(f);
  const { actorId, personId, topicId } = references;
  const grading = (record: string, version: number, label: string): string =>
    `(N'${record}', ${String(version)}, 0, N'NON_HADITH_FIXTURE_GRADER_1', N'${label}', N'ar', N'NON_HADITH_FIXTURE_REFERENCE_3', '2026-10-03T08:00:00')`;

  // ---- the registered sources, the collection and its two editions -----------
  await sql.query(`
    INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding],[reference],[createdAt]) VALUES
      (N'${f.sourceAId}', N'${f.sourceACode}', N'fixture', N'NON_HADITH_FIXTURE recovery source A', N'fixture-1', N'utf-8', NULL, '2026-10-03T07:00:00'),
      (N'${f.sourceBId}', N'${f.sourceBCode}', N'fixture', N'NON_HADITH_FIXTURE recovery source B', N'fixture-2', N'utf-8', NULL, '2026-10-03T07:00:00');
    INSERT INTO [dbo].[HadithCollection] ([id],[slug],[position],[namesVersion],[createdAt],[updatedAt]) VALUES
      (N'${f.collectionId}', N'${s.collection}', 0, 1, '2026-10-03T07:00:00', '2026-10-03T07:00:00');
    INSERT INTO [dbo].[HadithEdition] ([id],[collectionId],[sourceSystemId],[code],[title],[reference],[createdAt]) VALUES
      (N'${f.editionAId}', N'${f.collectionId}', N'${f.sourceAId}', N'NON_HADITH_FIXTURE_EDITION_A', N'NON_HADITH_FIXTURE edition A', NULL, '2026-10-03T07:00:00'),
      (N'${f.editionBId}', N'${f.collectionId}', N'${f.sourceBId}', N'NON_HADITH_FIXTURE_EDITION_B', N'NON_HADITH_FIXTURE edition B', N'NON_HADITH_FIXTURE_REFERENCE_4', '2026-10-03T07:00:00');
    INSERT INTO [dbo].[HadithCollectionName] ([collectionId],[locale],[name],[description]) VALUES
      (N'${f.collectionId}', N'en', N'NON_HADITH_FIXTURE collection', N'NON_HADITH_FIXTURE description'),
      (N'${f.collectionId}', N'ur', N'NON_HADITH_FIXTURE ${ARABIC}', NULL),
      (N'${f.collectionId}', N'ar', N'NON_HADITH_FIXTURE ${ARABIC}', NULL);
    UPDATE [dbo].[HadithCollection] SET [namesVersion]=[namesVersion]+1, [updatedAt]='2026-10-03T07:05:00' WHERE [id]=N'${f.collectionId}';
  `);

  // ---- each edition's own structure, the same apparent reference in both -----
  await sql.query(`
    INSERT INTO [dbo].[HadithBook] ([id],[collectionId],[editionId],[slug],[reference],[position],[title],[titleLanguage],[namesVersion],[createdAt],[updatedAt]) VALUES
      (N'${f.bookAId}', N'${f.collectionId}', N'${f.editionAId}', N'${s.bookA}', N'NON_HADITH_FIXTURE_REFERENCE_1', 1, N'NON_HADITH_FIXTURE book ${ARABIC}', N'ar', 1, '2026-10-03T07:10:00', '2026-10-03T07:10:00'),
      (N'${f.bookBId}', N'${f.collectionId}', N'${f.editionBId}', N'${s.bookB}', N'NON_HADITH_FIXTURE_REFERENCE_1', 1, NULL, NULL, 1, '2026-10-03T07:10:00', '2026-10-03T07:10:00');
    INSERT INTO [dbo].[HadithChapter] ([id],[bookId],[slug],[reference],[position],[title],[titleLanguage],[namesVersion],[createdAt],[updatedAt]) VALUES
      (N'${f.chapterId}', N'${f.bookAId}', N'${s.chapter}', N'NON_HADITH_FIXTURE_REFERENCE_2', 1, NULL, NULL, 1, '2026-10-03T07:10:00', '2026-10-03T07:10:00');
    INSERT INTO [dbo].[HadithBookName] ([bookId],[locale],[name]) VALUES (N'${f.bookAId}', N'en', N'NON_HADITH_FIXTURE book A');
    INSERT INTO [dbo].[HadithChapterName] ([chapterId],[locale],[name]) VALUES (N'${f.chapterId}', N'en', N'NON_HADITH_FIXTURE chapter A');
    UPDATE [dbo].[HadithBook] SET [namesVersion]=[namesVersion]+1, [updatedAt]='2026-10-03T07:15:00' WHERE [id]=N'${f.bookAId}';
  `);

  // ---- two candidates, identical at version 1, each with its history ---------
  await sql.query(`
    INSERT INTO [dbo].[Hadith] ([id],[collectionId],[sourceSystemId],[editionId],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.recordAId}', N'${f.collectionId}', N'${f.sourceAId}', N'${f.editionAId}', N'${TEXT.reference}', ${String(CITATION)}, N'${f.bookAId}', N'${f.chapterId}', N'${TEXT.original}', N'ar', N'${TEXT.chain}', N'ar', 1, '2026-10-03T08:00:00', '2026-10-03T08:00:00'),
      (N'${f.recordBId}', N'${f.collectionId}', N'${f.sourceBId}', N'${f.editionBId}', N'${TEXT.reference}', ${String(CITATION)}, N'${f.bookBId}', NULL, N'${TEXT.original}', N'ar', N'${TEXT.chain}', N'ar', 1, '2026-10-03T08:00:00', '2026-10-03T08:00:00');
    INSERT INTO [dbo].[HadithRevision] ([hadithId],[version],[operation],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[evidence],[reason],[actorId],[stepUpGrantId],[createdAt]) VALUES
      (N'${f.recordAId}', 1, N'created', N'${TEXT.reference}', ${String(CITATION)}, N'${f.bookAId}', N'${f.chapterId}', N'${TEXT.original}', N'ar', N'${TEXT.chain}', N'ar', N'${TEXT.evidence}', NULL, N'${actorId}', N'${f.stepUpGrantId}', '2026-10-03T08:00:00'),
      (N'${f.recordBId}', 1, N'created', N'${TEXT.reference}', ${String(CITATION)}, N'${f.bookBId}', NULL, N'${TEXT.original}', N'ar', N'${TEXT.chain}', N'ar', N'${TEXT.evidence}', NULL, N'${actorId}', N'${f.stepUpGrantId}', '2026-10-03T08:00:00');
    INSERT INTO [dbo].[HadithGrading] ([hadithId],[version],[position],[grader],[label],[labelLanguage],[reference],[createdAt]) VALUES
      ${grading(f.recordAId, 1, 'NON_HADITH_FIXTURE_GRADING_1')},
      ${grading(f.recordBId, 1, 'NON_HADITH_FIXTURE_GRADING_1')};
    INSERT INTO [dbo].[HadithVerification] ([id],[hadithId],[version],[evidence],[actorId],[stepUpGrantId],[createdAt]) VALUES
      (N'${f.verificationOneId}', N'${f.recordAId}', 1, N'${TEXT.evidence}', N'${actorId}', N'${f.stepUpGrantId}', '2026-10-03T08:10:00');
  `);

  // ---- the citation, mapped while free of conflict evidence -----------------
  await sql.query(`
    INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.collectionId}', ${String(CITATION)}, N'${f.citationId}', N'${f.recordAId}', N'mapped', 1, '2026-10-03T08:20:00', '2026-10-03T08:20:00');
    INSERT INTO [dbo].[HadithCitationRevision] ([collectionId],[number],[version],[hadithId],[state],[evidence],[reason],[actorId],[stepUpGrantId],[createdAt]) VALUES
      (N'${f.collectionId}', ${String(CITATION)}, 1, N'${f.recordAId}', N'mapped', N'${TEXT.evidence}', NULL, N'${actorId}', N'${f.stepUpGrantId}', '2026-10-03T08:20:00');
    INSERT INTO [dbo].[HadithActivation] ([collectionId],[authority],[authorisedBy],[activatedAt]) VALUES
      (N'${f.collectionId}', N'fixture', N'${TEXT.operator}', '2026-10-03T08:30:00');
  `);

  // ---- one correction, recorded before the record moves to it, and the
  // conflict evidence it produced against the other edition's candidate -------
  await sql.query(`
    INSERT INTO [dbo].[HadithRevision] ([hadithId],[version],[operation],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[evidence],[reason],[actorId],[stepUpGrantId],[createdAt]) VALUES
      (N'${f.recordAId}', 2, N'corrected', N'${TEXT.reference}', ${String(CITATION)}, N'${f.bookAId}', N'${f.chapterId}', N'${TEXT.corrected}', N'ar', N'${TEXT.chain}', N'ar', N'NON_HADITH_FIXTURE_EVIDENCE_2', N'${TEXT.reason}', N'${actorId}', N'${f.stepUpGrantId}', '2026-10-03T09:00:00');
    INSERT INTO [dbo].[HadithGrading] ([hadithId],[version],[position],[grader],[label],[labelLanguage],[reference],[createdAt]) VALUES
      ${grading(f.recordAId, 2, 'NON_HADITH_FIXTURE_GRADING_2')};
    UPDATE [dbo].[Hadith] SET [text]=N'${TEXT.corrected}', [version]=2, [updatedAt]='2026-10-03T09:00:00' WHERE [id]=N'${f.recordAId}';
    INSERT INTO [dbo].[HadithConflict] ([id],[collectionId],[citationNumber],[hadithId],[hadithVersion],[otherHadithId],[otherVersion],[facets],[detectedAt]) VALUES
      (N'${f.conflictId}', N'${f.collectionId}', ${String(CITATION)}, N'${f.recordAId}', 2, N'${f.recordBId}', 1, N'text,grading', '2026-10-03T09:00:00');
    INSERT INTO [dbo].[HadithVerification] ([id],[hadithId],[version],[evidence],[actorId],[stepUpGrantId],[createdAt]) VALUES
      (N'${f.verificationTwoId}', N'${f.recordAId}', 2, N'NON_HADITH_FIXTURE_EVIDENCE_2', N'${actorId}', N'${f.stepUpGrantId}', '2026-10-03T09:10:00');
  `);

  // ---- the layered works ------------------------------------------------------
  await sql.query(`
    INSERT INTO [dbo].[HadithTranslation] ([id],[hadithId],[languageCode],[text],[attribution],[sourceSystemId],[state],[version],[createdAt],[updatedAt],[publishedAt]) VALUES
      (N'${f.translationId}', N'${f.recordAId}', N'en', N'NON_HADITH_FIXTURE_TRANSLATION_1', N'NON_HADITH_FIXTURE attribution', N'${f.sourceAId}', N'published', 2, '2026-10-03T10:00:00', '2026-10-03T10:05:00', '2026-10-03T10:05:00');
    INSERT INTO [dbo].[HadithTranslationContributor] ([translationId],[personId],[role],[position]) VALUES (N'${f.translationId}', N'${personId}', N'translator', 0);

    INSERT INTO [dbo].[HadithCommentary] ([id],[slug],[languageCode],[name],[description],[attribution],[sourceSystemId],[state],[version],[createdAt],[updatedAt],[publishedAt]) VALUES
      (N'${f.commentaryId}', N'${s.commentary}', N'ur', N'NON_HADITH_FIXTURE commentary', NULL, NULL, NULL, N'draft', 1, '2026-10-03T10:00:00', '2026-10-03T10:00:00', NULL);
    INSERT INTO [dbo].[HadithCommentaryContributor] ([commentaryId],[personId],[role],[position]) VALUES (N'${f.commentaryId}', N'${personId}', N'author', 0);
    INSERT INTO [dbo].[HadithCommentaryEntry] ([commentaryId],[hadithId],[text]) VALUES (N'${f.commentaryId}', N'${f.recordAId}', N'NON_HADITH_FIXTURE_COMMENTARY_1 ${ARABIC}');
    UPDATE [dbo].[HadithCommentary] SET [state]=N'published', [sourceSystemId]=N'${f.sourceAId}', [publishedAt]='2026-10-03T10:05:00', [version]=2, [updatedAt]='2026-10-03T10:05:00' WHERE [id]=N'${f.commentaryId}';

    INSERT INTO [dbo].[HadithScience] ([id],[slug],[position],[attribution],[sourceSystemId],[state],[version],[createdAt],[updatedAt],[publishedAt]) VALUES
      (N'${f.scienceId}', N'${s.science}', 0, NULL, NULL, N'draft', 1, '2026-10-03T10:00:00', '2026-10-03T10:00:00', NULL);
    INSERT INTO [dbo].[HadithScienceText] ([scienceId],[languageCode],[title],[body]) VALUES
      (N'${f.scienceId}', N'en', N'NON_HADITH_FIXTURE science', N'NON_HADITH_FIXTURE_SCIENCE_1 ${ARABIC}');
    UPDATE [dbo].[HadithScience] SET [state]=N'published', [sourceSystemId]=N'${f.sourceBId}', [publishedAt]='2026-10-03T10:05:00', [version]=2, [updatedAt]='2026-10-03T10:05:00' WHERE [id]=N'${f.scienceId}';

    INSERT INTO [dbo].[HadithTopic] ([hadithId],[topicId]) VALUES (N'${f.recordAId}', N'${topicId}');
    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'hadith', N'${f.citationId}');
  `);
}

/** Every authoritative Phase-19 row this fixture wrote, in a stable order. */
export async function capturePhase19Fixture(
  sql: SqlSession,
  fixture: Phase19Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const records = `N'${f.recordAId}',N'${f.recordBId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'HadithSourceSystem',
      `SELECT * FROM [dbo].[HadithSourceSystem] WHERE [id] IN (N'${f.sourceAId}',N'${f.sourceBId}') ORDER BY [code]`,
      2,
    ],
    [
      'HadithCollection',
      `SELECT * FROM [dbo].[HadithCollection] WHERE [id]=N'${f.collectionId}'`,
      1,
    ],
    [
      'HadithEdition',
      `SELECT * FROM [dbo].[HadithEdition] WHERE [collectionId]=N'${f.collectionId}' ORDER BY [code]`,
      2,
    ],
    ['HadithActivation', 'SELECT * FROM [dbo].[HadithActivation]', 1],
    [
      'HadithCollectionName',
      `SELECT * FROM [dbo].[HadithCollectionName] WHERE [collectionId]=N'${f.collectionId}' ORDER BY [locale]`,
      3,
    ],
    [
      'HadithBook',
      `SELECT * FROM [dbo].[HadithBook] WHERE [collectionId]=N'${f.collectionId}' ORDER BY [slug]`,
      2,
    ],
    [
      'HadithBookName',
      `SELECT * FROM [dbo].[HadithBookName] WHERE [bookId]=N'${f.bookAId}'`,
      1,
    ],
    [
      'HadithChapter',
      `SELECT * FROM [dbo].[HadithChapter] WHERE [bookId]=N'${f.bookAId}'`,
      1,
    ],
    [
      'HadithChapterName',
      `SELECT * FROM [dbo].[HadithChapterName] WHERE [chapterId]=N'${f.chapterId}'`,
      1,
    ],
    [
      'Hadith',
      `SELECT * FROM [dbo].[Hadith] WHERE [id] IN (${records}) ORDER BY [editionId]`,
      2,
    ],
    [
      'HadithRevision',
      `SELECT * FROM [dbo].[HadithRevision] WHERE [hadithId] IN (${records}) ORDER BY [hadithId],[version]`,
      3,
    ],
    [
      'HadithGrading',
      `SELECT * FROM [dbo].[HadithGrading] WHERE [hadithId] IN (${records}) ORDER BY [hadithId],[version],[position]`,
      3,
    ],
    [
      'HadithVerification',
      `SELECT * FROM [dbo].[HadithVerification] WHERE [hadithId] IN (${records}) ORDER BY [version]`,
      2,
    ],
    [
      'HadithCitation',
      `SELECT * FROM [dbo].[HadithCitation] WHERE [collectionId]=N'${f.collectionId}'`,
      1,
    ],
    [
      'HadithCitationRevision',
      `SELECT * FROM [dbo].[HadithCitationRevision] WHERE [collectionId]=N'${f.collectionId}' ORDER BY [number],[version]`,
      1,
    ],
    [
      'HadithConflict',
      `SELECT * FROM [dbo].[HadithConflict] WHERE [collectionId]=N'${f.collectionId}'`,
      1,
    ],
    [
      'HadithTranslation',
      `SELECT * FROM [dbo].[HadithTranslation] WHERE [id]=N'${f.translationId}'`,
      1,
    ],
    [
      'HadithTranslationContributor',
      `SELECT * FROM [dbo].[HadithTranslationContributor] WHERE [translationId]=N'${f.translationId}'`,
      1,
    ],
    [
      'HadithCommentary',
      `SELECT * FROM [dbo].[HadithCommentary] WHERE [id]=N'${f.commentaryId}'`,
      1,
    ],
    [
      'HadithCommentaryContributor',
      `SELECT * FROM [dbo].[HadithCommentaryContributor] WHERE [commentaryId]=N'${f.commentaryId}'`,
      1,
    ],
    [
      'HadithCommentaryEntry',
      `SELECT * FROM [dbo].[HadithCommentaryEntry] WHERE [commentaryId]=N'${f.commentaryId}'`,
      1,
    ],
    [
      'HadithScience',
      `SELECT * FROM [dbo].[HadithScience] WHERE [id]=N'${f.scienceId}'`,
      1,
    ],
    [
      'HadithScienceText',
      `SELECT * FROM [dbo].[HadithScienceText] WHERE [scienceId]=N'${f.scienceId}'`,
      1,
    ],
    [
      'HadithTopic',
      `SELECT * FROM [dbo].[HadithTopic] WHERE [hadithId] IN (${records}) ORDER BY [topicId]`,
      1,
    ],
    [
      'HadithSearchIntent',
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'hadith'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-19 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-19 tables whose constraints and triggers must return intact. */
const PHASE19_TABLES = [
  'HadithSourceSystem',
  'HadithCollection',
  'HadithEdition',
  'HadithActivation',
  'HadithBook',
  'HadithChapter',
  'Hadith',
  'HadithRevision',
  'HadithGrading',
  'HadithVerification',
  'HadithCitation',
  'HadithCitationRevision',
  'HadithConflict',
  'HadithCollectionName',
  'HadithBookName',
  'HadithChapterName',
  'HadithTranslation',
  'HadithTranslationContributor',
  'HadithCommentary',
  'HadithCommentaryContributor',
  'HadithCommentaryEntry',
  'HadithScience',
  'HadithScienceText',
  'HadithTopic',
] as const;

const PROCEDURES = [
  'HadithAssertCanonicalAuthority',
  'HadithCreateBook',
  'HadithCreateChapter',
  'HadithCreateCollection',
  'HadithDetectConflicts',
  'HadithSetCitation',
  'HadithVerifyRecord',
  'HadithWriteRecord',
] as const;

/**
 * Verifies the restored Hadith state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: every canonical text, chain, grading and reference is
 * still an unmistakable sentinel and every source system still of `fixture`
 * authority, so a restore can never turn the fixture into something that reads
 * as a Hadith or as approved; the same apparent source reference still names
 * two records in two editions; the corrected record's text is byte for byte its
 * version-2 revision's, version 1 still holds the original and the Arabic
 * marks are the exact code units written; each record still sits in a
 * structure of its own edition and source system; the citation still names
 * its declared candidate and its conflict evidence both exact versions; every
 * layered row still resolves through its typed key to a real record, Person
 * and Topic; the eighteen triggers are enabled and every Phase-19 CHECK and
 * foreign key enabled, trusted and non-cascading; the eight procedures and
 * the three permission keys, bundled, are back.
 */
export async function verifyRestoredPhase19(
  sql: SqlSession,
  fixture: Phase19Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase19References,
): Promise<string> {
  deepStrictEqual(
    await capturePhase19Fixture(sql, fixture),
    expected,
    'Phase-19 Hadith authoritative values changed during recovery.',
  );
  const f = fixture;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Hadith] WHERE [text] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]TEXT[_]%'
         OR [chain] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]CHAIN[_]%' OR [sourceReference] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]%') AS [records],
      (SELECT COUNT(*) FROM [dbo].[HadithRevision] WHERE [text] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]TEXT[_]%'
         OR [evidence] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]%') AS [revisions],
      (SELECT COUNT(*) FROM [dbo].[HadithGrading] WHERE [grader] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]GRADER[_]%'
         OR [label] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]GRADING[_]%' OR [reference] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]%') AS [gradings],
      (SELECT COUNT(*) FROM [dbo].[HadithSourceSystem] WHERE [authority]<>N'fixture' OR [code] NOT LIKE N'NON[_]HADITH[_]FIXTURE[_]%') AS [sources],
      (SELECT COUNT(*) FROM [dbo].[HadithActivation] WHERE [authority]=N'fixture') AS [fixtureMode],
      (SELECT COUNT(*) FROM (
         SELECT [name] FROM [dbo].[HadithCollectionName] UNION ALL SELECT [name] FROM [dbo].[HadithBookName]
         UNION ALL SELECT [name] FROM [dbo].[HadithChapterName] UNION ALL SELECT [name] FROM [dbo].[HadithCommentary]
         UNION ALL SELECT [text] FROM [dbo].[HadithTranslation] UNION ALL SELECT [text] FROM [dbo].[HadithCommentaryEntry]
         UNION ALL SELECT [title] FROM [dbo].[HadithScienceText] UNION ALL SELECT [body] FROM [dbo].[HadithScienceText]) w
       WHERE w.[name] NOT LIKE N'NON[_]HADITH[_]FIXTURE%') AS [layered];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"records":0,"revisions":0,"gradings":0,"sources":0,"fixtureMode":1,"layered":0}'
  ) {
    throw new Error(
      `Restored Phase-19 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // The corrected record, byte for byte: current text = its version-2
  // revision's, version 1 still the original, Arabic marks exactly as written.
  const [corrected] = await sql.query<Record<string, number | string>>(`
    SELECT h.[version],
      CASE WHEN CAST(h.[text] AS VARBINARY(MAX))=CAST(r.[text] AS VARBINARY(MAX)) THEN 1 ELSE 0 END AS [exact],
      CONVERT(VARCHAR(MAX), CAST(h.[text] AS VARBINARY(MAX)), 2) AS [bytes],
      (SELECT CONVERT(VARCHAR(MAX), CAST(o.[text] AS VARBINARY(MAX)), 2) FROM [dbo].[HadithRevision] o
        WHERE o.[hadithId]=h.[id] AND o.[version]=1 AND o.[operation]=N'created') AS [original],
      r.[operation], r.[actorId], r.[stepUpGrantId],
      (SELECT COUNT(*) FROM [dbo].[HadithGrading] g WHERE g.[hadithId]=h.[id]) AS [gradings],
      (SELECT COUNT(*) FROM [dbo].[HadithVerification] v WHERE v.[hadithId]=h.[id] AND v.[version]=h.[version]) AS [verifiedNow]
    FROM [dbo].[Hadith] h
    JOIN [dbo].[HadithRevision] r ON r.[hadithId]=h.[id] AND r.[version]=h.[version]
    WHERE h.[id]=N'${f.recordAId}';
  `);
  if (
    JSON.stringify(corrected) !==
    JSON.stringify({
      version: 2,
      exact: 1,
      bytes: utf16(TEXT.corrected),
      original: utf16(TEXT.original),
      operation: 'corrected',
      actorId: references.actorId,
      stepUpGrantId: f.stepUpGrantId,
      gradings: 2,
      verifiedNow: 1,
    })
  ) {
    throw new Error(
      `Restored Phase-19 correction lost its history, bytes or evidence: ${JSON.stringify(corrected)}.`,
    );
  }

  // Source-qualified identity and typed relationships, through real joins.
  const [typed] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(DISTINCT h.[editionId]) FROM [dbo].[Hadith] h
         WHERE CAST(h.[sourceReference] AS VARBINARY(128))=CAST(N'${TEXT.reference}' AS VARBINARY(128))) AS [sameReference],
      (SELECT COUNT(*) FROM [dbo].[Hadith] h
         JOIN [dbo].[HadithEdition] e ON e.[id]=h.[editionId] AND e.[collectionId]=h.[collectionId] AND e.[sourceSystemId]=h.[sourceSystemId]
         JOIN [dbo].[HadithSourceSystem] s ON s.[id]=e.[sourceSystemId]
         JOIN [dbo].[HadithBook] b ON b.[id]=h.[bookId] AND b.[editionId]=h.[editionId]
         LEFT JOIN [dbo].[HadithChapter] c ON c.[id]=h.[chapterId] AND c.[bookId]=h.[bookId]
         WHERE h.[collectionId]=N'${f.collectionId}' AND (h.[chapterId] IS NULL OR c.[id] IS NOT NULL)) AS [placed],
      (SELECT COUNT(*) FROM [dbo].[HadithCitation] t
         JOIN [dbo].[Hadith] h ON h.[id]=t.[hadithId] AND h.[collectionId]=t.[collectionId] AND h.[citationNumber]=t.[number]
         JOIN [dbo].[HadithCitationRevision] v ON v.[collectionId]=t.[collectionId] AND v.[number]=t.[number] AND v.[version]=t.[version]
         WHERE t.[id]=N'${f.citationId}' AND t.[state]=N'mapped' AND v.[hadithId]=t.[hadithId]) AS [citation],
      (SELECT COUNT(*) FROM [dbo].[HadithConflict] k
         JOIN [dbo].[HadithRevision] a ON a.[hadithId]=k.[hadithId] AND a.[version]=k.[hadithVersion]
         JOIN [dbo].[HadithRevision] b ON b.[hadithId]=k.[otherHadithId] AND b.[version]=k.[otherVersion]
         WHERE k.[hadithId]=N'${f.recordAId}' AND k.[otherHadithId]=N'${f.recordBId}' AND k.[facets]=N'text,grading') AS [conflict],
      (SELECT COUNT(*) FROM [dbo].[HadithTranslation] t JOIN [dbo].[Hadith] h ON h.[id]=t.[hadithId]
         JOIN [dbo].[HadithSourceSystem] s ON s.[id]=t.[sourceSystemId]
         JOIN [dbo].[HadithTranslationContributor] c ON c.[translationId]=t.[id]
         JOIN [dbo].[Person] p ON p.[id]=c.[personId]
         WHERE t.[id]=N'${f.translationId}' AND p.[id]=N'${references.personId}') AS [translation],
      (SELECT COUNT(*) FROM [dbo].[HadithCommentaryEntry] e JOIN [dbo].[Hadith] h ON h.[id]=e.[hadithId]
         JOIN [dbo].[HadithCommentary] w ON w.[id]=e.[commentaryId] AND w.[state]=N'published'
         JOIN [dbo].[HadithCommentaryContributor] c ON c.[commentaryId]=w.[id]
         JOIN [dbo].[Person] p ON p.[id]=c.[personId]
         WHERE w.[id]=N'${f.commentaryId}' AND p.[id]=N'${references.personId}') AS [commentary],
      (SELECT COUNT(*) FROM [dbo].[HadithScienceText] x JOIN [dbo].[HadithScience] w ON w.[id]=x.[scienceId]
         JOIN [dbo].[HadithSourceSystem] s ON s.[id]=w.[sourceSystemId] JOIN [dbo].[Language] l ON l.[code]=x.[languageCode]
         WHERE w.[id]=N'${f.scienceId}') AS [science],
      (SELECT COUNT(*) FROM [dbo].[HadithTopic] q JOIN [dbo].[Topic] t ON t.[id]=q.[topicId]
         JOIN [dbo].[Hadith] h ON h.[id]=q.[hadithId]
         WHERE t.[id]=N'${references.topicId}') AS [topic],
      (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] r JOIN [dbo].[HadithCitation] t ON t.[id]=r.[scopeId]
         WHERE r.[scopeKind]=N'hadith') AS [intent];
  `);
  if (
    JSON.stringify(typed) !==
    '{"sameReference":2,"placed":2,"citation":1,"conflict":1,"translation":1,"commentary":1,"science":1,"topic":1,"intent":1}'
  ) {
    throw new Error(
      `Restored Phase-19 typed relationships are broken: ${JSON.stringify(typed)}.`,
    );
  }

  const tables = PHASE19_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
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
      `Restored Phase-19 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
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
            AND rp.[permissionKey] IN (N'hadith.read', N'hadith.administer', N'hadith.editCanonical')) AS [bundled];`,
  );
  // 31 CHECKs, 42 foreign keys and 18 triggers, exactly as the migration
  // creates them: a restore that silently lost one would otherwise read as
  // "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 31 ||
    Number(counts?.keys ?? 0) !== 42 ||
    Number(counts?.triggers ?? 0) !== 18 ||
    Number(counts?.procedures ?? 0) !== PROCEDURES.length ||
    Number(counts?.bundled ?? 0) !== 3
  ) {
    throw new Error(
      `Restored Phase-19 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'fixture-mode collection with two editions and one apparent reference, version-1 history and a recorded version-2 correction, versioned gradings, verification, a mapped citation and its conflict evidence, published layered works typed to record, Person and Topic, sentinel labels and Arabic marks intact';
}
