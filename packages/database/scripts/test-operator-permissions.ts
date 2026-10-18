import 'server-only';

import { randomUUID } from 'node:crypto';

import { EXTERNALLY_GATED_PERMISSIONS } from '@minhaj/contracts/identity';

import {
  getApplicationPrincipalCredentials,
  getOperatorPrincipalCredentials,
} from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../src/lifecycle/disposable-database.ts';
import { deployMigrations, loadMigrations } from '../src/lifecycle/migrations.ts';
import {
  OPERATOR_PROCEDURES,
  OPERATOR_ROLE,
  provisionOperatorPrincipal,
} from '../src/lifecycle/operator-principal.ts';
import { inspectPrincipalAuthority } from '../src/lifecycle/principal-authority.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../src/lifecycle/sql-connection.ts';
import {
  reportConfiguration,
  retargetAtDisposable,
  startLocalCommand,
} from './local-bootstrap.ts';

/**
 * `npm run db:test:operator` — proves the HOST-ONLY privileged boundary with
 * the actual principals, against a disposable database.
 *
 * ## What this proof has to establish, and why each half is needed
 *
 * POSITIVE: the operator can run the two audited procedures, and they do what
 * SECURITY_BASELINE.md §8.3 says — one-time, race-safe, audited, refusing an
 * ineligible target, and never granting a role during recovery.
 *
 * NEGATIVE: the operator can do NOTHING ELSE, and the application principal
 * cannot run them at all. A bootstrap the web process could execute would be
 * the open setup endpoint the baseline forbids, wearing a different hat.
 *
 * Both halves matter. An operator that could also SELECT from `User` would
 * satisfy the positive half completely while holding authority nobody granted
 * it, and the permission system would record that as normal.
 */

/**
 * Error numbers SQL Server raises when it refuses a statement for permissions.
 *
 * Identical to the runtime proof's set, and for the same reason: a test that
 * accepted any failure would pass on a typo. 229/230/262 are direct refusals;
 * 300 is `EXECUTE permission was denied`.
 */
const PERMISSION_DENIED = new Set([229, 230, 262, 300, 1088, 3701]);

/** The procedures' own THROW numbers, from the migration. */
const BOOTSTRAP_ALREADY_DONE = 51001;
const BOOTSTRAP_INELIGIBLE_TARGET = 51003;
const RECOVERY_NOT_AN_ADMINISTRATOR = 51012;

interface SqlError extends Error {
  number?: number;
}

function errorNumber(error: unknown): number | undefined {
  return (error as SqlError | undefined)?.number;
}

let failures = 0;

function pass(label: string, detail: string): void {
  process.stdout.write(`  PASS  ${label.padEnd(44)} ${detail}\n`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  process.stdout.write(`  FAIL  ${label.padEnd(44)} ${detail}\n`);
}

/** Asserts a statement is refused BY THE PERMISSION SYSTEM, not by anything else. */
async function expectDenied(
  session: SqlSession,
  label: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const number = errorNumber(error);
    if (number !== undefined && PERMISSION_DENIED.has(number)) {
      pass(label, `denied, SQL Server error ${number}`);
      return;
    }
    fail(
      label,
      `rejected for the WRONG reason (error ${number ?? 'unknown'}): ` +
        `${(error as Error).message.split('\n')[0]}`,
    );
    return;
  }
  fail(label, 'statement SUCCEEDED but must be denied');
}

/** Asserts a PROCEDURE refused for its own documented reason, not a permission one. */
async function expectRefusedBy(
  label: string,
  expected: number,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const number = errorNumber(error);
    if (number === expected) {
      pass(label, `refused by the procedure, error ${number}`);
      return;
    }
    fail(label, `expected procedure error ${expected}, got ${number ?? 'unknown'}`);
    return;
  }
  fail(label, 'the procedure SUCCEEDED but must refuse');
}

async function expectAllowed(
  label: string,
  detail: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
    pass(label, detail);
  } catch (error) {
    fail(
      label,
      `should be permitted but failed: ${(error as Error).message.split('\n')[0]}`,
    );
  }
}

/** A synthetic account. `.invalid` is reserved and can never resolve. */
async function createAccount(
  admin: SqlSession,
  options: { verified: boolean; status: string },
): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [status], [locale], [createdAt], [updatedAt])
    VALUES
      (N'${id}', N'Operator Proof', N'operator-proof-${id}@proof.invalid',
       ${options.verified ? 1 : 0}, N'${options.status}', N'en',
       SYSUTCDATETIME(), SYSUTCDATETIME());
  `);
  return id;
}

async function scalar(session: SqlSession, statement: string): Promise<number> {
  const [row] = await session.query<{ total: number }>(statement);
  return Number(row?.total ?? 0);
}

const command = startLocalCommand('migration-target');
const migrationConnection = command.connection;
const environment = command.environment;
const application = getApplicationPrincipalCredentials(environment.values);
const operator = getOperatorPrincipalCredentials(environment.values);
const databaseName = newDisposableDatabaseName();

const { url: disposableUrl } = retargetAtDisposable(command, databaseName);

const master = await openMasterSession(migrationConnection);
let admin: SqlSession | undefined;
let app: SqlSession | undefined;
let host: SqlSession | undefined;
let second: SqlSession | undefined;

process.stdout.write(`Privileged operator proof on ${databaseName}\n`);
reportConfiguration(command, 44);

try {
  await createDisposableDatabase(master, databaseName);
  admin = await openSession(withDatabase(migrationConnection, databaseName));

  if ((await loadMigrations()).length === 0) {
    throw new Error('No migrations to test against.');
  }

  await deployMigrations(disposableUrl, environment.values);
  await provisionApplicationPrincipal(
    admin,
    application.DATABASE_APP_LOGIN,
    application.DATABASE_APP_PASSWORD,
  );
  await provisionOperatorPrincipal(
    admin,
    operator.DATABASE_OPERATOR_LOGIN,
    operator.DATABASE_OPERATOR_PASSWORD,
  );

  // ---- the migration's own foundation data ---------------------------------
  //
  // The protected bundle is every catalogued key EXCEPT the externally gated
  // ones: whoever triages, answers and publishes Fatwa is the organisation's
  // decision (OPEN_DECISIONS.md §1.4, §6.3), so those keys are catalogued and
  // bundled into no role. Both halves are asserted — every ordinary key
  // bundled, and not one gated key bundled or granted to anybody.
  const gated = EXTERNALLY_GATED_PERMISSIONS.map((key) => `N'${key}'`).join(', ');
  const seededPermissions = await scalar(
    admin,
    'SELECT COUNT_BIG(*) AS total FROM [dbo].[Permission];',
  );
  const seededGated = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Permission] WHERE [key] IN (${gated});`,
  );
  const seededBundle = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[RolePermission] rp
     JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
     WHERE r.[key] = N'platform-administrator';`,
  );
  const gatedHeld = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${gated});`,
  );
  if (
    seededPermissions === 0 ||
    seededGated !== EXTERNALLY_GATED_PERMISSIONS.length ||
    seededBundle !== seededPermissions - seededGated ||
    gatedHeld !== 0
  ) {
    fail(
      'protected role is migration-seeded',
      `${seededPermissions} permissions (${seededGated} externally gated), ` +
        `${seededBundle} bundled, ${gatedHeld} gated grants`,
    );
  } else {
    pass(
      'protected role is migration-seeded',
      `${seededPermissions} permissions; all but the ${seededGated} externally gated ` +
        `bundled, and no role holds a gated key`,
    );
  }

  // ---- the operator's EFFECTIVE authority ----------------------------------
  //
  // Bound to a local as well as to the outer `finally` handle: the outer one is
  // `SqlSession | undefined` for cleanup, and every use below needs a value the
  // type system knows is present rather than an assertion that it is.
  const operatorSession = await openSession({
    ...withDatabase(migrationConnection, databaseName),
    user: operator.DATABASE_OPERATOR_LOGIN,
    password: operator.DATABASE_OPERATOR_PASSWORD,
  });
  host = operatorSession;

  const authority = await inspectPrincipalAuthority(operatorSession);

  if (authority.broadRoles.length > 0) {
    fail('operator holds no broad database role', authority.broadRoles.join(', '));
  } else if (!authority.roles.includes(OPERATOR_ROLE)) {
    fail(
      'operator holds no broad database role',
      `expected membership of ${OPERATOR_ROLE}; roles: ${authority.roles.join(', ') || '(none)'}`,
    );
  } else {
    pass(
      'operator holds no broad database role',
      `${OPERATOR_ROLE} only; db_datareader/db_datawriter and the administrative roles absent`,
    );
  }

  const heldDatabase = authority.databasePermissions
    .filter((entry) => entry.held)
    .map((entry) => entry.permission);
  if (heldDatabase.length > 0) {
    fail(
      'operator holds no database-scope rights',
      `effective: ${heldDatabase.join(', ')}`,
    );
  } else {
    pass(
      'operator holds no database-scope rights',
      `${authority.databasePermissions.length} probes, none effective`,
    );
  }

  const heldSchema = authority.schemaPermissions
    .filter((entry) => entry.held)
    .map((entry) => entry.permission);
  if (heldSchema.length > 0) {
    fail('operator holds no dbo-schema rights', `effective: ${heldSchema.join(', ')}`);
  } else {
    pass(
      'operator holds no dbo-schema rights',
      `${authority.schemaPermissions.length} probes, none effective`,
    );
  }

  // ---- no general table access ---------------------------------------------
  //
  // The sharpest negative case. The procedures below WILL read and write every
  // one of these tables on the operator's behalf, through ownership chaining —
  // so proving the operator cannot touch them directly is what shows the
  // chaining is the whole of its authority rather than a convenience on top of
  // rights it already had.
  for (const table of [
    'User',
    'Session',
    'RoleAssignment',
    'TwoFactor',
    'PrivilegedSecurityPosture',
    'AuditLog',
  ]) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }

  // Phase 18 gives the operator ROLE nothing over the Quran: registering a
  // source and activating a corpus are acts of the database OWNER, and the
  // canonical write path is the runtime's, under the live canonical authority.
  // A recovery principal that could read or write either would be a second,
  // unaudited route to the canonical text.
  for (const table of ['QuranSource', 'QuranSourceAyah', 'QuranActivation', 'Ayah']) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }
  await expectDenied(operatorSession, 'operator INSERT on QuranActivation denied', () =>
    operatorSession.query(`
      INSERT INTO [dbo].[QuranActivation] ([id], [sourceId], [authorisedBy])
      VALUES (1, N'injected', N'injected');
    `),
  );
  await expectDenied(
    operatorSession,
    'operator EXECUTE on QuranAcceptCorpus denied',
    () =>
      operatorSession.query(`
      EXEC [dbo].[QuranAcceptCorpus] @runId=N'injected', @sourceId=N'injected',
        @candidate=N'[]', @actorId=N'injected', @sessionId=N'injected',
        @stepUpGrantId=N'injected', @at='2026-10-02T00:00:00';
    `),
  );

  // Phase 19 gives the operator ROLE nothing over Hadith either: registering a
  // source system or edition and activating a collection are the OWNER's acts,
  // and records, gradings, verifications and citations are written only by the
  // runtime's canonical procedures under the live canonical authority.
  for (const table of [
    'HadithSourceSystem',
    'HadithEdition',
    'HadithActivation',
    'Hadith',
    'HadithRevision',
    'HadithGrading',
    'HadithVerification',
    'HadithCitation',
    'HadithConflict',
  ]) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }
  await expectDenied(operatorSession, 'operator INSERT on HadithActivation denied', () =>
    operatorSession.query(`
      INSERT INTO [dbo].[HadithActivation] ([collectionId], [authority], [authorisedBy])
      VALUES (N'injected', N'approved', N'injected');
    `),
  );
  await expectDenied(
    operatorSession,
    'operator INSERT on HadithSourceSystem denied',
    () =>
      operatorSession.query(`
      INSERT INTO [dbo].[HadithSourceSystem] ([id], [code], [authority], [title], [version], [encoding], [reference])
      VALUES (N'injected', N'injected', N'approved', N'injected', N'injected', N'utf-8', N'injected');
    `),
  );
  await expectDenied(operatorSession, 'operator UPDATE on Hadith denied', () =>
    operatorSession.query(`UPDATE [dbo].[Hadith] SET [text] = [text];`),
  );
  await expectDenied(
    operatorSession,
    'operator EXECUTE on HadithWriteRecord denied',
    () =>
      operatorSession.query(`
      EXEC [dbo].[HadithWriteRecord] @hadithId=N'injected', @editionId=N'injected',
        @expectedVersion=0, @sourceReference=N'injected', @citationNumber=NULL,
        @bookId=N'injected', @chapterId=NULL, @text=N'injected', @textLanguage=N'ar',
        @chain=NULL, @chainLanguage=NULL, @gradings=N'[]', @evidence=N'injected',
        @reason=NULL, @actorId=N'injected', @sessionId=N'injected',
        @stepUpGrantId=N'injected', @at='2026-10-03T00:00:00';
    `),
  );
  await expectDenied(
    operatorSession,
    'operator EXECUTE on HadithSetCitation denied',
    () =>
      operatorSession.query(`
      EXEC [dbo].[HadithSetCitation] @id=N'injected', @collectionId=N'injected', @number=1,
        @hadithId=N'injected', @state=N'mapped', @expectedVersion=0, @evidence=N'injected',
        @reason=NULL, @actorId=N'injected', @sessionId=N'injected',
        @stepUpGrantId=N'injected', @at='2026-10-03T00:00:00';
    `),
  );

  // Phase 20 gives the operator ROLE nothing over Fatwa: activating the service
  // is the OWNER's act, a private question is readable only through the
  // runtime's stage-scoped queries, and every workflow change is written by the
  // runtime's procedures under a live permission re-checked in SQL.
  for (const table of [
    'FatwaActivation',
    'FatwaCategory',
    'FatwaQuestion',
    'Fatwa',
    'FatwaRevision',
    'FatwaPublication',
    'FatwaReviewDecision',
    'FatwaReadTally',
  ]) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }
  await expectDenied(operatorSession, 'operator INSERT on FatwaActivation denied', () =>
    operatorSession.query(`
      INSERT INTO [dbo].[FatwaActivation] ([id], [authority], [authorisedBy], [reference])
      VALUES (1, N'approved', N'injected', N'injected');
    `),
  );
  await expectDenied(operatorSession, 'operator UPDATE on Fatwa denied', () =>
    operatorSession.query(`UPDATE [dbo].[Fatwa] SET [slug] = [slug];`),
  );
  await expectDenied(
    operatorSession,
    'operator EXECUTE on FatwaPublishRevision denied',
    () =>
      operatorSession.query(`
      EXEC [dbo].[FatwaPublishRevision] @fatwaId=N'injected', @expectedVersion=1,
        @revisionId=N'injected', @publicationId=N'injected', @actorId=N'injected',
        @sessionId=N'injected', @stepUpGrantId=N'injected', @at='2026-10-04T00:00:00';
    `),
  );
  await expectDenied(
    operatorSession,
    'operator EXECUTE on FatwaDisposeQuestions denied',
    () =>
      operatorSession.query(`
      EXEC [dbo].[FatwaDisposeQuestions] @askerId=NULL, @limit=1, @at='2026-10-04T00:00:00';
    `),
  );
  await expectDenied(
    operatorSession,
    'operator EXECUTE on FatwaAssertPermission denied',
    () =>
      operatorSession.query(`
      EXEC [dbo].[FatwaAssertPermission] @actorId=N'injected', @permission=N'fatwa.publish';
    `),
  );

  // Phase 21 gives the operator ROLE nothing over Personalisation: a person's
  // saved items, notes, history and notifications are read and written only by
  // the runtime on that person's own behalf, and a newsletter subscription and
  // its consent evidence only through the runtime's newsletter operations — so
  // the operator can neither read an address nor rewrite what was agreed.
  for (const table of [
    'PersonalisationProfile',
    'PersonalisationInterest',
    'PersonalisationGoal',
    'SavedItem',
    'Bookmark',
    'Note',
    'PrivateCollection',
    'PrivateCollectionItem',
    'ReadingHistory',
    'WatchHistory',
    'QuranReadingProgress',
    'NotificationPreference',
    'Notification',
    'NewsletterSubscriber',
    'NewsletterConsentEvent',
  ]) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }
  await expectDenied(operatorSession, 'operator INSERT on Notification denied', () =>
    operatorSession.query(`
      INSERT INTO [dbo].[Notification] ([id], [userId], [kind], [category], [destination],
        [idempotencyKey], [createdAt])
      VALUES (N'injected', N'injected', N'question-answered', N'questions', NULL,
        N'injected', SYSUTCDATETIME());
    `),
  );
  await expectDenied(
    operatorSession,
    'operator UPDATE on NewsletterSubscriber denied',
    () =>
      operatorSession.query(
        `UPDATE [dbo].[NewsletterSubscriber] SET [state] = N'suppressed';`,
      ),
  );
  await expectDenied(operatorSession, 'operator DELETE on SavedItem denied', () =>
    operatorSession.query(`DELETE FROM [dbo].[SavedItem];`),
  );
  await expectDenied(
    operatorSession,
    'operator DELETE on NewsletterConsentEvent denied',
    () => operatorSession.query(`DELETE FROM [dbo].[NewsletterConsentEvent];`),
  );

  // Phase 22 gives the operator ROLE nothing over Learning: the catalogue is
  // administered only through the runtime under `learning.administer`, and a
  // person's enrolments, progress and trial requests are read and written only
  // by the runtime on that person's own behalf — so the operator can neither
  // publish a Course, free a reserved slug nor read who is learning what.
  for (const table of [
    'Course',
    'CourseLabel',
    'CourseSlugHistory',
    'CourseTopic',
    'CourseTeacher',
    'CourseModule',
    'CourseModuleLabel',
    'Lesson',
    'LessonLabel',
    'LearningPath',
    'LearningPathLabel',
    'LearningPathSlugHistory',
    'LearningPathCourse',
    'Enrolment',
    'LessonProgress',
    'TrialClassRequest',
  ]) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }
  await expectDenied(operatorSession, 'operator INSERT on Enrolment denied', () =>
    operatorSession.query(`
      INSERT INTO [dbo].[Enrolment] ([userId], [courseId], [enrolledAt])
      VALUES (N'injected', N'injected', SYSUTCDATETIME());
    `),
  );
  await expectDenied(operatorSession, 'operator UPDATE on Course denied', () =>
    operatorSession.query(`UPDATE [dbo].[Course] SET [state] = N'published';`),
  );
  await expectDenied(operatorSession, 'operator DELETE on CourseSlugHistory denied', () =>
    operatorSession.query(`DELETE FROM [dbo].[CourseSlugHistory];`),
  );
  await expectDenied(operatorSession, 'operator DELETE on LessonProgress denied', () =>
    operatorSession.query(`DELETE FROM [dbo].[LessonProgress];`),
  );
  await expectDenied(operatorSession, 'operator INSERT on TrialClassRequest denied', () =>
    operatorSession.query(`
      INSERT INTO [dbo].[TrialClassRequest] ([id], [userId], [courseId], [requestedAt])
      VALUES (N'injected', N'injected', N'injected', SYSUTCDATETIME());
    `),
  );

  // Phase 23 gives the operator ROLE nothing over live classes either: the
  // activation is the owner's own migration-level act, scopes and sessions are
  // administered only through the runtime under `learning.classes.administer`,
  // and a Booking, a mark, a window and an intent are an account's own — so
  // the operator can neither switch live learning on, scope a teacher, nor read
  // a meeting address or who is booked with whom.
  for (const table of [
    'LiveLearningActivation',
    'CourseTeachingAssignment',
    'Availability',
    'ClassSession',
    'Booking',
    'Attendance',
    'ClassCommunicationIntent',
  ]) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }
  await expectDenied(
    operatorSession,
    'operator INSERT on LiveLearningActivation denied',
    () =>
      operatorSession.query(`
      INSERT INTO [dbo].[LiveLearningActivation] ([id], [authority], [authorisedBy], [reference])
      VALUES (1, N'approved', N'injected', N'urn:example:injected');
    `),
  );
  await expectDenied(
    operatorSession,
    'operator INSERT on CourseTeachingAssignment denied',
    () =>
      operatorSession.query(`
      INSERT INTO [dbo].[CourseTeachingAssignment] ([id], [courseId], [userId], [roleAssignmentId], [grantedAt])
      VALUES (N'injected', N'injected', N'injected', N'injected', SYSUTCDATETIME());
    `),
  );
  await expectDenied(operatorSession, 'operator UPDATE on ClassSession denied', () =>
    operatorSession.query(`UPDATE [dbo].[ClassSession] SET [meetingUrl] = NULL;`),
  );
  await expectDenied(operatorSession, 'operator DELETE on Booking denied', () =>
    operatorSession.query(`DELETE FROM [dbo].[Booking];`),
  );

  // Phase 24 gives the operator ROLE nothing over Messaging: the activation is
  // the owner's own migration-level act, a conversation's messages are read
  // only by the Messaging service on a current relationship, and support and
  // moderation are runtime authority under the externally gated keys — so the
  // operator can neither switch messaging on, read a message, a report or who
  // talks to whom, nor withhold, decide or erase anything.
  for (const table of [
    'MessagingActivation',
    'Conversation',
    'ConversationParticipant',
    'Message',
    'MessageAttachment',
    'MessageReadState',
    'MessagingBlock',
    'MessagingReport',
    'MessagingModerationDecision',
  ]) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
  }
  await expectDenied(
    operatorSession,
    'operator INSERT on MessagingActivation denied',
    () =>
      operatorSession.query(`
      INSERT INTO [dbo].[MessagingActivation] ([capability], [authority], [authorisedBy], [reference])
      VALUES (N'support', N'approved', N'injected', N'urn:example:injected');
    `),
  );
  await expectDenied(operatorSession, 'operator UPDATE on Message denied', () =>
    operatorSession.query(`UPDATE [dbo].[Message] SET [moderation] = N'withheld';`),
  );
  await expectDenied(operatorSession, 'operator DELETE on Message denied', () =>
    operatorSession.query(`DELETE FROM [dbo].[Message];`),
  );
  await expectDenied(
    operatorSession,
    'operator INSERT on MessagingModerationDecision denied',
    () =>
      operatorSession.query(`
      INSERT INTO [dbo].[MessagingModerationDecision] ([id], [reportId], [moderatorUserId], [action])
      VALUES (N'injected', N'injected', N'injected', N'dismiss');
    `),
  );
  await expectDenied(operatorSession, 'operator DELETE on MessagingReport denied', () =>
    operatorSession.query(`DELETE FROM [dbo].[MessagingReport];`),
  );

  // Phase 26 gives the operator ROLE nothing over Membership: types are
  // administered, and applications decided, only through the runtime under
  // `membership.administer`, and an application, a Membership and the mail
  // owed about them are an account's own — so the operator can neither read
  // who applied or belongs, nor approve, close, publish or erase anything.
  const membershipProbes: Readonly<Record<string, readonly [string, string, string]>> = {
    MembershipType: [
      `INSERT INTO [dbo].[MembershipType] ([id], [primaryLocale], [displayOrder]) VALUES (N'injected', N'en', 0);`,
      `UPDATE [dbo].[MembershipType] SET [state] = N'published';`,
      `DELETE FROM [dbo].[MembershipType];`,
    ],
    MembershipTypeTranslation: [
      `INSERT INTO [dbo].[MembershipTypeTranslation] ([membershipTypeId], [locale], [title], [summary], [description]) VALUES (N'injected', N'en', N'injected', N'injected', N'injected');`,
      `UPDATE [dbo].[MembershipTypeTranslation] SET [title] = N'injected';`,
      `DELETE FROM [dbo].[MembershipTypeTranslation];`,
    ],
    MembershipApplication: [
      `INSERT INTO [dbo].[MembershipApplication] ([id], [applicantUserId], [membershipTypeId], [submittedAt]) VALUES (N'injected', N'injected', N'injected', SYSUTCDATETIME());`,
      `UPDATE [dbo].[MembershipApplication] SET [status] = N'approved';`,
      `DELETE FROM [dbo].[MembershipApplication];`,
    ],
    Membership: [
      `INSERT INTO [dbo].[Membership] ([id], [memberUserId], [membershipTypeId], [sourceApplicationId], [activatedAt]) VALUES (N'injected', N'injected', N'injected', N'injected', SYSUTCDATETIME());`,
      `UPDATE [dbo].[Membership] SET [status] = N'closed';`,
      `DELETE FROM [dbo].[Membership];`,
    ],
    MembershipCommunicationIntent: [
      `INSERT INTO [dbo].[MembershipCommunicationIntent] ([id], [purpose], [recipientUserId], [applicationId], [dueAt], [idempotencyKey]) VALUES (N'injected', N'membership.application.submitted', N'injected', N'injected', SYSUTCDATETIME(), N'injected');`,
      `UPDATE [dbo].[MembershipCommunicationIntent] SET [state] = N'abandoned';`,
      `DELETE FROM [dbo].[MembershipCommunicationIntent];`,
    ],
  };
  for (const [table, [insert, update, remove]] of Object.entries(membershipProbes)) {
    await expectDenied(operatorSession, `operator SELECT on ${table} denied`, () =>
      operatorSession.query(`SELECT TOP 1 1 AS probe FROM [dbo].[${table}];`),
    );
    await expectDenied(operatorSession, `operator INSERT on ${table} denied`, () =>
      operatorSession.query(insert),
    );
    await expectDenied(operatorSession, `operator UPDATE on ${table} denied`, () =>
      operatorSession.query(update),
    );
    await expectDenied(operatorSession, `operator DELETE on ${table} denied`, () =>
      operatorSession.query(remove),
    );
  }

  await expectDenied(operatorSession, 'operator INSERT on RoleAssignment denied', () =>
    operatorSession.query(`
      INSERT INTO [dbo].[RoleAssignment] ([userId], [roleId])
      VALUES (N'injected', N'injected');
    `),
  );

  await expectDenied(operatorSession, 'operator CREATE TABLE denied', () =>
    operatorSession.query(
      'CREATE TABLE [dbo].[OperatorShouldNotCreateThis] ([id] INT NOT NULL);',
    ),
  );

  // ---- the application principal cannot execute either procedure -----------
  const applicationSession = await openSession({
    ...withDatabase(migrationConnection, databaseName),
    user: application.DATABASE_APP_LOGIN,
    password: application.DATABASE_APP_PASSWORD,
  });
  app = applicationSession;

  const eligible = await createAccount(admin, { verified: true, status: 'active' });

  for (const procedure of OPERATOR_PROCEDURES) {
    await expectDenied(
      applicationSession,
      `application EXECUTE on ${procedure} denied`,
      () =>
        applicationSession.execute(procedure, {
          targetUserId: eligible,
          ticket: 'proof',
        }),
    );
  }

  // ---- bootstrap: ineligible targets ---------------------------------------
  const unverified = await createAccount(admin, { verified: false, status: 'active' });
  const disabled = await createAccount(admin, { verified: true, status: 'disabled' });

  await expectRefusedBy(
    'bootstrap refuses an unverified target',
    BOOTSTRAP_INELIGIBLE_TARGET,
    () =>
      operatorSession.execute(OPERATOR_PROCEDURES[0], {
        targetUserId: unverified,
        ticket: 'OPS-1 unverified',
      }),
  );

  await expectRefusedBy(
    'bootstrap refuses an inactive target',
    BOOTSTRAP_INELIGIBLE_TARGET,
    () =>
      operatorSession.execute(OPERATOR_PROCEDURES[0], {
        targetUserId: disabled,
        ticket: 'OPS-2 disabled',
      }),
  );

  // ---- bootstrap: concurrent attempts resolve to exactly one ---------------
  //
  // Two operator sessions, the same instant, two DIFFERENT eligible targets.
  // Different targets matter: identical ones could both "succeed" against a
  // naive idempotency rule and hide the race. Exactly one must win.
  const rivalSession = await openSession({
    ...withDatabase(migrationConnection, databaseName),
    user: operator.DATABASE_OPERATOR_LOGIN,
    password: operator.DATABASE_OPERATOR_PASSWORD,
  });
  second = rivalSession;

  const contender = await createAccount(admin, { verified: true, status: 'active' });

  const outcomes = await Promise.allSettled([
    operatorSession.execute(OPERATOR_PROCEDURES[0], {
      targetUserId: eligible,
      ticket: 'OPS-3 concurrent A',
    }),
    rivalSession.execute(OPERATOR_PROCEDURES[0], {
      targetUserId: contender,
      ticket: 'OPS-3 concurrent B',
    }),
  ]);

  const succeeded = outcomes.filter((outcome) => outcome.status === 'fulfilled').length;
  const administrators = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[RoleAssignment] ra
     JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
     WHERE r.[key] = N'platform-administrator' AND ra.[revokedAt] IS NULL;`,
  );
  const bootstrapRows = await scalar(
    admin,
    'SELECT COUNT_BIG(*) AS total FROM [dbo].[IdentityBootstrap];',
  );

  if (succeeded !== 1 || administrators !== 1 || bootstrapRows !== 1) {
    fail(
      'concurrent bootstrap yields exactly one',
      `${succeeded} call(s) succeeded, ${administrators} administrator(s), ` +
        `${bootstrapRows} bootstrap row(s)`,
    );
  } else {
    pass(
      'concurrent bootstrap yields exactly one',
      '1 success, 1 administrator, 1 bootstrap record',
    );
  }

  // Which of the two won is not determined, and must not be: the property is
  // that exactly one did. The winner is read back for the recovery cases.
  const [winner] = await admin.query<{ userId: string }>(
    `SELECT TOP 1 ra.[userId] AS userId FROM [dbo].[RoleAssignment] ra
     JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
     WHERE r.[key] = N'platform-administrator' AND ra.[revokedAt] IS NULL;`,
  );
  const administratorId = winner?.userId ?? '';

  // ---- bootstrap self-closes ------------------------------------------------
  await expectRefusedBy('a second bootstrap is refused', BOOTSTRAP_ALREADY_DONE, () =>
    operatorSession.execute(OPERATOR_PROCEDURES[0], {
      targetUserId: disabled,
      ticket: 'OPS-4 second attempt',
    }),
  );

  // ---- the bootstrap recorded WHO, WHAT and WHY ---------------------------
  const [record] = await admin.query<{
    operatorLogin: string;
    ticket: string;
    targetUserId: string;
  }>('SELECT [operatorLogin], [ticket], [targetUserId] FROM [dbo].[IdentityBootstrap];');

  if (record?.operatorLogin !== operator.DATABASE_OPERATOR_LOGIN) {
    fail(
      'bootstrap records the real DB login',
      `recorded '${record?.operatorLogin ?? ''}', expected the operator login`,
    );
  } else if (record.targetUserId !== administratorId || record.ticket === '') {
    fail('bootstrap records the real DB login', 'target or ticket is missing');
  } else {
    pass(
      'bootstrap records the real DB login',
      `ORIGINAL_LOGIN() = ${record.operatorLogin}, ticket recorded`,
    );
  }

  const bootstrapAudit = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
     WHERE [action] = N'identity.bootstrap.completed'
       AND [actorType] = N'operator'
       AND [actorId] = N'${operator.DATABASE_OPERATOR_LOGIN}';`,
  );
  if (bootstrapAudit !== 1) {
    fail('bootstrap is audited', `${bootstrapAudit} audit row(s)`);
  } else {
    pass('bootstrap is audited', 'one operator-attributed audit record');
  }

  // ---- recovery -------------------------------------------------------------
  await expectRefusedBy(
    'recovery refuses a non-administrator',
    RECOVERY_NOT_AN_ADMINISTRATOR,
    () =>
      operatorSession.execute(OPERATOR_PROCEDURES[1], {
        targetUserId: disabled,
        ticket: 'OPS-5 not an administrator',
      }),
  );

  // Give the administrator a live session, a step-up grant, an enrolled factor
  // and a complete posture, so recovery has something real to clear.
  const sessionId = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Session] ([id], [expiresAt], [token], [createdAt], [updatedAt], [userId])
    VALUES (N'${sessionId}', DATEADD(day, 7, SYSUTCDATETIME()), N'token-${sessionId}',
            SYSUTCDATETIME(), SYSUTCDATETIME(), N'${administratorId}');
  `);
  await admin.query(`
    INSERT INTO [dbo].[StepUpGrant] ([userId], [sessionId], [purpose], [expiresAt])
    VALUES (N'${administratorId}', N'${sessionId}', N'privilege-administration',
            DATEADD(minute, 5, SYSUTCDATETIME()));
  `);
  await admin.query(`
    INSERT INTO [dbo].[TwoFactor] ([secret], [backupCodes], [userId], [verified])
    VALUES (N'synthetic-not-a-secret', N'synthetic-not-a-code', N'${administratorId}', 1);
  `);
  await admin.query(`
    UPDATE [dbo].[User] SET [twoFactorEnabled] = 1 WHERE [id] = N'${administratorId}';
  `);
  await admin.query(`
    INSERT INTO [dbo].[PrivilegedSecurityPosture]
      ([userId], [secondFactorVerifiedAt], [recoveryCodesIssuedAt], [recoveryCodesConfirmedAt])
    VALUES (N'${administratorId}', SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);

  await expectAllowed(
    'operator EXECUTE on the recovery procedure',
    'the two host-only procedures are the operator’s whole authority',
    () =>
      operatorSession.execute(OPERATOR_PROCEDURES[1], {
        targetUserId: administratorId,
        ticket: 'OPS-6 lost authenticator',
      }),
  );

  const remainingSessions = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Session] WHERE [userId] = N'${administratorId}';`,
  );
  const remainingGrants = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[StepUpGrant] WHERE [userId] = N'${administratorId}';`,
  );
  const remainingFactors = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[TwoFactor] WHERE [userId] = N'${administratorId}';`,
  );
  const stillEnabled = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[User]
     WHERE [id] = N'${administratorId}' AND [twoFactorEnabled] = 1;`,
  );
  const reenrolment = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[PrivilegedSecurityPosture]
     WHERE [userId] = N'${administratorId}'
       AND [reenrolmentRequiredAt] IS NOT NULL
       AND [secondFactorVerifiedAt] IS NULL
       AND [recoveryCodesConfirmedAt] IS NULL;`,
  );

  if (
    remainingSessions !== 0 ||
    remainingGrants !== 0 ||
    remainingFactors !== 0 ||
    stillEnabled !== 0 ||
    reenrolment !== 1
  ) {
    fail(
      'recovery clears the factor and demands re-enrolment',
      `${remainingSessions} session(s), ${remainingGrants} grant(s), ` +
        `${remainingFactors} factor(s), enabled=${stillEnabled}, posture=${reenrolment}`,
    );
  } else {
    pass(
      'recovery clears the factor and demands re-enrolment',
      'sessions, grants and factor gone; re-enrolment required',
    );
  }

  // ---- recovery NEVER touches the role assignment --------------------------
  const assignmentsAfter = await admin.query<{ id: string; revokedAt: Date | null }>(
    `SELECT ra.[id] AS id, ra.[revokedAt] AS revokedAt FROM [dbo].[RoleAssignment] ra
     JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
     WHERE r.[key] = N'platform-administrator';`,
  );

  if (assignmentsAfter.length !== 1 || assignmentsAfter[0]?.revokedAt !== null) {
    fail(
      'recovery neither grants nor regrants a role',
      `${assignmentsAfter.length} assignment row(s); expected the original, unrevoked`,
    );
  } else {
    pass(
      'recovery neither grants nor regrants a role',
      'the original assignment is intact and unrevoked',
    );
  }

  const recoveryAudit = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
     WHERE [action] = N'identity.security.factor-recovered'
       AND [actorType] = N'operator'
       AND [actorId] = N'${operator.DATABASE_OPERATOR_LOGIN}';`,
  );
  if (recoveryAudit !== 1) {
    fail('recovery is audited', `${recoveryAudit} audit row(s)`);
  } else {
    pass('recovery is audited', 'one operator-attributed audit record');
  }

  // ---- nothing sensitive reached the audit record --------------------------
  const leaked = await scalar(
    admin,
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
     WHERE ISNULL([beforeState], N'') LIKE N'%secret%'
        OR ISNULL([afterState], N'')  LIKE N'%secret%'
        OR ISNULL([beforeState], N'') LIKE N'%synthetic-not-a-code%'
        OR ISNULL([afterState], N'')  LIKE N'%synthetic-not-a-code%';`,
  );
  if (leaked !== 0) {
    fail('no second-factor material is audited', `${leaked} row(s) carry it`);
  } else {
    pass(
      'no second-factor material is audited',
      'no secret or recovery code in any payload',
    );
  }
} finally {
  await second?.close();
  await host?.close();
  await app?.close();
  await admin?.close();
  await dropDisposableDatabase(master, databaseName);
  await master.close();
}

if (failures > 0) {
  process.stdout.write(`\n${failures} operator check(s) FAILED.\n`);
  process.exit(1);
}

process.stdout.write(
  '\nHost-only bootstrap and recovery verified against the live operator principal.\n',
);
