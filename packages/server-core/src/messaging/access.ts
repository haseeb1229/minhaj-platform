import 'server-only';

import { TEACHING_STANDING_BATCH } from '@minhaj/contracts/learning';
import type {
  ConversationRecord,
  MessagingAccountPort,
  MessagingAuthority,
  MessagingAuthorityPort,
  MessagingCapability,
  MessagingPeerPolicyPort,
  MessagingTeachingPort,
  ParticipantRecord,
} from '@minhaj/contracts/messaging';

/**
 * THE access decision — the one rule every person-facing read and write of a
 * conversation asks (DOMAIN_MODEL.md §15.3, §15.6).
 *
 * WHY THERE IS EXACTLY ONE. Listing, opening, history, catch-up, sending,
 * marking read, reporting, uploading and opening an attachment all ask "may
 * this person reach this conversation NOW". A second copy of that answer is a
 * second place for it to be wrong — the classic shape of the leak where the
 * list hides a conversation the history still serves. So every caller hands
 * its records here and acts on the verdict; none re-derives any part of it.
 *
 * MEMBERSHIP IS NECESSARY, NEVER SUFFICIENT. A participant row only says the
 * person was once let in. What lets them in TODAY is the kind's activation
 * plus, for a teaching conversation, Learning's current relationship — both
 * halves of it, read live — and, for support staff, Identity's live key. A
 * teacher whose assignment was revoked keeps their row and is told `ended`.
 * A public teacher profile, a Course's attribution or a role NAME never
 * appears here, which is the point: only the standing Learning reports counts.
 *
 * THE TERMINAL RULE IS NARROW ON PURPOSE. A conversation the counterpart's
 * ACCOUNT CLOSURE ended stays readable — read-only — to the person left
 * behind, and only while that person's OWN half of the relationship is still
 * current. Ordinary revocation, withdrawal, a block or a moderator's closure
 * never produces it: those answer `ended` (or keep `available` for a
 * moderated conversation whose relationship holds, which then cannot send).
 *
 * BATCHED PER PAGE. A list asks Learning ONE standing question for the whole
 * page, Identity ONE closed-accounts question for the account-closed
 * candidates and ONE permission question for the actor — never one round trip
 * per row. The peer policy has no batch form; production wiring answers
 * without I/O.
 */

/** The verdict. `not-found` and `ended` are refusals; the other two may read. */
export type AccessDecision = 'available' | 'terminal' | 'ended' | 'not-found';

export interface AccessDeciderDependencies {
  readonly teaching: MessagingTeachingPort;
  readonly authority: MessagingAuthorityPort;
  readonly accounts: MessagingAccountPort;
  readonly peers: MessagingPeerPolicyPort;
}

/** Identity's closed-accounts question is bounded; never ask more at once. */
export const IDENTITY_BATCH = 100;

/** The actor's CURRENT participation — a row they have not left. */
export function currentSelf(
  record: ConversationRecord,
  accountId: string,
): ParticipantRecord | undefined {
  return record.participants.find(
    (participant) => participant.accountId === accountId && participant.leftAt === null,
  );
}

/**
 * The other person of a DIRECT conversation, current or past. Support staff
 * and the requester are never a counterpart: support is not a peer relation.
 */
export function directCounterpart(
  record: ConversationRecord,
  accountId: string,
): ParticipantRecord | undefined {
  if (record.kind === 'support') return undefined;
  return record.participants.find(
    (participant) =>
      participant.accountId !== accountId &&
      (participant.role === 'teacher' ||
        participant.role === 'learner' ||
        participant.role === 'peer'),
  );
}

export function chunks<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

export function createAccessDecider({
  teaching,
  authority,
  accounts,
  peers,
}: AccessDeciderDependencies) {
  return async function decide(
    actorId: string,
    records: readonly ConversationRecord[],
    activations: ReadonlyMap<MessagingCapability, MessagingAuthority>,
  ): Promise<ReadonlyMap<string, AccessDecision>> {
    const verdicts = new Map<string, AccessDecision>();
    const teachingRows: {
      readonly record: ConversationRecord;
      readonly me: ParticipantRecord;
      readonly teacher: ParticipantRecord;
      readonly learner: ParticipantRecord;
      readonly courseId: string;
    }[] = [];
    const peerRows: {
      readonly record: ConversationRecord;
      readonly low: string;
      readonly high: string;
      readonly courseId: string;
    }[] = [];
    let staffKey: Promise<boolean> | null = null;

    for (const record of records) {
      const me = currentSelf(record, actorId);
      // Not a current participant, or the kind is switched off: one answer for
      // both, and the same one a conversation that does not exist gets.
      if (me === undefined || !activations.has(record.kind)) {
        verdicts.set(record.id, 'not-found');
        continue;
      }
      if (record.kind === 'support') {
        if (me.role === 'requester') {
          verdicts.set(record.id, 'available');
        } else if (me.role === 'support') {
          // Staff hold the conversation through Identity's LIVE key, asked
          // once per decision and never remembered between calls.
          staffKey ??= authority.permits(actorId, 'messaging.support');
          verdicts.set(record.id, (await staffKey) ? 'available' : 'ended');
        } else {
          verdicts.set(record.id, 'not-found');
        }
        continue;
      }
      const counterpart = directCounterpart(record, actorId);
      if (record.courseId === null || counterpart === undefined) {
        // A shape the database refuses. Fail closed without describing it.
        verdicts.set(record.id, 'not-found');
        continue;
      }
      if (record.kind === 'teacher-student') {
        const teacher = record.participants.find((p) => p.role === 'teacher');
        const learner = record.participants.find((p) => p.role === 'learner');
        if (
          teacher === undefined ||
          learner === undefined ||
          (me.role !== 'teacher' && me.role !== 'learner')
        ) {
          verdicts.set(record.id, 'not-found');
          continue;
        }
        teachingRows.push({ record, me, teacher, learner, courseId: record.courseId });
        continue;
      }
      if (me.role !== 'peer') {
        verdicts.set(record.id, 'not-found');
        continue;
      }
      const [low, high] =
        actorId < counterpart.accountId
          ? [actorId, counterpart.accountId]
          : [counterpart.accountId, actorId];
      peerRows.push({ record, low, high, courseId: record.courseId });
    }

    // STUDENT-TO-STUDENT. The terminal rule's "own half" for a peer pair IS
    // the policy's answer, so a pair the policy permits is simply available
    // and one it refuses is ended — terminal history cannot arise here, and
    // under the production policy nothing is ever available.
    const peerAnswers = await Promise.all(
      peerRows.map((row) =>
        peers.permits({
          firstAccountId: row.low,
          secondAccountId: row.high,
          courseId: row.courseId,
        }),
      ),
    );
    peerRows.forEach((row, index) => {
      verdicts.set(row.record.id, peerAnswers[index] === true ? 'available' : 'ended');
    });

    // TEACHER-STUDENT. One standing question for the page.
    const standings: { readonly teacher: boolean; readonly learner: boolean }[] = [];
    for (const batch of chunks(teachingRows, TEACHING_STANDING_BATCH)) {
      const answers = await teaching.standing(
        batch.map((row) => ({
          teacherAccountId: row.teacher.accountId,
          learnerAccountId: row.learner.accountId,
          courseId: row.courseId,
        })),
      );
      // A short answer is a missing answer, and a missing answer is "no".
      batch.forEach((_, index) => {
        standings.push(answers[index] ?? { teacher: false, learner: false });
      });
    }

    const terminalCandidates: { readonly id: string; readonly counterpartId: string }[] =
      [];
    teachingRows.forEach((row, index) => {
      const standing = standings[index] ?? { teacher: false, learner: false };
      if (standing.teacher && standing.learner) {
        verdicts.set(row.record.id, 'available');
        return;
      }
      const ownHalf = row.me.role === 'teacher' ? standing.teacher : standing.learner;
      if (row.record.closedReason === 'account-closed' && ownHalf) {
        const counterpart = row.me.role === 'teacher' ? row.learner : row.teacher;
        terminalCandidates.push({
          id: row.record.id,
          counterpartId: counterpart.accountId,
        });
        return;
      }
      verdicts.set(row.record.id, 'ended');
    });

    // The terminal rule needs Identity to say the counterpart's ACCOUNT is
    // closed — a conversation merely marked `account-closed` is not proof.
    if (terminalCandidates.length > 0) {
      const asked = [
        ...new Set(terminalCandidates.map((candidate) => candidate.counterpartId)),
      ];
      const closed = new Set<string>();
      for (const batch of chunks(asked, IDENTITY_BATCH)) {
        for (const accountId of await accounts.closedAccounts(batch))
          closed.add(accountId);
      }
      for (const candidate of terminalCandidates) {
        verdicts.set(
          candidate.id,
          closed.has(candidate.counterpartId) ? 'terminal' : 'ended',
        );
      }
    }

    return verdicts;
  };
}

export type AccessDecider = ReturnType<typeof createAccessDecider>;
