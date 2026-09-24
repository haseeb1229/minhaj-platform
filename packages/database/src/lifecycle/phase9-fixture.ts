import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-9 STATE for the recovery rehearsals.
 *
 * WHAT IT PROVES THAT A SCHEMA CHECK DOES NOT. That the scholarly and periodical
 * Library came back with its RELATIONSHIPS and its INVARIANTS:
 *
 *   - a Research record RENAMED once, so both slugs must come back reserved to
 *     it — a restore that lost the history would turn every old link into a 404;
 *   - a Magazine renamed once, with an issue renamed once WITHIN it, so the
 *     two-part periodical address and both reservation namespaces must survive;
 *   - an ARCHIVED research paper and a DRAFT issue, so a rebuild after restore
 *     can be shown to return only what is public;
 *   - Urdu and Arabic text read back character by character, a citation with its
 *     DOI and HTTPS address, typed contributor and topic relations;
 *   - a PENDING search intent, because durable derived-work intent is
 *     authoritative state the indexer still owes (ARCHITECTURE.md §8.5).
 *
 * THE SEARCH PROJECTION IS NOT HERE. It is derived, and the proof that it
 * rebuilds from the restored owner is the Phase-9 restore test's to make.
 *
 * NOTHING HERE IS REAL. Every title says it is a recovery proof, the words are
 * invented, and no research, periodical or religious text is represented.
 */

export interface Phase9Fixture {
  readonly runId: string;
  readonly researchId: string;
  readonly researchOriginalSlug: string;
  readonly researchSlug: string;
  readonly paperId: string;
  readonly publicationId: string;
  readonly encyclopediaId: string;
  readonly magazineId: string;
  readonly magazineOriginalSlug: string;
  readonly magazineSlug: string;
  readonly issueId: string;
  readonly issueOriginalSlug: string;
  readonly issueSlug: string;
  readonly draftIssueId: string;
}

export function newPhase9Fixture(): Phase9Fixture {
  const runId = randomUUID().replaceAll('-', '');
  return {
    runId,
    researchId: randomUUID(),
    researchOriginalSlug: `phase9-research-original-${runId}`,
    researchSlug: `phase9-research-current-${runId}`,
    paperId: randomUUID(),
    publicationId: randomUUID(),
    encyclopediaId: randomUUID(),
    magazineId: randomUUID(),
    magazineOriginalSlug: `phase9-magazine-original-${runId}`,
    magazineSlug: `phase9-magazine-current-${runId}`,
    issueId: randomUUID(),
    issueOriginalSlug: `phase9-issue-original-${runId}`,
    issueSlug: `phase9-issue-current-${runId}`,
    draftIssueId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase9Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-9 fixture runId does not match the expected pattern.');
  }
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-z-]{1,120}$/.test(value)) {
      throw new Error(`Phase-9 fixture field '${name}' is not a safe generated value.`);
    }
  }
}

/** The words a rebuilt index must — and must not — answer to. */
export const PHASE9_RECOVERY_WORDS = Object.freeze({
  research: 'lanternmossfixture',
  paper: 'cinderwaldfixture',
  issue: 'harrowdalefixture',
  draftIssue: 'wrenlockfixture',
});

const TEXT = {
  researchUr: 'بحالی کے ثبوت کی آزمائشی تحقیق',
  abstractUr: 'یہ ایک آزمائشی خلاصہ ہے جو صرف بحالی کے ثبوت کے لیے لکھا گیا۔',
  encyclopediaAr: 'موسوعة تجريبية لإثبات الاستعادة',
} as const;

/**
 * Writes the populated Phase-9 state into the SOURCE database, before backup.
 *
 * Written with the MIGRATION principal, in dependency order, so the real foreign
 * keys, CHECK constraints and slug-reservation triggers are exercised rather
 * than worked around — the renames are real UPDATEs the triggers observe.
 */
export async function writePhase9Fixture(
  sql: SqlSession,
  fixture: Phase9Fixture,
  references: { readonly personId: string; readonly topicId: string },
): Promise<void> {
  assertSafe(fixture);
  for (const value of Object.values(references)) {
    if (!/^[a-z0-9-]{1,36}$/i.test(value)) {
      throw new Error('Invalid synthetic Phase-9 fixture reference.');
    }
  }
  const f = fixture;
  const w = PHASE9_RECOVERY_WORDS;
  const document = JSON.stringify({
    sections: [
      {
        key: 'recovery-proof',
        title: 'Recovery proof',
        paragraphs: ['Synthetic non-authoritative recovery text.'],
      },
    ],
  });

  await sql.query(`
    INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[publishedOn],[institutionalContext],[abstract],[document],[version],[updatedAt])
    VALUES (N'${f.researchId}', N'${f.researchOriginalSlug}', N'en', N'ur', N'published', 2020, '2020-05-06',
            N'A synthetic institute', N'${TEXT.abstractUr}', N'${document}', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Research] SET [slug]=N'${f.researchSlug}', [version]=2 WHERE [id]=N'${f.researchId}';
    INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES
      (N'${f.researchId}', N'en', N'Synthetic recovery research ${w.research}', N''),
      (N'${f.researchId}', N'ur', N'${TEXT.researchUr}', N'');
    INSERT INTO [dbo].[ResearchContributor] ([researchId],[personId],[role],[position])
      VALUES (N'${f.researchId}', N'${references.personId}', N'author', 0);
    INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId])
      VALUES (N'${f.researchId}', N'${references.topicId}');
    INSERT INTO [dbo].[ResearchCitation] ([researchId],[position],[text],[url],[doi])
      VALUES (N'${f.researchId}', 0, N'Synthetic recovery citation', N'https://example.org/recovery', N'10.1234/recovery.proof');

    INSERT INTO [dbo].[ResearchPaper] ([id],[slug],[primaryLocale],[languageCode],[state],[venue],[doi],[version],[updatedAt])
    VALUES (N'${f.paperId}', N'phase9-paper-${f.runId}', N'en', N'en', N'archived',
            N'Synthetic Journal of Recovery', N'10.1234/recovery.paper', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[ResearchPaperLabel] ([researchPaperId],[locale],[title],[summary])
      VALUES (N'${f.paperId}', N'en', N'Synthetic withdrawn paper ${w.paper}', N'');

    INSERT INTO [dbo].[Publication] ([id],[slug],[primaryLocale],[languageCode],[state],[publisher],[version],[updatedAt])
    VALUES (N'${f.publicationId}', N'phase9-publication-${f.runId}', N'en', N'en', N'published', N'Synthetic Press', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[PublicationLabel] ([publicationId],[locale],[title],[summary])
      VALUES (N'${f.publicationId}', N'en', N'Synthetic recovery publication', N'');

    INSERT INTO [dbo].[Encyclopedia] ([id],[slug],[primaryLocale],[languageCode],[state],[version],[updatedAt])
    VALUES (N'${f.encyclopediaId}', N'phase9-encyclopedia-${f.runId}', N'ar', N'ar', N'published', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[EncyclopediaLabel] ([encyclopediaId],[locale],[title],[summary])
      VALUES (N'${f.encyclopediaId}', N'ar', N'${TEXT.encyclopediaAr}', N'');

    INSERT INTO [dbo].[Magazine] ([id],[slug],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${f.magazineId}', N'${f.magazineOriginalSlug}', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Magazine] SET [slug]=N'${f.magazineSlug}', [version]=2 WHERE [id]=N'${f.magazineId}';
    INSERT INTO [dbo].[MagazineLabel] ([magazineId],[locale],[title],[summary])
      VALUES (N'${f.magazineId}', N'en', N'Synthetic recovery monthly', N'');

    INSERT INTO [dbo].[MagazineIssue] ([id],[magazineId],[slug],[primaryLocale],[languageCode],[state],[volume],[issueNumber],[publicationYear],[version],[updatedAt])
    VALUES (N'${f.issueId}', N'${f.magazineId}', N'${f.issueOriginalSlug}', N'en', N'en', N'published', 1, 1, 2021, 1, SYSUTCDATETIME()),
           (N'${f.draftIssueId}', N'${f.magazineId}', N'phase9-draft-${f.runId}', N'en', N'en', N'draft', 1, 2, 2021, 1, SYSUTCDATETIME());
    UPDATE [dbo].[MagazineIssue] SET [slug]=N'${f.issueSlug}', [version]=2 WHERE [id]=N'${f.issueId}';
    INSERT INTO [dbo].[MagazineIssueLabel] ([magazineIssueId],[locale],[title],[summary]) VALUES
      (N'${f.issueId}', N'en', N'Synthetic recovery issue ${w.issue}', N''),
      (N'${f.draftIssueId}', N'en', N'Synthetic draft issue ${w.draftIssue}', N'');
    INSERT INTO [dbo].[MagazineIssueTopic] ([magazineIssueId],[topicId])
      VALUES (N'${f.issueId}', N'${references.topicId}');

    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'magazine-issue', N'${f.issueId}');
  `);
}

/** Every authoritative Phase-9 row this fixture wrote, in a stable order. */
export async function capturePhase9Fixture(
  sql: SqlSession,
  fixture: Phase9Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const issues = `N'${f.issueId}',N'${f.draftIssueId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    ['Research', `SELECT * FROM [dbo].[Research] WHERE [id]=N'${f.researchId}'`, 1],
    [
      'ResearchLabel',
      `SELECT * FROM [dbo].[ResearchLabel] WHERE [researchId]=N'${f.researchId}' ORDER BY [locale]`,
      2,
    ],
    [
      'ResearchSlugHistory',
      `SELECT * FROM [dbo].[ResearchSlugHistory] WHERE [researchId]=N'${f.researchId}' ORDER BY [slug]`,
      2,
    ],
    [
      'ResearchContributor',
      `SELECT * FROM [dbo].[ResearchContributor] WHERE [researchId]=N'${f.researchId}'`,
      1,
    ],
    [
      'ResearchTopic',
      `SELECT * FROM [dbo].[ResearchTopic] WHERE [researchId]=N'${f.researchId}'`,
      1,
    ],
    [
      'ResearchCitation',
      `SELECT * FROM [dbo].[ResearchCitation] WHERE [researchId]=N'${f.researchId}'`,
      1,
    ],
    [
      'ResearchPaper',
      `SELECT * FROM [dbo].[ResearchPaper] WHERE [id]=N'${f.paperId}'`,
      1,
    ],
    [
      'Publication',
      `SELECT * FROM [dbo].[Publication] WHERE [id]=N'${f.publicationId}'`,
      1,
    ],
    [
      'Encyclopedia',
      `SELECT * FROM [dbo].[Encyclopedia] WHERE [id]=N'${f.encyclopediaId}'`,
      1,
    ],
    [
      'EncyclopediaLabel',
      `SELECT * FROM [dbo].[EncyclopediaLabel] WHERE [encyclopediaId]=N'${f.encyclopediaId}'`,
      1,
    ],
    ['Magazine', `SELECT * FROM [dbo].[Magazine] WHERE [id]=N'${f.magazineId}'`, 1],
    [
      'MagazineSlugHistory',
      `SELECT * FROM [dbo].[MagazineSlugHistory] WHERE [magazineId]=N'${f.magazineId}' ORDER BY [slug]`,
      2,
    ],
    [
      'MagazineIssue',
      `SELECT * FROM [dbo].[MagazineIssue] WHERE [id] IN (${issues}) ORDER BY [id]`,
      2,
    ],
    [
      'MagazineIssueSlugHistory',
      `SELECT * FROM [dbo].[MagazineIssueSlugHistory] WHERE [magazineIssueId] IN (${issues}) ORDER BY [slug]`,
      3,
    ],
    [
      'MagazineIssueTopic',
      `SELECT * FROM [dbo].[MagazineIssueTopic] WHERE [magazineIssueId]=N'${f.issueId}'`,
      1,
    ],
    [
      'SearchIndexRequest',
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'magazine-issue' AND [scopeId]=N'${f.issueId}'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-9 recovery expected ${expected} ${name} row(s), found ${data.length}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/**
 * Verifies the restored Phase-9 Library and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: the six slug-reservation triggers came back enabled, so a
 * restored database still refuses slug reuse; no Phase-9 CHECK constraint came
 * back disabled or untrusted; the filtered (volume, number) index came back
 * unique and filtered; and the Urdu and Arabic text is exactly what was written.
 */
export async function verifyRestoredPhase9(
  sql: SqlSession,
  fixture: Phase9Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase9Fixture(sql, fixture),
    expected,
    'Phase-9 Library authoritative values changed during recovery.',
  );

  const [text] = await sql.query<{
    research: string;
    abstract: string;
    encyclopedia: string;
  }>(
    `SELECT
       (SELECT [title] FROM [dbo].[ResearchLabel] WHERE [researchId]=N'${fixture.researchId}' AND [locale]=N'ur') AS [research],
       (SELECT [abstract] FROM [dbo].[Research] WHERE [id]=N'${fixture.researchId}') AS [abstract],
       (SELECT [title] FROM [dbo].[EncyclopediaLabel] WHERE [encyclopediaId]=N'${fixture.encyclopediaId}') AS [encyclopedia];`,
  );
  if (
    text?.research !== TEXT.researchUr ||
    text.abstract !== TEXT.abstractUr ||
    text.encyclopedia !== TEXT.encyclopediaAr
  ) {
    throw new Error('Restored Urdu or Arabic Phase-9 text does not match.');
  }

  const [triggers] = await sql.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM sys.triggers
     WHERE [name] IN (N'LibraryReserveResearchSlug',N'LibraryReserveResearchPaperSlug',N'LibraryReservePublicationSlug',
                      N'LibraryReserveMagazineSlug',N'LibraryReserveMagazineIssueSlug',N'LibraryReserveEncyclopediaSlug')
       AND [is_disabled]=0;`,
  );
  if (Number(triggers?.total ?? 0) !== 6) {
    throw new Error('Restored database lost a Phase-9 slug-reservation trigger.');
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (OBJECT_ID(N'Research'),OBJECT_ID(N'ResearchPaper'),OBJECT_ID(N'Publication'),
                                OBJECT_ID(N'Magazine'),OBJECT_ID(N'MagazineIssue'),OBJECT_ID(N'Encyclopedia'),
                                OBJECT_ID(N'ResearchCitation'),OBJECT_ID(N'ResearchPaperCitation'))
       AND (is_disabled=1 OR is_not_trusted=1);`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-9 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [numbers] = await sql.query<{ filtered: number }>(
    `SELECT COUNT_BIG(*) AS [filtered] FROM sys.indexes
     WHERE [name]=N'MagazineIssue_magazineId_volume_issueNumber_key' AND [is_unique]=1 AND [has_filter]=1;`,
  );
  if (Number(numbers?.filtered ?? 0) !== 1) {
    throw new Error('Restored database lost the filtered issue-number index.');
  }

  return 'six aggregates, slug histories, citations, issue hierarchy and search intent intact';
}
