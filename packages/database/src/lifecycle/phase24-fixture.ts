import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-24 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That
 * messaging came back exactly as it was switched on — the three fixture
 * activations and nothing more — that every conversation still names the
 * people and Course it was opened between, that every message is still in
 * its place, by its sender, with its moderation, that every attachment still
 * names its own Storage asset and can still be released by its token alone,
 * and that support and moderation authority is still exactly who Identity
 * says it is:
 *
 *   - the owner's fixture activations of `support`, `teacher-student` and
 *     `student-student` (authority `fixture`, no evidence);
 *   - a teacher-student conversation between the Phase-23 live teacher and
 *     the Phase-22 learner on the Phase-22 published live Course, with three
 *     ordered messages, both read positions, the teacher's first message
 *     reported by the learner and WITHHELD by a moderation decision whose
 *     report is resolved, and a conversation-level report still open;
 *   - three attachments on the teacher's third message — a JPEG, a PNG and a
 *     PDF at places 0, 1 and 2 — each naming a `clean` Storage asset whose
 *     release digest is the SHA-256 of the attachment's own token, and one
 *     `releasing` attachment of an unsent upload, its asset already gone;
 *   - a block by the learner of the support requester;
 *   - a support conversation: a synthetic requester, a synthetic member of
 *     staff holding a synthetic role carrying `messaging.support` under a LIVE
 *     assignment and the active claim, and a second member of staff whose
 *     assignment of that role was REVOKED and whose claim was released;
 *   - a synthetic moderator holding a synthetic role carrying
 *     `messaging.moderate` under a live assignment, who made the decision;
 *   - a TERMINAL conversation: the live teacher and a synthetic learner whose
 *     account is CLOSED, closed for `account-closed`, the closed account's
 *     participation ended.
 *
 * BYTES ARE NOT DATABASE STATE. The Storage assets are METADATA ONLY — key,
 * measured type, size, checksum, state and release digest. The files
 * themselves live in Storage's file store, outside the database a backup
 * carries; their custody and recovery are Storage's own proof
 * (`tests/storage/recovery.integration.test.ts`), never this one's.
 *
 * NOTHING HERE IS ANYBODY'S DATA. Every name and body is a
 * `NON_MESSAGING_FIXTURE_…` sentinel, every address `@messaging-proof.invalid`,
 * every role key a `recovery-messaging-…` sentinel and every storage key a
 * `recovery/messaging/…` sentinel; the Course, the learner and the teacher are
 * the Phase-22 and Phase-23 fixtures' own synthetic rows. Rows are written
 * directly by the owner: the recovery databases are disposable and created by
 * the run that writes them, and the adapters' own write paths are proved by
 * `db:test:permissions` and the integration suites.
 */

const TEXT = {
  requester: 'NON_MESSAGING_FIXTURE_ACCOUNT requester',
  staff: 'NON_MESSAGING_FIXTURE_ACCOUNT support staff',
  revokedStaff: 'NON_MESSAGING_FIXTURE_ACCOUNT revoked support staff',
  moderator: 'NON_MESSAGING_FIXTURE_ACCOUNT moderator',
  closed: 'NON_MESSAGING_FIXTURE_ACCOUNT closed learner',
  operator: 'NON_MESSAGING_FIXTURE_OPERATOR',
  supportRole: 'NON_MESSAGING_FIXTURE_ROLE support',
  moderatorRole: 'NON_MESSAGING_FIXTURE_ROLE moderation',
  body: 'NON_MESSAGING_FIXTURE_MESSAGE',
  file: 'NON_MESSAGING_FIXTURE_FILE',
} as const;

export interface Phase24Fixture {
  readonly runId: string;
  readonly requesterId: string;
  readonly staffId: string;
  readonly revokedStaffId: string;
  readonly moderatorId: string;
  readonly closedLearnerId: string;
  readonly supportRoleId: string;
  readonly moderatorRoleId: string;
  readonly staffAssignmentId: string;
  readonly revokedStaffAssignmentId: string;
  readonly moderatorAssignmentId: string;
  readonly taughtId: string;
  readonly supportId: string;
  readonly terminalId: string;
  readonly teacherParticipantId: string;
  readonly learnerParticipantId: string;
  readonly requesterParticipantId: string;
  readonly staffParticipantId: string;
  readonly revokedStaffParticipantId: string;
  readonly terminalTeacherParticipantId: string;
  readonly terminalClosedParticipantId: string;
  readonly withheldMessageId: string;
  readonly replyMessageId: string;
  readonly attachedMessageId: string;
  readonly requesterMessageId: string;
  readonly staffMessageId: string;
  readonly terminalMessageId: string;
  readonly jpegAssetId: string;
  readonly pngAssetId: string;
  readonly pdfAssetId: string;
  readonly jpegAttachmentId: string;
  readonly pngAttachmentId: string;
  readonly pdfAttachmentId: string;
  readonly releasingAttachmentId: string;
  readonly messageReportId: string;
  readonly conversationReportId: string;
  readonly decisionId: string;
}

export interface Phase24References {
  /** The Phase-22 published live Course the direct conversations name. */
  readonly liveCourseId: string;
  /** The Phase-22 learner, enrolled on that Course. */
  readonly learnerId: string;
  /** The Phase-23 live teacher, scoped to that Course under `teaching.perform`. */
  readonly teacherId: string;
}

export function newPhase24Fixture(): Phase24Fixture {
  const id = (): string => randomUUID();
  return {
    runId: randomUUID().replaceAll('-', ''),
    requesterId: id(),
    staffId: id(),
    revokedStaffId: id(),
    moderatorId: id(),
    closedLearnerId: id(),
    supportRoleId: id(),
    moderatorRoleId: id(),
    staffAssignmentId: id(),
    revokedStaffAssignmentId: id(),
    moderatorAssignmentId: id(),
    taughtId: id(),
    supportId: id(),
    terminalId: id(),
    teacherParticipantId: id(),
    learnerParticipantId: id(),
    requesterParticipantId: id(),
    staffParticipantId: id(),
    revokedStaffParticipantId: id(),
    terminalTeacherParticipantId: id(),
    terminalClosedParticipantId: id(),
    withheldMessageId: id(),
    replyMessageId: id(),
    attachedMessageId: id(),
    requesterMessageId: id(),
    staffMessageId: id(),
    terminalMessageId: id(),
    jpegAssetId: id(),
    pngAssetId: id(),
    pdfAssetId: id(),
    jpegAttachmentId: id(),
    pngAttachmentId: id(),
    pdfAttachmentId: id(),
    releasingAttachmentId: id(),
    messageReportId: id(),
    conversationReportId: id(),
    decisionId: id(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase24Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-24 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-24 fixture field '${name}' is not a generated identifier.`);
  }
}

function assertReferences(references: Phase24References): void {
  for (const id of [references.liveCourseId, references.learnerId, references.teacherId])
    if (!/^[a-z0-9-]{1,36}$/i.test(id))
      throw new Error('Invalid synthetic Phase-24 fixture reference.');
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A direct conversation names its two accounts in BINARY order. */
const pair = (one: string, two: string): readonly [string, string] =>
  one < two ? [one, two] : [two, one];

/** The fixture's release tokens: what the CONSUMER keeps, never Storage. */
function tokens(fixture: Phase24Fixture): {
  readonly jpeg: string;
  readonly png: string;
  readonly pdf: string;
  readonly releasing: string;
} {
  const token = (label: string): string =>
    sha256(`NON_MESSAGING_FIXTURE ${label} ${fixture.runId}`);
  return {
    jpeg: token('jpeg'),
    png: token('png'),
    pdf: token('pdf'),
    releasing: token('releasing'),
  };
}

/**
 * Writes the populated Phase-24 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real keys, CHECKs and triggers are
 * exercised: the activations first, because no conversation may exist before
 * its kind's; every participant fitting its conversation; every message at the
 * place its conversation just allocated, from a current participant of an open
 * conversation; every attachment pending first, ready with its asset, then
 * attached to its own uploader's message; the decision on an open report; and
 * the terminal conversation closed only after it held its message.
 */
export async function writePhase24Fixture(
  sql: SqlSession,
  fixture: Phase24Fixture,
  references: Phase24References,
): Promise<void> {
  assertSafe(fixture);
  assertReferences(references);
  const f = fixture;
  const r = references;
  const t = tokens(f);
  const stem = f.runId.slice(0, 16);
  const account = (id: string, label: string, name: string, closed = false): string =>
    `(N'${id}', N'${name}', N'${label}-${stem}@messaging-proof.invalid', 0, '2026-10-08T06:00:00', '2026-10-08T06:00:00', N'en', N'${closed ? 'closed' : 'active'}', ${closed ? "'2026-10-08T09:00:00'" : 'NULL'}, 0)`;

  // ---- the activations, the accounts and their Identity authority ----------------
  await sql.query(`
    INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference],[activatedAt]) VALUES
      (N'support', N'fixture', N'${TEXT.operator}', NULL, '2026-10-08T06:00:00'),
      (N'teacher-student', N'fixture', N'${TEXT.operator}', NULL, '2026-10-08T06:00:00'),
      (N'student-student', N'fixture', N'${TEXT.operator}', NULL, '2026-10-08T06:00:00');
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[closedAt],[twoFactorEnabled]) VALUES
      ${account(f.requesterId, 'requester', TEXT.requester)},
      ${account(f.staffId, 'staff', TEXT.staff)},
      ${account(f.revokedStaffId, 'revoked-staff', TEXT.revokedStaff)},
      ${account(f.moderatorId, 'moderator', TEXT.moderator)},
      ${account(f.closedLearnerId, 'closed-learner', TEXT.closed, true)};
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES
      (N'${f.supportRoleId}', N'recovery-messaging-support-${stem}', N'${TEXT.supportRole}', N'Synthetic recovery role.', 0),
      (N'${f.moderatorRoleId}', N'recovery-messaging-moderation-${stem}', N'${TEXT.moderatorRole}', N'Synthetic recovery role.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES
      (N'${f.supportRoleId}', N'messaging.support'),
      (N'${f.moderatorRoleId}', N'messaging.moderate');
    INSERT INTO [dbo].[RoleAssignment] ([id],[userId],[roleId],[grantedAt]) VALUES
      (N'${f.staffAssignmentId}', N'${f.staffId}', N'${f.supportRoleId}', '2026-10-08T06:10:00'),
      (N'${f.revokedStaffAssignmentId}', N'${f.revokedStaffId}', N'${f.supportRoleId}', '2026-10-08T06:10:00'),
      (N'${f.moderatorAssignmentId}', N'${f.moderatorId}', N'${f.moderatorRoleId}', '2026-10-08T06:10:00');
  `);

  // ---- the three conversations and their people ------------------------------------
  const [low, high] = pair(r.teacherId, r.learnerId);
  const [terminalLow, terminalHigh] = pair(r.teacherId, f.closedLearnerId);
  await sql.query(`
    INSERT INTO [dbo].[Conversation] ([id],[kind],[courseId],[lowUserId],[highUserId],[requesterUserId],[activityAt],[createdAt]) VALUES
      (N'${f.taughtId}', N'teacher-student', N'${r.liveCourseId}', N'${low}', N'${high}', NULL, '2026-10-08T07:00:00', '2026-10-08T07:00:00'),
      (N'${f.supportId}', N'support', NULL, NULL, NULL, N'${f.requesterId}', '2026-10-08T07:00:00', '2026-10-08T07:00:00'),
      (N'${f.terminalId}', N'teacher-student', N'${r.liveCourseId}', N'${terminalLow}', N'${terminalHigh}', NULL, '2026-10-08T07:00:00', '2026-10-08T07:00:00');
    INSERT INTO [dbo].[ConversationParticipant] ([id],[conversationId],[userId],[role],[joinedAt],[leftAt]) VALUES
      (N'${f.teacherParticipantId}', N'${f.taughtId}', N'${r.teacherId}', N'teacher', '2026-10-08T07:00:00', NULL),
      (N'${f.learnerParticipantId}', N'${f.taughtId}', N'${r.learnerId}', N'learner', '2026-10-08T07:00:00', NULL),
      (N'${f.requesterParticipantId}', N'${f.supportId}', N'${f.requesterId}', N'requester', '2026-10-08T07:00:00', NULL),
      (N'${f.revokedStaffParticipantId}', N'${f.supportId}', N'${f.revokedStaffId}', N'support', '2026-10-08T07:05:00', '2026-10-08T07:10:00'),
      (N'${f.staffParticipantId}', N'${f.supportId}', N'${f.staffId}', N'support', '2026-10-08T07:10:00', NULL),
      (N'${f.terminalTeacherParticipantId}', N'${f.terminalId}', N'${r.teacherId}', N'teacher', '2026-10-08T07:00:00', NULL),
      (N'${f.terminalClosedParticipantId}', N'${f.terminalId}', N'${f.closedLearnerId}', N'learner', '2026-10-08T07:00:00', NULL);
    UPDATE [dbo].[RoleAssignment] SET [revokedAt]='2026-10-08T07:10:00', [revokedReason]=N'NON_MESSAGING_FIXTURE revoked'
      WHERE [id]=N'${f.revokedStaffAssignmentId}';
  `);

  // ---- messages, each at the place just allocated ---------------------------------
  const send = (
    id: string,
    conversationId: string,
    sequence: number,
    sender: string,
    label: string,
    at: string,
  ): string =>
    `UPDATE [dbo].[Conversation] SET [lastSequence]=${String(sequence)}, [activityAt]='${at}', [version]=[version]+1 WHERE [id]=N'${conversationId}';
     INSERT INTO [dbo].[Message] ([id],[conversationId],[sequence],[senderUserId],[operationId],[body],[payloadDigest],[sentAt]) VALUES
       (N'${id}', N'${conversationId}', ${String(sequence)}, N'${sender}', N'${randomUUID()}', N'${TEXT.body} ${label}', N'${sha256(`${TEXT.body} ${label}`)}', '${at}');`;
  await sql.query(`
    ${send(f.withheldMessageId, f.taughtId, 1, r.teacherId, 'first', '2026-10-08T07:20:00')}
    ${send(f.replyMessageId, f.taughtId, 2, r.learnerId, 'reply', '2026-10-08T07:21:00')}
    ${send(f.attachedMessageId, f.taughtId, 3, r.teacherId, 'with files', '2026-10-08T07:22:00')}
    ${send(f.requesterMessageId, f.supportId, 1, f.requesterId, 'question', '2026-10-08T07:23:00')}
    ${send(f.staffMessageId, f.supportId, 2, f.staffId, 'answer', '2026-10-08T07:24:00')}
    ${send(f.terminalMessageId, f.terminalId, 1, f.closedLearnerId, 'before closure', '2026-10-08T07:25:00')}
  `);

  // ---- assets and attachments: pending, ready, attached; one released --------------
  const asset = (id: string, label: string, mediaType: string, token: string): string =>
    `(N'${id}', N'recovery/messaging/${stem}/${label}', N'${mediaType}', 2048, N'${sha256(`${TEXT.file} ${label}`)}', N'clean', NULL, N'${TEXT.file} ${label}', 0, '2026-10-08T07:30:00', '2026-10-08T07:30:00', N'${sha256(token)}')`;
  const pending = (id: string, token: string, uploader: string): string =>
    `(N'${id}', N'${f.taughtId}', N'${uploader}', N'${token}', N'pending', '2026-10-08T07:30:00')`;
  const ready = (id: string, assetId: string, mediaType: string, label: string): string =>
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'ready', [assetId]=N'${assetId}', [mediaType]=N'${mediaType}', [byteSize]=2048, [displayName]=N'${TEXT.file} ${label}' WHERE [id]=N'${id}';`;
  const attach = (id: string, position: number): string =>
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'attached', [messageId]=N'${f.attachedMessageId}', [position]=${String(position)}, [attachedAt]='2026-10-08T07:31:00' WHERE [id]=N'${id}';`;
  await sql.query(`
    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[rejection],[displayName],[scanAttempts],[createdAt],[updatedAt],[releaseDigest]) VALUES
      ${asset(f.jpegAssetId, 'jpeg', 'image/jpeg', t.jpeg)},
      ${asset(f.pngAssetId, 'png', 'image/png', t.png)},
      ${asset(f.pdfAssetId, 'pdf', 'application/pdf', t.pdf)};
    INSERT INTO [dbo].[MessageAttachment] ([id],[conversationId],[uploaderUserId],[releaseToken],[state],[createdAt]) VALUES
      ${pending(f.jpegAttachmentId, t.jpeg, r.teacherId)},
      ${pending(f.pngAttachmentId, t.png, r.teacherId)},
      ${pending(f.pdfAttachmentId, t.pdf, r.teacherId)},
      ${pending(f.releasingAttachmentId, t.releasing, r.learnerId)};
    ${ready(f.jpegAttachmentId, f.jpegAssetId, 'image/jpeg', 'jpeg')}
    ${ready(f.pngAttachmentId, f.pngAssetId, 'image/png', 'png')}
    ${ready(f.pdfAttachmentId, f.pdfAssetId, 'application/pdf', 'pdf')}
    ${attach(f.jpegAttachmentId, 0)}
    ${attach(f.pngAttachmentId, 1)}
    ${attach(f.pdfAttachmentId, 2)}
    UPDATE [dbo].[MessageAttachment] SET [state]=N'releasing' WHERE [id]=N'${f.releasingAttachmentId}';
  `);

  // ---- read positions, a block, the reports and the decision -----------------------
  await sql.query(`
    INSERT INTO [dbo].[MessageReadState] ([conversationId],[userId],[lastReadSequence],[updatedAt]) VALUES
      (N'${f.taughtId}', N'${r.learnerId}', 3, '2026-10-08T07:40:00'),
      (N'${f.taughtId}', N'${r.teacherId}', 2, '2026-10-08T07:40:00');
    INSERT INTO [dbo].[MessagingBlock] ([blockerUserId],[blockedUserId],[createdAt]) VALUES
      (N'${r.learnerId}', N'${f.requesterId}', '2026-10-08T07:40:00');
    INSERT INTO [dbo].[MessagingReport] ([id],[conversationId],[messageId],[reporterUserId],[reason],[atSequence],[createdAt]) VALUES
      (N'${f.messageReportId}', N'${f.taughtId}', N'${f.withheldMessageId}', N'${r.learnerId}', N'harassment', 3, '2026-10-08T07:45:00'),
      (N'${f.conversationReportId}', N'${f.taughtId}', NULL, N'${r.teacherId}', N'other', 3, '2026-10-08T07:46:00');
    INSERT INTO [dbo].[MessagingModerationDecision] ([id],[reportId],[moderatorUserId],[action],[decidedAt]) VALUES
      (N'${f.decisionId}', N'${f.messageReportId}', N'${f.moderatorId}', N'withhold-message', '2026-10-08T08:00:00');
    UPDATE [dbo].[Message] SET [moderation]=N'withheld', [withheldAt]='2026-10-08T08:00:00' WHERE [id]=N'${f.withheldMessageId}';
    UPDATE [dbo].[MessagingReport] SET [state]=N'resolved', [resolvedAt]='2026-10-08T08:00:00', [version]=2 WHERE [id]=N'${f.messageReportId}';
  `);

  // ---- the terminal conversation: the account closed, its participation ended ----
  await sql.query(`
    UPDATE [dbo].[ConversationParticipant] SET [leftAt]='2026-10-08T09:00:00' WHERE [id]=N'${f.terminalClosedParticipantId}';
    UPDATE [dbo].[Conversation] SET [state]=N'closed', [closedReason]=N'account-closed', [closedAt]='2026-10-08T09:00:00', [version]=[version]+1
      WHERE [id]=N'${f.terminalId}';
  `);
}

/** Every authoritative Phase-24 row this fixture wrote, in a stable order. */
export async function capturePhase24Fixture(
  sql: SqlSession,
  fixture: Phase24Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const conversations = `N'${f.taughtId}',N'${f.supportId}',N'${f.terminalId}'`;
  const accounts = [
    f.requesterId,
    f.staffId,
    f.revokedStaffId,
    f.moderatorId,
    f.closedLearnerId,
  ]
    .map((id) => `N'${id}'`)
    .join(',');
  const roles = `N'${f.supportRoleId}',N'${f.moderatorRoleId}'`;
  const assets = `N'${f.jpegAssetId}',N'${f.pngAssetId}',N'${f.pdfAssetId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'MessagingActivation',
      'SELECT * FROM [dbo].[MessagingActivation] ORDER BY [capability]',
      3,
    ],
    [
      'User',
      `SELECT * FROM [dbo].[User] WHERE [id] IN (${accounts}) ORDER BY [email]`,
      5,
    ],
    ['Role', `SELECT * FROM [dbo].[Role] WHERE [id] IN (${roles}) ORDER BY [key]`, 2],
    [
      'RolePermission',
      `SELECT * FROM [dbo].[RolePermission] WHERE [roleId] IN (${roles}) ORDER BY [permissionKey]`,
      2,
    ],
    [
      'RoleAssignment',
      `SELECT * FROM [dbo].[RoleAssignment] WHERE [roleId] IN (${roles}) ORDER BY [id]`,
      3,
    ],
    [
      'Conversation',
      `SELECT * FROM [dbo].[Conversation] WHERE [id] IN (${conversations}) ORDER BY [id]`,
      3,
    ],
    [
      'ConversationParticipant',
      `SELECT * FROM [dbo].[ConversationParticipant] WHERE [conversationId] IN (${conversations}) ORDER BY [id]`,
      7,
    ],
    [
      'Message',
      `SELECT * FROM [dbo].[Message] WHERE [conversationId] IN (${conversations}) ORDER BY [conversationId], [sequence]`,
      6,
    ],
    ['Asset', `SELECT * FROM [dbo].[Asset] WHERE [id] IN (${assets}) ORDER BY [id]`, 3],
    [
      'MessageAttachment',
      `SELECT * FROM [dbo].[MessageAttachment] WHERE [conversationId] IN (${conversations}) ORDER BY [id]`,
      4,
    ],
    [
      'MessageReadState',
      `SELECT * FROM [dbo].[MessageReadState] WHERE [conversationId] IN (${conversations}) ORDER BY [userId]`,
      2,
    ],
    [
      'MessagingBlock',
      `SELECT * FROM [dbo].[MessagingBlock] WHERE [blockedUserId] IN (${accounts}) ORDER BY [blockerUserId]`,
      1,
    ],
    [
      'MessagingReport',
      `SELECT * FROM [dbo].[MessagingReport] WHERE [conversationId] IN (${conversations}) ORDER BY [id]`,
      2,
    ],
    [
      'MessagingModerationDecision',
      `SELECT * FROM [dbo].[MessagingModerationDecision] WHERE [id]=N'${f.decisionId}'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-24 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-24 tables whose constraints and triggers must return intact. */
const PHASE24_TABLES = [
  'MessagingActivation',
  'Conversation',
  'ConversationParticipant',
  'Message',
  'MessageAttachment',
  'MessageReadState',
  'MessagingBlock',
  'MessagingReport',
  'MessagingModerationDecision',
] as const;

/** Every Messaging trigger, exactly. */
const PHASE24_TRIGGERS = [
  'MessagingActivationImmutable',
  'MessagingAttachmentIntegrity',
  'MessagingConversationIntegrity',
  'MessagingDecisionIntegrity',
  'MessagingMessageIntegrity',
  'MessagingParticipantIntegrity',
  'MessagingReadStateIntegrity',
  'MessagingReportIntegrity',
].join(',');

/**
 * Verifies the restored Messaging state and returns one line of what was
 * proved.
 *
 * BEYOND ROW EQUALITY: every name, address, role key, body and storage key is
 * still an unmistakable sentinel; the activations are the fixture's and
 * nothing more; the teacher-student conversation still names the live teacher
 * and the learner in binary order on the published live Course, its messages
 * in places 1, 2 and 3 with the first withheld by a decision on a resolved
 * report and the conversation-level report still open; every attachment
 * still sits at its place on its own uploader's message and names a clean
 * asset whose release digest is STILL the SHA-256 of the attachment's own
 * token — so only that token can release it — while the released upload holds
 * no asset; the active support claim is held by staff whose `messaging.support`
 * assignment is live, the released claim by staff whose assignment is revoked,
 * and the decision by a live `messaging.moderate` holder; the terminal
 * conversation is closed for `account-closed` with the closed account's
 * participation ended; the two gated keys are held only by the synthetic
 * roles; and every Phase-24 CHECK, foreign key, trigger and filtered claim —
 * and Storage's release-digest key and CHECK — is enabled and trusted, with no
 * key cascading at all.
 */
export async function verifyRestoredPhase24(
  sql: SqlSession,
  fixture: Phase24Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase24References,
): Promise<string> {
  deepStrictEqual(
    await capturePhase24Fixture(sql, fixture),
    expected,
    'Phase-24 Messaging authoritative values changed during recovery.',
  );
  assertReferences(references);
  const f = fixture;
  const r = references;
  const conversations = `N'${f.taughtId}',N'${f.supportId}',N'${f.terminalId}'`;
  const accounts = [
    f.requesterId,
    f.staffId,
    f.revokedStaffId,
    f.moderatorId,
    f.closedLearnerId,
  ]
    .map((id) => `N'${id}'`)
    .join(',');
  const roles = `N'${f.supportRoleId}',N'${f.moderatorRoleId}'`;
  const assets = `N'${f.jpegAssetId}',N'${f.pngAssetId}',N'${f.pdfAssetId}'`;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (${accounts})
         AND ([name] NOT LIKE N'NON[_]MESSAGING[_]FIXTURE[_]%' OR [email] NOT LIKE N'%@messaging-proof.invalid')) AS [accounts],
      (SELECT COUNT(*) FROM [dbo].[Role] WHERE [id] IN (${roles})
         AND ([name] NOT LIKE N'NON[_]MESSAGING[_]FIXTURE[_]%' OR [key] NOT LIKE N'recovery-messaging-%')) AS [roles],
      (SELECT COUNT(*) FROM [dbo].[MessagingActivation]
         WHERE [authorisedBy] NOT LIKE N'NON[_]MESSAGING[_]FIXTURE[_]%') AS [activation],
      (SELECT COUNT(*) FROM [dbo].[Message] WHERE [conversationId] IN (${conversations})
         AND [body] NOT LIKE N'NON[_]MESSAGING[_]FIXTURE[_]%') AS [bodies],
      (SELECT COUNT(*) FROM [dbo].[Asset] WHERE [id] IN (${assets})
         AND ([storageKey] NOT LIKE N'recovery/messaging/%' OR [displayName] NOT LIKE N'NON[_]MESSAGING[_]FIXTURE[_]%')) AS [assets];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"accounts":0,"roles":0,"activation":0,"bodies":0,"assets":0}'
  ) {
    throw new Error(
      `Restored Phase-24 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Activation, membership, order, moderation, custody and authority — through
  // the same joins and predicates the adapters read by.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([capability] + N':' + [authority] + N':' + CASE WHEN [reference] IS NULL THEN N'-' ELSE N'ref' END, N',')
          WITHIN GROUP (ORDER BY [capability])
         FROM [dbo].[MessagingActivation]) AS [activations],
      (SELECT COUNT(*) FROM [dbo].[Conversation] c
         JOIN [dbo].[Course] k ON k.[id]=c.[courseId] AND k.[format]=N'live' AND k.[state]=N'published'
        WHERE c.[id]=N'${f.taughtId}' AND c.[kind]=N'teacher-student' AND c.[state]=N'open'
          AND c.[courseId]=N'${r.liveCourseId}' AND c.[lastSequence]=3
          AND N'${r.teacherId}' IN (c.[lowUserId], c.[highUserId]) AND N'${r.learnerId}' IN (c.[lowUserId], c.[highUserId])
          AND c.[lowUserId] COLLATE Latin1_General_BIN2 < c.[highUserId] COLLATE Latin1_General_BIN2) AS [taught],
      (SELECT STRING_AGG(CAST(m.[sequence] AS NVARCHAR(8)) + N':' + CASE WHEN m.[senderUserId]=N'${r.teacherId}' THEN N'teacher' ELSE N'learner' END + N':' + m.[moderation], N',')
          WITHIN GROUP (ORDER BY m.[sequence])
         FROM [dbo].[Message] m WHERE m.[conversationId]=N'${f.taughtId}') AS [messages],
      (SELECT COUNT(*) FROM [dbo].[MessagingModerationDecision] d
         JOIN [dbo].[MessagingReport] p ON p.[id]=d.[reportId] AND p.[state]=N'resolved' AND p.[messageId]=N'${f.withheldMessageId}'
         JOIN [dbo].[Message] m ON m.[id]=p.[messageId] AND m.[conversationId]=p.[conversationId] AND m.[moderation]=N'withheld'
         JOIN [dbo].[RoleAssignment] ra ON ra.[userId]=d.[moderatorUserId] AND ra.[revokedAt] IS NULL
         JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] AND rp.[permissionKey]=N'messaging.moderate'
        WHERE d.[id]=N'${f.decisionId}' AND d.[action]=N'withhold-message') AS [decision],
      (SELECT COUNT(*) FROM [dbo].[MessagingReport]
        WHERE [id]=N'${f.conversationReportId}' AND [messageId] IS NULL AND [state]=N'open' AND [reporterUserId]=N'${r.teacherId}') AS [openReport],
      (SELECT STRING_AGG(a.[mediaType] + N':' + CAST(a.[position] AS NVARCHAR(4)), N',') WITHIN GROUP (ORDER BY a.[position])
         FROM [dbo].[MessageAttachment] a
         JOIN [dbo].[Message] m ON m.[id]=a.[messageId] AND m.[conversationId]=a.[conversationId] AND m.[senderUserId]=a.[uploaderUserId]
         JOIN [dbo].[Asset] x ON x.[id]=a.[assetId] AND x.[state]=N'clean' AND x.[mediaType]=a.[mediaType] AND x.[byteSize]=a.[byteSize]
           AND x.[releaseDigest]=LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', CAST(a.[releaseToken] AS VARCHAR(64))), 2))
        WHERE a.[state]=N'attached' AND a.[messageId]=N'${f.attachedMessageId}') AS [attachments],
      (SELECT COUNT(*) FROM [dbo].[MessageAttachment]
        WHERE [id]=N'${f.releasingAttachmentId}' AND [state]=N'releasing' AND [assetId] IS NULL AND [messageId] IS NULL) AS [releasing],
      (SELECT STRING_AGG(CASE WHEN [userId]=N'${r.teacherId}' THEN N'teacher' ELSE N'learner' END + N':' + CAST([lastReadSequence] AS NVARCHAR(8)), N',')
          WITHIN GROUP (ORDER BY [lastReadSequence])
         FROM [dbo].[MessageReadState] WHERE [conversationId]=N'${f.taughtId}') AS [read],
      (SELECT COUNT(*) FROM [dbo].[MessagingBlock] WHERE [blockerUserId]=N'${r.learnerId}' AND [blockedUserId]=N'${f.requesterId}') AS [block],
      (SELECT COUNT(*) FROM [dbo].[ConversationParticipant] p
         JOIN [dbo].[Conversation] c ON c.[id]=p.[conversationId] AND c.[kind]=N'support' AND c.[state]=N'open' AND c.[requesterUserId]=N'${f.requesterId}'
         JOIN [dbo].[RoleAssignment] ra ON ra.[userId]=p.[userId] AND ra.[revokedAt] IS NULL
         JOIN [dbo].[Role] o ON o.[id]=ra.[roleId] AND o.[deactivatedAt] IS NULL
         JOIN [dbo].[RolePermission] rp ON rp.[roleId]=o.[id] AND rp.[permissionKey]=N'messaging.support'
        WHERE p.[id]=N'${f.staffParticipantId}' AND p.[role]=N'support' AND p.[leftAt] IS NULL) AS [claim],
      (SELECT COUNT(*) FROM [dbo].[ConversationParticipant] p
         JOIN [dbo].[RoleAssignment] ra ON ra.[id]=N'${f.revokedStaffAssignmentId}' AND ra.[userId]=p.[userId] AND ra.[revokedAt] IS NOT NULL
        WHERE p.[id]=N'${f.revokedStaffParticipantId}' AND p.[leftAt] IS NOT NULL) AS [releasedClaim],
      (SELECT COUNT(*) FROM [dbo].[ConversationParticipant] WHERE [conversationId]=N'${f.supportId}' AND [role]=N'support' AND [leftAt] IS NULL) AS [activeClaims],
      (SELECT COUNT(*) FROM [dbo].[Conversation] c
         JOIN [dbo].[ConversationParticipant] p ON p.[conversationId]=c.[id] AND p.[userId]=N'${f.closedLearnerId}' AND p.[leftAt] IS NOT NULL
         JOIN [dbo].[User] u ON u.[id]=p.[userId] AND u.[status]=N'closed'
         JOIN [dbo].[ConversationParticipant] t ON t.[conversationId]=c.[id] AND t.[userId]=N'${r.teacherId}' AND t.[leftAt] IS NULL
        WHERE c.[id]=N'${f.terminalId}' AND c.[state]=N'closed' AND c.[closedReason]=N'account-closed' AND c.[disposingAt] IS NULL) AS [terminal],
      (SELECT STRING_AGG(rp.[permissionKey] + N'@' + CASE WHEN rp.[roleId] IN (${roles}) THEN N'synthetic' ELSE rp.[roleId] END, N',')
          WITHIN GROUP (ORDER BY rp.[permissionKey])
         FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] IN (N'messaging.support', N'messaging.moderate')) AS [gatedHeldBy];
  `);
  const expectedState = {
    activations: 'student-student:fixture:-,support:fixture:-,teacher-student:fixture:-',
    taught: 1,
    messages: '1:teacher:withheld,2:learner:visible,3:teacher:visible',
    decision: 1,
    openReport: 1,
    attachments: 'image/jpeg:0,image/png:1,application/pdf:2',
    releasing: 1,
    read: 'teacher:2,learner:3',
    block: 1,
    claim: 1,
    releasedClaim: 1,
    activeClaims: 1,
    terminal: 1,
    gatedHeldBy: 'messaging.moderate@synthetic,messaging.support@synthetic',
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-24 Messaging state is broken: ${JSON.stringify(state)}.`,
    );
  }

  const tables = PHASE24_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE (parent_object_id IN (${tables}) OR [name]=N'Asset_releaseDigest_ck') AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1 OR delete_referential_action<>0 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-24 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: string | null;
    filtered: number;
    digest: number;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.triggers
         WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.indexes
         WHERE [object_id] IN (${tables}) AND has_filter=1 AND is_unique=1) AS [filtered],
       (SELECT COUNT_BIG(*) FROM sys.indexes
         WHERE [object_id]=OBJECT_ID(N'Asset') AND [name]=N'Asset_releaseDigest_key' AND has_filter=1 AND is_unique=1)
       + (SELECT COUNT_BIG(*) FROM sys.check_constraints
         WHERE parent_object_id=OBJECT_ID(N'Asset') AND [name]=N'Asset_releaseDigest_ck') AS [digest];`,
  );
  // 11 CHECKs, 20 foreign keys none of which cascades, the 8 triggers, the
  // seven filtered claims and Storage's release-digest key and CHECK, exactly
  // as the migration creates them: a restore that silently lost one would
  // otherwise read as "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 11 ||
    Number(counts?.keys ?? 0) !== 20 ||
    counts?.triggers !== PHASE24_TRIGGERS ||
    Number(counts.filtered) !== 7 ||
    Number(counts.digest) !== 2
  ) {
    throw new Error(
      `Restored Phase-24 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'the three fixture activations alone, a teacher-student conversation on the published live Course with its three messages in order and the first withheld by a live moderator’s decision on a resolved report, an open conversation-level report, a JPEG, PNG and PDF at their places on their uploader’s message each naming a clean asset still releasable only by its own token, a released upload holding no asset, both read positions, a block, one active support claim under a live messaging.support assignment beside a released one under a revoked assignment, a closed-account terminal conversation, both gated keys held only by the synthetic roles, and every key, CHECK, trigger and filtered claim trusted with no cascade (asset bytes are Storage’s, not the database’s)';
}
