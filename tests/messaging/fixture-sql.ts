import { randomUUID } from 'node:crypto';

import type { MessagingPeerPolicyPort } from '../../packages/contracts/src/messaging/index.ts';
import type { MessagingPersistencePort } from '../../packages/contracts/src/messaging/index.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  createMessagingService,
  denyAllPeers,
  type MessagingService,
} from '../../packages/server-core/src/messaging/index.ts';
import { createLearningRelationshipService } from '../../packages/server-core/src/relationships/index.ts';
import { createProofDatabase, type DisposableDatabase } from '../identity/harness.ts';
import { count, n } from '../learning/fixture-sql.ts';

export {
  activateLive,
  count,
  n,
  revokeAssignment,
  scope,
} from '../learning/fixture-sql.ts';

/**
 * Phase 24 fixture rows that ONLY the owner/operator — or another context —
 * may write: Messaging's activation, accounts and their role assignments
 * (Identity's), Courses, Enrolments and teaching scopes (Learning's) and a
 * teacher's public profile (People's). Every statement here runs on the
 * MIGRATION (owner) session. NOTHING Messaging itself stores is written here:
 * conversations, messages, read state, blocks and reports are created through
 * Messaging's own service and adapter, which write the millisecond-precision
 * instants its keysets depend on.
 *
 * NOTHING HERE IS CONTENT. Every title, name and body is an unmistakable
 * `NON_MESSAGING_FIXTURE_…` sentinel, and every account address sits on the
 * reserved `.invalid` TLD (`@messaging-proof.invalid`).
 */

/** A sentinel no real message, title or name could be mistaken for. */
export const sentinel = (kind: string, index: number | string) =>
  `NON_MESSAGING_FIXTURE_${kind}_${index}`;

let sequence = 0;

/* ===========================================================================
 * Messaging's activation — owner-written, immutable
 * ========================================================================= */

export type FixtureCapability = 'support' | 'teacher-student' | 'student-student';

export async function activateMessaging(
  admin: SqlSession,
  capability: FixtureCapability,
): Promise<void> {
  await admin.query(`
    INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference])
    VALUES (${n(capability)}, N'fixture', N'NON_MESSAGING_FIXTURE operator', NULL);
  `);
}

/* ===========================================================================
 * Identity
 * ========================================================================= */

/** A fresh synthetic address on the reserved TLD. */
export function proofEmail(): string {
  sequence += 1;
  return `msg-${String(sequence)}-${Date.now().toString(36)}@messaging-proof.invalid`;
}

/**
 * A synthetic account, `…@messaging-proof.invalid`. The id fits Messaging's
 * account bound (36) and is plain ASCII, so binary and JavaScript ordering of
 * a pair agree.
 */
export async function account(
  admin: SqlSession,
  options: { readonly email?: string; readonly status?: 'active' | 'closed' } = {},
): Promise<string> {
  sequence += 1;
  const id = `msgp-${String(sequence)}-${randomUUID().slice(0, 8)}`;
  const email = options.email ?? `${id}@messaging-proof.invalid`;
  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [createdAt], [updatedAt],
       [locale], [status], [twoFactorEnabled])
    VALUES
      (${n(id)}, N'NON_MESSAGING_FIXTURE account', ${n(email)}, 0,
       SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', ${n(options.status ?? 'active')}, 0);
  `);
  return id;
}

export interface RoleFixture {
  readonly accountId: string;
  readonly roleId: string;
  readonly roleAssignmentId: string;
}

/** A live assignment, to `accountId`, of a fresh role carrying exactly `permissions`. */
export async function grantRole(
  admin: SqlSession,
  accountId: string,
  permissions: readonly string[],
): Promise<RoleFixture> {
  const roleId = randomUUID();
  const roleAssignmentId = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
    VALUES (${n(roleId)}, ${n(`proof-messaging-${roleId}`)}, N'NON_MESSAGING_FIXTURE role', N'Test fixture', 0);
    INSERT INTO [dbo].[RoleAssignment] ([id],[userId],[roleId])
    VALUES (${n(roleAssignmentId)}, ${n(accountId)}, ${n(roleId)});
  `);
  for (const key of permissions)
    await admin.query(
      `INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(roleId)}, ${n(key)});`,
    );
  return { accountId, roleId, roleAssignmentId };
}

/** A fresh account holding a live `teaching.perform` assignment (or the keys named). */
export async function teacherAccount(
  admin: SqlSession,
  permissions: readonly string[] = ['teaching.perform'],
): Promise<RoleFixture> {
  return grantRole(admin, await account(admin), permissions);
}

/** A live assignment of the SYSTEM Platform Administrator role — every bundled key. */
export async function platformAdministrator(
  admin: SqlSession,
  accountId: string,
): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[RoleAssignment] ([id],[userId],[roleId])
    SELECT ${n(id)}, ${n(accountId)}, r.[id] FROM [dbo].[Role] r WHERE r.[key] = N'platform-administrator';
  `);
  if ((await count(admin, 'RoleAssignment', `[id] = ${n(id)}`)) !== 1)
    throw new Error('The Platform Administrator role was not found.');
  return id;
}

/* ===========================================================================
 * Learning — Courses, scopes and Enrolments the owner writes
 * ========================================================================= */

/**
 * A PUBLISHED live Course with the syllabus the catalogue trigger requires,
 * written as a draft first (a published syllabus is frozen) and published last.
 */
export async function liveCourse(
  admin: SqlSession,
  options: { readonly publish?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  const moduleId = randomUUID();
  const lessonId = randomUUID();
  const slug = `non-messaging-fixture-${id}`;
  await admin.query(`
    INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode])
    VALUES (${n(id)}, ${n(slug)}, N'en', N'draft', N'beginner', N'live', N'en');
    INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description])
    VALUES (${n(id)}, N'en', ${n(sentinel('COURSE', id))}, N'', N'');
    INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (${n(moduleId)}, ${n(id)}, 0);
    INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary])
    VALUES (${n(moduleId)}, N'en', ${n(sentinel('MODULE', id))}, N'');
    INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES (${n(lessonId)}, ${n(id)}, ${n(moduleId)}, 0);
    INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body])
    VALUES (${n(lessonId)}, N'en', ${n(sentinel('LESSON', id))}, N'', ${n(sentinel('LESSON_BODY', id))});
  `);
  if (options.publish !== false)
    await admin.query(
      `UPDATE [dbo].[Course] SET [state] = N'published', [publishedAt] = SYSUTCDATETIME() WHERE [id] = ${n(id)};`,
    );
  return id;
}

/** Ends one teaching scope, as Learning's operator surface would. */
export async function endScope(admin: SqlSession, scopeId: string): Promise<void> {
  await admin.query(
    `UPDATE [dbo].[CourseTeachingAssignment] SET [endedAt] = SYSUTCDATETIME() WHERE [id] = ${n(scopeId)};`,
  );
}

export async function enrol(
  admin: SqlSession,
  learnerAccountId: string,
  courseId: string,
): Promise<void> {
  await admin.query(`
    INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt])
    VALUES (${n(learnerAccountId)}, ${n(courseId)}, SYSUTCDATETIME());
  `);
}

/** The learner leaves the Course: Learning deletes the Enrolment. */
export async function withdrawEnrolment(
  admin: SqlSession,
  learnerAccountId: string,
  courseId: string,
): Promise<void> {
  await admin.query(
    `DELETE FROM [dbo].[Enrolment] WHERE [userId] = ${n(learnerAccountId)} AND [courseId] = ${n(courseId)};`,
  );
}

/* ===========================================================================
 * People — public attribution, which grants nothing
 * ========================================================================= */

/**
 * A published contributor LINKED to the account, with an active teacher
 * profile, named as a teacher on the Course — every public "this person
 * teaches here" fact, and none of the authority.
 */
export async function publicTeacher(
  admin: SqlSession,
  accountId: string,
  courseId: string,
): Promise<void> {
  const personId = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status],[userId])
    VALUES (${n(personId)}, ${n(`non-messaging-fixture-person-${personId}`)}, N'en', N'published', ${n(accountId)});
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography])
    VALUES (${n(personId)}, N'en', ${n(sentinel('PERSON', personId))}, NULL);
    INSERT INTO [dbo].[TeacherProfile] ([personId],[status]) VALUES (${n(personId)}, N'active');
    INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES (${n(courseId)}, ${n(personId)}, 0);
  `);
}

/* ===========================================================================
 * Observations
 * ========================================================================= */

/** Messaging rows that name one conversation, across every Messaging table. */
export async function conversationRows(
  admin: SqlSession,
  conversationId: string,
): Promise<number> {
  const of = `[conversationId] = ${n(conversationId)}`;
  return (
    (await count(admin, 'Conversation', `[id] = ${n(conversationId)}`)) +
    (await count(admin, 'ConversationParticipant', of)) +
    (await count(admin, 'Message', of)) +
    (await count(admin, 'MessageReadState', of)) +
    (await count(admin, 'MessageAttachment', of))
  );
}

/** Every Messaging row in the database — for "nothing leaked" proofs. */
export async function messagingRows(admin: SqlSession): Promise<number> {
  let total = 0;
  for (const table of [
    'Conversation',
    'ConversationParticipant',
    'Message',
    'MessageAttachment',
    'MessageReadState',
    'MessagingBlock',
    'MessagingReport',
    'MessagingModerationDecision',
  ])
    total += await count(admin, table);
  return total;
}

/** The audit rows one target received, oldest first, with their state columns. */
export async function auditRows(
  admin: SqlSession,
  targetId: string,
): Promise<
  readonly {
    action: string;
    actorId: string | null;
    targetType: string | null;
    authorisingSource: string | null;
    beforeState: string | null;
    afterState: string | null;
  }[]
> {
  return admin.query(`
    SELECT [action], [actorId], [targetType], [authorisingSource], [beforeState], [afterState]
    FROM [dbo].[AuditLog] WHERE [targetId] = ${n(targetId)} ORDER BY [occurredAt], [id];
  `);
}

/* ===========================================================================
 * The world: one disposable database and the REAL service over it
 * ========================================================================= */

/** What Storage was asked to release — the fake keeps only the count of tokens. */
export interface ReleaseLog {
  readonly tokens: string[];
}

export interface MessagingWorld {
  readonly db: DisposableDatabase;
  /** A session as the provisioned RUNTIME principal, for grant-floor proofs. */
  readonly app: SqlSession;
  /** The production wiring: real adapters, real Identity answers, `denyAllPeers`. */
  readonly service: MessagingService;
  /**
   * The same wiring with ONE port replaced: a fixture peer policy (ONLY for the
   * student-to-student proof) or a persistence wrapper that pauses a call so a
   * proof can commit a competing change at an exact point.
   */
  serviceWith(overrides: {
    readonly peers?: MessagingPeerPolicyPort;
    readonly persistence?: MessagingPersistencePort;
  }): MessagingService;
  /** Messaging's own adapter, for owner-side steps a proof must interrupt or race. */
  readonly persistence: MessagingPersistencePort;
  /** Identity's real closure, through Identity's own adapter. */
  closeAccount(accountId: string): Promise<void>;
  /** Learning's real disposition of a closed account (its Enrolments, progress, requests). */
  disposeLearning(accountId: string): Promise<number>;
  readonly releases: ReleaseLog;
  close(): Promise<void>;
}

/**
 * Creates the disposable database, provisions the runtime principal, repoints
 * the runtime URL at it and wires `createMessagingService` exactly as the web
 * composition root does (`apps/web/src/composition/messaging.ts`): Learning's
 * relationship service over Learning's reader with Identity's LIVE
 * `teaching.perform` assignments, Identity's live effective permissions,
 * Identity's closed-account answer, the real audit writer and the real SQL
 * rate limiter. Storage is a fake that stores nothing — these proofs carry no
 * attachment bytes; the attachment proofs use the real Storage service.
 */
export async function messagingWorld(): Promise<MessagingWorld> {
  // Read BEFORE the database exists: creating it repoints `DATABASE_URL`.
  const runtimeSource = getDatabaseRuntimeUrl();
  const db = await createProofDatabase();
  // A failure while wiring must not orphan the database it just made.
  try {
    return await wire(db, runtimeSource);
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function wire(
  db: DisposableDatabase,
  runtimeSource: string,
): Promise<MessagingWorld> {
  const runtimeTarget = parseSqlServerUrl(runtimeSource);
  const runtimeUrl = runtimeSource.replace(
    `database=${runtimeTarget.database}`,
    `database=${db.name}`,
  );
  if (runtimeUrl === runtimeSource)
    throw new Error('The runtime URL could not be repointed at the disposable database.');
  const connection = assertApprovedLocalTarget(
    runtimeUrl,
    localTargetPolicy(process.env, 'disposable', 'runtime'),
  );
  const principal = getApplicationPrincipalCredentials();
  await provisionApplicationPrincipal(
    db.admin,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );
  const app = await openSession(connection);
  process.env['DATABASE_URL'] = runtimeUrl;

  const database = await import('../../packages/database/src/index.ts');
  const persistence = database.createMessagingPersistence();
  const authorization = database.createAuthorizationPersistence();
  const reader = database.createAuthorizationReader();
  const identity = database.createIdentityPersistence();
  const learning = database.createLearningDisposition();
  const configuration = {
    digestKey: 'synthetic-messaging-proof-digest-key-000000000',
    digestKeyVersion: 1,
  };
  const limiter = database.createRateLimiter(configuration);
  const audit = database.createAuditWriter();
  const releases: ReleaseLog = { tokens: [] };

  const teaching = createLearningRelationshipService({
    reader: database.createLearningRelationshipReader(),
    identity: {
      liveTeachingAssignments: (accountId) =>
        authorization.liveAssignmentsCarrying(accountId, 'teaching.perform'),
    },
  });

  const build = (
    overrides: {
      readonly peers?: MessagingPeerPolicyPort;
      readonly persistence?: MessagingPersistencePort;
    } = {},
  ): MessagingService =>
    createMessagingService({
      persistence: overrides.persistence ?? persistence,
      teaching,
      authority: {
        permits: async (accountId, permission) =>
          (await reader.effectivePermissions(accountId)).includes(permission),
      },
      accounts: { closedAccounts: (ids) => authorization.closedAccountIds(ids) },
      peers: overrides.peers ?? denyAllPeers,
      storage: {
        store: async () => {
          throw new Error('These proofs store no attachment bytes.');
        },
        open: async () => null,
        release: async (token) => {
          releases.tokens.push(token);
          return 'absent';
        },
      },
      audit,
      limiter,
      limitKey: (purpose, subject) =>
        database.rateLimitKey({ purpose, subject, configuration }),
    });

  return {
    db,
    app,
    service: build(),
    serviceWith: build,
    persistence,
    async closeAccount(accountId) {
      const [row] = await db.admin.query<{ email: string }>(
        `SELECT [email] FROM [dbo].[User] WHERE [id] = ${n(accountId)};`,
      );
      await identity.closeAccount({
        accountId,
        intent: {
          purpose: 'identity.account-closed',
          accountId,
          locale: 'en',
          idempotencyKey: `messaging-proof-closure-${accountId}`,
          ...(row === undefined ? {} : { recipientOverride: row.email }),
        },
        audit: {
          action: 'identity.account.closed',
          actorType: 'user',
          actorId: accountId,
          targetType: 'user',
          targetId: accountId,
        },
      });
    },
    async disposeLearning(accountId) {
      let removed = 0;
      for (let round = 0; round < 20; round += 1) {
        const step = await learning.disposeAccount(accountId, 500);
        removed += step;
        if (step === 0) break;
      }
      return removed;
    },
    releases,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/** A refusal's reason (`MessagingRefusal`, `MessagingDataError`), `accepted`, or `unclassified`. */
export async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const named = error as { name?: unknown; reason?: unknown } | null;
    if (named?.name === 'MessagingDataError') return `data-error:${String(named.reason)}`;
    return typeof named?.reason === 'string' ? named.reason : 'unclassified';
  }
  return 'accepted';
}

/** A UUID operation identifier, fresh per send. */
export const op = () => randomUUID();
