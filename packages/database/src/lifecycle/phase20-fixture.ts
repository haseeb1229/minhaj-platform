import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-20 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That Fatwa came
 * back with its PRIVATE QUESTIONS still scoped to their askers, its rulings'
 * IMMUTABLE HISTORY in order, the current public revision still the last one
 * published, and the authority that published it still exactly as granted:
 *
 *   - fixture-mode activation, so the restored service is open in fixture mode
 *     and never approved;
 *   - a category mapped onto a Topic, with display names in three locales;
 *   - two askers, each with one private question: one answered — triaged,
 *     assigned and published — and one still submitted;
 *   - one ruling with three immutable revisions and their topics: the first
 *     published, a correction returned with a private note, and the revised
 *     correction published as the current revision;
 *   - two publications in sequence, each under a `fatwa-publication` grant;
 *   - two days of an anonymous read tally;
 *   - the `fatwa` search intent still owed;
 *   - synthetic triage, answering and publishing roles, their assignments, the
 *     publisher's session and step-up grant.
 *
 * NOTHING HERE IS A FATWA. Every question, public question, ruling, title,
 * reason, note, name and operator is a `NON_FATWA_FIXTURE_…` sentinel, and the
 * accounts are `.invalid` synthetic ones the fixture creates. Rows are written
 * directly by the owner: the recovery databases are disposable and created by
 * the run that writes them, and the workflow procedures themselves are proved
 * by `db:migrate:test` and `db:test:permissions`.
 */

const TEXT = {
  question: 'NON_FATWA_FIXTURE_QUESTION_1 synthetic private question text',
  other: 'NON_FATWA_FIXTURE_QUESTION_2 synthetic private question text',
  publicQuestion: 'NON_FATWA_FIXTURE_PUBLIC_QUESTION anonymised statement',
  reason: 'NON_FATWA_FIXTURE_CORRECTION_REASON public statement',
  note: 'NON_FATWA_FIXTURE_NOTE private review note',
  operator: 'NON_FATWA_FIXTURE recovery operator',
} as const;

export interface Phase20Fixture {
  readonly runId: string;
  readonly askerId: string;
  readonly otherAskerId: string;
  readonly triagerId: string;
  readonly answererId: string;
  readonly publisherId: string;
  readonly receiveRoleId: string;
  readonly answerRoleId: string;
  readonly publishRoleId: string;
  readonly sessionId: string;
  readonly stepUpGrantId: string;
  readonly categoryId: string;
  readonly questionId: string;
  readonly otherQuestionId: string;
  readonly fatwaId: string;
  readonly firstRevisionId: string;
  readonly returnedRevisionId: string;
  readonly currentRevisionId: string;
  readonly firstPublicationId: string;
  readonly correctionPublicationId: string;
  readonly decisionId: string;
}

export interface Phase20References {
  /** The canonical Topic the category maps onto and the revisions list. */
  readonly topicId: string;
}

export function newPhase20Fixture(): Phase20Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    askerId: randomUUID(),
    otherAskerId: randomUUID(),
    triagerId: randomUUID(),
    answererId: randomUUID(),
    publisherId: randomUUID(),
    receiveRoleId: randomUUID(),
    answerRoleId: randomUUID(),
    publishRoleId: randomUUID(),
    sessionId: randomUUID(),
    stepUpGrantId: randomUUID(),
    categoryId: randomUUID(),
    questionId: randomUUID(),
    otherQuestionId: randomUUID(),
    fatwaId: randomUUID(),
    firstRevisionId: randomUUID(),
    returnedRevisionId: randomUUID(),
    currentRevisionId: randomUUID(),
    firstPublicationId: randomUUID(),
    correctionPublicationId: randomUUID(),
    decisionId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase20Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-20 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-20 fixture field '${name}' is not a generated identifier.`);
  }
}

function slugs(fixture: Phase20Fixture) {
  const stem = fixture.runId.slice(0, 16);
  return {
    category: `fixture-category-${stem}`,
    ruling: `fixture-ruling-${stem}`,
    stem,
  };
}

/**
 * Writes the populated Phase-20 state into the SOURCE database, before backup,
 * with the MIGRATION principal, in the order the workflow itself produces it,
 * so the real keys, CHECKs and triggers are exercised: every status carries its
 * facts, each revision's topics join it while it is pending, each publication
 * exists before the ruling points at it, every ruling update moves exactly one
 * version, and the address never changes after first publication.
 */
export async function writePhase20Fixture(
  sql: SqlSession,
  fixture: Phase20Fixture,
  references: Phase20References,
): Promise<void> {
  assertSafe(fixture);
  if (!/^[a-z0-9-]{1,36}$/i.test(references.topicId))
    throw new Error('Invalid synthetic Phase-20 fixture reference.');
  const f = fixture;
  const s = slugs(f);
  const { topicId } = references;
  const account = (id: string, role: string): string =>
    `(N'${id}', N'NON_FATWA_FIXTURE recovery ${role}', N'fatwa-${role}-${s.stem}@proof.invalid', 0, '2026-10-04T07:00:00', '2026-10-04T07:00:00', N'en', N'active', 0)`;
  const revision = (
    id: string,
    number: number,
    reason: string | null,
    at: string,
  ): string =>
    `INSERT INTO [dbo].[FatwaRevision] ([id],[fatwaId],[number],[title],[publicQuestion],[ruling],[language],[categoryId],[correctionReason],[authorId],[createdAt]) VALUES
       (N'${id}', N'${f.fatwaId}', ${String(number)}, N'NON_FATWA_FIXTURE title ${String(number)}', N'${TEXT.publicQuestion}', N'NON_FATWA_FIXTURE_RULING_${String(number)} synthetic ruling text', N'en', N'${f.categoryId}', ${reason === null ? 'NULL' : `N'${reason}'`}, N'${f.answererId}', '${at}');
     UPDATE [dbo].[Fatwa] SET [pendingRevisionId]=N'${id}', [reviewState]=N'drafting', [version]=[version]+1, [updatedAt]='${at}' WHERE [id]=N'${f.fatwaId}';
     INSERT INTO [dbo].[FatwaRevisionTopic] ([revisionId],[topicId]) VALUES (N'${id}', N'${topicId}');
     UPDATE [dbo].[Fatwa] SET [reviewState]=N'in_review', [version]=[version]+1, [updatedAt]='${at}' WHERE [id]=N'${f.fatwaId}';`;
  const publication = (
    id: string,
    revisionId: string,
    sequence: number,
    at: string,
  ): string =>
    `INSERT INTO [dbo].[FatwaPublication] ([id],[fatwaId],[revisionId],[sequence],[publisherId],[publisherPersonId],[authorPersonId],[stepUpGrantId],[publishedAt]) VALUES
       (N'${id}', N'${f.fatwaId}', N'${revisionId}', ${String(sequence)}, N'${f.publisherId}', NULL, NULL, N'${f.stepUpGrantId}', '${at}');
     UPDATE [dbo].[Fatwa] SET [publishedRevisionId]=N'${revisionId}', [pendingRevisionId]=NULL, [reviewState]=NULL,
       [firstPublishedAt]=ISNULL([firstPublishedAt], '${at}'), [version]=[version]+1, [updatedAt]='${at}' WHERE [id]=N'${f.fatwaId}';`;

  // ---- the operator's activation, the accounts and their authority ---------------
  await sql.query(`
    INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy],[reference],[activatedAt]) VALUES
      (1, N'fixture', N'${TEXT.operator}', NULL, '2026-10-04T07:00:00');
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
      ${account(f.askerId, 'asker')},
      ${account(f.otherAskerId, 'other-asker')},
      ${account(f.triagerId, 'triager')},
      ${account(f.answererId, 'answerer')},
      ${account(f.publisherId, 'publisher')};
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES
      (N'${f.receiveRoleId}', N'recovery-fatwa-receive-${s.stem}', N'NON_FATWA_FIXTURE triage role', N'Synthetic recovery role.', 0),
      (N'${f.answerRoleId}', N'recovery-fatwa-answer-${s.stem}', N'NON_FATWA_FIXTURE answer role', N'Synthetic recovery role.', 0),
      (N'${f.publishRoleId}', N'recovery-fatwa-publish-${s.stem}', N'NON_FATWA_FIXTURE publish role', N'Synthetic recovery role.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES
      (N'${f.receiveRoleId}', N'question.receive'),
      (N'${f.answerRoleId}', N'fatwa.answer'),
      (N'${f.publishRoleId}', N'fatwa.publish');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES
      (N'${f.triagerId}', N'${f.receiveRoleId}'),
      (N'${f.answererId}', N'${f.answerRoleId}'),
      (N'${f.publisherId}', N'${f.publishRoleId}');
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt]) VALUES
      (N'${f.sessionId}', N'recovery-fatwa-${f.sessionId}', N'${f.publisherId}', '2026-10-04T09:00:00', '2026-10-04T07:00:00', '2026-10-04T07:00:00');
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[createdAt],[expiresAt]) VALUES
      (N'${f.stepUpGrantId}', N'${f.publisherId}', N'${f.sessionId}', N'fatwa-publication', '2026-10-04T07:00:00', '2026-10-04T07:10:00');
  `);

  // ---- the category and the two private questions --------------------------------
  await sql.query(`
    INSERT INTO [dbo].[FatwaCategory] ([id],[slug],[topicId],[position],[status],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.categoryId}', N'${s.category}', N'${topicId}', 0, N'active', 1, '2026-10-04T07:00:00', '2026-10-04T07:00:00');
    INSERT INTO [dbo].[FatwaCategoryName] ([categoryId],[locale],[name]) VALUES
      (N'${f.categoryId}', N'en', N'NON_FATWA_FIXTURE category'),
      (N'${f.categoryId}', N'ur', N'NON_FATWA_FIXTURE category ur'),
      (N'${f.categoryId}', N'ar', N'NON_FATWA_FIXTURE category ar');
    INSERT INTO [dbo].[FatwaQuestion] ([id],[askerId],[body],[status],[categoryId],[assigneeId],[triagedById],[triagedAt],[assignedById],[assignedAt],[answeredAt],[version],[submittedAt],[updatedAt]) VALUES
      (N'${f.questionId}', N'${f.askerId}', N'${TEXT.question}', N'answered', N'${f.categoryId}', N'${f.answererId}', N'${f.triagerId}', '2026-10-04T07:10:00', N'${f.triagerId}', '2026-10-04T07:20:00', '2026-10-04T08:00:00', 4, '2026-10-04T07:05:00', '2026-10-04T08:00:00');
    INSERT INTO [dbo].[FatwaQuestion] ([id],[askerId],[body],[status],[version],[submittedAt],[updatedAt]) VALUES
      (N'${f.otherQuestionId}', N'${f.otherAskerId}', N'${TEXT.other}', N'submitted', 1, '2026-10-04T07:06:00', '2026-10-04T07:06:00');
  `);

  // ---- the ruling: published, a correction returned, the revised one published ----
  await sql.query(`
    INSERT INTO [dbo].[Fatwa] ([id],[questionId],[slug],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.fatwaId}', N'${f.questionId}', N'${s.ruling}', 1, '2026-10-04T07:30:00', '2026-10-04T07:30:00');
    ${revision(f.firstRevisionId, 1, null, '2026-10-04T07:30:00')}
    ${publication(f.firstPublicationId, f.firstRevisionId, 1, '2026-10-04T08:00:00')}
    ${revision(f.returnedRevisionId, 2, TEXT.reason, '2026-10-04T09:00:00')}
    INSERT INTO [dbo].[FatwaReviewDecision] ([id],[fatwaId],[revisionId],[decision],[note],[actorId],[stepUpGrantId],[decidedAt]) VALUES
      (N'${f.decisionId}', N'${f.fatwaId}', N'${f.returnedRevisionId}', N'returned', N'${TEXT.note}', N'${f.publisherId}', NULL, '2026-10-04T09:10:00');
    UPDATE [dbo].[Fatwa] SET [reviewState]=N'returned', [version]=[version]+1, [updatedAt]='2026-10-04T09:10:00' WHERE [id]=N'${f.fatwaId}';
    ${revision(f.currentRevisionId, 3, TEXT.reason, '2026-10-04T09:30:00')}
    ${publication(f.correctionPublicationId, f.currentRevisionId, 2, '2026-10-04T10:00:00')}
    INSERT INTO [dbo].[FatwaReadTally] ([fatwaId],[day],[reads]) VALUES
      (N'${f.fatwaId}', '2026-10-04', 5),
      (N'${f.fatwaId}', '2026-10-05', 2);
    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'fatwa', N'${f.fatwaId}');
  `);
}

/** Every authoritative Phase-20 row this fixture wrote, in a stable order. */
export async function capturePhase20Fixture(
  sql: SqlSession,
  fixture: Phase20Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    ['FatwaActivation', 'SELECT * FROM [dbo].[FatwaActivation]', 1],
    [
      'FatwaCategory',
      `SELECT * FROM [dbo].[FatwaCategory] WHERE [id]=N'${f.categoryId}'`,
      1,
    ],
    [
      'FatwaCategoryName',
      `SELECT * FROM [dbo].[FatwaCategoryName] WHERE [categoryId]=N'${f.categoryId}' ORDER BY [locale]`,
      3,
    ],
    [
      'FatwaQuestion',
      `SELECT * FROM [dbo].[FatwaQuestion] WHERE [id] IN (N'${f.questionId}',N'${f.otherQuestionId}') ORDER BY [submittedAt]`,
      2,
    ],
    ['Fatwa', `SELECT * FROM [dbo].[Fatwa] WHERE [id]=N'${f.fatwaId}'`, 1],
    [
      'FatwaRevision',
      `SELECT * FROM [dbo].[FatwaRevision] WHERE [fatwaId]=N'${f.fatwaId}' ORDER BY [number]`,
      3,
    ],
    [
      'FatwaRevisionTopic',
      `SELECT t.* FROM [dbo].[FatwaRevisionTopic] t JOIN [dbo].[FatwaRevision] r ON r.[id]=t.[revisionId] WHERE r.[fatwaId]=N'${f.fatwaId}' ORDER BY r.[number]`,
      3,
    ],
    [
      'FatwaPublication',
      `SELECT * FROM [dbo].[FatwaPublication] WHERE [fatwaId]=N'${f.fatwaId}' ORDER BY [sequence]`,
      2,
    ],
    [
      'FatwaReviewDecision',
      `SELECT * FROM [dbo].[FatwaReviewDecision] WHERE [fatwaId]=N'${f.fatwaId}'`,
      1,
    ],
    [
      'FatwaReadTally',
      `SELECT * FROM [dbo].[FatwaReadTally] WHERE [fatwaId]=N'${f.fatwaId}' ORDER BY [day]`,
      2,
    ],
    [
      'FatwaSearchIntent',
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'fatwa'`,
      1,
    ],
    [
      'FatwaAuthority',
      `SELECT r.[id], r.[key], rp.[permissionKey], ra.[userId], ra.[revokedAt]
         FROM [dbo].[Role] r JOIN [dbo].[RolePermission] rp ON rp.[roleId]=r.[id]
         JOIN [dbo].[RoleAssignment] ra ON ra.[roleId]=r.[id]
        WHERE r.[id] IN (N'${f.receiveRoleId}',N'${f.answerRoleId}',N'${f.publishRoleId}') ORDER BY rp.[permissionKey]`,
      3,
    ],
    [
      'FatwaStepUpGrant',
      `SELECT * FROM [dbo].[StepUpGrant] WHERE [id]=N'${f.stepUpGrantId}'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-20 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-20 tables whose constraints and triggers must return intact. */
const PHASE20_TABLES = [
  'FatwaActivation',
  'FatwaCategory',
  'FatwaCategoryName',
  'FatwaQuestion',
  'Fatwa',
  'FatwaRevision',
  'FatwaRevisionTopic',
  'FatwaPublication',
  'FatwaReviewDecision',
  'FatwaReadTally',
] as const;

const PROCEDURES = [
  'FatwaAssertPermission',
  'FatwaAssertPublicationAuthority',
  'FatwaSubmitQuestion',
  'FatwaTriageQuestion',
  'FatwaAssignQuestion',
  'FatwaDeclineQuestion',
  'FatwaSaveDraft',
  'FatwaSubmitForReview',
  'FatwaReturnForRevision',
  'FatwaPublishRevision',
  'FatwaWithdraw',
  'FatwaDisposeQuestions',
  'FatwaRecordRead',
] as const;

/**
 * Verifies the restored Fatwa state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: every question, ruling, reason and note is still an
 * unmistakable sentinel and the activation still `fixture`; each asker's
 * owner-scoped read still returns exactly that asker's question; the ruling
 * is public now, its current revision is the one its LAST publication
 * published, the correction history reads first-then-corrected in sequence with
 * the returned revision between them and its private decision intact; every
 * typed relationship still resolves through a real join; the `fatwa` intent is
 * owed; the publisher's grant is still the `fatwa-publication` purpose of the
 * publisher's own session; the protected bundle still holds no gated key; the
 * eight triggers are enabled, every Phase-20 CHECK and foreign key enabled,
 * trusted and non-cascading, and the thirteen procedures are back.
 */
export async function verifyRestoredPhase20(
  sql: SqlSession,
  fixture: Phase20Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase20References,
): Promise<string> {
  deepStrictEqual(
    await capturePhase20Fixture(sql, fixture),
    expected,
    'Phase-20 Fatwa authoritative values changed during recovery.',
  );
  const f = fixture;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[FatwaQuestion] WHERE [body] NOT LIKE N'NON[_]FATWA[_]FIXTURE[_]QUESTION[_]%') AS [questions],
      (SELECT COUNT(*) FROM [dbo].[FatwaRevision] WHERE [title] NOT LIKE N'NON[_]FATWA[_]FIXTURE%'
         OR [publicQuestion] NOT LIKE N'NON[_]FATWA[_]FIXTURE[_]%' OR [ruling] NOT LIKE N'NON[_]FATWA[_]FIXTURE[_]RULING[_]%'
         OR ISNULL([correctionReason], N'NON_FATWA_FIXTURE') NOT LIKE N'NON[_]FATWA[_]FIXTURE%') AS [revisions],
      (SELECT COUNT(*) FROM [dbo].[FatwaReviewDecision] WHERE [note] NOT LIKE N'NON[_]FATWA[_]FIXTURE%') AS [decisions],
      (SELECT COUNT(*) FROM [dbo].[FatwaCategoryName] WHERE [name] NOT LIKE N'NON[_]FATWA[_]FIXTURE%') AS [names],
      (SELECT COUNT(*) FROM [dbo].[FatwaActivation] WHERE [authority]=N'fixture' AND [authorisedBy] LIKE N'NON[_]FATWA[_]FIXTURE%') AS [fixtureMode];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"questions":0,"revisions":0,"decisions":0,"names":0,"fixtureMode":1}'
  ) {
    throw new Error(
      `Restored Phase-20 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Owner isolation, current revision, correction history and intent, through
  // the same predicates the readers use.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([id], N',') FROM [dbo].[FatwaQuestion] WHERE [askerId]=N'${f.askerId}') AS [own],
      (SELECT STRING_AGG([id], N',') FROM [dbo].[FatwaQuestion] WHERE [askerId]=N'${f.otherAskerId}') AS [other],
      (SELECT COUNT(*) FROM [dbo].[Fatwa] x
         WHERE x.[id]=N'${f.fatwaId}' AND EXISTS (SELECT 1 FROM [dbo].[FatwaActivation])
           AND x.[publishedRevisionId] IS NOT NULL AND x.[withdrawnAt] IS NULL) AS [publicNow],
      (SELECT p.[revisionId] FROM [dbo].[FatwaPublication] p JOIN [dbo].[Fatwa] x ON x.[id]=p.[fatwaId]
         WHERE x.[id]=N'${f.fatwaId}' AND x.[publishedRevisionId]=p.[revisionId]
           AND p.[sequence]=(SELECT MAX([sequence]) FROM [dbo].[FatwaPublication] WHERE [fatwaId]=x.[id])) AS [current],
      (SELECT STRING_AGG(p.[revisionId], N',') WITHIN GROUP (ORDER BY p.[sequence])
         FROM [dbo].[FatwaPublication] p JOIN [dbo].[FatwaRevision] r ON r.[id]=p.[revisionId] AND r.[fatwaId]=p.[fatwaId]
        WHERE p.[fatwaId]=N'${f.fatwaId}') AS [published],
      (SELECT STRING_AGG(CONVERT(NVARCHAR(8), r.[number]) + N':' + CASE WHEN r.[correctionReason] IS NULL THEN N'first' ELSE N'correction' END, N',')
         WITHIN GROUP (ORDER BY r.[number]) FROM [dbo].[FatwaRevision] r WHERE r.[fatwaId]=N'${f.fatwaId}') AS [history],
      (SELECT d.[revisionId] FROM [dbo].[FatwaReviewDecision] d
         JOIN [dbo].[FatwaRevision] r ON r.[id]=d.[revisionId] AND r.[fatwaId]=d.[fatwaId]
        WHERE d.[fatwaId]=N'${f.fatwaId}' AND d.[decision]=N'returned') AS [returned],
      (SELECT COUNT(*) FROM [dbo].[FatwaRevisionTopic] t JOIN [dbo].[Topic] o ON o.[id]=t.[topicId]
         JOIN [dbo].[FatwaRevision] r ON r.[id]=t.[revisionId]
        WHERE r.[fatwaId]=N'${f.fatwaId}' AND o.[id]=N'${references.topicId}') AS [topics],
      (SELECT COUNT(*) FROM [dbo].[FatwaCategory] c JOIN [dbo].[Topic] o ON o.[id]=c.[topicId]
        WHERE c.[id]=N'${f.categoryId}' AND o.[id]=N'${references.topicId}') AS [mapped],
      (SELECT SUM([reads]) FROM [dbo].[FatwaReadTally] WHERE [fatwaId]=N'${f.fatwaId}') AS [reads],
      (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] q JOIN [dbo].[Fatwa] x ON x.[id]=q.[scopeId]
        WHERE q.[scopeKind]=N'fatwa') AS [intent],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] g
         JOIN [dbo].[Session] s ON s.[id]=g.[sessionId] AND s.[userId]=g.[userId]
         JOIN [dbo].[RoleAssignment] ra ON ra.[userId]=g.[userId] AND ra.[revokedAt] IS NULL
         JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] AND rp.[permissionKey]=N'fatwa.publish'
        WHERE g.[id]=N'${f.stepUpGrantId}' AND g.[purpose]=N'fatwa-publication') AS [authority],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id]=rp.[roleId]
        WHERE r.[key]=N'platform-administrator'
          AND rp.[permissionKey] IN (N'question.receive', N'fatwa.answer', N'fatwa.publish')) AS [gatedBundled];
  `);
  const expectedState = {
    own: f.questionId,
    other: f.otherQuestionId,
    publicNow: 1,
    current: f.currentRevisionId,
    published: `${f.firstRevisionId},${f.currentRevisionId}`,
    history: '1:first,2:correction,3:correction',
    returned: f.returnedRevisionId,
    topics: 3,
    mapped: 1,
    reads: 7,
    intent: 1,
    authority: 1,
    gatedBundled: 0,
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-20 workflow state is broken: ${JSON.stringify(state)}.`,
    );
  }

  const tables = PHASE20_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
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
      `Restored Phase-20 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: number;
    procedures: number;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT COUNT_BIG(*) FROM sys.triggers WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.procedures WHERE [name] IN (${PROCEDURES.map((name) => `N'${name}'`).join(',')})) AS [procedures];`,
  );
  // 14 CHECKs, 24 foreign keys and 8 triggers, exactly as the migration creates
  // them: a restore that silently lost one would otherwise read as "none
  // untrusted".
  if (
    Number(counts?.checks ?? 0) !== 14 ||
    Number(counts?.keys ?? 0) !== 24 ||
    Number(counts?.triggers ?? 0) !== 8 ||
    Number(counts?.procedures ?? 0) !== PROCEDURES.length
  ) {
    throw new Error(
      `Restored Phase-20 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'fixture-mode service, owner-scoped private questions, a first publication and a returned then published correction in sequence, revision topics, category mapped to its Topic, read tally, search intent and the gated publisher authority intact, no gated key bundled';
}
