import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
} from '@minhaj/contracts/identity';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-2 STATE for the recovery rehearsal.
 *
 * WHY THIS EXISTS. The Phase-1 rehearsal wrote ONE `AuditLog` row and checked
 * it came back. That proved a backup artifact restores, which is the hardest
 * part — and it proved nothing at all about the tables Phase 2 introduces, or
 * about the relationships between them. "The schema restored" and "the data
 * restored" are different claims, and only the second is what an incident
 * actually depends on.
 *
 * So every Phase-2 table gets representative rows, they are related to each
 * other the way real ones are, and each is read back field by field after the
 * restore.
 *
 * NOTHING HERE IS REAL, AND NOTHING HERE IS A CREDENTIAL.
 *
 * Addresses are `.invalid` (RFC 2606, can never resolve). The stored password
 * is a fixed non-secret placeholder string, not a hash of anything and not a
 * value any account accepts. Tokens are the literal word `synthetic` plus the
 * run's identifier. Digests are fixed hex. A reader who finds one of these in
 * a database is meant to recognise it instantly as rehearsal machinery
 * (SECURITY_BASELINE.md §18.1).
 */

/** Marks every row this module writes, so a rehearsal's residue is obvious. */
const TAG = 'phase2-recovery';

/**
 * How many permissions the delivered migrations seed.
 *
 * Derived from the compiled catalogue rather than written as a literal: the
 * catalogue and the migrations are proved equal by
 * `tests/architecture/phase2-chunk2-boundaries.test.ts`, so counting it here
 * asks the one definition rather than adding a second number for a later phase
 * to forget.
 */
const EXPECTED_PERMISSION_COUNT = PERMISSION_CATALOGUE.length;

/**
 * How many of them the protected Platform Administrator bundle holds: the whole
 * catalogue EXCEPT the externally gated keys, whose holders only the
 * organisation names. Asked of the same compiled definition, for the same
 * reason.
 */
const EXPECTED_BUNDLE_COUNT = PLATFORM_ADMINISTRATOR_PERMISSIONS.length;

export interface Phase2Fixture {
  readonly runId: string;
  readonly accountId: string;
  readonly email: string;
  readonly sessionId: string;
  readonly credentialId: string;
  readonly verificationId: string;
  readonly intentId: string;
  readonly securityOperationId: string;
  readonly deliveryId: string;
  readonly suppressionId: string;
  readonly providerEventId: string;
  readonly rateLimitKey: string;
  readonly auditId: string;

  // ---- Chunk 2: authorisation and privileged security ------------------
  readonly customRoleId: string;
  readonly customRoleKey: string;
  readonly assignmentId: string;
  readonly protectedAssignmentId: string;
  readonly stepUpGrantId: string;
  readonly twoFactorId: string;
}

export function newPhase2Fixture(): Phase2Fixture {
  // Random per run, so a restored row can only have come from THIS run's
  // backup — residue from an earlier rehearsal cannot satisfy the assertions.
  const runId = randomUUID().replaceAll('-', '');

  return {
    runId,
    accountId: randomUUID(),
    email: `${TAG}-${runId}@proof.invalid`,
    sessionId: randomUUID(),
    credentialId: randomUUID(),
    verificationId: randomUUID(),
    intentId: randomUUID(),
    securityOperationId: randomUUID(),
    deliveryId: randomUUID(),
    suppressionId: randomUUID(),
    providerEventId: randomUUID(),
    rateLimitKey: `v1:${TAG}:${runId}`,
    auditId: randomUUID(),

    customRoleId: randomUUID(),
    // A key nothing else can collide with, and obviously rehearsal machinery.
    // It carries the WHOLE run identifier, which is what `assertSafe` checks:
    // a truncated one would be a value this module cannot prove it generated.
    customRoleKey: `${TAG}-${runId}`,
    assignmentId: randomUUID(),
    protectedAssignmentId: randomUUID(),
    stepUpGrantId: randomUUID(),
    twoFactorId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase2Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-2 fixture runId does not match the expected pattern.');
  }

  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (typeof value !== 'string' || !value.includes(fixture.runId)) {
      if (!/^[0-9a-fA-F-]{36}$/.test(String(value))) {
        throw new Error(`Phase-2 fixture field '${name}' is not a safe generated value.`);
      }
    }
  }
}

/**
 * Writes the populated Phase-2 state into the SOURCE database, before backup.
 *
 * Written with the MIGRATION principal, like the rest of this administrative
 * tooling. The rows are inserted in dependency order so the real foreign keys
 * are exercised rather than worked around.
 */
export async function writePhase2Fixture(
  admin: SqlSession,
  fixture: Phase2Fixture,
): Promise<void> {
  assertSafe(fixture);

  const f = fixture;

  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [status], [locale], [createdAt], [updatedAt])
    VALUES
      (N'${f.accountId}', N'Recovery Rehearsal', N'${f.email}', 1, N'active', N'ur',
       SYSUTCDATETIME(), SYSUTCDATETIME());
  `);

  await admin.query(`
    INSERT INTO [dbo].[Account]
      ([id], [accountId], [providerId], [userId], [password], [createdAt], [updatedAt])
    VALUES
      (N'${f.credentialId}', N'${f.email}', N'credential', N'${f.accountId}',
       N'not-a-real-hash-${TAG}-${f.runId}', SYSUTCDATETIME(), SYSUTCDATETIME());
  `);

  await admin.query(`
    INSERT INTO [dbo].[Session]
      ([id], [token], [userId], [expiresAt], [createdAt], [updatedAt])
    VALUES
      (N'${f.sessionId}', N'synthetic-session-${f.runId}', N'${f.accountId}',
       DATEADD(day, 7, SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);

  await admin.query(`
    INSERT INTO [dbo].[Verification]
      ([id], [identifier], [value], [expiresAt], [createdAt], [updatedAt])
    VALUES
      (N'${f.verificationId}', N'email-verification-otp-${f.email}',
       N'synthetic-not-a-token-${f.runId}', DATEADD(hour, 1, SYSUTCDATETIME()),
       SYSUTCDATETIME(), SYSUTCDATETIME());
  `);

  await admin.query(`
    INSERT INTO [dbo].[IdentityCommunicationIntent]
      ([id], [purpose], [userId], [locale], [idempotencyKey], [recipientOverride], [status])
    VALUES
      (N'${f.intentId}', N'identity.password-changed', N'${f.accountId}', N'ur',
       N'identity.password-changed:${f.accountId}:${TAG}', NULL, N'pending');
  `);

  await admin.query(`
    INSERT INTO [dbo].[IdentitySecurityOperation]
      ([id], [kind], [userId], [initiatingSessionId], [committedAt], [completedAt])
    VALUES
      (N'${f.securityOperationId}', N'email-change', N'${f.accountId}',
       N'${f.sessionId}', SYSUTCDATETIME(), SYSUTCDATETIME());
  `);

  await admin.query(`
    INSERT INTO [dbo].[EmailDelivery]
      ([id], [purpose], [recipientDigest], [digestKeyVersion], [sourceReference],
       [idempotencyKey], [status], [attemptCount])
    VALUES
      (N'${f.deliveryId}', N'identity.password-changed',
       N'${'a1b2c3d4'.repeat(4)}', 1, N'identity:account:${f.accountId}:notice',
       N'delivery:${TAG}:${f.runId}', N'pending', 0);
  `);

  await admin.query(`
    INSERT INTO [dbo].[EmailSuppression]
      ([id], [recipientDigest], [digestKeyVersion], [reason], [scope])
    VALUES
      (N'${f.suppressionId}', N'${'f0e1d2c3'.repeat(4)}', 1, N'bounce', N'transactional');
  `);

  await admin.query(`
    INSERT INTO [dbo].[ProviderEvent]
      ([id], [provider], [eventId], [type], [processedAt])
    VALUES
      (N'${f.providerEventId}', N'resend', N'evt_${TAG}_${f.runId}', N'email.bounced',
       SYSUTCDATETIME());
  `);

  await admin.query(`
    INSERT INTO [dbo].[RateLimitCounter]
      ([key], [keyVersion], [count], [windowStartedAt], [windowExpiresAt])
    VALUES
      (N'${f.rateLimitKey}', 1, 3, SYSUTCDATETIME(), DATEADD(minute, 5, SYSUTCDATETIME()));
  `);

  await admin.query(`
    INSERT INTO [dbo].[AuditLog]
      ([id], [actorType], [actorId], [action], [targetType], [targetId], [authorisingSource])
    VALUES
      (N'${f.auditId}', N'user', N'${f.accountId}', N'identity.password.changed',
       N'user', N'${f.accountId}', N'db:recovery:populated');
  `);

  // ---- Chunk 2: authorisation and privileged security --------------------
  //
  // WHY THESE ROWS MATTER MOST. An artifact that restored the accounts but not
  // WHO MAY ADMINISTER THEM is a restore that looks complete and leaves the
  // platform ungoverned — and the protected role, the assignment history and
  // the second-factor state are precisely what nobody can reconstruct by hand.
  //
  // NOTHING HERE IS A CREDENTIAL. The stored secret and recovery codes are
  // fixed non-secret placeholders, not encrypted material and not values any
  // account accepts.

  await admin.query(`
    INSERT INTO [dbo].[Role] ([id], [key], [name], [description], [system])
    VALUES
      (N'${f.customRoleId}', N'${f.customRoleKey}', N'Recovery Rehearsal Role',
       N'A custom role written by the populated recovery rehearsal.', 0);
  `);

  // A bundle drawn from the MIGRATION-SEEDED catalogue, so the foreign key to
  // `Permission` is genuinely exercised rather than worked around.
  await admin.query(`
    INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
    VALUES
      (N'${f.customRoleId}', N'audit.read'),
      (N'${f.customRoleId}', N'users.read');
  `);

  await admin.query(`
    INSERT INTO [dbo].[RoleAssignment]
      ([id], [userId], [roleId], [grantedById], [grantedReason])
    VALUES
      (N'${f.assignmentId}', N'${f.accountId}', N'${f.customRoleId}',
       N'${f.accountId}', N'${TAG}-${f.runId}');
  `);

  // The completed bootstrap record below is legal only after a usable holder
  // of the protected role exists. This mirrors the production procedure's
  // assignment-before-bootstrap order and makes that invariant part of the
  // populated restore proof.
  await admin.query(`
    INSERT INTO [dbo].[RoleAssignment]
      ([id], [userId], [roleId], [grantedById], [grantedReason])
    SELECT N'${f.protectedAssignmentId}', N'${f.accountId}', r.[id],
           N'${f.accountId}', N'${TAG}-${f.runId}-bootstrap'
    FROM [dbo].[Role] r
    WHERE r.[key] = N'platform-administrator';
  `);

  await admin.query(`
    INSERT INTO [dbo].[StepUpGrant]
      ([id], [userId], [sessionId], [purpose], [expiresAt])
    VALUES
      (N'${f.stepUpGrantId}', N'${f.accountId}', N'${f.sessionId}',
       N'privilege-administration', DATEADD(minute, 5, SYSUTCDATETIME()));
  `);

  await admin.query(`
    INSERT INTO [dbo].[TwoFactor]
      ([id], [secret], [backupCodes], [userId], [verified])
    VALUES
      (N'${f.twoFactorId}', N'not-a-real-secret-${TAG}-${f.runId}',
       N'not-real-codes-${TAG}-${f.runId}', N'${f.accountId}', 1);
  `);

  await admin.query(`
    UPDATE [dbo].[User] SET [twoFactorEnabled] = 1 WHERE [id] = N'${f.accountId}';
  `);

  await admin.query(`
    INSERT INTO [dbo].[PrivilegedSecurityPosture]
      ([userId], [secondFactorVerifiedAt], [recoveryCodesIssuedAt],
       [recoveryCodesConfirmedAt])
    VALUES
      (N'${f.accountId}', SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);

  // The one-time bootstrap record. Singleton by primary key and CHECK
  // constraint, so a restore that lost it would let a second bootstrap run.
  await admin.query(`
    INSERT INTO [dbo].[IdentityBootstrap]
      ([id], [targetUserId], [operatorLogin], [ticket])
    VALUES
      (N'platform-administrator', N'${f.accountId}', N'rehearsal_operator',
       N'${TAG}-${f.runId}');
  `);
}

/** What a single verification found, for reporting. */
export interface Phase2Restored {
  readonly table: string;
  readonly detail: string;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Reads the populated state back out of the RESTORED database.
 *
 * VALUES, not counts. A restore that recovered row identifiers but corrupted
 * their contents would satisfy a count; every field written above is compared
 * to what came back, and the relationships between the rows are re-derived
 * through the real foreign keys rather than assumed.
 */
export async function verifyRestoredPhase2(
  restored: SqlSession,
  fixture: Phase2Fixture,
): Promise<Phase2Restored[]> {
  assertSafe(fixture);

  const f = fixture;
  const found: Phase2Restored[] = [];

  const users = await restored.query<{
    email: string;
    status: string;
    locale: string;
    emailVerified: boolean | number;
  }>(
    `SELECT [email], [status], [locale], [emailVerified] FROM [dbo].[User]
     WHERE [id] = N'${f.accountId}';`,
  );
  const user = users[0];
  expect(user !== undefined, 'Restored database has no rehearsal User row.');
  expect(user?.email === f.email, `Restored User email is '${user?.email ?? '(none)'}'.`);
  expect(user?.status === 'active', `Restored User status is '${user?.status}'.`);
  // The locale is deliberately `ur`: a restore that silently defaulted a
  // column would otherwise be invisible against an `en` fixture.
  expect(user?.locale === 'ur', `Restored User locale is '${user?.locale}'.`);
  expect(Boolean(user?.emailVerified), 'Restored User lost its verified flag.');
  found.push({ table: 'User', detail: `${f.email} status=active locale=ur` });

  // RELATIONAL INTEGRITY, walked through the real foreign key rather than by
  // reading the child's stored id back to itself.
  const credentials = await restored.query<{ total: number; password: string }>(
    `SELECT COUNT_BIG(*) AS total, MIN([password]) AS password FROM [dbo].[Account] AS a
     JOIN [dbo].[User] AS u ON u.[id] = a.[userId]
     WHERE u.[id] = N'${f.accountId}' AND a.[providerId] = N'credential';`,
  );
  expect(
    Number(credentials[0]?.total) === 1,
    'Restored credential Account did not survive with its user relationship.',
  );
  expect(
    credentials[0]?.password === `not-a-real-hash-${TAG}-${f.runId}`,
    'Restored credential Account payload changed.',
  );
  found.push({ table: 'Account', detail: 'credential row joined to its User' });

  const sessions = await restored.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Session] AS s
     JOIN [dbo].[User] AS u ON u.[id] = s.[userId]
     WHERE s.[id] = N'${f.sessionId}' AND s.[expiresAt] > SYSUTCDATETIME();`,
  );
  expect(Number(sessions[0]?.total) === 1, 'Restored Session did not survive.');
  found.push({ table: 'Session', detail: 'live session joined to its User' });

  const verifications = await restored.query<{ identifier: string; value: string }>(
    `SELECT [identifier], [value] FROM [dbo].[Verification]
     WHERE [id] = N'${f.verificationId}';`,
  );
  expect(
    verifications[0]?.identifier === `email-verification-otp-${f.email}`,
    'Restored Verification identifier changed.',
  );
  expect(
    verifications[0]?.value === `synthetic-not-a-token-${f.runId}`,
    'Restored Verification value changed.',
  );
  found.push({ table: 'Verification', detail: 'synthetic record intact' });

  const intents = await restored.query<{
    status: string;
    idempotencyKey: string;
    recipientOverride: string | null;
  }>(
    `SELECT [status], [idempotencyKey], [recipientOverride]
     FROM [dbo].[IdentityCommunicationIntent] WHERE [id] = N'${f.intentId}';`,
  );
  expect(intents[0]?.status === 'pending', 'Restored intent status changed.');
  expect(
    intents[0]?.idempotencyKey === `identity.password-changed:${f.accountId}:${TAG}`,
    'Restored intent idempotency key changed.',
  );
  // Present as a column and NULL as written. The bounded recipient is part of
  // the current schema, so a restore that predated it would be caught here.
  expect(intents[0]?.recipientOverride === null, 'Restored intent override changed.');
  found.push({
    table: 'IdentityCommunicationIntent',
    detail: 'pending, key intact, recipientOverride column present',
  });

  await verifyRestoredAuthorization(restored, fixture, found);

  const operations = await restored.query<{
    kind: string;
    initiatingSessionId: string | null;
    committedAt: Date | null;
    completedAt: Date | null;
  }>(
    `SELECT [kind], [initiatingSessionId], [committedAt], [completedAt]
     FROM [dbo].[IdentitySecurityOperation]
     WHERE [id] = N'${f.securityOperationId}';`,
  );
  expect(
    operations[0]?.kind === 'email-change',
    'Restored security operation kind changed.',
  );
  expect(
    operations[0]?.initiatingSessionId === f.sessionId,
    'Restored security operation session evidence changed.',
  );
  expect(
    operations[0]?.committedAt !== null && operations[0]?.completedAt !== null,
    'Restored security operation lost its committed/completed evidence.',
  );
  found.push({
    table: 'IdentitySecurityOperation',
    detail: 'token-free committed/completed evidence intact',
  });

  const deliveries = await restored.query<{ status: string; sourceReference: string }>(
    `SELECT [status], [sourceReference] FROM [dbo].[EmailDelivery]
     WHERE [id] = N'${f.deliveryId}';`,
  );
  expect(deliveries[0]?.status === 'pending', 'Restored delivery status changed.');
  expect(
    deliveries[0]?.sourceReference === `identity:account:${f.accountId}:notice`,
    'Restored delivery source reference changed.',
  );
  found.push({ table: 'EmailDelivery', detail: 'pending delivery intact' });

  const suppressions = await restored.query<{ reason: string; scope: string }>(
    `SELECT [reason], [scope] FROM [dbo].[EmailSuppression]
     WHERE [id] = N'${f.suppressionId}';`,
  );
  expect(suppressions[0]?.reason === 'bounce', 'Restored suppression reason changed.');
  expect(
    suppressions[0]?.scope === 'transactional',
    'Restored suppression scope changed — the scope distinction did not survive.',
  );
  found.push({ table: 'EmailSuppression', detail: 'bounce/transactional intact' });

  const events = await restored.query<{ type: string; processedAt: Date | null }>(
    `SELECT [type], [processedAt] FROM [dbo].[ProviderEvent]
     WHERE [id] = N'${f.providerEventId}';`,
  );
  expect(events[0]?.type === 'email.bounced', 'Restored provider event type changed.');
  // A COMPLETED event must restore as completed. Losing `processedAt` would
  // make a replay redo an effect the platform had already applied.
  expect(events[0]?.processedAt !== null, 'Restored provider event lost processedAt.');
  found.push({ table: 'ProviderEvent', detail: 'completed event, processedAt intact' });

  const counters = await restored.query<{ count: number }>(
    `SELECT [count] FROM [dbo].[RateLimitCounter] WHERE [key] = N'${f.rateLimitKey}';`,
  );
  expect(Number(counters[0]?.count) === 3, 'Restored rate-limit counter changed.');
  found.push({ table: 'RateLimitCounter', detail: 'window count 3 intact' });

  const audits = await restored.query<{ action: string; targetId: string }>(
    `SELECT [action], [targetId] FROM [dbo].[AuditLog] WHERE [id] = N'${f.auditId}';`,
  );
  expect(
    audits[0]?.action === 'identity.password.changed',
    'Restored audit row action changed.',
  );
  expect(audits[0]?.targetId === f.accountId, 'Restored audit row target changed.');
  found.push({ table: 'AuditLog', detail: 'security event intact' });

  return found;
}

/**
 * Proves the restored database still ENFORCES its foreign keys.
 *
 * Data surviving is one property; the constraints that keep it coherent
 * surviving is another, and a restore that brought rows across without their
 * relationships would satisfy every check above.
 */
export async function verifyRestoredIntegrity(
  restored: SqlSession,
  fixture: Phase2Fixture,
): Promise<string> {
  assertSafe(fixture);

  const untrusted = await restored.query<{ name: string }>(`
    SELECT name FROM sys.foreign_keys WHERE is_not_trusted = 1 OR is_disabled = 1;
  `);
  if (untrusted.length > 0) {
    throw new Error(
      `Restored foreign keys are disabled or untrusted: ` +
        untrusted.map((row) => row.name).join(', '),
    );
  }

  // And it must actually REFUSE an orphan, not merely describe a constraint.
  try {
    await restored.query(`
      INSERT INTO [dbo].[Session] ([id], [token], [userId], [expiresAt], [createdAt], [updatedAt])
      VALUES (N'${randomUUID()}', N'orphan-${fixture.runId}',
              N'00000000-0000-0000-0000-000000000000',
              DATEADD(day, 1, SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
    `);
    throw new Error('Restored database ACCEPTED a Session with no User.');
  } catch (error) {
    const number = (error as { number?: number }).number;
    // 547 = foreign key violation. Anything else means it failed for an
    // unrelated reason and this proved nothing.
    if (number !== 547) throw error;
  }

  return `${untrusted.length === 0 ? 'all trusted' : ''}, orphan INSERT refused (547)`;
}

/**
 * Reads the Chunk-2 authorisation state back out of the RESTORED database.
 *
 * VALUES AND RELATIONSHIPS, like the rest of this module: the bundle is walked
 * through the real foreign key to `Permission`, the assignment through the one
 * to `Role`, and the singleton bootstrap record is checked for the exact key
 * its CHECK constraint permits. A restore that recovered the tables but lost
 * the graph between them would satisfy a count and fail here.
 */
async function verifyRestoredAuthorization(
  restored: SqlSession,
  fixture: Phase2Fixture,
  found: Phase2Restored[],
): Promise<void> {
  const f = fixture;

  // THE SEEDED CATALOGUE. It is migration-controlled foundation data, so it
  // travels in the artifact like any other row.
  //
  // COUNTED AGAINST THE DELIVERED VOCABULARY rather than a fixed number. The
  // catalogue grows when a phase that owns new administrative surfaces ships
  // one — Phase 3B appended Taxonomy's two — so a literal here would have to be
  // edited by every such phase, and the phase that forgot would report the
  // omission as a restore failure. What must not change is that the RESTORE
  // brings back exactly what the migrations put there.
  const [catalogue] = await restored.query<{ total: number }>(
    'SELECT COUNT_BIG(*) AS total FROM [dbo].[Permission];',
  );
  expect(
    Number(catalogue?.total) === EXPECTED_PERMISSION_COUNT,
    `Restored permission catalogue holds ${catalogue?.total ?? 0} rows, expected ` +
      `${EXPECTED_PERMISSION_COUNT}.`,
  );
  found.push({
    table: 'Permission',
    detail: `${EXPECTED_PERMISSION_COUNT} migration-seeded permissions`,
  });

  // THE PROTECTED BUNDLE IS THE CATALOGUE LESS ITS EXTERNALLY GATED KEYS, which
  // is why extending the catalogue with an ordinary key is a privilege change
  // and extending it with a gated one is not.
  const [protectedRole] = await restored.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Role] AS r
     JOIN [dbo].[RolePermission] AS rp ON rp.[roleId] = r.[id]
     WHERE r.[key] = N'platform-administrator' AND r.[system] = 1;`,
  );
  expect(
    Number(protectedRole?.total) === EXPECTED_BUNDLE_COUNT,
    'Restored protected role lost part of its permission bundle.',
  );
  found.push({ table: 'Role', detail: 'protected system role with its full bundle' });

  const [custom] = await restored.query<{ name: string; system: boolean | number }>(
    `SELECT [name], [system] FROM [dbo].[Role] WHERE [id] = N'${f.customRoleId}';`,
  );
  expect(custom !== undefined, 'Restored database has no rehearsal custom role.');
  expect(custom?.name === 'Recovery Rehearsal Role', 'Restored custom role renamed.');
  expect(!custom?.system, 'Restored custom role became a protected one.');

  const [bundle] = await restored.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[RolePermission] AS rp
     JOIN [dbo].[Permission] AS p ON p.[key] = rp.[permissionKey]
     WHERE rp.[roleId] = N'${f.customRoleId}';`,
  );
  expect(
    Number(bundle?.total) === 2,
    'Restored custom bundle did not survive with its catalogue relationship.',
  );
  found.push({
    table: 'RolePermission',
    detail: '2 memberships joined to the catalogue',
  });

  const [assignment] = await restored.query<{
    reason: string | null;
    revokedAt: Date | null;
  }>(
    `SELECT ra.[grantedReason] AS reason, ra.[revokedAt] AS revokedAt
     FROM [dbo].[RoleAssignment] AS ra
     JOIN [dbo].[Role] AS r ON r.[id] = ra.[roleId]
     JOIN [dbo].[User] AS u ON u.[id] = ra.[userId]
     WHERE ra.[id] = N'${f.assignmentId}';`,
  );
  expect(assignment !== undefined, 'Restored role assignment did not survive.');
  expect(
    assignment?.reason === `${TAG}-${f.runId}`,
    'Restored assignment lost its grant reason.',
  );
  expect(assignment?.revokedAt === null, 'Restored assignment came back revoked.');
  found.push({
    table: 'RoleAssignment',
    detail: 'live assignment joined to its User and Role',
  });

  const [protectedAssignment] = await restored.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total
     FROM [dbo].[RoleAssignment] ra
     JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
     JOIN [dbo].[User] u ON u.[id] = ra.[userId]
     WHERE ra.[id] = N'${f.protectedAssignmentId}'
       AND r.[key] = N'platform-administrator'
       AND r.[deactivatedAt] IS NULL
       AND ra.[revokedAt] IS NULL
       AND u.[status] = N'active'
       AND u.[emailVerified] = 1;`,
  );
  expect(
    Number(protectedAssignment?.total) === 1,
    'Restored bootstrap has no usable protected-role holder.',
  );
  found.push({
    table: 'RoleAssignment',
    detail: 'usable protected-role holder preserves the bootstrap invariant',
  });

  const [grant] = await restored.query<{ purpose: string }>(
    `SELECT sg.[purpose] FROM [dbo].[StepUpGrant] AS sg
     JOIN [dbo].[Session] AS s ON s.[id] = sg.[sessionId]
     WHERE sg.[id] = N'${f.stepUpGrantId}';`,
  );
  expect(
    grant?.purpose === 'privilege-administration',
    'Restored step-up grant did not survive with its session relationship.',
  );
  found.push({ table: 'StepUpGrant', detail: 'grant joined to its Session' });

  const [factor] = await restored.query<{ verified: boolean | number; secret: string }>(
    `SELECT [verified], [secret] FROM [dbo].[TwoFactor] WHERE [id] = N'${f.twoFactorId}';`,
  );
  expect(factor !== undefined, 'Restored second-factor record did not survive.');
  expect(Boolean(factor?.verified), 'Restored second factor lost its verified flag.');
  expect(
    factor?.secret === `not-a-real-secret-${TAG}-${f.runId}`,
    'Restored second-factor payload changed.',
  );
  found.push({ table: 'TwoFactor', detail: 'verified factor, payload intact' });

  const [posture] = await restored.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[PrivilegedSecurityPosture]
     WHERE [userId] = N'${f.accountId}'
       AND [recoveryCodesConfirmedAt] IS NOT NULL
       AND [reenrolmentRequiredAt] IS NULL;`,
  );
  expect(
    Number(posture?.total) === 1,
    'Restored privileged posture did not survive complete.',
  );
  found.push({
    table: 'PrivilegedSecurityPosture',
    detail: 'complete posture, no re-enrolment demanded',
  });

  const [bootstrap] = await restored.query<{
    id: string;
    operatorLogin: string;
    ticket: string;
  }>('SELECT [id], [operatorLogin], [ticket] FROM [dbo].[IdentityBootstrap];');
  expect(bootstrap !== undefined, 'Restored bootstrap record did not survive.');
  expect(
    bootstrap?.id === 'platform-administrator',
    'Restored bootstrap record carries an unexpected key.',
  );
  expect(
    bootstrap?.operatorLogin === 'rehearsal_operator',
    'Restored bootstrap lost the operator identity it recorded.',
  );
  expect(
    bootstrap?.ticket === `${TAG}-${f.runId}`,
    'Restored bootstrap lost its ticket.',
  );
  found.push({
    table: 'IdentityBootstrap',
    detail: 'one-time record intact, operator and ticket preserved',
  });
}
