import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-26 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That who
 * belongs to the organisation came back exactly as it was — every Membership
 * still the member's own, made from their own approved application on its own
 * type — that every application is still where its lifecycle left it, and
 * that the mail owed about them is still owed to the right person:
 *
 *   - four types: a published English-primary type with words in all three
 *     locales, a published Urdu-primary type with Urdu words only, an archived
 *     type and a draft type whose only words are its Arabic primary ones;
 *   - three synthetic accounts: an applicant with a SUBMITTED application and
 *     an UNDER-REVIEW one; a member whose APPROVED application made an ACTIVE
 *     Membership, beside a WITHDRAWN application of their own; and a former
 *     member whose approval made a Membership they CLOSED, beside a REJECTED
 *     application;
 *   - a PENDING intent owed to the applicant about their submission, and a
 *     RELAYED intent about the former member's closure.
 *
 * NOTHING HERE IS ANYBODY'S DATA. Every name and title is a
 * `NON_MEMBERSHIP_FIXTURE_…` sentinel, every address `@membership-proof.invalid`,
 * every key a `recovery-membership-…` sentinel. Rows are written directly by
 * the owner: the recovery databases are disposable and created by the run that
 * writes them, and the adapters' own write paths are proved by
 * `db:test:permissions` and the integration suites.
 */

const TEXT = {
  applicant: 'NON_MEMBERSHIP_FIXTURE_ACCOUNT applicant',
  member: 'NON_MEMBERSHIP_FIXTURE_ACCOUNT member',
  former: 'NON_MEMBERSHIP_FIXTURE_ACCOUNT former member',
  title: 'NON_MEMBERSHIP_FIXTURE_TYPE title',
  urdu: 'NON_MEMBERSHIP_FIXTURE_TYPE عنوان',
  arabic: 'NON_MEMBERSHIP_FIXTURE_TYPE عنوان عربي',
} as const;

export interface Phase26Fixture {
  readonly runId: string;
  readonly applicantId: string;
  readonly memberId: string;
  readonly formerId: string;
  readonly typeEnId: string;
  readonly typeUrId: string;
  readonly typeArchivedId: string;
  readonly typeDraftId: string;
  readonly submittedId: string;
  readonly reviewId: string;
  readonly approvedId: string;
  readonly withdrawnId: string;
  readonly formerApprovedId: string;
  readonly rejectedId: string;
  readonly activeId: string;
  readonly closedId: string;
  readonly pendingIntentId: string;
  readonly relayedIntentId: string;
}

export function newPhase26Fixture(): Phase26Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    applicantId: randomUUID(),
    memberId: randomUUID(),
    formerId: randomUUID(),
    typeEnId: randomUUID(),
    typeUrId: randomUUID(),
    typeArchivedId: randomUUID(),
    typeDraftId: randomUUID(),
    submittedId: randomUUID(),
    reviewId: randomUUID(),
    approvedId: randomUUID(),
    withdrawnId: randomUUID(),
    formerApprovedId: randomUUID(),
    rejectedId: randomUUID(),
    activeId: randomUUID(),
    closedId: randomUUID(),
    pendingIntentId: randomUUID(),
    relayedIntentId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase26Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-26 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-26 fixture field '${name}' is not a generated identifier.`);
  }
}

const AT = '2026-10-09T06:00:00';
const REVIEWED = '2026-10-09T07:00:00';
const DECIDED = '2026-10-09T08:00:00';
const CLOSED = '2026-10-09T09:00:00';

/**
 * Writes the populated Phase-26 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real keys, CHECKs and triggers are
 * exercised: each type made a draft at version one and published only once
 * its primary locale's words exist, one version at a time; each application
 * made `submitted` on a published type and moved only along its lifecycle;
 * each Membership made active from its own approved application on a
 * published type, and closed one version on; each intent naming its own
 * record and owed to that record's own account.
 */
export async function writePhase26Fixture(
  sql: SqlSession,
  fixture: Phase26Fixture,
): Promise<void> {
  assertSafe(fixture);
  const f = fixture;
  const stem = f.runId.slice(0, 16);
  const account = (id: string, label: string, name: string): string =>
    `(N'${id}', N'${name}', N'${label}-${stem}@membership-proof.invalid', 0, '${AT}', '${AT}', N'en', N'active', 0)`;
  const words = (typeId: string, locale: string, title: string): string =>
    `(N'${typeId}', N'${locale}', N'${title}', N'NON_MEMBERSHIP_FIXTURE_TYPE summary', N'NON_MEMBERSHIP_FIXTURE_TYPE description', N'NON_MEMBERSHIP_FIXTURE_TYPE guidance', '${AT}')`;

  // ---- the accounts, the types and their words -------------------------------------
  await sql.query(`
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
      ${account(f.applicantId, 'applicant', TEXT.applicant)},
      ${account(f.memberId, 'member', TEXT.member)},
      ${account(f.formerId, 'former', TEXT.former)};
    INSERT INTO [dbo].[MembershipType] ([id],[state],[primaryLocale],[displayOrder],[version],[createdAt],[updatedAt],[publishedAt],[archivedAt]) VALUES
      (N'${f.typeEnId}', N'draft', N'en', 0, 1, '${AT}', '${AT}', NULL, NULL),
      (N'${f.typeUrId}', N'draft', N'ur', 1, 1, '${AT}', '${AT}', NULL, NULL),
      (N'${f.typeArchivedId}', N'draft', N'en', 2, 1, '${AT}', '${AT}', NULL, NULL),
      (N'${f.typeDraftId}', N'draft', N'ar', 3, 1, '${AT}', '${AT}', NULL, NULL);
    INSERT INTO [dbo].[MembershipTypeTranslation] ([membershipTypeId],[locale],[title],[summary],[description],[guidance],[updatedAt]) VALUES
      ${words(f.typeEnId, 'en', TEXT.title)},
      ${words(f.typeEnId, 'ur', TEXT.urdu)},
      ${words(f.typeEnId, 'ar', TEXT.arabic)},
      ${words(f.typeUrId, 'ur', TEXT.urdu)},
      ${words(f.typeArchivedId, 'en', TEXT.title)},
      ${words(f.typeDraftId, 'ar', TEXT.arabic)};
    UPDATE [dbo].[MembershipType] SET [state]=N'published', [publishedAt]='${AT}', [version]=2
      WHERE [id] IN (N'${f.typeEnId}', N'${f.typeUrId}', N'${f.typeArchivedId}');
    UPDATE [dbo].[MembershipType] SET [state]=N'archived', [archivedAt]='${REVIEWED}', [version]=3, [updatedAt]='${REVIEWED}'
      WHERE [id]=N'${f.typeArchivedId}';
  `);

  // ---- the applications, along their lifecycles ------------------------------------
  const application = (id: string, user: string, typeId: string): string =>
    `(N'${id}', N'${user}', N'${typeId}', '${AT}', '${AT}')`;
  await sql.query(`
    INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[submittedAt],[updatedAt]) VALUES
      ${application(f.submittedId, f.applicantId, f.typeEnId)},
      ${application(f.reviewId, f.applicantId, f.typeUrId)},
      ${application(f.approvedId, f.memberId, f.typeEnId)},
      ${application(f.withdrawnId, f.memberId, f.typeUrId)},
      ${application(f.formerApprovedId, f.formerId, f.typeEnId)},
      ${application(f.rejectedId, f.formerId, f.typeUrId)};
    UPDATE [dbo].[MembershipApplication] SET [status]=N'under_review', [reviewStartedAt]='${REVIEWED}', [version]=2, [updatedAt]='${REVIEWED}'
      WHERE [id] IN (N'${f.reviewId}', N'${f.approvedId}', N'${f.formerApprovedId}', N'${f.rejectedId}');
    UPDATE [dbo].[MembershipApplication] SET [status]=N'approved', [decidedAt]='${DECIDED}', [version]=3, [updatedAt]='${DECIDED}'
      WHERE [id] IN (N'${f.approvedId}', N'${f.formerApprovedId}');
    UPDATE [dbo].[MembershipApplication] SET [status]=N'rejected', [decidedAt]='${DECIDED}', [version]=3, [updatedAt]='${DECIDED}'
      WHERE [id]=N'${f.rejectedId}';
    UPDATE [dbo].[MembershipApplication] SET [status]=N'withdrawn', [withdrawalSource]=N'applicant', [withdrawnAt]='${REVIEWED}', [version]=2, [updatedAt]='${REVIEWED}'
      WHERE [id]=N'${f.withdrawnId}';
  `);

  // ---- the Memberships the approvals made, and the mail owed --------------------
  await sql.query(`
    INSERT INTO [dbo].[Membership] ([id],[memberUserId],[membershipTypeId],[sourceApplicationId],[activatedAt],[updatedAt]) VALUES
      (N'${f.activeId}', N'${f.memberId}', N'${f.typeEnId}', N'${f.approvedId}', '${DECIDED}', '${DECIDED}'),
      (N'${f.closedId}', N'${f.formerId}', N'${f.typeEnId}', N'${f.formerApprovedId}', '${DECIDED}', '${DECIDED}');
    UPDATE [dbo].[Membership] SET [status]=N'closed', [closureSource]=N'member', [closedAt]='${CLOSED}', [version]=2, [updatedAt]='${CLOSED}'
      WHERE [id]=N'${f.closedId}';
    INSERT INTO [dbo].[MembershipCommunicationIntent] ([id],[purpose],[recipientUserId],[applicationId],[membershipId],[dueAt],[state],[idempotencyKey],[claimedUntil],[relayedAt],[createdAt]) VALUES
      (N'${f.pendingIntentId}', N'membership.application.submitted', N'${f.applicantId}', N'${f.submittedId}', NULL, '${AT}', N'pending', N'recovery-membership-${stem}-submitted', NULL, NULL, '${AT}'),
      (N'${f.relayedIntentId}', N'membership.closed', N'${f.formerId}', NULL, N'${f.closedId}', '${CLOSED}', N'pending', N'recovery-membership-${stem}-closed', NULL, NULL, '${CLOSED}');
    UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'relayed', [relayedAt]='${CLOSED}'
      WHERE [id]=N'${f.relayedIntentId}';
  `);
}

/** Every authoritative Phase-26 row this fixture wrote, in a stable order. */
export async function capturePhase26Fixture(
  sql: SqlSession,
  fixture: Phase26Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const accounts = `N'${f.applicantId}',N'${f.memberId}',N'${f.formerId}'`;
  const types = `N'${f.typeEnId}',N'${f.typeUrId}',N'${f.typeArchivedId}',N'${f.typeDraftId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'User',
      `SELECT * FROM [dbo].[User] WHERE [id] IN (${accounts}) ORDER BY [email]`,
      3,
    ],
    [
      'MembershipType',
      `SELECT * FROM [dbo].[MembershipType] WHERE [id] IN (${types}) ORDER BY [displayOrder]`,
      4,
    ],
    [
      'MembershipTypeTranslation',
      `SELECT * FROM [dbo].[MembershipTypeTranslation] WHERE [membershipTypeId] IN (${types}) ORDER BY [membershipTypeId], [locale]`,
      6,
    ],
    [
      'MembershipApplication',
      `SELECT * FROM [dbo].[MembershipApplication] WHERE [applicantUserId] IN (${accounts}) ORDER BY [id]`,
      6,
    ],
    [
      'Membership',
      `SELECT * FROM [dbo].[Membership] WHERE [memberUserId] IN (${accounts}) ORDER BY [id]`,
      2,
    ],
    [
      'MembershipCommunicationIntent',
      `SELECT * FROM [dbo].[MembershipCommunicationIntent] WHERE [recipientUserId] IN (${accounts}) ORDER BY [purpose]`,
      2,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-26 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-26 tables whose constraints and triggers must return intact. */
const PHASE26_TABLES = [
  'MembershipType',
  'MembershipTypeTranslation',
  'MembershipApplication',
  'Membership',
  'MembershipCommunicationIntent',
] as const;

/** Every Membership trigger, exactly. */
const PHASE26_TRIGGERS = [
  'MembershipApplicationIntegrity',
  'MembershipIntegrity',
  'MembershipIntentIntegrity',
  'MembershipTypeIntegrity',
  'MembershipTypeTranslationIntegrity',
].join(',');

/**
 * Both filtered claims, exactly — compared as a set, because the server's
 * collation and JavaScript order an underscore differently.
 */
const PHASE26_FILTERED = 'MembershipApplication_open_key,Membership_active_key';

/**
 * Verifies the restored Membership state and returns one line of what was
 * proved.
 *
 * BEYOND ROW EQUALITY: every name, address, title and key is still an
 * unmistakable sentinel, the Urdu and Arabic words intact; every type is in
 * the state its instants say; no account holds two open applications or two
 * active Memberships of one type; every Membership is its member's OWN — made
 * from an approved application of the same account and type — and the
 * approval made exactly one; the open applications and the closed Membership
 * are where their lifecycles left them; the pending intent is still owed to
 * the applicant about their own submission and the relayed one is not owed
 * again; both Membership keys are still bundled; no payment, fee, dues,
 * invoice or donation artifact exists in the schema or the vocabulary; and
 * every Phase-26 CHECK, foreign key, trigger and filtered claim is enabled and
 * trusted, with no key cascading at all.
 */
export async function verifyRestoredPhase26(
  sql: SqlSession,
  fixture: Phase26Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase26Fixture(sql, fixture),
    expected,
    'Phase-26 Membership authoritative values changed during recovery.',
  );
  const f = fixture;
  const accounts = `N'${f.applicantId}',N'${f.memberId}',N'${f.formerId}'`;
  const types = `N'${f.typeEnId}',N'${f.typeUrId}',N'${f.typeArchivedId}',N'${f.typeDraftId}'`;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (${accounts})
         AND ([name] NOT LIKE N'NON[_]MEMBERSHIP[_]FIXTURE[_]%' OR [email] NOT LIKE N'%@membership-proof.invalid')) AS [accounts],
      (SELECT COUNT(*) FROM [dbo].[MembershipTypeTranslation] WHERE [membershipTypeId] IN (${types})
         AND ([title] NOT LIKE N'NON[_]MEMBERSHIP[_]FIXTURE[_]%' OR [summary] NOT LIKE N'NON[_]MEMBERSHIP[_]FIXTURE[_]%')) AS [words],
      (SELECT COUNT(*) FROM [dbo].[MembershipCommunicationIntent] WHERE [recipientUserId] IN (${accounts})
         AND [idempotencyKey] NOT LIKE N'recovery-membership-%') AS [keys],
      (SELECT COUNT(*) FROM [dbo].[MembershipTypeTranslation] WHERE [membershipTypeId] IN (${types})
         AND [locale] IN (N'ur', N'ar') AND [title] NOT LIKE N'%' + NCHAR(1593) + N'%') AS [script];
  `);
  if (JSON.stringify(labelled) !== '{"accounts":0,"words":0,"keys":0,"script":0}') {
    throw new Error(
      `Restored Phase-26 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Uniqueness, ownership, the approval's one Membership and the owed mail —
  // through the same joins and predicates the adapter reads by.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([state], N',') WITHIN GROUP (ORDER BY [displayOrder])
         FROM [dbo].[MembershipType] WHERE [id] IN (${types})) AS [types],
      (SELECT COUNT(*) FROM [dbo].[MembershipType] t
        WHERE t.[state] = N'published' AND t.[id] IN (${types})
          AND EXISTS (SELECT 1 FROM [dbo].[MembershipTypeTranslation] w
                      WHERE w.[membershipTypeId] = t.[id] AND w.[locale] = t.[primaryLocale])) AS [publishedWithWords],
      (SELECT COUNT(*) FROM (
         SELECT [applicantUserId], [membershipTypeId] FROM [dbo].[MembershipApplication]
          WHERE [status] IN (N'submitted', N'under_review')
          GROUP BY [applicantUserId], [membershipTypeId] HAVING COUNT(*) > 1) d) AS [doubleOpen],
      (SELECT COUNT(*) FROM (
         SELECT [memberUserId], [membershipTypeId] FROM [dbo].[Membership]
          WHERE [status] = N'active'
          GROUP BY [memberUserId], [membershipTypeId] HAVING COUNT(*) > 1) d) AS [doubleActive],
      (SELECT COUNT(*) FROM [dbo].[Membership] m
         LEFT JOIN [dbo].[MembershipApplication] a ON a.[id] = m.[sourceApplicationId]
           AND a.[applicantUserId] = m.[memberUserId] AND a.[membershipTypeId] = m.[membershipTypeId]
           AND a.[status] = N'approved' AND a.[decidedAt] = m.[activatedAt]
        WHERE m.[memberUserId] IN (${accounts}) AND a.[id] IS NULL) AS [foreignMemberships],
      (SELECT STRING_AGG(m.[status] + N':' + ISNULL(m.[closureSource], N'-'), N',') WITHIN GROUP (ORDER BY m.[status])
         FROM [dbo].[Membership] m
         JOIN [dbo].[MembershipApplication] a ON a.[id] = m.[sourceApplicationId]
        WHERE a.[id] IN (N'${f.approvedId}', N'${f.formerApprovedId}')) AS [approvalsMade],
      (SELECT [memberUserId] FROM [dbo].[Membership]
        WHERE [status] = N'active' AND [sourceApplicationId] = N'${f.approvedId}') AS [activeMember],
      (SELECT STRING_AGG([status] + N':' + ISNULL([withdrawalSource], N'-'), N',') WITHIN GROUP (ORDER BY [status])
         FROM [dbo].[MembershipApplication] WHERE [applicantUserId] IN (${accounts})) AS [applications],
      (SELECT COUNT(*) FROM [dbo].[MembershipApplication] a
         JOIN [dbo].[MembershipCommunicationIntent] i ON i.[applicationId] = a.[id] AND i.[recipientUserId] = a.[applicantUserId]
        WHERE i.[id] = N'${f.pendingIntentId}' AND i.[state] = N'pending' AND i.[relayedAt] IS NULL
          AND i.[purpose] = N'membership.application.submitted' AND a.[status] = N'submitted'
          AND a.[applicantUserId] = N'${f.applicantId}') AS [owed],
      (SELECT COUNT(*) FROM [dbo].[Membership] m
         JOIN [dbo].[MembershipCommunicationIntent] i ON i.[membershipId] = m.[id] AND i.[recipientUserId] = m.[memberUserId]
        WHERE i.[id] = N'${f.relayedIntentId}' AND i.[state] = N'relayed' AND i.[relayedAt] IS NOT NULL
          AND m.[status] = N'closed') AS [relayed],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id] = rp.[roleId]
        WHERE o.[key] = N'platform-administrator'
          AND rp.[permissionKey] IN (N'membership.read', N'membership.administer')) AS [bundled];
  `);
  const expectedState = {
    types: 'published,published,archived,draft',
    publishedWithWords: 2,
    doubleOpen: 0,
    doubleActive: 0,
    foreignMemberships: 0,
    approvalsMade: 'active:-,closed:member',
    activeMember: f.memberId,
    applications:
      'approved:-,approved:-,rejected:-,submitted:-,under_review:-,withdrawn:applicant',
    owed: 1,
    relayed: 1,
    bundled: 2,
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-26 Membership state is broken: ${JSON.stringify(state)}.`,
    );
  }

  // NO PAYMENT CONCEPT survived or arrived with the restore: no column of the
  // context names one, no table anywhere is a payment record of Membership's,
  // and no key of the vocabulary grants one.
  const tables = PHASE26_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const [payment] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns WHERE [object_id] IN (${tables})
         AND ([name] LIKE N'%amount%' OR [name] LIKE N'%currency%' OR [name] LIKE N'%fee%'
              OR [name] LIKE N'%dues%' OR [name] LIKE N'%price%' OR [name] LIKE N'%payment%'
              OR [name] LIKE N'%invoice%' OR [name] LIKE N'%receipt%' OR [name] LIKE N'%provider%'
              OR [name] LIKE N'%transaction%' OR [name] LIKE N'%donat%'
              OR [name] IN (N'targetType', N'targetId'))) AS [columns],
      (SELECT COUNT(*) FROM sys.tables
        WHERE [name] LIKE N'Membership%' AND [name] NOT IN (${PHASE26_TABLES.map((table) => `N'${table}'`).join(',')})) AS [tables],
      (SELECT COUNT(*) FROM [dbo].[Permission]
        WHERE [key] LIKE N'membership.%' AND [key] NOT IN (N'membership.read', N'membership.administer')) AS [keys];
  `);
  if (JSON.stringify(payment) !== '{"columns":0,"tables":0,"keys":0}') {
    throw new Error(
      `Restored Phase-26 schema carries a payment or foreign artifact: ${JSON.stringify(payment)}.`,
    );
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1 OR delete_referential_action<>0 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-26 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: string | null;
    filtered: string | null;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.triggers
         WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.indexes
         WHERE [object_id] IN (${tables}) AND has_filter=1 AND is_unique=1) AS [filtered];`,
  );
  // 5 CHECKs, 12 foreign keys none of which cascades, the 5 triggers and the
  // two filtered claims, exactly as the migration creates them: a restore that
  // silently lost one would otherwise read as "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 5 ||
    Number(counts?.keys ?? 0) !== 12 ||
    counts?.triggers !== PHASE26_TRIGGERS ||
    (counts.filtered ?? '').split(',').sort().join(',') !== PHASE26_FILTERED
  ) {
    throw new Error(
      `Restored Phase-26 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'published, archived and draft types with their Urdu and Arabic words, submitted, under-review, approved, rejected and withdrawn applications, one active and one member-closed Membership each made from its own approval, no account with two open applications or two active Memberships of a type, a pending intent owed to its own applicant and a relayed one not owed again, both Membership keys bundled, no payment artifact, and every key, CHECK, trigger and filtered claim trusted with no cascade';
}
