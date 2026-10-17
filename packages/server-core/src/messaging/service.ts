import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import {
  CONVERSATION_STATES,
  MESSAGING_EXPORT_SCHEMA,
  MESSAGING_EXPORT_VERSION,
  MESSAGING_LIMITS,
  REPORT_STATES,
  messageSequenceSchema,
  messagingAccountIdSchema,
  messagingIdSchema,
  messagingVersionSchema,
  moderationDecisionSchema,
  reportInputSchema,
  sendMessageSchema,
  startTeachingConversationSchema,
  type ConversationAccess,
  type ConversationRecord,
  type ConversationState,
  type ConversationView,
  type MessageAttachmentRecord,
  type MessagingActor,
  type MessagingAuthority,
  type MessagingCapability,
  type MessagingPeerPolicyPort,
  type MessagingPermission,
  type ParticipantRecord,
  type ParticipantRole,
  type ReadingState,
  type ReportRecord,
  type ReportState,
  type SendRefusal,
} from '@minhaj/contracts/messaging';
import type {
  AssetAuthorizationPort,
  AssetStream,
  AuditEvent,
  RateLimitRule,
  StoredAsset,
} from '@minhaj/contracts/platform';

import {
  createAccessDecider,
  currentSelf,
  directCounterpart,
  type AccessDecision,
} from './access.ts';
import { cleanDisplayName, rejectionRefusal, uploadPolicy } from './attachments.ts';
import { createDisposition } from './disposition.ts';
import { refusing } from './refusal.ts';
import {
  MessagingRefusal,
  type MessagingCapabilities,
  type MessagingRateRules,
  type MessagingService,
  type MessagingServiceDependencies,
  type SupportConversationView,
} from './types.ts';
import {
  NO_READING,
  activityOf,
  decodeCursor,
  encodeCursor,
  evidenceMessage,
  isAttachmentType,
  messageView,
  reportSummary,
  summaryOf,
} from './views.ts';

/**
 * The Messaging service (DELIVERY_PLAN.md Phase 24; DOMAIN_MODEL.md §15).
 *
 * ONE IMPLEMENTATION, TWO PROCESSES. The web application calls this today and
 * the Phase-25 realtime transport will call the SAME functions on every
 * event, so no rule here may live in a route, a page or a socket handler.
 *
 * EVERY CALL RE-DECIDES (`access.ts`). Nothing is cached: each read and write
 * re-reads the activation, Learning's current standing, Identity's live keys
 * and Messaging's own blocks and states, so a revocation wins next request.
 *
 * REFUSALS ARE CHOSEN. Input failing a contract schema is `invalid`; a
 * conversation the actor has no part in, of an inactive kind, or that does not
 * exist is `not-found` — one answer, so it cannot be probed; only a current
 * participant whose relationship has ended hears `ended`. Staff and moderator
 * surfaces without their live key hear `denied`. A rule the database enforced
 * beneath the adapter's own questions is told the same way (`refusal.ts`).
 * Anything else thrown is an outage and is left to propagate.
 *
 * COSTS BEFORE WRITES. A rate budget is spent after the cheap checks and the
 * access decision — so a refused request does not drain a person's budget —
 * and before the first write.
 *
 * NOTHING SENSITIVE LEAVES SIDEWAYS. This service logs nothing. Audit rows
 * carry identifiers and states only: never a body, a filename or a token.
 */

const rule = (window: number, max: number): RateLimitRule =>
  Object.freeze({ window, max });

export const MESSAGING_RATE_RULES: MessagingRateRules = Object.freeze({
  start: rule(3_600, 30),
  send: rule(3_600, 300),
  sendPerConversation: rule(600, 60),
  upload: rule(3_600, 40),
  supportOpen: rule(3_600, 5),
  report: rule(3_600, 20),
  block: rule(3_600, 60),
  staffRead: rule(3_600, 600),
  moderation: rule(3_600, 300),
  export: rule(3_600, 10),
});

/**
 * The production student-to-student policy: no pair, ever
 * (OPEN_DECISIONS.md §2.5 is open). Nothing configures it; a future approved
 * policy replaces this wiring with its own tests before activation.
 */
export const denyAllPeers: MessagingPeerPolicyPort = Object.freeze({
  permits: async () => false,
});

const SURFACE_ROLES: Readonly<Record<'my' | 'teacher', readonly ParticipantRole[]>> =
  Object.freeze({
    my: Object.freeze(['learner', 'peer', 'requester'] as const),
    teacher: Object.freeze(['teacher'] as const),
  });

/** Earlier support conversations shown beside the open one. */
const SUPPORT_OVERVIEW = 10;

type Readable = Extract<AccessDecision, ConversationAccess>;

export function createMessagingService(
  deps: MessagingServiceDependencies,
): MessagingService {
  const store = deps.persistence;
  const now = deps.clock ?? (() => new Date());
  const decideMany = createAccessDecider(deps);
  const disposition = createDisposition({
    persistence: store,
    accounts: deps.accounts,
    storage: deps.storage,
    now,
  });

  /* ---- small guards -------------------------------------------------------- */

  /** The session's account. A malformed actor is never a person. */
  function actorOf(actor: MessagingActor): string {
    const parsed = messagingAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new MessagingRefusal('denied');
    return parsed.data;
  }

  function idOf(value: unknown): string {
    const parsed = messagingIdSchema.safeParse(value);
    if (!parsed.success) throw new MessagingRefusal('invalid');
    return parsed.data;
  }

  async function spend(
    purpose: keyof MessagingRateRules,
    subject: string,
  ): Promise<void> {
    const decision = await deps.limiter.consume(
      deps.limitKey(`messaging-${purpose}`, subject),
      MESSAGING_RATE_RULES[purpose],
    );
    if (!decision.allowed) throw new MessagingRefusal('rate-limited');
  }

  async function requireKey(
    actorId: string,
    permission: MessagingPermission,
  ): Promise<void> {
    if (!(await deps.authority.permits(actorId, permission)))
      throw new MessagingRefusal('denied');
  }

  async function activations(): Promise<
    ReadonlyMap<MessagingCapability, MessagingAuthority>
  > {
    return store.activations();
  }

  async function audit(event: Omit<AuditEvent, 'actorType'>): Promise<void> {
    await deps.audit.record({ actorType: 'user', ...event });
  }

  /* ---- the one decision, applied ------------------------------------------ */

  interface Decided {
    readonly record: ConversationRecord;
    readonly me: ParticipantRecord;
    readonly access: Readable;
  }

  /** One conversation through THE decision; refuses unless it may be read. */
  async function readable(actorId: string, conversationId: unknown): Promise<Decided> {
    const id = idOf(conversationId);
    const record = await store.conversation(id);
    if (record === null) throw new MessagingRefusal('not-found');
    const verdict = (await decideMany(actorId, [record], await activations())).get(
      record.id,
    );
    const me = currentSelf(record, actorId);
    if (verdict === 'available' || verdict === 'terminal') {
      if (me === undefined) throw new MessagingRefusal('not-found');
      return { record, me, access: verdict };
    }
    throw new MessagingRefusal(verdict === 'ended' ? 'ended' : 'not-found');
  }

  /**
   * Why a reader who may read cannot send now — the order a person needs it in.
   *
   * `unclaimed` never arises here: staff without a CURRENT claim hold no
   * current participant row, so the decision itself refuses them on this
   * path; the staff view (`supportConversation`) is where they are told.
   */
  function sendRefusalOf(
    record: ConversationRecord,
    access: Readable,
    blocked: boolean,
  ): SendRefusal | null {
    // Terminal first: a closed account's conversation is also closed, and the
    // person left behind needs to be told WHY it is read-only.
    if (access === 'terminal') return 'terminal';
    if (record.state === 'closed') return 'closed';
    if (blocked) return 'blocked';
    return null;
  }

  async function blockFacts(
    record: ConversationRecord,
    actorId: string,
  ): Promise<{ readonly blockedByMe: boolean; readonly blocked: boolean }> {
    const counterpart = directCounterpart(record, actorId);
    if (counterpart === undefined) return { blockedByMe: false, blocked: false };
    const state = await store.blockState(actorId, counterpart.accountId);
    return {
      blockedByMe: state.firstBlockedSecond,
      blocked: state.firstBlockedSecond || state.secondBlockedFirst,
    };
  }

  /** The send gate shared by `send` and `uploadAttachment`. */
  async function sendable(actorId: string, conversationId: unknown): Promise<Decided> {
    const decided = await readable(actorId, conversationId);
    const { blocked } = await blockFacts(decided.record, actorId);
    const refusal = sendRefusalOf(decided.record, decided.access, blocked);
    if (refusal !== null) throw new MessagingRefusal(refusal);
    return decided;
  }

  /* ---- attachments --------------------------------------------------------- */

  /** Storage first, then Messaging's row — never the other way round. */
  async function releaseAndForget(
    attachmentId: string,
    releaseToken: string,
  ): Promise<void> {
    const outcome = await deps.storage.release(releaseToken);
    if (outcome !== 'referenced') await store.forgetAttachment(attachmentId);
  }

  async function abandon(attachmentId: string, releaseToken: string): Promise<void> {
    await store.abandonAttachment(attachmentId);
    await releaseAndForget(attachmentId, releaseToken);
  }

  /** Storage's half: serve exactly this asset, and only as a Messaging format. */
  function onlyAsset(assetId: string): AssetAuthorizationPort {
    return {
      decide: async (request) =>
        request.assetId === assetId && isAttachmentType(request.mediaType)
          ? 'allow'
          : 'deny',
    };
  }

  /** `null` for every refusal; an outage still throws. */
  async function orNull<T>(work: () => Promise<T | null>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof MessagingRefusal) return null;
      throw error;
    }
  }

  async function serve(attachment: MessageAttachmentRecord): Promise<AssetStream | null> {
    if (attachment.assetId === null) return null;
    return deps.storage.open(attachment.assetId, onlyAsset(attachment.assetId));
  }

  /* ---- support staff ------------------------------------------------------- */

  /** A support conversation for live `messaging.support`, kind on, or a refusal. */
  async function staffConversation(actorId: string, conversationId: unknown) {
    await requireKey(actorId, 'messaging.support');
    const id = idOf(conversationId);
    if (!(await activations()).has('support')) throw new MessagingRefusal('not-found');
    const record = await store.conversation(id);
    if (record === null || record.kind !== 'support')
      throw new MessagingRefusal('not-found');
    return record;
  }

  function claimantOf(record: ConversationRecord): string | null {
    return (
      record.participants.find(
        (participant) => participant.role === 'support' && participant.leftAt === null,
      )?.accountId ?? null
    );
  }

  /* ---- moderation ---------------------------------------------------------- */

  /** The ONE span a report authorises, or `null` when it names none. */
  function evidenceWindow(
    report: ReportRecord,
  ): { readonly from: number; readonly to: number } | null {
    if (report.messageId !== null) {
      if (report.messageSequence === null) return null;
      const from = Math.max(1, report.messageSequence - MESSAGING_LIMITS.evidenceAround);
      const to = Math.min(
        report.atSequence,
        report.messageSequence + MESSAGING_LIMITS.evidenceAround,
      );
      return from <= to ? { from, to } : null;
    }
    const from = Math.max(
      1,
      report.atSequence - (MESSAGING_LIMITS.evidenceConversation - 1),
    );
    return from <= report.atSequence ? { from, to: report.atSequence } : null;
  }

  async function evidenceSpan(report: ReportRecord) {
    const window = evidenceWindow(report);
    if (window === null) return [];
    return store.span({ conversationId: report.conversationId, ...window });
  }

  async function moderatorReport(
    actorId: string,
    reportId: unknown,
  ): Promise<ReportRecord> {
    await requireKey(actorId, 'messaging.moderate');
    const id = idOf(reportId);
    const report = await store.report(id);
    if (report === null) throw new MessagingRefusal('not-found');
    return report;
  }

  /* ---- the surface --------------------------------------------------------- */

  async function conversations(
    actor: MessagingActor,
    input: { readonly surface: 'my' | 'teacher'; readonly cursor: string | null },
  ) {
    const actorId = actorOf(actor);
    const surface = input?.surface;
    if (surface !== 'my' && surface !== 'teacher') throw new MessagingRefusal('invalid');
    const roles = SURFACE_ROLES[surface];
    const after = decodeCursor(input.cursor);
    const records = await store.conversationsOf({
      accountId: actorId,
      roles,
      after,
      limit: MESSAGING_LIMITS.conversationPage,
    });
    const verdicts = await decideMany(actorId, records, await activations());
    const kept = records.filter((record) => {
      const verdict = verdicts.get(record.id);
      return verdict === 'available' || verdict === 'terminal';
    });
    const readings =
      kept.length === 0
        ? new Map<string, ReadingState>()
        : await store.readingStates(
            actorId,
            kept.map((record) => record.id),
          );
    const last = records[records.length - 1];
    return {
      conversations: kept.flatMap((record) => {
        const me = currentSelf(record, actorId);
        const access = verdicts.get(record.id) as Readable;
        return me === undefined
          ? []
          : [
              summaryOf(
                record,
                actorId,
                me.role,
                readings.get(record.id) ?? NO_READING,
                access,
              ),
            ];
      }),
      next:
        records.length === MESSAGING_LIMITS.conversationPage && last !== undefined
          ? encodeCursor({ at: activityOf(last), id: last.id })
          : null,
    };
  }

  return {
    async capabilities(): Promise<MessagingCapabilities> {
      const active = await activations();
      return {
        support: active.has('support'),
        teacherStudent: active.has('teacher-student'),
        studentStudent: active.has('student-student'),
        fixture: [...active.values()].some((authority) => authority === 'fixture'),
      };
    },

    conversations,

    async conversation(actor, conversationId): Promise<ConversationView> {
      const actorId = actorOf(actor);
      const { record, me, access } = await readable(actorId, conversationId);
      const [readings, blocks] = await Promise.all([
        store.readingStates(actorId, [record.id]),
        blockFacts(record, actorId),
      ]);
      const reading = readings.get(record.id) ?? NO_READING;
      const sendRefusal = sendRefusalOf(record, access, blocks.blocked);
      return {
        summary: summaryOf(record, actorId, me.role, reading, access),
        readSequence: reading.readSequence,
        canSend: sendRefusal === null,
        sendRefusal,
        blockedByMe: blocks.blockedByMe,
      };
    },

    async history(actor, conversationId, before) {
      const actorId = actorOf(actor);
      if (
        before !== null &&
        !(messageSequenceSchema.safeParse(before).success && before >= 1)
      ) {
        throw new MessagingRefusal('invalid');
      }
      const { record } = await readable(actorId, conversationId);
      const page = await store.history({
        conversationId: record.id,
        before,
        limit: MESSAGING_LIMITS.historyPage,
      });
      const first = page[0];
      return {
        messages: page.map((message) => messageView(message, actorId)),
        before: first !== undefined && first.sequence > 1 ? first.sequence : null,
      };
    },

    async catchUp(actor, conversationId, after) {
      const actorId = actorOf(actor);
      if (!messageSequenceSchema.safeParse(after).success)
        throw new MessagingRefusal('invalid');
      const { record } = await readable(actorId, conversationId);
      const page = await store.after({
        conversationId: record.id,
        after,
        limit: MESSAGING_LIMITS.catchUpPage,
      });
      const last = page[page.length - 1];
      return {
        messages: page.map((message) => messageView(message, actorId)),
        more:
          page.length === MESSAGING_LIMITS.catchUpPage &&
          last !== undefined &&
          last.sequence < record.lastSequence,
        lastSequence: record.lastSequence,
      };
    },

    async unreadTotal(actor) {
      const page = await conversations(actor, { surface: 'my', cursor: null });
      return page.conversations
        .filter((summary) => summary.access === 'available')
        .reduce((total, summary) => total + summary.unread, 0);
    },

    async startable(actor) {
      const actorId = actorOf(actor);
      if (!(await activations()).has('teacher-student')) return [];
      const teachers = await deps.teaching.currentTeachers(actorId);
      return teachers
        .filter((teacher) => teacher.teacherAccountId !== actorId)
        .map((teacher) => ({
          counterpartAccountId: teacher.teacherAccountId,
          courseId: teacher.courseId,
        }));
    },

    async startTeaching(actor, input) {
      const actorId = actorOf(actor);
      const parsed = startTeachingConversationSchema.safeParse(input);
      if (!parsed.success) throw new MessagingRefusal('invalid');
      const { counterpartAccountId: counterpart, courseId } = parsed.data;
      if (counterpart === actorId) throw new MessagingRefusal('invalid');
      if (!(await activations()).has('teacher-student'))
        throw new MessagingRefusal('not-found');
      await spend('start', actorId);
      // Either side may start, so ask both orientations in one question and
      // take the one where BOTH halves hold. Neither: no relationship to offer.
      const [asTeacher, asLearner] = await deps.teaching.standing([
        { teacherAccountId: actorId, learnerAccountId: counterpart, courseId },
        { teacherAccountId: counterpart, learnerAccountId: actorId, courseId },
      ]);
      const roles: {
        readonly actor: ParticipantRole;
        readonly counterpart: ParticipantRole;
      } | null =
        asTeacher?.teacher === true && asTeacher.learner
          ? { actor: 'teacher', counterpart: 'learner' }
          : asLearner?.teacher === true && asLearner.learner
            ? { actor: 'learner', counterpart: 'teacher' }
            : null;
      if (roles === null) throw new MessagingRefusal('not-found');
      const blocks = await store.blockState(actorId, counterpart);
      if (blocks.firstBlockedSecond || blocks.secondBlockedFirst) {
        throw new MessagingRefusal('blocked');
      }
      const opened = await refusing(() =>
        store.openDirect({
          kind: 'teacher-student',
          courseId,
          first: { accountId: actorId, role: roles.actor },
          second: { accountId: counterpart, role: roles.counterpart },
        }),
      );
      return { conversationId: opened.conversation.id };
    },

    async startPeer(actor, input) {
      const actorId = actorOf(actor);
      const parsed = startTeachingConversationSchema.safeParse(input);
      if (!parsed.success) throw new MessagingRefusal('invalid');
      const { counterpartAccountId: counterpart, courseId } = parsed.data;
      if (counterpart === actorId) throw new MessagingRefusal('invalid');
      if (!(await activations()).has('student-student'))
        throw new MessagingRefusal('not-found');
      const [low, high] =
        actorId < counterpart ? [actorId, counterpart] : [counterpart, actorId];
      if (
        !(await deps.peers.permits({
          firstAccountId: low,
          secondAccountId: high,
          courseId,
        }))
      ) {
        throw new MessagingRefusal('not-found');
      }
      await spend('start', actorId);
      const blocks = await store.blockState(actorId, counterpart);
      if (blocks.firstBlockedSecond || blocks.secondBlockedFirst) {
        throw new MessagingRefusal('blocked');
      }
      const opened = await refusing(() =>
        store.openDirect({
          kind: 'student-student',
          courseId,
          first: { accountId: actorId, role: 'peer' },
          second: { accountId: counterpart, role: 'peer' },
        }),
      );
      return { conversationId: opened.conversation.id };
    },

    async send(actor, conversationId, input) {
      const actorId = actorOf(actor);
      const parsed = sendMessageSchema.safeParse(input);
      if (!parsed.success) throw new MessagingRefusal('invalid');
      const { record } = await sendable(actorId, conversationId);
      await spend('send', actorId);
      await spend('sendPerConversation', `${actorId}:${record.id}`);
      const counterpart = directCounterpart(record, actorId);
      const blockPair: readonly [string, string] | null =
        counterpart === undefined
          ? null
          : actorId < counterpart.accountId
            ? [actorId, counterpart.accountId]
            : [counterpart.accountId, actorId];
      const { operationId, body, attachmentIds } = parsed.data;
      const outcome = await refusing(() =>
        store.append({
          conversationId: record.id,
          senderAccountId: actorId,
          operationId,
          body,
          // Binds the operation identifier to WHAT was sent, so a retry with a
          // different payload is told it conflicts instead of being "replayed".
          payloadDigest: createHash('sha256')
            .update(`${body}\u0000${attachmentIds.join(',')}`, 'utf8')
            .digest('hex'),
          attachmentIds,
          blockPair,
        }),
      );
      switch (outcome.state) {
        case 'created':
        case 'replayed':
          return {
            message: messageView(outcome.message, actorId),
            replayed: outcome.state === 'replayed',
          };
        case 'conflict':
          throw new MessagingRefusal('operation-conflict');
        case 'closed':
          throw new MessagingRefusal('closed');
        case 'not-participant':
          throw new MessagingRefusal('not-found');
        case 'blocked':
          throw new MessagingRefusal('blocked');
        case 'attachment-unavailable':
          throw new MessagingRefusal('invalid');
      }
    },

    async markRead(actor, conversationId, sequence) {
      const actorId = actorOf(actor);
      if (!messageSequenceSchema.safeParse(sequence).success)
        throw new MessagingRefusal('invalid');
      const { record } = await readable(actorId, conversationId);
      const readSequence = await refusing(() =>
        store.markRead({
          conversationId: record.id,
          accountId: actorId,
          sequence: Math.min(sequence, record.lastSequence),
        }),
      );
      return { readSequence };
    },

    /* ---- safety ---------------------------------------------------------- */

    async block(actor, conversationId) {
      const actorId = actorOf(actor);
      const id = idOf(conversationId);
      const record = await store.conversation(id);
      // A SAFETY ACT, not an exchange: a current participant may block the
      // other person whatever the relationship's standing — someone whose
      // teaching relationship ended must still be able to stop hearing from
      // them. Being a current participant is the whole requirement.
      const me = record === null ? undefined : currentSelf(record, actorId);
      if (record === null || me === undefined) throw new MessagingRefusal('not-found');
      const counterpart = directCounterpart(record, actorId);
      if (counterpart === undefined) throw new MessagingRefusal('invalid');
      await spend('block', actorId);
      await refusing(() => store.block(actorId, counterpart.accountId));
    },

    async unblock(actor, counterpartAccountId) {
      const actorId = actorOf(actor);
      const parsed = messagingAccountIdSchema.safeParse(counterpartAccountId);
      if (!parsed.success || parsed.data === actorId)
        throw new MessagingRefusal('invalid');
      await spend('block', actorId);
      await store.unblock(actorId, parsed.data);
    },

    async blocks(actor) {
      return store.blocksBy(actorOf(actor), MESSAGING_LIMITS.blockPage);
    },

    async report(actor, input) {
      const actorId = actorOf(actor);
      const parsed = reportInputSchema.safeParse(input);
      if (!parsed.success) throw new MessagingRefusal('invalid');
      const { record } = await readable(actorId, parsed.data.conversationId);
      await spend('report', actorId);
      const outcome = await refusing(() =>
        store.fileReport({
          conversationId: record.id,
          messageId: parsed.data.messageId,
          reporterAccountId: actorId,
          reason: parsed.data.reason,
        }),
      );
      if (outcome.state === 'invalid') throw new MessagingRefusal('invalid');
      return { reportId: outcome.reportId, duplicate: outcome.state === 'duplicate' };
    },

    /* ---- attachments ----------------------------------------------------- */

    async uploadAttachment(actor, conversationId, bytes, declared) {
      const actorId = actorOf(actor);
      const { record } = await sendable(actorId, conversationId);
      // Refused on the DECLARATION, before a byte is read: nothing outside the
      // three formats is worth streaming into quarantine to refuse there.
      const declaredType = declared?.mediaType ?? null;
      if (!isAttachmentType(declaredType)) throw new MessagingRefusal('unsupported');
      await spend('upload', actorId);
      const releaseToken = randomBytes(32).toString('hex');
      const prepared = await refusing(() =>
        store.prepareAttachment({
          conversationId: record.id,
          uploaderAccountId: actorId,
          releaseToken,
          limit: MESSAGING_LIMITS.pendingUploadsPerConversation,
        }),
      );
      if (prepared.state === 'too-many') throw new MessagingRefusal('too-many');
      const { attachmentId } = prepared;
      const displayName = cleanDisplayName(declared?.displayName ?? null);

      let stored: StoredAsset;
      try {
        stored = await deps.storage.store(
          bytes,
          uploadPolicy({ declared: declaredType, displayName, releaseToken }),
        );
      } catch (error) {
        // The bytes may or may not have landed. Release under the token we
        // hold either way; if even that fails, the `releasing` row is swept.
        try {
          await abandon(attachmentId, releaseToken);
        } catch {
          // The original failure is the one worth reporting.
        }
        throw error;
      }

      if (stored.state === 'clean' && isAttachmentType(stored.mediaType)) {
        let recorded: boolean;
        try {
          recorded = await refusing(() =>
            store.recordAttachment({
              attachmentId,
              uploaderAccountId: actorId,
              assetId: stored.id,
              mediaType: stored.mediaType,
              byteSize: stored.byteSize,
              displayName,
            }),
          );
        } catch (error) {
          // The clean bytes are in Storage under our token but not recorded:
          // release them now rather than leave them for the sweep.
          try {
            await abandon(attachmentId, releaseToken);
          } catch {
            // The original failure is the one worth reporting.
          }
          throw error;
        }
        if (!recorded) {
          // Swept (or discarded) while the bytes were arriving.
          await releaseAndForget(attachmentId, releaseToken);
          throw new MessagingRefusal('not-found');
        }
        return {
          id: attachmentId,
          mediaType: stored.mediaType,
          byteSize: stored.byteSize,
          displayName,
        };
      }

      await abandon(attachmentId, releaseToken);
      if (stored.state === 'rejected')
        throw new MessagingRefusal(rejectionRefusal(stored.rejection));
      throw new MessagingRefusal(
        stored.state === 'clean' ? 'unsupported' : 'not-cleared',
      );
    },

    async discardAttachment(actor, attachmentId) {
      const actorId = actorOf(actor);
      const attachment = await store.attachment(idOf(attachmentId));
      if (
        attachment === null ||
        attachment.uploaderAccountId !== actorId ||
        (attachment.state !== 'pending' && attachment.state !== 'ready')
      ) {
        throw new MessagingRefusal('not-found');
      }
      const release = await store.abandonAttachment(attachment.id);
      // Already on its way out (a concurrent discard or the sweep): done.
      if (release === null) return;
      await releaseAndForget(release.attachmentId, release.releaseToken);
    },

    async openAttachment(actor, attachmentId) {
      return orNull(async () => {
        const actorId = actorOf(actor);
        const attachment = await store.attachment(idOf(attachmentId));
        if (attachment === null) return null;
        const own = attachment.uploaderAccountId === actorId;
        if (attachment.state !== 'attached' && !(attachment.state === 'ready' && own))
          return null;
        const { access } = await readable(actorId, attachment.conversationId);
        // An unsent upload is only its uploader's preview while they may send.
        if (attachment.state === 'ready' && access !== 'available') return null;
        if (attachment.messageModeration === 'withheld') return null;
        return serve(attachment);
      });
    },

    /* ---- support --------------------------------------------------------- */

    async support(actor) {
      const actorId = actorOf(actor);
      const active = await activations();
      if (!active.has('support')) throw new MessagingRefusal('not-found');
      const records = await store.conversationsOf({
        accountId: actorId,
        roles: ['requester'],
        after: null,
        limit: SUPPORT_OVERVIEW,
      });
      const verdicts = await decideMany(actorId, records, active);
      const kept = records.filter((record) => verdicts.get(record.id) === 'available');
      const readings =
        kept.length === 0
          ? new Map<string, ReadingState>()
          : await store.readingStates(
              actorId,
              kept.map((record) => record.id),
            );
      const summaries = kept.map((record) =>
        summaryOf(
          record,
          actorId,
          'requester',
          readings.get(record.id) ?? NO_READING,
          'available',
        ),
      );
      return {
        open: summaries.find((summary) => summary.state === 'open') ?? null,
        earlier: summaries.filter((summary) => summary.state === 'closed'),
      };
    },

    async openSupport(actor) {
      const actorId = actorOf(actor);
      if (!(await activations()).has('support')) throw new MessagingRefusal('not-found');
      await spend('supportOpen', actorId);
      const opened = await refusing(() => store.openSupport(actorId));
      return { conversationId: opened.conversation.id };
    },

    async supportQueue(actor, input) {
      const actorId = actorOf(actor);
      await requireKey(actorId, 'messaging.support');
      const state = input?.state;
      if (!(CONVERSATION_STATES as readonly unknown[]).includes(state)) {
        throw new MessagingRefusal('invalid');
      }
      const after = decodeCursor(input.cursor);
      if (!(await activations()).has('support')) return { items: [], next: null };
      await spend('staffRead', actorId);
      const page = await store.supportQueue({
        state: state as ConversationState,
        after,
        limit: MESSAGING_LIMITS.supportQueuePage,
      });
      const last = page[page.length - 1];
      return {
        items: page.map(({ conversation, awaitingReply }) => {
          const claimant = claimantOf(conversation);
          return {
            id: conversation.id,
            state: conversation.state,
            closedReason: conversation.closedReason,
            createdAt: conversation.createdAt,
            lastMessageAt:
              conversation.lastSequence > 0 ? conversation.lastMessageAt : null,
            claimed: claimant !== null,
            claimedByMe: claimant === actorId,
            awaitingReply,
            version: conversation.version,
          };
        }),
        next:
          page.length === MESSAGING_LIMITS.supportQueuePage && last !== undefined
            ? encodeCursor({
                at: activityOf(last.conversation),
                id: last.conversation.id,
              })
            : null,
      };
    },

    async supportConversation(actor, conversationId): Promise<SupportConversationView> {
      const actorId = actorOf(actor);
      const record = await staffConversation(actorId, conversationId);
      await spend('staffRead', actorId);
      // Reading a person's support conversation is a sensitive access: it is
      // recorded — identifiers only — before anything of it is returned.
      await audit({
        action: 'messaging.support.accessed',
        actorId,
        targetType: 'conversation',
        targetId: record.id,
        authorisingSource: 'messaging.support',
      });
      const readings = await store.readingStates(actorId, [record.id]);
      const reading = readings.get(record.id) ?? NO_READING;
      const requester = record.participants.find(
        (participant) => participant.role === 'requester',
      );
      if (requester === undefined) throw new MessagingRefusal('not-found');
      const claimant = claimantOf(record);
      const sendRefusal: SendRefusal | null =
        record.state === 'closed' ? 'closed' : claimant !== actorId ? 'unclaimed' : null;
      return {
        conversation: {
          summary: summaryOf(record, actorId, 'support', reading, 'available'),
          readSequence: reading.readSequence,
          canSend: sendRefusal === null,
          sendRefusal,
          blockedByMe: false,
        },
        requesterAccountId: requester.accountId,
        claimedByAccountId: claimant,
        version: record.version,
      };
    },

    async supportHistory(actor, conversationId, before) {
      const actorId = actorOf(actor);
      if (
        before !== null &&
        !(messageSequenceSchema.safeParse(before).success && before >= 1)
      ) {
        throw new MessagingRefusal('invalid');
      }
      const record = await staffConversation(actorId, conversationId);
      await spend('staffRead', actorId);
      await audit({
        action: 'messaging.support.history.accessed',
        actorId,
        targetType: 'conversation',
        targetId: record.id,
        authorisingSource: 'messaging.support',
      });
      const page = await store.history({
        conversationId: record.id,
        before,
        limit: MESSAGING_LIMITS.historyPage,
      });
      const first = page[0];
      return {
        messages: page.map((message) => messageView(message, actorId)),
        before: first !== undefined && first.sequence > 1 ? first.sequence : null,
      };
    },

    async openSupportAttachment(actor, attachmentId) {
      return orNull(async () => {
        const actorId = actorOf(actor);
        await requireKey(actorId, 'messaging.support');
        const attachment = await store.attachment(idOf(attachmentId));
        if (
          attachment === null ||
          attachment.state !== 'attached' ||
          attachment.messageModeration === 'withheld'
        ) {
          return null;
        }
        await staffConversation(actorId, attachment.conversationId);
        await audit({
          action: 'messaging.support.attachment.accessed',
          actorId,
          targetType: 'message-attachment',
          targetId: attachment.id,
          authorisingSource: 'messaging.support',
        });
        return serve(attachment);
      });
    },

    async claimSupport(actor, conversationId, expectedVersion) {
      const actorId = actorOf(actor);
      if (!messagingVersionSchema.safeParse(expectedVersion).success) {
        throw new MessagingRefusal('invalid');
      }
      const record = await staffConversation(actorId, conversationId);
      const outcome = await refusing(() =>
        store.claimSupport({
          conversationId: record.id,
          staffAccountId: actorId,
          expectedVersion,
          audit: {
            action: 'messaging.support.claimed',
            actorType: 'user',
            actorId,
            targetType: 'conversation',
            targetId: record.id,
            after: { state: 'claimed' },
            authorisingSource: 'messaging.support',
          },
        }),
      );
      if (outcome === 'conflict') throw new MessagingRefusal('conflict');
      if (outcome === 'closed') throw new MessagingRefusal('closed');
      if (outcome === 'missing') throw new MessagingRefusal('not-found');
    },

    async resolveSupport(actor, conversationId, expectedVersion) {
      const actorId = actorOf(actor);
      if (!messagingVersionSchema.safeParse(expectedVersion).success) {
        throw new MessagingRefusal('invalid');
      }
      const record = await staffConversation(actorId, conversationId);
      const outcome = await refusing(() =>
        store.resolveSupport({
          conversationId: record.id,
          staffAccountId: actorId,
          expectedVersion,
          audit: {
            action: 'messaging.support.resolved',
            actorType: 'user',
            actorId,
            targetType: 'conversation',
            targetId: record.id,
            after: { state: 'resolved' },
            authorisingSource: 'messaging.support',
          },
        }),
      );
      if (outcome === 'conflict') throw new MessagingRefusal('conflict');
      if (outcome === 'closed') throw new MessagingRefusal('closed');
      if (outcome === 'missing') throw new MessagingRefusal('not-found');
    },

    /* ---- moderation ------------------------------------------------------ */

    async reports(actor, input) {
      const actorId = actorOf(actor);
      await requireKey(actorId, 'messaging.moderate');
      const state = input?.state;
      if (!(REPORT_STATES as readonly unknown[]).includes(state)) {
        throw new MessagingRefusal('invalid');
      }
      const after = decodeCursor(input.cursor);
      await spend('staffRead', actorId);
      const page = await store.reports({
        state: state as ReportState,
        after,
        limit: MESSAGING_LIMITS.reportPage,
      });
      const last = page[page.length - 1];
      return {
        reports: page.map(reportSummary),
        next:
          page.length === MESSAGING_LIMITS.reportPage && last !== undefined
            ? encodeCursor({ at: last.createdAt, id: last.id })
            : null,
      };
    },

    async evidence(actor, reportId) {
      const actorId = actorOf(actor);
      const report = await moderatorReport(actorId, reportId);
      await spend('staffRead', actorId);
      const conversation = await store.conversation(report.conversationId);
      if (conversation === null) throw new MessagingRefusal('not-found');
      // The report IS the authorisation: one bounded window of one
      // conversation, recorded before any of its text is read.
      await audit({
        action: 'messaging.evidence.accessed',
        actorId,
        targetType: 'messaging-report',
        targetId: report.id,
        authorisingSource: 'messaging.moderate',
      });
      const messages = await evidenceSpan(report);
      return {
        report: reportSummary(report),
        reporterAccountId: report.reporterAccountId,
        conversation: {
          id: conversation.id,
          kind: conversation.kind,
          state: conversation.state,
          closedReason: conversation.closedReason,
          courseId: conversation.courseId,
        },
        messages: messages.map((message) => evidenceMessage(message, report)),
        decision: report.decision,
      };
    },

    async openEvidenceAttachment(actor, reportId, attachmentId) {
      return orNull(async () => {
        const actorId = actorOf(actor);
        const report = await moderatorReport(actorId, reportId);
        const attachment = await store.attachment(idOf(attachmentId));
        if (
          attachment === null ||
          attachment.state !== 'attached' ||
          attachment.messageId === null ||
          attachment.conversationId !== report.conversationId
        ) {
          return null;
        }
        // Inside THIS report's window, or not at all — another report's
        // evidence is not reachable by naming its attachment here.
        const inWindow = (await evidenceSpan(report)).some(
          (message) =>
            message.id === attachment.messageId &&
            message.attachments.some((fact) => fact.id === attachment.id),
        );
        if (!inWindow) return null;
        await audit({
          action: 'messaging.evidence.attachment.accessed',
          actorId,
          targetType: 'messaging-report',
          targetId: report.id,
          after: { attachmentId: attachment.id },
          authorisingSource: 'messaging.moderate',
        });
        return serve(attachment);
      });
    },

    async decide(actor, input) {
      const actorId = actorOf(actor);
      await requireKey(actorId, 'messaging.moderate');
      const parsed = moderationDecisionSchema.safeParse(input);
      if (!parsed.success) throw new MessagingRefusal('invalid');
      await spend('moderation', actorId);
      const { reportId, action, expectedVersion } = parsed.data;
      const report = await store.report(reportId);
      if (report === null) throw new MessagingRefusal('not-found');
      // Withholding needs a message to withhold; a conversation report has none.
      if (action === 'withhold-message' && report.messageId === null) {
        throw new MessagingRefusal('invalid');
      }
      const outcome = await refusing(() =>
        store.decide({
          reportId,
          expectedVersion,
          moderatorAccountId: actorId,
          action,
          audit: {
            action: 'messaging.moderation.decided',
            actorType: 'user',
            actorId,
            targetType: 'messaging-report',
            targetId: reportId,
            after: { action },
            authorisingSource: 'messaging.moderate',
          },
        }),
      );
      if (outcome === 'conflict') throw new MessagingRefusal('conflict');
      if (outcome === 'invalid') throw new MessagingRefusal('invalid');
      if (outcome === 'missing') throw new MessagingRefusal('not-found');
    },

    /* ---- export and disposition ----------------------------------------- */

    async export(actor) {
      const actorId = actorOf(actor);
      await spend('export', actorId);
      const collected = await store.exportFor(actorId);
      return {
        schema: MESSAGING_EXPORT_SCHEMA,
        version: MESSAGING_EXPORT_VERSION,
        generatedAt: now().toISOString(),
        ...collected,
      };
    },

    async disposeAccount(accountId) {
      const parsed = messagingAccountIdSchema.safeParse(accountId);
      if (!parsed.success) throw new MessagingRefusal('invalid');
      // Refused for anything Identity does not report CLOSED, so this can
      // never be turned on a living person's conversations.
      const closed = await deps.accounts.closedAccounts([parsed.data]);
      if (!closed.includes(parsed.data)) throw new MessagingRefusal('denied');
      return disposition.disposeClosedAccount(parsed.data);
    },

    async reconcileClosedAccounts() {
      return disposition.reconcile();
    },

    async sweepAttachments() {
      return disposition.sweep();
    },
  };
}
