import { describe, expect, it } from 'vitest';

import type {
  AttachmentState,
  ConversationClosedReason,
  ConversationKind,
  ConversationState,
  MessageModerationState,
  MessagingAuthority,
  MessagingCapability,
  MessagingPeerPolicyPort,
  MessagingPermission,
  MessagingPersistencePort,
  ModerationAction,
  ParticipantRole,
  ReportReason,
  ReportState,
} from '../../packages/contracts/src/messaging/index.ts';
import type {
  AssetAuthorizationPort,
  AssetRejection,
  AssetState,
  AssetStream,
  AuditEvent,
  UploadPolicy,
} from '../../packages/contracts/src/platform/index.ts';
import {
  MESSAGING_RATE_RULES,
  MessagingRefusal,
  createMessagingService,
  denyAllPeers,
  messagingFailure,
  type MessagingService,
} from '../../packages/server-core/src/messaging/index.ts';
import { dataRefusal } from '../../packages/server-core/src/messaging/refusal.ts';

/**
 * Phase 24 — the Messaging service's rules, over fake ports.
 *
 * WHAT IS PROVED HERE CHEAPLY: the ONE access decision — membership is only
 * the candidate set, Learning's live standing (both halves) is what admits a
 * teaching conversation, the terminal-history rule needs an account-closed
 * conversation AND Identity reporting the counterpart closed AND the reader's
 * own half current, the production peer policy admits no pair, and support
 * staff hold a conversation only through the live key; the refusal vocabulary
 * (not-found vs ended vs denied); what a withheld message shows to whom; the
 * bounded evidence window; idempotent send; blocks; rate budgets; the upload
 * lifecycle's releases; and the bounded, honest disposition loops.
 *
 * The fake persistence below is deliberately small and honest — it keeps the
 * facts the real adapter keeps and decides nothing the service should. The
 * SQL half (triggers, locks, unique keys) is proved against a real database
 * elsewhere.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-17T12:00:00Z');
const COURSE = ID(900);
const OTHER_COURSE = ID(901);

const TEACHER = 'acct-teacher';
const LEARNER = 'acct-learner';
const STRANGER = 'acct-stranger';
const STAFF = 'acct-staff';
const ADMIN = 'acct-platform-admin';
const MODERATOR = 'acct-moderator';
const PEER_A = 'acct-peer-a';
const PEER_B = 'acct-peer-b';
const REQUESTER = 'acct-requester';

const SECRET_BODY = 'SENTINEL-BODY-do-not-leak';
const SECRET_NAME = 'SENTINEL-FILENAME.pdf';

const me = (accountId: string) => ({ accountId });

/** An empty byte stream that is still a real async iterable. */
function noBytes(): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: true, value: undefined }),
    }),
  };
}

/* ===========================================================================
 * The fake world
 * ========================================================================= */

interface Participant {
  accountId: string;
  role: ParticipantRole;
  joinedAt: Date;
  leftAt: Date | null;
}

interface Conversation {
  id: string;
  kind: ConversationKind;
  courseId: string | null;
  state: ConversationState;
  closedReason: ConversationClosedReason | null;
  closedAt: Date | null;
  lastSequence: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  version: number;
  participants: Participant[];
}

interface Message {
  id: string;
  conversationId: string;
  sequence: number;
  senderAccountId: string;
  operationId: string;
  payloadDigest: string;
  body: string;
  moderation: MessageModerationState;
  sentAt: Date;
}

interface Attachment {
  id: string;
  conversationId: string;
  uploaderAccountId: string;
  releaseToken: string;
  state: AttachmentState;
  messageId: string | null;
  position: number | null;
  assetId: string | null;
  mediaType: string | null;
  byteSize: number | null;
  displayName: string | null;
  createdAt: Date;
}

interface Report {
  id: string;
  conversationId: string;
  messageId: string | null;
  reporterAccountId: string;
  reason: ReportReason;
  atSequence: number;
  state: ReportState;
  createdAt: Date;
  version: number;
  decision: {
    action: ModerationAction;
    decidedAt: Date;
    moderatorAccountId: string;
  } | null;
}

function createWorld() {
  let serial = 0;
  const next = () => ID((serial += 1));

  const activations = new Map<MessagingCapability, MessagingAuthority>([
    ['teacher-student', 'approved'],
    ['support', 'approved'],
  ]);
  const conversations = new Map<string, Conversation>();
  const messages: Message[] = [];
  const reading = new Map<string, number>();
  const blockRows = new Map<string, Date>();
  const attachments = new Map<string, Attachment>();
  const reports = new Map<string, Report>();
  const disposing = new Set<string>();
  const audit: AuditEvent[] = [];
  const calls = {
    standing: 0,
    closedAccounts: 0,
    permits: 0,
    append: 0,
    prepare: 0,
    candidatePages: 0,
  };

  /* Learning, Identity and policy answers */
  const standings = new Map<string, { teacher: boolean; learner: boolean }>();
  const keys = new Map<string, Set<MessagingPermission>>();
  const closed = new Set<string>();

  /* Storage */
  const storage = {
    next: {
      state: 'clean' as AssetState,
      rejection: null as AssetRejection | null,
      mediaType: 'image/png',
    },
    stored: [] as { policy: UploadPolicy; assetId: string }[],
    released: [] as string[],
    opened: [] as string[],
    throwOnStore: false,
  };

  /* Rate limiter */
  const spent: string[] = [];
  const exhausted = new Set<string>();

  /* knobs for disposition budgets */
  const knobs = { withdrawForever: false };

  const snapshot = (conversation: Conversation) => ({
    ...conversation,
    participants: conversation.participants.map((p) => ({ ...p })),
  });

  const messageRecord = (message: Message) => ({
    id: message.id,
    conversationId: message.conversationId,
    sequence: message.sequence,
    senderAccountId: message.senderAccountId,
    body: message.body,
    moderation: message.moderation,
    sentAt: message.sentAt,
    attachments: [...attachments.values()]
      .filter((a) => a.messageId === message.id && a.state === 'attached')
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((a) => ({
        id: a.id,
        mediaType: a.mediaType ?? '',
        byteSize: a.byteSize ?? 0,
        displayName: a.displayName,
        position: a.position ?? 0,
      })),
  });

  const ofConversation = (id: string) =>
    messages
      .filter((m) => m.conversationId === id)
      .sort((a, b) => a.sequence - b.sequence);

  const current = (conversation: Conversation, accountId: string) =>
    conversation.participants.find((p) => p.accountId === accountId && p.leftAt === null);

  const activity = (c: Conversation) => (c.lastMessageAt ?? c.createdAt).getTime();

  const persistence: MessagingPersistencePort = {
    async activations() {
      return new Map(activations);
    },
    async conversation(id) {
      const found = conversations.get(id);
      return found === undefined ? null : snapshot(found);
    },
    async conversationsOf({ accountId, roles, after, limit }) {
      return [...conversations.values()]
        .filter((c) => {
          const self = current(c, accountId);
          return self !== undefined && roles.includes(self.role);
        })
        .sort((a, b) => activity(b) - activity(a) || (a.id < b.id ? 1 : -1))
        .filter(
          (c) =>
            after === null ||
            activity(c) < after.at.getTime() ||
            (activity(c) === after.at.getTime() && c.id < after.id),
        )
        .slice(0, limit)
        .map(snapshot);
    },
    async openDirect({ kind, courseId, first, second }) {
      const existing = [...conversations.values()].find(
        (c) =>
          c.kind === kind &&
          c.courseId === courseId &&
          c.participants.some((p) => p.accountId === first.accountId) &&
          c.participants.some((p) => p.accountId === second.accountId),
      );
      if (existing !== undefined)
        return { conversation: snapshot(existing), created: false };
      const id = seed.conversation({
        kind,
        courseId,
        participants: [
          [first.accountId, first.role],
          [second.accountId, second.role],
        ],
      });
      return { conversation: snapshot(conversations.get(id)!), created: true };
    },
    async openSupport(requester) {
      const existing = [...conversations.values()].find(
        (c) =>
          c.kind === 'support' &&
          c.state === 'open' &&
          c.participants.some((p) => p.role === 'requester' && p.accountId === requester),
      );
      if (existing !== undefined)
        return { conversation: snapshot(existing), created: false };
      const id = seed.conversation({
        kind: 'support',
        participants: [[requester, 'requester']],
      });
      return { conversation: snapshot(conversations.get(id)!), created: true };
    },
    async readingStates(accountId, ids) {
      const result = new Map<string, { readSequence: number; unread: number }>();
      for (const id of ids) {
        const readSequence = reading.get(`${id}|${accountId}`) ?? 0;
        const unread = ofConversation(id).filter(
          (m) => m.sequence > readSequence && m.senderAccountId !== accountId,
        ).length;
        result.set(id, { readSequence, unread });
      }
      return result;
    },
    async history({ conversationId, before, limit }) {
      const all = ofConversation(conversationId).filter(
        (m) => before === null || m.sequence < before,
      );
      return all.slice(Math.max(0, all.length - limit)).map(messageRecord);
    },
    async after({ conversationId, after, limit }) {
      return ofConversation(conversationId)
        .filter((m) => m.sequence > after)
        .slice(0, limit)
        .map(messageRecord);
    },
    async span({ conversationId, from, to }) {
      return ofConversation(conversationId)
        .filter((m) => m.sequence >= from && m.sequence <= to)
        .map(messageRecord);
    },
    async append(input) {
      calls.append += 1;
      const conversation = conversations.get(input.conversationId)!;
      const prior = messages.find(
        (m) =>
          m.conversationId === input.conversationId &&
          m.senderAccountId === input.senderAccountId &&
          m.operationId === input.operationId,
      );
      if (prior !== undefined) {
        return prior.payloadDigest === input.payloadDigest
          ? { state: 'replayed', message: messageRecord(prior) }
          : { state: 'conflict' };
      }
      if (conversation.state !== 'open') return { state: 'closed' };
      if (current(conversation, input.senderAccountId) === undefined) {
        return { state: 'not-participant' };
      }
      if (input.blockPair !== null) {
        const [a, b] = input.blockPair;
        if (blockRows.has(`${a}>${b}`) || blockRows.has(`${b}>${a}`))
          return { state: 'blocked' };
      }
      for (const id of input.attachmentIds) {
        const row = attachments.get(id);
        if (
          row === undefined ||
          row.state !== 'ready' ||
          row.uploaderAccountId !== input.senderAccountId ||
          row.conversationId !== input.conversationId
        ) {
          return { state: 'attachment-unavailable' };
        }
      }
      conversation.lastSequence += 1;
      conversation.lastMessageAt = NOW;
      const message: Message = {
        id: next(),
        conversationId: input.conversationId,
        sequence: conversation.lastSequence,
        senderAccountId: input.senderAccountId,
        operationId: input.operationId,
        payloadDigest: input.payloadDigest,
        body: input.body,
        moderation: 'visible',
        sentAt: NOW,
      };
      messages.push(message);
      input.attachmentIds.forEach((id, position) => {
        const row = attachments.get(id)!;
        row.state = 'attached';
        row.messageId = message.id;
        row.position = position;
      });
      reading.set(`${input.conversationId}|${input.senderAccountId}`, message.sequence);
      return { state: 'created', message: messageRecord(message) };
    },
    async markRead({ conversationId, accountId, sequence }) {
      const key = `${conversationId}|${accountId}`;
      const value = Math.max(reading.get(key) ?? 0, sequence);
      reading.set(key, value);
      return value;
    },
    async blockState(first, second) {
      return {
        firstBlockedSecond: blockRows.has(`${first}>${second}`),
        secondBlockedFirst: blockRows.has(`${second}>${first}`),
      };
    },
    async block(blocker, blocked) {
      if (!blockRows.has(`${blocker}>${blocked}`))
        blockRows.set(`${blocker}>${blocked}`, NOW);
    },
    async unblock(blocker, blocked) {
      blockRows.delete(`${blocker}>${blocked}`);
    },
    async blocksBy(blocker, limit) {
      return [...blockRows.entries()]
        .filter(([key]) => key.startsWith(`${blocker}>`))
        .slice(0, limit)
        .map(([key, createdAt]) => ({ blockedAccountId: key.split('>')[1]!, createdAt }));
    },
    async prepareAttachment({ conversationId, uploaderAccountId, releaseToken, limit }) {
      calls.prepare += 1;
      const pending = [...attachments.values()].filter(
        (a) =>
          a.conversationId === conversationId &&
          a.uploaderAccountId === uploaderAccountId &&
          (a.state === 'pending' || a.state === 'ready'),
      ).length;
      if (pending >= limit) return { state: 'too-many' };
      const id = next();
      attachments.set(id, {
        id,
        conversationId,
        uploaderAccountId,
        releaseToken,
        state: 'pending',
        messageId: null,
        position: null,
        assetId: null,
        mediaType: null,
        byteSize: null,
        displayName: null,
        createdAt: NOW,
      });
      return { state: 'prepared', attachmentId: id };
    },
    async recordAttachment(input) {
      const row = attachments.get(input.attachmentId);
      if (row === undefined || row.state !== 'pending') return false;
      Object.assign(row, {
        state: 'ready',
        assetId: input.assetId,
        mediaType: input.mediaType,
        byteSize: input.byteSize,
        displayName: input.displayName,
      });
      return true;
    },
    async abandonAttachment(id) {
      const row = attachments.get(id);
      if (row === undefined || (row.state !== 'pending' && row.state !== 'ready'))
        return null;
      row.state = 'releasing';
      row.assetId = null;
      return { attachmentId: id, releaseToken: row.releaseToken };
    },
    async attachment(id) {
      const row = attachments.get(id);
      if (row === undefined) return null;
      const message = messages.find((m) => m.id === row.messageId);
      return {
        id: row.id,
        conversationId: row.conversationId,
        uploaderAccountId: row.uploaderAccountId,
        state: row.state,
        messageId: row.messageId,
        assetId: row.assetId,
        mediaType: row.mediaType,
        byteSize: row.byteSize,
        displayName: row.displayName,
        createdAt: row.createdAt,
        messageModeration:
          row.state === 'attached' && message ? message.moderation : null,
      };
    },
    async releaseQueue({ staleBefore, conversationId, limit }) {
      for (const row of attachments.values()) {
        if (conversationId !== null && row.conversationId !== conversationId) continue;
        if (
          (row.state === 'pending' || row.state === 'ready') &&
          row.createdAt < staleBefore
        ) {
          row.state = 'releasing';
          row.assetId = null;
        }
      }
      return [...attachments.values()]
        .filter(
          (row) =>
            row.state === 'releasing' &&
            (conversationId === null || row.conversationId === conversationId),
        )
        .slice(0, limit)
        .map((row) => ({ attachmentId: row.id, releaseToken: row.releaseToken }));
    },
    async forgetAttachment(id) {
      if (attachments.get(id)?.state === 'releasing') attachments.delete(id);
    },
    async supportQueue({ state, limit }) {
      return [...conversations.values()]
        .filter((c) => c.kind === 'support' && c.state === state)
        .slice(0, limit)
        .map((c) => {
          const last = ofConversation(c.id).at(-1);
          const requester = c.participants.find((p) => p.role === 'requester');
          return {
            conversation: snapshot(c),
            awaitingReply:
              last !== undefined && last.senderAccountId === requester?.accountId,
          };
        });
    },
    async claimSupport({
      conversationId,
      staffAccountId,
      expectedVersion,
      audit: event,
    }) {
      const c = conversations.get(conversationId);
      if (c === undefined || c.kind !== 'support') return 'missing';
      if (c.state !== 'open') return 'closed';
      if (c.version !== expectedVersion) return 'conflict';
      for (const p of c.participants)
        if (p.role === 'support' && p.leftAt === null) p.leftAt = NOW;
      const existing = c.participants.find((p) => p.accountId === staffAccountId);
      if (existing !== undefined) existing.leftAt = null;
      else
        c.participants.push({
          accountId: staffAccountId,
          role: 'support',
          joinedAt: NOW,
          leftAt: null,
        });
      c.version += 1;
      audit.push(event);
      return 'claimed';
    },
    async resolveSupport({ conversationId, expectedVersion, audit: event }) {
      const c = conversations.get(conversationId);
      if (c === undefined || c.kind !== 'support') return 'missing';
      if (c.state !== 'open') return 'closed';
      if (c.version !== expectedVersion) return 'conflict';
      Object.assign(c, { state: 'closed', closedReason: 'resolved', closedAt: NOW });
      c.version += 1;
      audit.push(event);
      return 'resolved';
    },
    async fileReport({ conversationId, messageId, reporterAccountId, reason }) {
      const c = conversations.get(conversationId)!;
      if (!c.participants.some((p) => p.accountId === reporterAccountId))
        return { state: 'invalid' };
      if (
        messageId !== null &&
        !messages.some((m) => m.id === messageId && m.conversationId === conversationId)
      ) {
        return { state: 'invalid' };
      }
      const duplicate = [...reports.values()].find(
        (r) =>
          r.state === 'open' &&
          r.reporterAccountId === reporterAccountId &&
          r.conversationId === conversationId &&
          r.messageId === messageId,
      );
      if (duplicate !== undefined) return { state: 'duplicate', reportId: duplicate.id };
      const id = seed.report({ conversationId, messageId, reporterAccountId, reason });
      return { state: 'filed', reportId: id };
    },
    async reports({ state, limit }) {
      return [...reports.values()]
        .filter((r) => r.state === state)
        .slice(0, limit)
        .map(reportRecord);
    },
    async report(id) {
      const found = reports.get(id);
      return found === undefined ? null : reportRecord(found);
    },
    async decide({
      reportId,
      expectedVersion,
      moderatorAccountId,
      action,
      audit: event,
    }) {
      const r = reports.get(reportId);
      if (r === undefined) return 'missing';
      if (r.state !== 'open' || r.version !== expectedVersion) return 'conflict';
      if (action === 'withhold-message') {
        if (r.messageId === null) return 'invalid';
        messages.find((m) => m.id === r.messageId)!.moderation = 'withheld';
      }
      if (action === 'close-conversation') {
        Object.assign(conversations.get(r.conversationId)!, {
          state: 'closed',
          closedReason: 'moderation',
          closedAt: NOW,
        });
      }
      r.decision = { action, decidedAt: NOW, moderatorAccountId };
      r.state = 'resolved';
      r.version += 1;
      audit.push(event);
      return 'decided';
    },
    async exportFor(accountId) {
      const mine = [...conversations.values()].filter((c) =>
        c.participants.some((p) => p.accountId === accountId),
      );
      return {
        conversations: mine.map((c) => {
          const p = c.participants.find((x) => x.accountId === accountId)!;
          return {
            id: c.id,
            kind: c.kind,
            courseId: c.courseId,
            role: p.role,
            state: c.state,
            closedReason: c.closedReason,
            joinedAt: p.joinedAt.toISOString(),
            leftAt: p.leftAt?.toISOString() ?? null,
            lastReadSequence: reading.get(`${c.id}|${accountId}`) ?? 0,
          };
        }),
        messages: messages
          .filter((m) => m.senderAccountId === accountId)
          .map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            sequence: m.sequence,
            body: m.body,
            withheld: m.moderation === 'withheld',
            sentAt: m.sentAt.toISOString(),
          })),
        attachments: [],
        blocks: [],
        reports: [],
      };
    },
    async accountsWithData(after, limit) {
      const owners = new Set<string>();
      for (const c of conversations.values())
        for (const p of c.participants) if (p.leftAt === null) owners.add(p.accountId);
      for (const key of blockRows.keys()) owners.add(key.split('>')[0]!);
      return [...owners]
        .sort()
        .filter((id) => after === null || id > after)
        .slice(0, limit);
    },
    async withdrawAccount(accountId, _limit) {
      if (knobs.withdrawForever) return 1;
      let changed = 0;
      for (const c of conversations.values()) {
        const self = current(c, accountId);
        if (self === undefined) continue;
        self.leftAt = NOW;
        changed += 1;
        if (c.state === 'open' && self.role !== 'support') {
          Object.assign(c, {
            state: 'closed',
            closedReason: 'account-closed',
            closedAt: NOW,
          });
        }
      }
      for (const key of [...reading.keys()]) {
        if (key.endsWith(`|${accountId}`)) {
          reading.delete(key);
          changed += 1;
        }
      }
      for (const key of [...blockRows.keys()]) {
        if (key.split('>').includes(accountId)) {
          blockRows.delete(key);
          changed += 1;
        }
      }
      for (const row of attachments.values()) {
        if (
          row.uploaderAccountId === accountId &&
          (row.state === 'pending' || row.state === 'ready')
        ) {
          row.state = 'releasing';
          row.assetId = null;
          changed += 1;
        }
      }
      return changed;
    },
    async disposalCandidates(accountId, after, limit) {
      calls.candidatePages += 1;
      return [...conversations.values()]
        .filter(
          (c) =>
            !disposing.has(c.id) &&
            (after === null || c.id > after) &&
            c.participants.some((p) => p.accountId === accountId) &&
            // The port's guarantee: no living holder — every non-support
            // participant has already left.
            c.participants.every((p) => p.role === 'support' || p.leftAt !== null),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map((c) => ({
          conversationId: c.id,
          kind: c.kind,
          otherAccountIds: c.participants
            .filter((p) => p.accountId !== accountId && p.role !== 'support')
            .map((p) => p.accountId),
          evidence: [...reports.values()].some((r) => r.conversationId === c.id),
        }));
    },
    async beginDisposal(conversationId) {
      disposing.add(conversationId);
      for (const row of attachments.values()) {
        if (row.conversationId === conversationId) {
          row.state = 'releasing';
          row.assetId = null;
          row.messageId = null;
        }
      }
    },
    async disposing(limit) {
      return [...disposing].slice(0, limit);
    },
    async disposeStep(conversationId) {
      if (
        [...attachments.values()].some((row) => row.conversationId === conversationId)
      ) {
        return 'awaiting-release';
      }
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]!.conversationId === conversationId) messages.splice(i, 1);
      }
      conversations.delete(conversationId);
      disposing.delete(conversationId);
      return 'removed';
    },
  };

  function reportRecord(r: Report) {
    const message = messages.find((m) => m.id === r.messageId);
    return {
      ...r,
      conversationKind: conversations.get(r.conversationId)?.kind ?? 'support',
      messageSequence: message?.sequence ?? null,
    };
  }

  const seed = {
    conversation(input: {
      kind: ConversationKind;
      courseId?: string | null;
      participants: readonly (readonly [string, ParticipantRole])[];
      state?: ConversationState;
      closedReason?: ConversationClosedReason | null;
    }): string {
      const id = next();
      conversations.set(id, {
        id,
        kind: input.kind,
        courseId: input.kind === 'support' ? null : (input.courseId ?? COURSE),
        state: input.state ?? 'open',
        closedReason: input.closedReason ?? null,
        closedAt: input.state === 'closed' ? NOW : null,
        lastSequence: 0,
        lastMessageAt: null,
        createdAt: new Date(NOW.getTime() - serial * 1000),
        version: 1,
        participants: input.participants.map(([accountId, role]) => ({
          accountId,
          role,
          joinedAt: NOW,
          leftAt: null,
        })),
      });
      return id;
    },
    messages(
      conversationId: string,
      count: number,
      senders: readonly string[],
    ): string[] {
      const c = conversations.get(conversationId)!;
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        c.lastSequence += 1;
        c.lastMessageAt = NOW;
        const id = next();
        ids.push(id);
        messages.push({
          id,
          conversationId,
          sequence: c.lastSequence,
          senderAccountId: senders[i % senders.length]!,
          operationId: next(),
          payloadDigest: 'x'.repeat(64),
          body: `${SECRET_BODY} #${String(c.lastSequence)}`,
          moderation: 'visible',
          sentAt: NOW,
        });
      }
      return ids;
    },
    attachment(input: {
      conversationId: string;
      uploader: string;
      messageId?: string | null;
      state?: AttachmentState;
      createdAt?: Date;
    }): string {
      const id = next();
      const attached = input.messageId !== undefined && input.messageId !== null;
      attachments.set(id, {
        id,
        conversationId: input.conversationId,
        uploaderAccountId: input.uploader,
        releaseToken: `${'a'.repeat(60)}${String(serial).padStart(4, '0')}`,
        state: input.state ?? (attached ? 'attached' : 'ready'),
        messageId: input.messageId ?? null,
        position: attached ? 0 : null,
        assetId: next(),
        mediaType: 'application/pdf',
        byteSize: 1234,
        displayName: SECRET_NAME,
        createdAt: input.createdAt ?? NOW,
      });
      return id;
    },
    report(input: {
      conversationId: string;
      messageId: string | null;
      reporterAccountId: string;
      reason?: ReportReason;
    }): string {
      const id = next();
      reports.set(id, {
        id,
        conversationId: input.conversationId,
        messageId: input.messageId,
        reporterAccountId: input.reporterAccountId,
        reason: input.reason ?? 'harassment',
        atSequence: conversations.get(input.conversationId)!.lastSequence,
        state: 'open',
        createdAt: NOW,
        version: 1,
        decision: null,
      });
      return id;
    },
    teaching(
      teacher: string,
      learner: string,
      standing: { teacher: boolean; learner: boolean },
      course = COURSE,
    ) {
      standings.set(`${teacher}|${learner}|${course}`, standing);
    },
    grant(accountId: string, permission: MessagingPermission) {
      const held = keys.get(accountId) ?? new Set<MessagingPermission>();
      held.add(permission);
      keys.set(accountId, held);
    },
    revoke(accountId: string, permission: MessagingPermission) {
      keys.get(accountId)?.delete(permission);
    },
  };

  function service(options: { peers?: MessagingPeerPolicyPort } = {}): MessagingService {
    return createMessagingService({
      persistence,
      teaching: {
        async standing(queries) {
          calls.standing += 1;
          return queries.map(
            (q) =>
              standings.get(
                `${q.teacherAccountId}|${q.learnerAccountId}|${q.courseId}`,
              ) ?? {
                teacher: false,
                learner: false,
              },
          );
        },
        async currentTeachers(learner) {
          return [...standings.entries()]
            .filter(([key, s]) => key.split('|')[1] === learner && s.teacher && s.learner)
            .map(([key]) => ({
              teacherAccountId: key.split('|')[0]!,
              courseId: key.split('|')[2]!,
            }));
        },
      },
      authority: {
        async permits(accountId, permission) {
          calls.permits += 1;
          return keys.get(accountId)?.has(permission) ?? false;
        },
      },
      accounts: {
        async closedAccounts(ids) {
          calls.closedAccounts += 1;
          expect(ids.length).toBeLessThanOrEqual(100);
          return ids.filter((id) => closed.has(id));
        },
      },
      peers: options.peers ?? denyAllPeers,
      storage: {
        async store(bytes, policy) {
          if (storage.throwOnStore) throw new Error('storage outage');
          for await (const chunk of bytes) void chunk;
          const assetId = next();
          storage.stored.push({ policy, assetId });
          return {
            id: assetId,
            state: storage.next.state,
            mediaType: storage.next.mediaType,
            byteSize: 2048,
            checksum: 'c'.repeat(64),
            rejection: storage.next.rejection,
          };
        },
        async open(
          assetId: string,
          authorization: AssetAuthorizationPort,
        ): Promise<AssetStream | null> {
          const row = [...attachments.values()].find((a) => a.assetId === assetId);
          const verdict = await authorization.decide({
            assetId,
            mediaType: row?.mediaType ?? 'application/pdf',
            byteSize: 1234,
            checksum: 'c'.repeat(64),
          });
          if (verdict !== 'allow') return null;
          storage.opened.push(assetId);
          return {
            mediaType: row?.mediaType ?? 'application/pdf',
            byteSize: 1234,
            checksum: 'c'.repeat(64),
            displayName: null,
            body: noBytes(),
            range: () => noBytes(),
          };
        },
        async release(token) {
          storage.released.push(token);
          return 'released';
        },
      },
      audit: {
        async record(event) {
          audit.push(event);
        },
      },
      limiter: {
        async consume(key) {
          spent.push(key);
          const purpose = key.split(':')[0]!;
          return {
            allowed: !exhausted.has(purpose),
            retryAfter: exhausted.has(purpose) ? 60 : null,
          };
        },
        async purgeExpired() {
          return 0;
        },
      },
      limitKey: (purpose, subject) => `${purpose}:${subject}`,
      clock: () => NOW,
    });
  }

  return {
    persistence,
    activations,
    conversations,
    messages,
    attachments,
    reports,
    disposing,
    audit,
    calls,
    closed,
    storage,
    spent,
    exhausted,
    knobs,
    seed,
    service,
  };
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof MessagingRefusal) return error.reason;
    throw error;
  }
  throw new Error('expected a refusal');
}

const op = (n: number) => ID(5000 + n);
const text = (body: string, n = 1) => ({
  operationId: op(n),
  body,
  attachmentIds: [] as string[],
});

/** A current teaching relationship with one conversation in it. */
function teachingWorld(standing = { teacher: true, learner: true }) {
  const world = createWorld();
  world.seed.teaching(TEACHER, LEARNER, standing);
  const conversation = world.seed.conversation({
    kind: 'teacher-student',
    participants: [
      [TEACHER, 'teacher'],
      [LEARNER, 'learner'],
    ],
  });
  const [first] = world.seed.messages(conversation, 3, [LEARNER, TEACHER]);
  const attachment = world.seed.attachment({
    conversationId: conversation,
    uploader: LEARNER,
    messageId: first!,
  });
  return {
    world,
    conversation,
    attachment,
    firstMessage: first!,
    service: world.service(),
  };
}

/* ===========================================================================
 * Rules and policy exports
 * ========================================================================= */

describe('exports', () => {
  it('pins the engineering rate budgets', () => {
    expect(MESSAGING_RATE_RULES).toEqual({
      start: { window: 3600, max: 30 },
      send: { window: 3600, max: 300 },
      sendPerConversation: { window: 600, max: 60 },
      upload: { window: 3600, max: 40 },
      supportOpen: { window: 3600, max: 5 },
      report: { window: 3600, max: 20 },
      block: { window: 3600, max: 60 },
      staffRead: { window: 3600, max: 600 },
      moderation: { window: 3600, max: 300 },
      export: { window: 3600, max: 10 },
    });
    expect(Object.isFrozen(MESSAGING_RATE_RULES)).toBe(true);
  });

  it('denies every peer pair in production wiring', async () => {
    expect(
      await denyAllPeers.permits({
        firstAccountId: PEER_A,
        secondAccountId: PEER_B,
        courseId: COURSE,
      }),
    ).toBe(false);
  });

  it('maps a refusal to its reason and anything else to unavailable', () => {
    expect(messagingFailure(new MessagingRefusal('ended'))).toBe('ended');
    expect(messagingFailure(new Error('db down'))).toBe('unavailable');
  });

  it('reports which kinds are active and whether any is a fixture', async () => {
    const world = createWorld();
    expect(await world.service().capabilities()).toEqual({
      support: true,
      teacherStudent: true,
      studentStudent: false,
      fixture: false,
    });
    world.activations.set('student-student', 'fixture');
    expect((await world.service().capabilities()).fixture).toBe(true);
  });
});

/* ===========================================================================
 * The access decision
 * ========================================================================= */

describe('the access decision — membership alone never authorises', () => {
  it('serves a current relationship, both halves holding', async () => {
    const { service, conversation } = teachingWorld();
    const view = await service.conversation(me(LEARNER), conversation);
    expect(view.summary.access).toBe('available');
    expect(view.canSend).toBe(true);
    expect(view.summary.counterpartAccountId).toBe(TEACHER);
    expect(
      (await service.history(me(TEACHER), conversation, null)).messages,
    ).toHaveLength(3);
  });

  it('tells a participant whose teacher half ended `ended` on every read and write', async () => {
    const { world, service, conversation, attachment, firstMessage } = teachingWorld({
      teacher: false,
      learner: true,
    });
    // The teacher still holds every Messaging key: no key, profile or role
    // name stands in for Learning's standing.
    world.seed.grant(TEACHER, 'messaging.support');
    world.seed.grant(TEACHER, 'messaging.moderate');
    for (const actor of [TEACHER, LEARNER]) {
      expect(
        (
          await service.conversations(me(actor), {
            surface: actor === TEACHER ? 'teacher' : 'my',
            cursor: null,
          })
        ).conversations,
      ).toEqual([]);
      expect(await refusal(service.conversation(me(actor), conversation))).toBe('ended');
      expect(await refusal(service.history(me(actor), conversation, null))).toBe('ended');
      expect(await refusal(service.catchUp(me(actor), conversation, 0))).toBe('ended');
      expect(await refusal(service.send(me(actor), conversation, text('hello')))).toBe(
        'ended',
      );
      expect(await refusal(service.markRead(me(actor), conversation, 1))).toBe('ended');
      expect(
        await refusal(
          service.report(me(actor), {
            conversationId: conversation,
            messageId: firstMessage,
            reason: 'spam',
          }),
        ),
      ).toBe('ended');
      expect(await service.openAttachment(me(actor), attachment)).toBeNull();
    }
    expect(world.calls.append).toBe(0);
    expect(world.reports.size).toBe(0);
  });

  it('refuses when only the learner half ended (withdrawal) — `ended`, never terminal', async () => {
    const { service, conversation } = teachingWorld({ teacher: true, learner: false });
    expect(await refusal(service.history(me(TEACHER), conversation, null))).toBe('ended');
    expect(await refusal(service.send(me(LEARNER), conversation, text('hi')))).toBe(
      'ended',
    );
  });

  it('answers `not-found` to a non-participant, an unknown id and a left participant', async () => {
    const { world, service, conversation } = teachingWorld();
    expect(await refusal(service.conversation(me(STRANGER), conversation))).toBe(
      'not-found',
    );
    expect(await refusal(service.history(me(STRANGER), conversation, null))).toBe(
      'not-found',
    );
    expect(await refusal(service.send(me(STRANGER), conversation, text('hi')))).toBe(
      'not-found',
    );
    expect(
      await refusal(
        service.report(me(STRANGER), {
          conversationId: conversation,
          messageId: null,
          reason: 'spam',
        }),
      ),
    ).toBe('not-found');
    expect(await refusal(service.conversation(me(LEARNER), ID(4242)))).toBe('not-found');
    expect(await refusal(service.conversation(me(LEARNER), 'not-a-uuid'))).toBe(
      'invalid',
    );
    world.conversations.get(conversation)!.participants[1]!.leftAt = NOW;
    expect(await refusal(service.conversation(me(LEARNER), conversation))).toBe(
      'not-found',
    );
  });

  it('answers `not-found` to a participant while the kind is switched off', async () => {
    const { world, service, conversation } = teachingWorld();
    world.activations.delete('teacher-student');
    expect(await refusal(service.conversation(me(LEARNER), conversation))).toBe(
      'not-found',
    );
    expect(await refusal(service.send(me(TEACHER), conversation, text('hi')))).toBe(
      'not-found',
    );
    expect(
      (await service.conversations(me(LEARNER), { surface: 'my', cursor: null }))
        .conversations,
    ).toEqual([]);
    expect(await service.startable(me(LEARNER))).toEqual([]);
  });

  it('asks Learning once per page, not once per conversation', async () => {
    const world = createWorld();
    for (let i = 0; i < 5; i += 1) {
      const teacher = `acct-teacher-${String(i)}`;
      world.seed.teaching(teacher, LEARNER, { teacher: true, learner: true });
      world.seed.conversation({
        kind: 'teacher-student',
        participants: [
          [teacher, 'teacher'],
          [LEARNER, 'learner'],
        ],
      });
    }
    const page = await world
      .service()
      .conversations(me(LEARNER), { surface: 'my', cursor: null });
    expect(page.conversations).toHaveLength(5);
    expect(world.calls.standing).toBe(1);
    expect(page.next).toBeNull();
  });

  it('pages with an opaque cursor and refuses a forged one', async () => {
    const world = createWorld();
    world.seed.teaching(TEACHER, LEARNER, { teacher: true, learner: true });
    for (let i = 0; i < 26; i += 1) {
      const course = ID(2000 + i);
      world.seed.teaching(TEACHER, LEARNER, { teacher: true, learner: true }, course);
      world.seed.conversation({
        kind: 'teacher-student',
        courseId: course,
        participants: [
          [TEACHER, 'teacher'],
          [LEARNER, 'learner'],
        ],
      });
    }
    const service = world.service();
    const first = await service.conversations(me(LEARNER), {
      surface: 'my',
      cursor: null,
    });
    expect(first.conversations).toHaveLength(25);
    expect(first.next).not.toBeNull();
    const second = await service.conversations(me(LEARNER), {
      surface: 'my',
      cursor: first.next,
    });
    expect(second.conversations).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(
      await refusal(
        service.conversations(me(LEARNER), { surface: 'my', cursor: 'garbage' }),
      ),
    ).toBe('invalid');
    expect(
      await refusal(
        service.conversations(me(LEARNER), { surface: 'other' as 'my', cursor: null }),
      ),
    ).toBe('invalid');
  });
});

describe('the terminal-history rule', () => {
  function closedCounterpart(standing: { teacher: boolean; learner: boolean }) {
    const world = createWorld();
    world.seed.teaching(TEACHER, LEARNER, standing);
    const conversation = world.seed.conversation({
      kind: 'teacher-student',
      participants: [
        [TEACHER, 'teacher'],
        [LEARNER, 'learner'],
      ],
      state: 'closed',
      closedReason: 'account-closed',
    });
    world.conversations.get(conversation)!.participants[0]!.leftAt = NOW;
    world.seed.messages(conversation, 2, [TEACHER]);
    world.closed.add(TEACHER);
    return { world, conversation, service: world.service() };
  }

  it('lets the remaining person read, read-only, while their own half is current', async () => {
    const { service, conversation } = closedCounterpart({
      teacher: false,
      learner: true,
    });
    const view = await service.conversation(me(LEARNER), conversation);
    expect(view.summary.access).toBe('terminal');
    expect(view.canSend).toBe(false);
    expect(view.sendRefusal).toBe('terminal');
    expect(
      (await service.history(me(LEARNER), conversation, null)).messages,
    ).toHaveLength(2);
    expect(await service.markRead(me(LEARNER), conversation, 99)).toEqual({
      readSequence: 2,
    });
    expect(await refusal(service.send(me(LEARNER), conversation, text('anyone?')))).toBe(
      'terminal',
    );
    expect(
      await refusal(
        service.uploadAttachment(me(LEARNER), conversation, noBytes(), {
          mediaType: 'application/pdf',
          displayName: null,
        }),
      ),
    ).toBe('terminal');
    const page = await service.conversations(me(LEARNER), {
      surface: 'my',
      cursor: null,
    });
    expect(page.conversations.map((c) => c.access)).toEqual(['terminal']);
  });

  it('is read-only even when the conversation is still marked open', async () => {
    const { world, service, conversation } = closedCounterpart({
      teacher: false,
      learner: true,
    });
    Object.assign(world.conversations.get(conversation)!, { state: 'open' });
    const view = await service.conversation(me(LEARNER), conversation);
    expect(view.sendRefusal).toBe('terminal');
    expect(await refusal(service.send(me(LEARNER), conversation, text('x')))).toBe(
      'terminal',
    );
  });

  it('ends when the remaining person’s own half has ended too', async () => {
    const { service, conversation } = closedCounterpart({
      teacher: false,
      learner: false,
    });
    expect(await refusal(service.history(me(LEARNER), conversation, null))).toBe('ended');
  });

  it('needs Identity to report the counterpart closed — the marker alone is not proof', async () => {
    const { world, service, conversation } = closedCounterpart({
      teacher: false,
      learner: true,
    });
    world.closed.delete(TEACHER);
    expect(await refusal(service.history(me(LEARNER), conversation, null))).toBe('ended');
  });

  it('never arises from ordinary revocation, moderation or a block', async () => {
    const { world, service, conversation } = teachingWorld({
      teacher: false,
      learner: true,
    });
    world.closed.add(TEACHER); // even with the teacher closed: no account-closed marker
    expect(await refusal(service.history(me(LEARNER), conversation, null))).toBe('ended');

    const moderated = teachingWorld();
    Object.assign(moderated.world.conversations.get(moderated.conversation)!, {
      state: 'closed',
      closedReason: 'moderation',
    });
    const view = await moderated.service.conversation(
      me(LEARNER),
      moderated.conversation,
    );
    expect(view.summary.access).toBe('available');
    expect(view.sendRefusal).toBe('closed');

    const blocked = teachingWorld({ teacher: false, learner: true });
    await blocked.service.block(me(LEARNER), blocked.conversation);
    expect(
      await refusal(blocked.service.history(me(LEARNER), blocked.conversation, null)),
    ).toBe('ended');
  });
});

describe('student-to-student', () => {
  function peerWorld() {
    const world = createWorld();
    world.activations.set('student-student', 'fixture');
    const conversation = world.seed.conversation({
      kind: 'student-student',
      participants: [
        [PEER_A, 'peer'],
        [PEER_B, 'peer'],
      ],
    });
    return { world, conversation };
  }

  it('is refused under the production policy even when activated', async () => {
    const { world, conversation } = peerWorld();
    const service = world.service();
    expect(
      await refusal(
        service.startPeer(me(PEER_A), { counterpartAccountId: PEER_B, courseId: COURSE }),
      ),
    ).toBe('not-found');
    expect(await refusal(service.history(me(PEER_A), conversation, null))).toBe('ended');
    expect(await refusal(service.send(me(PEER_B), conversation, text('hi')))).toBe(
      'ended',
    );
    expect(world.spent).toEqual([]);
  });

  it('is decided per pair by an injected policy, low id first', async () => {
    const { world, conversation } = peerWorld();
    const asked: unknown[] = [];
    const service = world.service({
      peers: {
        async permits(input) {
          asked.push(input);
          return true;
        },
      },
    });
    expect((await service.conversation(me(PEER_B), conversation)).summary.access).toBe(
      'available',
    );
    expect(asked).toEqual([
      { firstAccountId: PEER_A, secondAccountId: PEER_B, courseId: COURSE },
    ]);
    const started = await service.startPeer(me(PEER_A), {
      counterpartAccountId: PEER_B,
      courseId: COURSE,
    });
    expect(started.conversationId).toBe(conversation);
  });

  it('is refused while the kind is off', async () => {
    const world = createWorld();
    const service = world.service({ peers: { permits: async () => true } });
    expect(
      await refusal(
        service.startPeer(me(PEER_A), { counterpartAccountId: PEER_B, courseId: COURSE }),
      ),
    ).toBe('not-found');
  });
});

/* ===========================================================================
 * Starting and sending
 * ========================================================================= */

describe('starting a teaching conversation', () => {
  it('opens from either side of a current relationship, with the right roles', async () => {
    const world = createWorld();
    world.seed.teaching(TEACHER, LEARNER, { teacher: true, learner: true });
    const service = world.service();
    const { conversationId } = await service.startTeaching(me(LEARNER), {
      counterpartAccountId: TEACHER,
      courseId: COURSE,
    });
    const roles = world.conversations
      .get(conversationId)!
      .participants.map((p) => [p.accountId, p.role]);
    expect(roles).toEqual([
      [LEARNER, 'learner'],
      [TEACHER, 'teacher'],
    ]);
    const again = await service.startTeaching(me(TEACHER), {
      counterpartAccountId: LEARNER,
      courseId: COURSE,
    });
    expect(again.conversationId).toBe(conversationId);
    expect(await service.startable(me(LEARNER))).toEqual([
      { counterpartAccountId: TEACHER, courseId: COURSE },
    ]);
  });

  it('refuses with no current relationship, oneself, or bad input', async () => {
    const world = createWorld();
    world.seed.teaching(TEACHER, LEARNER, { teacher: false, learner: true });
    const service = world.service();
    expect(
      await refusal(
        service.startTeaching(me(LEARNER), {
          counterpartAccountId: TEACHER,
          courseId: COURSE,
        }),
      ),
    ).toBe('not-found');
    expect(
      await refusal(
        service.startTeaching(me(LEARNER), {
          counterpartAccountId: TEACHER,
          courseId: OTHER_COURSE,
        }),
      ),
    ).toBe('not-found');
    expect(
      await refusal(
        service.startTeaching(me(LEARNER), {
          counterpartAccountId: LEARNER,
          courseId: COURSE,
        }),
      ),
    ).toBe('invalid');
    expect(
      await refusal(
        service.startTeaching(me(LEARNER), {
          counterpartAccountId: TEACHER,
          courseId: 'x',
        }),
      ),
    ).toBe('invalid');
    expect(world.conversations.size).toBe(0);
  });
});

describe('sending', () => {
  it('replays the same operation and refuses a different payload under it', async () => {
    const { world, service, conversation } = teachingWorld();
    const first = await service.send(me(LEARNER), conversation, text('Assalamu alaikum'));
    expect(first.replayed).toBe(false);
    expect(first.message).toMatchObject({
      sequence: 4,
      own: true,
      body: 'Assalamu alaikum',
    });
    const again = await service.send(me(LEARNER), conversation, text('Assalamu alaikum'));
    expect(again).toMatchObject({ replayed: true, message: { id: first.message.id } });
    expect(
      await refusal(service.send(me(LEARNER), conversation, text('something else'))),
    ).toBe('operation-conflict');
    expect(world.messages.filter((m) => m.conversationId === conversation)).toHaveLength(
      4,
    );
  });

  it('normalises the body and refuses an empty or malformed message before spending', async () => {
    const { world, service, conversation } = teachingWorld();
    expect(await refusal(service.send(me(LEARNER), conversation, text('   ')))).toBe(
      'invalid',
    );
    expect(
      await refusal(
        service.send(me(LEARNER), conversation, { ...text('x'), extra: 1 } as never),
      ),
    ).toBe('invalid');
    expect(await refusal(service.send(me(LEARNER), conversation, text('a‮b')))).toBe(
      'invalid',
    );
    expect(world.spent).toEqual([]);
    const sent = await service.send(me(LEARNER), conversation, text('line\r\nbreak'));
    expect(sent.message.body).toBe('line\nbreak');
  });

  it('spends both budgets and refuses once one is exhausted, writing nothing', async () => {
    const { world, service, conversation } = teachingWorld();
    await service.send(me(LEARNER), conversation, text('one'));
    expect(world.spent).toEqual([
      `messaging-send:${LEARNER}`,
      `messaging-sendPerConversation:${LEARNER}:${conversation}`,
    ]);
    world.exhausted.add('messaging-sendPerConversation');
    expect(await refusal(service.send(me(LEARNER), conversation, text('two', 2)))).toBe(
      'rate-limited',
    );
    expect(world.calls.append).toBe(1);
  });

  it('refuses a refused attachment as invalid', async () => {
    const { service, conversation, attachment } = teachingWorld();
    expect(
      await refusal(
        service.send(me(TEACHER), conversation, {
          operationId: op(9),
          body: '',
          attachmentIds: [attachment],
        }),
      ),
    ).toBe('invalid');
  });

  it('marks read up to, never past, the last message', async () => {
    const { service, conversation } = teachingWorld();
    expect(await service.markRead(me(TEACHER), conversation, 1_000)).toEqual({
      readSequence: 3,
    });
    expect(await refusal(service.markRead(me(TEACHER), conversation, -1))).toBe(
      'invalid',
    );
    expect((await service.conversation(me(TEACHER), conversation)).readSequence).toBe(3);
  });

  it('pages history backwards and catches up forwards, bounded', async () => {
    const { world, service, conversation } = teachingWorld();
    world.seed.messages(conversation, 57, [TEACHER]);
    const newest = await service.history(me(LEARNER), conversation, null);
    expect(newest.messages.map((m) => m.sequence)).toEqual(
      Array.from({ length: 30 }, (_, i) => 31 + i),
    );
    expect(newest.before).toBe(31);
    const older = await service.history(me(LEARNER), conversation, newest.before);
    expect(older.messages[0]!.sequence).toBe(1);
    expect(older.before).toBeNull();
    const caught = await service.catchUp(me(LEARNER), conversation, 5);
    expect(caught.messages).toHaveLength(50);
    expect(caught).toMatchObject({ more: true, lastSequence: 60 });
    const rest = await service.catchUp(me(LEARNER), conversation, 55);
    expect(rest).toMatchObject({ more: false, lastSequence: 60 });
    expect(await refusal(service.history(me(LEARNER), conversation, 0))).toBe('invalid');
    expect(await service.unreadTotal(me(LEARNER))).toBe(58);
  });
});

describe('blocks', () => {
  it('prevents starting and sending in either direction', async () => {
    const { world, service, conversation } = teachingWorld();
    await service.block(me(LEARNER), conversation);
    await service.block(me(LEARNER), conversation); // idempotent
    expect(await service.blocks(me(LEARNER))).toEqual([
      { blockedAccountId: TEACHER, createdAt: NOW },
    ]);
    const mine = await service.conversation(me(LEARNER), conversation);
    expect(mine).toMatchObject({
      blockedByMe: true,
      canSend: false,
      sendRefusal: 'blocked',
    });
    const theirs = await service.conversation(me(TEACHER), conversation);
    expect(theirs).toMatchObject({
      blockedByMe: false,
      canSend: false,
      sendRefusal: 'blocked',
    });
    expect(await refusal(service.send(me(TEACHER), conversation, text('hello?')))).toBe(
      'blocked',
    );
    expect(await refusal(service.send(me(LEARNER), conversation, text('hello?')))).toBe(
      'blocked',
    );
    expect(
      await refusal(
        service.startTeaching(me(TEACHER), {
          counterpartAccountId: LEARNER,
          courseId: COURSE,
        }),
      ),
    ).toBe('blocked');
    expect(world.calls.append).toBe(0);
    await service.unblock(me(LEARNER), TEACHER);
    expect((await service.send(me(TEACHER), conversation, text('hello'))).replayed).toBe(
      false,
    );
  });

  it('is a safety act for a current participant only, and never for support', async () => {
    const { world, service, conversation } = teachingWorld({
      teacher: false,
      learner: false,
    });
    await service.block(me(LEARNER), conversation);
    expect(await refusal(service.block(me(STRANGER), conversation))).toBe('not-found');
    const support = world.seed.conversation({
      kind: 'support',
      participants: [[REQUESTER, 'requester']],
    });
    expect(await refusal(service.block(me(REQUESTER), support))).toBe('invalid');
    expect(await refusal(service.unblock(me(LEARNER), LEARNER))).toBe('invalid');
    world.exhausted.add('messaging-block');
    expect(await refusal(service.block(me(LEARNER), conversation))).toBe('rate-limited');
  });
});

/* ===========================================================================
 * Reports and moderation
 * ========================================================================= */

describe('reports and moderation', () => {
  function moderatedWorld() {
    const world = createWorld();
    world.seed.teaching(TEACHER, LEARNER, { teacher: true, learner: true });
    const conversation = world.seed.conversation({
      kind: 'teacher-student',
      participants: [
        [TEACHER, 'teacher'],
        [LEARNER, 'learner'],
      ],
    });
    const ids = world.seed.messages(conversation, 100, [TEACHER, LEARNER]);
    world.seed.grant(MODERATOR, 'messaging.moderate');
    return { world, conversation, ids, service: world.service() };
  }

  it('files once per target and answers a duplicate', async () => {
    const { world, service, conversation, ids } = moderatedWorld();
    const filed = await service.report(me(LEARNER), {
      conversationId: conversation,
      messageId: ids[0]!,
      reason: 'harassment',
    });
    expect(filed.duplicate).toBe(false);
    const again = await service.report(me(LEARNER), {
      conversationId: conversation,
      messageId: ids[0]!,
      reason: 'spam',
    });
    expect(again).toEqual({ reportId: filed.reportId, duplicate: true });
    expect(
      await refusal(
        service.report(me(LEARNER), {
          conversationId: conversation,
          messageId: ID(7777),
          reason: 'spam',
        }),
      ),
    ).toBe('invalid');
    expect(
      await refusal(
        service.report(me(LEARNER), {
          conversationId: conversation,
          messageId: null,
          reason: 'nope' as never,
        }),
      ),
    ).toBe('invalid');
    world.exhausted.add('messaging-report');
    expect(
      await refusal(
        service.report(me(LEARNER), {
          conversationId: conversation,
          messageId: null,
          reason: 'spam',
        }),
      ),
    ).toBe('rate-limited');
  });

  it('bounds a message report’s evidence to ±10 within the report instant, and audits it', async () => {
    const { world, service, conversation, ids } = moderatedWorld();
    // Reported message is #50; five more messages had been sent by then.
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: ids[49]!,
      reporterAccountId: LEARNER,
    });
    world.reports.get(reportId)!.atSequence = 55;
    const evidence = await service.evidence(me(MODERATOR), reportId);
    expect(evidence.messages.map((m) => m.sequence)).toEqual(
      Array.from({ length: 16 }, (_, i) => 40 + i),
    );
    expect(evidence.messages.filter((m) => m.reported).map((m) => m.sequence)).toEqual([
      50,
    ]);
    expect(evidence.reporterAccountId).toBe(LEARNER);
    expect(world.audit).toEqual([
      {
        action: 'messaging.evidence.accessed',
        actorType: 'user',
        actorId: MODERATOR,
        targetType: 'messaging-report',
        targetId: reportId,
        authorisingSource: 'messaging.moderate',
      },
    ]);
  });

  it('bounds a conversation report to the last 30 messages at the report instant', async () => {
    const { world, service, conversation } = moderatedWorld();
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: null,
      reporterAccountId: TEACHER,
    });
    world.seed.messages(conversation, 5, [LEARNER]); // after the report: never evidence
    const evidence = await service.evidence(me(MODERATOR), reportId);
    expect(evidence.messages.map((m) => m.sequence)).toEqual(
      Array.from({ length: 30 }, (_, i) => 71 + i),
    );
  });

  it('refuses every moderation surface without the live key — `denied`', async () => {
    const { world, service, conversation } = moderatedWorld();
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: null,
      reporterAccountId: TEACHER,
    });
    world.seed.grant(ADMIN, 'messaging.support');
    for (const actor of [ADMIN, LEARNER]) {
      expect(
        await refusal(service.reports(me(actor), { state: 'open', cursor: null })),
      ).toBe('denied');
      expect(await refusal(service.evidence(me(actor), reportId))).toBe('denied');
      expect(
        await refusal(
          service.decide(me(actor), { reportId, action: 'dismiss', expectedVersion: 1 }),
        ),
      ).toBe('denied');
    }
    expect(
      (await service.reports(me(MODERATOR), { state: 'open', cursor: null })).reports,
    ).toHaveLength(1);
    world.seed.revoke(MODERATOR, 'messaging.moderate');
    expect(
      await refusal(service.reports(me(MODERATOR), { state: 'open', cursor: null })),
    ).toBe('denied');
    expect(world.audit).toEqual([]);
  });

  it('withholds: participants see a placeholder, the moderator the text', async () => {
    const { world, service, conversation, ids } = moderatedWorld();
    const target = ids[99]!;
    const attachment = world.seed.attachment({
      conversationId: conversation,
      uploader: LEARNER,
      messageId: target,
    });
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: target,
      reporterAccountId: TEACHER,
    });
    expect(
      await refusal(
        service.decide(me(MODERATOR), {
          reportId,
          action: 'withhold-message',
          expectedVersion: 7,
        }),
      ),
    ).toBe('conflict');
    await service.decide(me(MODERATOR), {
      reportId,
      action: 'withhold-message',
      expectedVersion: 1,
    });
    expect(world.audit.at(-1)).toMatchObject({
      action: 'messaging.moderation.decided',
      targetType: 'messaging-report',
      targetId: reportId,
      after: { action: 'withhold-message' },
    });

    const page = await service.history(me(TEACHER), conversation, null);
    const shown = page.messages.find((m) => m.id === target)!;
    expect(shown).toMatchObject({ withheld: true, body: null, attachments: [] });
    expect(await service.openAttachment(me(TEACHER), attachment)).toBeNull();
    expect(await service.openAttachment(me(LEARNER), attachment)).toBeNull();

    const evidence = await service.evidence(me(MODERATOR), reportId);
    const kept = evidence.messages.find((m) => m.id === target)!;
    expect(kept.withheld).toBe(true);
    expect(kept.body).toContain(SECRET_BODY);
    expect(kept.attachments.map((a) => a.id)).toEqual([attachment]);
    expect(
      await service.openEvidenceAttachment(me(MODERATOR), reportId, attachment),
    ).not.toBeNull();
    expect(world.audit.at(-1)).toMatchObject({
      action: 'messaging.evidence.attachment.accessed',
      targetId: reportId,
    });
    expect(JSON.stringify(world.audit)).not.toContain(SECRET_BODY);
    expect(JSON.stringify(world.audit)).not.toContain(SECRET_NAME);
  });

  it('opens an evidence attachment only inside that report’s window', async () => {
    const { world, service, conversation, ids } = moderatedWorld();
    const outside = world.seed.attachment({
      conversationId: conversation,
      uploader: TEACHER,
      messageId: ids[0]!,
    });
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: ids[89]!,
      reporterAccountId: LEARNER,
    });
    expect(
      await service.openEvidenceAttachment(me(MODERATOR), reportId, outside),
    ).toBeNull();
    expect(
      await service.openEvidenceAttachment(me(LEARNER), reportId, outside),
    ).toBeNull();
  });

  it('refuses to withhold on a conversation report', async () => {
    const { world, service, conversation } = moderatedWorld();
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: null,
      reporterAccountId: TEACHER,
    });
    expect(
      await refusal(
        service.decide(me(MODERATOR), {
          reportId,
          action: 'withhold-message',
          expectedVersion: 1,
        }),
      ),
    ).toBe('invalid');
    expect(
      await refusal(
        service.decide(me(MODERATOR), {
          reportId: ID(8888),
          action: 'dismiss',
          expectedVersion: 1,
        }),
      ),
    ).toBe('not-found');
    await service.decide(me(MODERATOR), {
      reportId,
      action: 'close-conversation',
      expectedVersion: 1,
    });
    expect((await service.conversation(me(LEARNER), conversation)).sendRefusal).toBe(
      'closed',
    );
  });
});

/* ===========================================================================
 * Support
 * ========================================================================= */

describe('support', () => {
  function supportWorld() {
    const world = createWorld();
    const conversation = world.seed.conversation({
      kind: 'support',
      participants: [[REQUESTER, 'requester']],
    });
    world.seed.messages(conversation, 2, [REQUESTER]);
    world.seed.grant(STAFF, 'messaging.support');
    return { world, conversation, service: world.service() };
  }

  it('shows the person only their own support conversations', async () => {
    const { world, service, conversation } = supportWorld();
    const overview = await service.support(me(REQUESTER));
    expect(overview.open?.id).toBe(conversation);
    expect(overview.open?.counterpartAccountId).toBeNull();
    expect(overview.earlier).toEqual([]);
    expect((await service.support(me(STRANGER))).open).toBeNull();
    expect(await refusal(service.history(me(STRANGER), conversation, null))).toBe(
      'not-found',
    );
    expect((await service.openSupport(me(REQUESTER))).conversationId).toBe(conversation);
    world.activations.delete('support');
    expect(await refusal(service.support(me(REQUESTER)))).toBe('not-found');
    expect(await refusal(service.openSupport(me(REQUESTER)))).toBe('not-found');
  });

  it('opens the staff surfaces only with the live key; a Platform Administrator without it is denied', async () => {
    const { world, service, conversation } = supportWorld();
    world.seed.grant(ADMIN, 'messaging.moderate');
    expect(
      await refusal(service.supportQueue(me(ADMIN), { state: 'open', cursor: null })),
    ).toBe('denied');
    expect(await refusal(service.supportConversation(me(ADMIN), conversation))).toBe(
      'denied',
    );
    expect(await refusal(service.supportHistory(me(ADMIN), conversation, null))).toBe(
      'denied',
    );
    expect(await refusal(service.claimSupport(me(ADMIN), conversation, 1))).toBe(
      'denied',
    );

    const queue = await service.supportQueue(me(STAFF), { state: 'open', cursor: null });
    expect(queue.items).toEqual([
      expect.objectContaining({
        id: conversation,
        claimed: false,
        claimedByMe: false,
        awaitingReply: true,
        version: 1,
      }),
    ]);
    world.seed.revoke(STAFF, 'messaging.support');
    expect(
      await refusal(service.supportQueue(me(STAFF), { state: 'open', cursor: null })),
    ).toBe('denied');
    expect(world.audit).toEqual([]);
  });

  it('audits every content access by identifier only', async () => {
    const { world, service, conversation } = supportWorld();
    const attachment = world.seed.attachment({
      conversationId: conversation,
      uploader: REQUESTER,
      messageId: world.messages[0]!.id,
    });
    const view = await service.supportConversation(me(STAFF), conversation);
    expect(view).toMatchObject({
      requesterAccountId: REQUESTER,
      claimedByAccountId: null,
      version: 1,
    });
    expect(view.conversation).toMatchObject({ canSend: false, sendRefusal: 'unclaimed' });
    const history = await service.supportHistory(me(STAFF), conversation, null);
    expect(history.messages[0]!.body).toContain(SECRET_BODY);
    expect(await service.openSupportAttachment(me(STAFF), attachment)).not.toBeNull();
    expect(world.audit.map((event) => event.action)).toEqual([
      'messaging.support.accessed',
      'messaging.support.history.accessed',
      'messaging.support.attachment.accessed',
    ]);
    for (const event of world.audit) {
      expect(event).toMatchObject({
        actorType: 'user',
        actorId: STAFF,
        authorisingSource: 'messaging.support',
      });
    }
    expect(JSON.stringify(world.audit)).not.toContain(SECRET_BODY);
    expect(JSON.stringify(world.audit)).not.toContain(SECRET_NAME);
    expect(await service.openSupportAttachment(me(ADMIN), attachment)).toBeNull();
  });

  it('requires a claim to send, and the key on every send after it', async () => {
    const { world, service, conversation } = supportWorld();
    expect(
      await refusal(service.send(me(STAFF), conversation, text('How can we help?'))),
    ).toBe('not-found');
    expect(await refusal(service.claimSupport(me(STAFF), conversation, 9))).toBe(
      'conflict',
    );
    await service.claimSupport(me(STAFF), conversation, 1);
    expect(world.audit.at(-1)).toMatchObject({
      action: 'messaging.support.claimed',
      targetId: conversation,
    });
    const sent = await service.send(me(STAFF), conversation, text('How can we help?'));
    expect(sent.message.own).toBe(true);
    const seen = await service.history(me(REQUESTER), conversation, null);
    expect(seen.messages.at(-1)).toMatchObject({ own: false, senderAccountId: STAFF });
    expect(
      (await service.supportConversation(me(STAFF), conversation)).conversation.canSend,
    ).toBe(true);

    world.seed.revoke(STAFF, 'messaging.support');
    expect(await refusal(service.send(me(STAFF), conversation, text('again', 2)))).toBe(
      'ended',
    );

    world.seed.grant(STAFF, 'messaging.support');
    await service.resolveSupport(me(STAFF), conversation, 2);
    expect(await refusal(service.resolveSupport(me(STAFF), conversation, 3))).toBe(
      'closed',
    );
    expect(
      await refusal(service.send(me(REQUESTER), conversation, text('thanks', 3))),
    ).toBe('closed');
    const overview = await service.support(me(REQUESTER));
    expect(overview.open).toBeNull();
    expect(overview.earlier.map((c) => c.id)).toEqual([conversation]);
  });

  it('refuses a direct conversation through the staff surface', async () => {
    const { service: _unused, world } = supportWorld();
    const direct = world.seed.conversation({
      kind: 'teacher-student',
      participants: [
        [TEACHER, 'teacher'],
        [LEARNER, 'learner'],
      ],
    });
    expect(await refusal(world.service().supportConversation(me(STAFF), direct))).toBe(
      'not-found',
    );
    expect(await refusal(world.service().claimSupport(me(STAFF), direct, 1))).toBe(
      'not-found',
    );
  });
});

/* ===========================================================================
 * Attachments
 * ========================================================================= */

describe('attachments', () => {
  function bytesProbe() {
    const probe = { iterated: false };
    const bytes: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        probe.iterated = true;
        let done = false;
        return {
          async next() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new Uint8Array([1, 2, 3]) };
          },
        };
      },
    };
    return { probe, bytes };
  }

  it('refuses an unsupported declared type before reading a byte', async () => {
    const { world, service, conversation } = teachingWorld();
    const { probe, bytes } = bytesProbe();
    expect(
      await refusal(
        service.uploadAttachment(me(LEARNER), conversation, bytes, {
          mediaType: 'image/svg+xml',
          displayName: 'x.svg',
        }),
      ),
    ).toBe('unsupported');
    expect(
      await refusal(
        service.uploadAttachment(me(LEARNER), conversation, bytes, {
          mediaType: null,
          displayName: null,
        }),
      ),
    ).toBe('unsupported');
    expect(probe.iterated).toBe(false);
    expect(world.calls.prepare).toBe(0);
    expect(world.spent).toEqual([]);
  });

  it('decides send authority before reading a byte', async () => {
    const { service, conversation } = teachingWorld({ teacher: true, learner: false });
    const { probe, bytes } = bytesProbe();
    expect(
      await refusal(
        service.uploadAttachment(me(LEARNER), conversation, bytes, {
          mediaType: 'image/png',
          displayName: null,
        }),
      ),
    ).toBe('ended');
    expect(
      await refusal(
        service.uploadAttachment(me(STRANGER), conversation, bytes, {
          mediaType: 'image/png',
          displayName: null,
        }),
      ),
    ).toBe('not-found');
    expect(probe.iterated).toBe(false);
  });

  it('records a clean upload under a fresh release token, with an image policy', async () => {
    const { world, service, conversation } = teachingWorld();
    const { bytes } = bytesProbe();
    const view = await service.uploadAttachment(me(LEARNER), conversation, bytes, {
      mediaType: 'image/png',
      displayName: '  ../photo‮.png  ',
    });
    expect(view).toEqual({
      id: expect.any(String),
      mediaType: 'image/png',
      byteSize: 2048,
      displayName: '..photo.png',
    });
    const [{ policy }] = world.storage.stored as [{ policy: UploadPolicy }];
    expect(policy.releaseToken).toMatch(/^[0-9a-f]{64}$/);
    expect(policy).toMatchObject({
      allowedMediaTypes: ['image/jpeg', 'image/png'],
      maxBytes: 5 * 1024 * 1024,
      declaredMediaType: 'image/png',
      image: { maxPixels: 40_000_000, maxEdge: 8_192 },
    });
    expect(world.attachments.get(view.id)).toMatchObject({
      state: 'ready',
      releaseToken: policy.releaseToken,
    });
    expect(await service.openAttachment(me(LEARNER), view.id)).not.toBeNull();
    expect(await service.openAttachment(me(TEACHER), view.id)).toBeNull(); // not yet sent

    const sent = await service.send(me(LEARNER), conversation, {
      operationId: op(3),
      body: '',
      attachmentIds: [view.id],
    });
    expect(sent.message.attachments.map((a) => a.id)).toEqual([view.id]);
    expect(await service.openAttachment(me(TEACHER), view.id)).not.toBeNull();
  });

  it.each([
    ['rejected', 'too-large', 'too-large'],
    ['rejected', 'dimensions-too-large', 'too-large'],
    ['rejected', 'infected', 'not-cleared'],
    ['rejected', 'detected-type-not-allowed', 'unsupported'],
    ['quarantined', null, 'not-cleared'],
  ] as const)(
    'releases and forgets a %s (%s) upload — %s',
    async (state, rejection, expected) => {
      const { world, service, conversation } = teachingWorld();
      world.storage.next = { state, rejection, mediaType: 'application/pdf' };
      const { bytes } = bytesProbe();
      expect(
        await refusal(
          service.uploadAttachment(me(LEARNER), conversation, bytes, {
            mediaType: 'application/pdf',
            displayName: SECRET_NAME,
          }),
        ),
      ).toBe(expected);
      const token = world.storage.stored[0]!.policy.releaseToken;
      expect(world.storage.released).toEqual([token]);
      expect(
        [...world.attachments.values()].filter((a) => a.releaseToken === token),
      ).toEqual([]);
    },
  );

  it('releases what may have landed when Storage fails, and rethrows the outage', async () => {
    const { world, service, conversation } = teachingWorld();
    world.storage.throwOnStore = true;
    const { bytes } = bytesProbe();
    await expect(
      service.uploadAttachment(me(LEARNER), conversation, bytes, {
        mediaType: 'application/pdf',
        displayName: null,
      }),
    ).rejects.toThrow('storage outage');
    expect(world.storage.released).toHaveLength(1);
    expect([...world.attachments.values()].filter((a) => a.state !== 'attached')).toEqual(
      [],
    );
  });

  it('enforces the pending bound and the upload budget', async () => {
    const { world, service, conversation } = teachingWorld();
    for (let i = 0; i < 8; i += 1)
      world.seed.attachment({ conversationId: conversation, uploader: LEARNER });
    expect(
      await refusal(
        service.uploadAttachment(me(LEARNER), conversation, bytesProbe().bytes, {
          mediaType: 'application/pdf',
          displayName: null,
        }),
      ),
    ).toBe('too-many');
    world.exhausted.add('messaging-upload');
    expect(
      await refusal(
        service.uploadAttachment(me(TEACHER), conversation, bytesProbe().bytes, {
          mediaType: 'application/pdf',
          displayName: null,
        }),
      ),
    ).toBe('rate-limited');
  });

  it('discards only one’s own unsent upload', async () => {
    const { world, service, conversation, attachment } = teachingWorld();
    const pending = world.seed.attachment({
      conversationId: conversation,
      uploader: LEARNER,
    });
    expect(await refusal(service.discardAttachment(me(TEACHER), pending))).toBe(
      'not-found',
    );
    expect(await refusal(service.discardAttachment(me(LEARNER), attachment))).toBe(
      'not-found',
    ); // already sent
    await service.discardAttachment(me(LEARNER), pending);
    expect(world.attachments.has(pending)).toBe(false);
    expect(world.storage.released).toHaveLength(1);
  });

  it('opens nothing for an unrelated person, an ended relationship or a malformed id', async () => {
    const { world, service, attachment } = teachingWorld();
    expect(await service.openAttachment(me(TEACHER), attachment)).not.toBeNull();
    expect(await service.openAttachment(me(STRANGER), attachment)).toBeNull();
    expect(await service.openAttachment(me(LEARNER), 'nope')).toBeNull();
    world.seed.teaching(TEACHER, LEARNER, { teacher: false, learner: true });
    expect(await service.openAttachment(me(LEARNER), attachment)).toBeNull();
    expect(world.storage.opened).toHaveLength(1);
  });
});

/* ===========================================================================
 * Export and disposition
 * ========================================================================= */

describe('export', () => {
  it('returns the person’s own data under the schema, rate-limited', async () => {
    const { world, service, conversation } = teachingWorld();
    const exported = await service.export(me(LEARNER));
    expect(exported).toMatchObject({
      schema: 'minhaj.messaging.export',
      version: 1,
      generatedAt: NOW.toISOString(),
      conversations: [expect.objectContaining({ id: conversation, role: 'learner' })],
    });
    expect(exported.messages.every((m) => m.conversationId === conversation)).toBe(true);
    expect(world.spent).toEqual([`messaging-export:${LEARNER}`]);
    world.exhausted.add('messaging-export');
    expect(await refusal(service.export(me(LEARNER)))).toBe('rate-limited');
    expect(await refusal(service.export({ accountId: '' }))).toBe('denied');
  });
});

describe('disposition', () => {
  function closureWorld() {
    const world = createWorld();
    const withClosed = world.seed.conversation({
      kind: 'teacher-student',
      participants: [
        [TEACHER, 'teacher'],
        [LEARNER, 'learner'],
      ],
    });
    const withLiving = world.seed.conversation({
      kind: 'teacher-student',
      courseId: OTHER_COURSE,
      participants: [
        [TEACHER, 'teacher'],
        [STRANGER, 'learner'],
      ],
    });
    const reported = world.seed.conversation({
      kind: 'teacher-student',
      courseId: ID(902),
      participants: [
        [TEACHER, 'teacher'],
        [PEER_A, 'learner'],
      ],
    });
    const [m1] = world.seed.messages(withClosed, 2, [LEARNER]);
    world.seed.messages(withLiving, 1, [TEACHER]);
    const [m3] = world.seed.messages(reported, 1, [PEER_A]);
    const sent = world.seed.attachment({
      conversationId: withClosed,
      uploader: LEARNER,
      messageId: m1!,
    });
    const unsent = world.seed.attachment({
      conversationId: withLiving,
      uploader: TEACHER,
    });
    world.seed.report({
      conversationId: reported,
      messageId: m3!,
      reporterAccountId: TEACHER,
    });
    return { world, withClosed, withLiving, reported, sent, unsent };
  }

  /** An earlier closure already withdrew `accountId` from `conversationId`. */
  function left(
    world: ReturnType<typeof createWorld>,
    conversationId: string,
    accountId: string,
  ) {
    world.conversations
      .get(conversationId)!
      .participants.find((p) => p.accountId === accountId)!.leftAt = NOW;
  }

  it('refuses an account Identity does not report closed', async () => {
    const { world } = closureWorld();
    expect(await refusal(world.service().disposeAccount(TEACHER))).toBe('denied');
    expect(await refusal(world.service().disposeAccount(''))).toBe('invalid');
    expect([...world.conversations.values()].every((c) => c.state === 'open')).toBe(true);
  });

  it('withdraws the account and disposes only what nobody living still holds', async () => {
    const { world, withClosed, withLiving, reported, sent, unsent } = closureWorld();
    world.closed.add(TEACHER);
    world.closed.add(LEARNER);
    world.closed.add(PEER_A);
    left(world, withClosed, LEARNER);
    left(world, reported, PEER_A);
    const progress = await world.service().disposeAccount(TEACHER);
    expect(progress.complete).toBe(true);
    expect(progress.removed).toBeGreaterThan(0);
    // Everyone in it is closed and nothing reports it: gone, bytes released.
    expect(world.conversations.has(withClosed)).toBe(false);
    expect(world.attachments.has(sent)).toBe(false);
    // A living learner keeps the history; the teacher's unsent upload is released.
    expect(world.conversations.get(withLiving)).toMatchObject({
      state: 'closed',
      closedReason: 'account-closed',
    });
    expect(world.attachments.has(unsent)).toBe(false);
    // Reported: evidence, kept.
    expect(world.conversations.has(reported)).toBe(true);
    expect(world.storage.released).toHaveLength(2);

    // Idempotent: a second run finds nothing more to do.
    const again = await world.service().disposeAccount(TEACHER);
    expect(again).toEqual({ removed: 0, complete: true });
  });

  it('says `complete: false` when a budget runs out', async () => {
    const { world, withClosed } = closureWorld();
    world.closed.add(TEACHER);
    world.knobs.withdrawForever = true;
    const progress = await world.service().disposeAccount(TEACHER);
    expect(progress.complete).toBe(false);
    expect(world.conversations.has(withClosed)).toBe(true);
    expect(world.disposing.size).toBe(0);
  });

  it('still asks Identity before marking — a left participant is not proof of closure', async () => {
    const { world, withLiving } = closureWorld();
    world.closed.add(TEACHER);
    // The learner left, but Identity does not report their account closed.
    left(world, withLiving, STRANGER);
    const progress = await world.service().disposeAccount(TEACHER);
    expect(progress.complete).toBe(true);
    expect(world.conversations.has(withLiving)).toBe(true);
    expect(world.disposing.has(withLiving)).toBe(false);
  });

  /**
   * A closed teacher with `retained` conversations a living learner still
   * holds, then `disposable` ones whose learner closed and left earlier.
   */
  function manyConversations(retained: number, disposable: number) {
    const world = createWorld();
    const gone: string[] = [];
    for (let i = 0; i < retained + disposable; i += 1) {
      const learner = `acct-learner-${String(i)}`;
      const id = world.seed.conversation({
        kind: 'teacher-student',
        courseId: ID(3000 + i),
        participants: [
          [TEACHER, 'teacher'],
          [learner, 'learner'],
        ],
      });
      if (i >= retained) {
        left(world, id, learner);
        world.closed.add(learner);
        gone.push(id);
      }
    }
    world.closed.add(TEACHER);
    return { world, gone };
  }

  it('completes in one page however many conversations living people retain', async () => {
    const { world, gone } = manyConversations(500, 1);
    const progress = await world.service().disposeAccount(TEACHER);
    expect(progress.complete).toBe(true);
    expect(world.calls.candidatePages).toBe(1);
    expect(world.conversations.has(gone[0]!)).toBe(false);
    expect(world.conversations.size).toBe(500);
    expect(await world.service().disposeAccount(TEACHER)).toEqual({
      removed: 0,
      complete: true,
    });
  });

  it('walks disposable candidates across pages and completes', async () => {
    const { world, gone } = manyConversations(0, 60);
    const progress = await world.service().disposeAccount(TEACHER);
    expect(progress.complete).toBe(true);
    expect(world.calls.candidatePages).toBe(2);
    expect(gone.every((id) => !world.conversations.has(id))).toBe(true);
  });

  it('says `complete: false` when the candidate page budget runs out, and resumes', async () => {
    // Ten full pages of disposable conversations, and one more beyond them.
    const { world, gone } = manyConversations(0, 501);
    const beyond = gone.at(-1)!;
    const progress = await world.service().disposeAccount(TEACHER);
    expect(progress.complete).toBe(false);
    expect(world.calls.candidatePages).toBe(10);
    expect(world.disposing.has(beyond)).toBe(false);
    expect(world.conversations.has(beyond)).toBe(true);
    // The next run picks up what the budget left.
    await world.service().disposeAccount(TEACHER);
    expect(world.disposing.has(beyond)).toBe(true);
  });

  it('reconciles only accounts Identity reports closed', async () => {
    const { world, withClosed, withLiving } = closureWorld();
    world.closed.add(LEARNER);
    const progress = await world.service().reconcileClosedAccounts();
    expect(progress.complete).toBe(true);
    expect(world.conversations.get(withClosed)).toMatchObject({
      state: 'closed',
      closedReason: 'account-closed',
    });
    // The teacher is alive: their own conversations stay as they were.
    expect(world.conversations.get(withLiving)!.state).toBe('open');
    expect(
      world.conversations.get(withLiving)!.participants.every((p) => p.leftAt === null),
    ).toBe(true);
  });

  it('sweeps unsent uploads past the bound and leaves fresh ones', async () => {
    const { world, withLiving, unsent } = closureWorld();
    const stale = world.seed.attachment({
      conversationId: withLiving,
      uploader: STRANGER,
      createdAt: new Date(NOW.getTime() - 25 * 3_600_000),
    });
    expect(await world.service().sweepAttachments()).toBe(1);
    expect(world.attachments.has(stale)).toBe(false);
    expect(world.attachments.has(unsent)).toBe(true);
  });
});

/* ===========================================================================
 * Database refusals beneath the adapter
 * ========================================================================= */

describe('database refusals beneath the adapter', () => {
  /**
   * The adapter's `MessagingDataError`, reproduced by SHAPE: this host cannot
   * import the database package, and the service recognises the error the
   * same way — by name and a string reason.
   */
  class MessagingDataError extends Error {
    constructor(readonly reason: string) {
      super(reason);
      this.name = 'MessagingDataError';
    }
  }

  it.each([
    ['invalid', 'invalid'],
    ['not-activated', 'not-found'],
    ['closed', 'closed'],
    ['not-participant', 'not-found'],
    ['attachment-unavailable', 'invalid'],
    ['conflict', 'conflict'],
  ] as const)('tells a %s data error as `%s`', (reason, expected) => {
    const mapped = dataRefusal(new MessagingDataError(reason));
    expect(mapped).toBeInstanceOf(MessagingRefusal);
    expect(mapped?.reason).toBe(expected);
  });

  it('maps nothing else: internal reasons, other errors and look-alikes stay outages', () => {
    for (const reason of ['immutable', 'evidence', 'open', 'not-disposing', 'unheard-of'])
      expect(dataRefusal(new MessagingDataError(reason))).toBeNull();
    expect(dataRefusal(new Error('closed'))).toBeNull();
    expect(dataRefusal({ name: 'MessagingDataError', reason: 'closed' })).toBeNull();
    const numeric = Object.assign(new Error('x'), {
      name: 'MessagingDataError',
      reason: 7,
    });
    expect(dataRefusal(numeric)).toBeNull();
    expect(dataRefusal(null)).toBeNull();
  });

  it('refuses a conversation opened against a kind switched off underneath — `not-found`', async () => {
    const world = createWorld();
    world.seed.teaching(TEACHER, LEARNER, { teacher: true, learner: true });
    world.persistence.openDirect = async () => {
      throw new MessagingDataError('not-activated');
    };
    expect(
      await refusal(
        world.service().startTeaching(me(LEARNER), {
          counterpartAccountId: TEACHER,
          courseId: COURSE,
        }),
      ),
    ).toBe('not-found');
  });

  it('refuses a send that met the floor: closed, or no longer a participant', async () => {
    const { world, service, conversation } = teachingWorld();
    world.persistence.append = async () => {
      throw new MessagingDataError('closed');
    };
    expect(await refusal(service.send(me(LEARNER), conversation, text('hi')))).toBe(
      'closed',
    );
    world.persistence.append = async () => {
      throw new MessagingDataError('not-participant');
    };
    expect(await refusal(service.send(me(LEARNER), conversation, text('hi', 2)))).toBe(
      'not-found',
    );
  });

  it('refuses an upload into a conversation closed after the gate, reading no byte', async () => {
    const { world, service, conversation } = teachingWorld();
    world.persistence.prepareAttachment = async () => {
      throw new MessagingDataError('closed');
    };
    let iterated = false;
    const bytes: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        iterated = true;
        return noBytes()[Symbol.asyncIterator]();
      },
    };
    expect(
      await refusal(
        service.uploadAttachment(me(LEARNER), conversation, bytes, {
          mediaType: 'application/pdf',
          displayName: null,
        }),
      ),
    ).toBe('closed');
    expect(iterated).toBe(false);
    expect(world.storage.stored).toEqual([]);
  });

  it('releases clean bytes whose recording met the floor, then refuses', async () => {
    const { world, service, conversation } = teachingWorld();
    world.storage.next = {
      state: 'clean',
      rejection: null,
      mediaType: 'application/pdf',
    };
    world.persistence.recordAttachment = async () => {
      throw new MessagingDataError('conflict');
    };
    expect(
      await refusal(
        service.uploadAttachment(me(LEARNER), conversation, noBytes(), {
          mediaType: 'application/pdf',
          displayName: SECRET_NAME,
        }),
      ),
    ).toBe('conflict');
    const token = world.storage.stored[0]!.policy.releaseToken;
    expect(world.storage.released).toEqual([token]);
    expect(
      [...world.attachments.values()].filter((a) => a.releaseToken === token),
    ).toEqual([]);
  });

  it('maps report, block, claim, resolve and decision floors the same way', async () => {
    const { world, service, conversation } = teachingWorld();
    world.persistence.fileReport = async () => {
      throw new MessagingDataError('not-participant');
    };
    expect(
      await refusal(
        service.report(me(LEARNER), {
          conversationId: conversation,
          messageId: null,
          reason: 'spam',
        }),
      ),
    ).toBe('not-found');
    world.persistence.block = async () => {
      throw new MessagingDataError('invalid');
    };
    expect(await refusal(service.block(me(LEARNER), conversation))).toBe('invalid');

    const support = world.seed.conversation({
      kind: 'support',
      participants: [[REQUESTER, 'requester']],
    });
    world.seed.grant(STAFF, 'messaging.support');
    world.persistence.claimSupport = async () => {
      throw new MessagingDataError('conflict');
    };
    expect(await refusal(service.claimSupport(me(STAFF), support, 1))).toBe('conflict');
    world.persistence.resolveSupport = async () => {
      throw new MessagingDataError('closed');
    };
    expect(await refusal(service.resolveSupport(me(STAFF), support, 1))).toBe('closed');
    world.persistence.openSupport = async () => {
      throw new MessagingDataError('conflict');
    };
    expect(await refusal(service.openSupport(me(REQUESTER)))).toBe('conflict');

    world.seed.grant(MODERATOR, 'messaging.moderate');
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: null,
      reporterAccountId: LEARNER,
    });
    world.persistence.decide = async () => {
      throw new MessagingDataError('conflict');
    };
    expect(
      await refusal(
        service.decide(me(MODERATOR), {
          reportId,
          action: 'dismiss',
          expectedVersion: 1,
        }),
      ),
    ).toBe('conflict');
  });

  it('rethrows an internal reason and an outage unchanged, never as a refusal', async () => {
    const { world, service, conversation } = teachingWorld();
    world.seed.grant(MODERATOR, 'messaging.moderate');
    const reportId = world.seed.report({
      conversationId: conversation,
      messageId: null,
      reporterAccountId: LEARNER,
    });
    const immutable = new MessagingDataError('immutable');
    world.persistence.decide = async () => {
      throw immutable;
    };
    await expect(
      service.decide(me(MODERATOR), { reportId, action: 'dismiss', expectedVersion: 1 }),
    ).rejects.toBe(immutable);
    const outage = new Error('connection reset');
    world.persistence.append = async () => {
      throw outage;
    };
    await expect(service.send(me(LEARNER), conversation, text('hi'))).rejects.toBe(
      outage,
    );
  });
});
