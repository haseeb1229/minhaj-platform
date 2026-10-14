import 'server-only';

import { randomUUID } from 'node:crypto';

import type { z } from 'zod';

import {
  FATWA_PERMISSIONS,
  categoryCreateSchema,
  categoryUpdateSchema,
  fatwaIdSchema,
  fatwaWithdrawalSchema,
  questionAssignmentSchema,
  questionDeclineSchema,
  questionTriageSchema,
  revisionDecisionSchema,
  revisionDraftSchema,
  revisionReturnSchema,
  type FatwaActor,
  type FatwaAnswererChoice,
  type FatwaAuthorityPort,
  type FatwaCategoryRecord,
  type FatwaPublicationAuthority,
  type FatwaRecord,
  type FatwaStaffReaderPort,
  type FatwaSummaryPage,
  type FatwaWorkflowPort,
  type StaffQuestion,
  type StaffQuestionPage,
} from '@minhaj/contracts/fatwa';
import type { PrivilegedActor } from '@minhaj/contracts/identity';

import { FatwaRefusal, asRefusal } from '../domain/refusal.ts';

/**
 * The Fatwa workflow — triage, assignment, drafting, scholar review,
 * publication, correction and withdrawal (DOMAIN_MODEL.md §12;
 * SECURITY_BASELINE.md §6).
 *
 * THREE STAGES, THREE KEYS, AND NONE IMPLIES ANOTHER. Each operation asks
 * Identity, live, whether the acting account holds the one permission its stage
 * needs — `question.receive`, `fatwa.answer` or `fatwa.publish` — before it
 * parses anything, so a caller without it learns nothing of the rules. No role
 * name, profile or administrator status is consulted anywhere: a Platform
 * Administrator who does not hold a Fatwa key is refused exactly like anybody
 * else.
 *
 * THIS SERVICE PASSING IS NECESSARY, NEVER SUFFICIENT. Every write is a
 * database procedure that re-checks the actor's live permission, assignment,
 * expected version, state and — for publication and withdrawal — the live
 * `fatwa-publication` step-up grant, the author/publisher separation and the
 * service activation, before it changes anything. A caller that skips this
 * service meets the same refusals one layer down, and the application
 * principal has no other way to write these tables.
 *
 * ONE PUBLICATION OPERATION. `publish` is the only way a revision becomes
 * public — first publication and correction alike. There is no bulk publish,
 * no import entry, no "publish without review"; a future importer must call
 * this same operation with a verified authority.
 *
 * NO AI PATH. Nothing here generates, drafts, suggests, rewrites, summarises or
 * anonymises text. The anonymised public question is a separate field a person
 * writes; this service stores it exactly as typed.
 *
 * NO TEXT IS LOGGED. The log sees operation names, outcomes and identifiers —
 * never a question, a ruling, a note or a reason.
 */

/** What may reach the log: identifiers and outcomes, never text. */
export interface FatwaWorkflowLogDetail {
  /** `fatwa.asker`: the after-commit lookup of whom to notify (Phase 21). */
  readonly operation: 'fatwa.publish' | 'fatwa.withdraw' | 'fatwa.asker';
  readonly outcome: 'passed' | 'denied' | 'failed';
  readonly actorId?: string;
  readonly fatwaId?: string;
  readonly revisionId?: string;
}

/** The structured logger's narrow face, handed in by Layer 4. */
export interface FatwaWorkflowLog {
  info(detail: FatwaWorkflowLogDetail, message: string): void;
  warn(detail: FatwaWorkflowLogDetail, message: string): void;
}

const OFFSET_MAX = 10_000;
const safeOffset = (offset: number) =>
  Number.isInteger(offset) && offset >= 0 && offset <= OFFSET_MAX ? offset : 0;
const idOk = (value: string) => fatwaIdSchema.safeParse(value).success;

export function createFatwaWorkflowService(deps: {
  readonly workflow: FatwaWorkflowPort;
  readonly staff: FatwaStaffReaderPort;
  readonly authority: FatwaAuthorityPort;
  readonly log?: FatwaWorkflowLog;
  readonly ids?: () => string;
}) {
  const ids = deps.ids ?? randomUUID;
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  /**
   * Who to tell about a decision that has ALREADY COMMITTED. The decision is
   * the result; this is derived work, so a failed read here is logged and
   * answered as "nobody to tell" — never reported as the decision failing.
   */
  const askerAfterCommit = (
    input: { readonly questionId: string } | { readonly fatwaId: string },
  ) =>
    deps.workflow.askerOf(input).catch(() => {
      deps.log?.warn(
        { operation: 'fatwa.asker', outcome: 'failed' },
        'Asker lookup after a decision failed.',
      );
      return null;
    });

  /** Identity's live answer for one key. Anything but `true` is a refusal. */
  async function holds(actor: FatwaActor, permission: string): Promise<void> {
    if ((await deps.authority.permits(actor.accountId, permission)) !== true) {
      throw new FatwaRefusal('denied');
    }
  }

  /** Permission first, parsing second: an unauthorised caller learns nothing of the rules. */
  async function authorised<S extends z.ZodType>(
    actor: FatwaActor,
    permission: string,
    schema: S,
    input: unknown,
  ): Promise<z.output<S>> {
    await holds(actor, permission);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new FatwaRefusal('invalid');
    return parsed.data;
  }

  /**
   * Publication authority: this exact Identity-minted PrivilegedActor, for
   * `fatwa.publish`, with a complete second-factor posture and a live
   * `fatwa-publication` step-up grant, re-verified now.
   */
  async function publisher(
    actor: PrivilegedActor,
    operation: FatwaWorkflowLogDetail['operation'],
  ): Promise<FatwaPublicationAuthority> {
    if (
      actor === null ||
      typeof actor !== 'object' ||
      (await deps.authority.verifyPublication(actor)) !== true
    ) {
      deps.log?.warn(
        { operation, outcome: 'denied' },
        'Fatwa publication authority refused.',
      );
      throw new FatwaRefusal('denied');
    }
    return {
      actorId: actor.accountId,
      sessionId: actor.sessionId,
      stepUpGrantId: actor.stepUpGrantId,
    };
  }

  return {
    /* ---- Intake — `question.receive` ---------------------------------- */

    async intake(actor: FatwaActor, offset: number): Promise<StaffQuestionPage> {
      await holds(actor, FATWA_PERMISSIONS.receive);
      return deps.staff.intake(actor.accountId, safeOffset(offset));
    },

    async assignment(actor: FatwaActor, offset: number): Promise<StaffQuestionPage> {
      await holds(actor, FATWA_PERMISSIONS.receive);
      return deps.staff.assignment(actor.accountId, safeOffset(offset));
    },

    async intakeQuestion(actor: FatwaActor, id: string): Promise<StaffQuestion | null> {
      await holds(actor, FATWA_PERMISSIONS.receive);
      return idOk(id) ? deps.staff.intakeQuestion(actor.accountId, id) : null;
    },

    /** The accounts that hold `fatwa.answer` now, as assignment choices. */
    async answerers(actor: FatwaActor): Promise<readonly FatwaAnswererChoice[]> {
      await holds(actor, FATWA_PERMISSIONS.receive);
      return deps.authority.answerers();
    },

    async triage(actor: FatwaActor, input: z.input<typeof questionTriageSchema>) {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.receive,
        questionTriageSchema,
        input,
      );
      await run(deps.workflow.triage({ actorId: actor.accountId, value }));
    },

    async assign(actor: FatwaActor, input: z.input<typeof questionAssignmentSchema>) {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.receive,
        questionAssignmentSchema,
        input,
      );
      await run(deps.workflow.assign({ actorId: actor.accountId, value }));
    },

    async decline(actor: FatwaActor, input: z.input<typeof questionDeclineSchema>) {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.receive,
        questionDeclineSchema,
        input,
      );
      await run(deps.workflow.decline({ actorId: actor.accountId, value }));
      // Who to tell, once the decline has committed — Layer 4 notifies them.
      return askerAfterCommit({ questionId: value.id });
    },

    /* ---- Drafting — `fatwa.answer`, the current assignee only --------- */

    async assigned(actor: FatwaActor, offset: number): Promise<StaffQuestionPage> {
      await holds(actor, FATWA_PERMISSIONS.answer);
      return deps.staff.assigned(actor.accountId, safeOffset(offset));
    },

    async assignedQuestion(actor: FatwaActor, id: string): Promise<StaffQuestion | null> {
      await holds(actor, FATWA_PERMISSIONS.answer);
      return idOk(id) ? deps.staff.assignedQuestion(actor.accountId, id) : null;
    },

    async assignedFatwa(
      actor: FatwaActor,
      questionId: string,
    ): Promise<FatwaRecord | null> {
      await holds(actor, FATWA_PERMISSIONS.answer);
      return idOk(questionId)
        ? deps.staff.assignedFatwa(actor.accountId, questionId)
        : null;
    },

    /**
     * Saves a NEW immutable revision. The first save creates the ruling; every
     * later one names the ruling the question already has, which the database
     * checks again against the expected version.
     */
    async saveDraft(
      actor: FatwaActor,
      input: z.input<typeof revisionDraftSchema>,
    ): Promise<{ readonly fatwaId: string; readonly revisionId: string }> {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.answer,
        revisionDraftSchema,
        input,
      );
      let fatwaId: string;
      if (value.expectedVersion === 0) {
        fatwaId = ids();
      } else {
        const existing = await deps.staff.assignedFatwa(
          actor.accountId,
          value.questionId,
        );
        if (existing === null) throw new FatwaRefusal('not-found');
        fatwaId = existing.id;
      }
      const revisionId = ids();
      await run(
        deps.workflow.saveDraft({ actorId: actor.accountId, fatwaId, revisionId, value }),
      );
      return { fatwaId, revisionId };
    },

    async submitForReview(
      actor: FatwaActor,
      input: z.input<typeof revisionDecisionSchema>,
    ) {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.answer,
        revisionDecisionSchema,
        input,
      );
      await run(deps.workflow.submitForReview({ actorId: actor.accountId, value }));
    },

    /* ---- Scholar review — `fatwa.publish` ------------------------------ */

    async reviewQueue(actor: FatwaActor, offset: number): Promise<FatwaSummaryPage> {
      await holds(actor, FATWA_PERMISSIONS.publish);
      return deps.staff.reviewQueue(actor.accountId, safeOffset(offset));
    },

    async reviewFatwa(actor: FatwaActor, fatwaId: string): Promise<FatwaRecord | null> {
      await holds(actor, FATWA_PERMISSIONS.publish);
      return idOk(fatwaId) ? deps.staff.reviewFatwa(actor.accountId, fatwaId) : null;
    },

    /** The private question, only while its ruling is under review. Audited. */
    async reviewQuestion(
      actor: FatwaActor,
      fatwaId: string,
    ): Promise<StaffQuestion | null> {
      await holds(actor, FATWA_PERMISSIONS.publish);
      return idOk(fatwaId) ? deps.staff.reviewQuestion(actor.accountId, fatwaId) : null;
    },

    async returnForRevision(
      actor: FatwaActor,
      input: z.input<typeof revisionReturnSchema>,
    ) {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.publish,
        revisionReturnSchema,
        input,
      );
      await run(deps.workflow.returnForRevision({ actorId: actor.accountId, value }));
    },

    /** THE publication operation, first and correction alike. */
    async publish(actor: PrivilegedActor, input: z.input<typeof revisionDecisionSchema>) {
      const authority = await publisher(actor, 'fatwa.publish');
      const parsed = revisionDecisionSchema.safeParse(input);
      if (!parsed.success) throw new FatwaRefusal('invalid');
      await run(
        deps.workflow.publish({ authority, publicationId: ids(), value: parsed.data }),
      );
      deps.log?.info(
        {
          operation: 'fatwa.publish',
          outcome: 'passed',
          actorId: authority.actorId,
          fatwaId: parsed.data.fatwaId,
          revisionId: parsed.data.revisionId,
        },
        'Fatwa revision published.',
      );
      // Who to tell, once the publication has committed — Layer 4 notifies them.
      return askerAfterCommit({ fatwaId: parsed.data.fatwaId });
    },

    async withdraw(actor: PrivilegedActor, input: z.input<typeof fatwaWithdrawalSchema>) {
      const authority = await publisher(actor, 'fatwa.withdraw');
      const parsed = fatwaWithdrawalSchema.safeParse(input);
      if (!parsed.success) throw new FatwaRefusal('invalid');
      await run(deps.workflow.withdraw({ authority, value: parsed.data }));
      deps.log?.info(
        {
          operation: 'fatwa.withdraw',
          outcome: 'passed',
          actorId: authority.actorId,
          fatwaId: parsed.data.fatwaId,
        },
        'Fatwa withdrawn.',
      );
    },

    async published(actor: FatwaActor, offset: number): Promise<FatwaSummaryPage> {
      await holds(actor, FATWA_PERMISSIONS.publish);
      return deps.staff.published(actor.accountId, safeOffset(offset));
    },

    async publishedFatwa(
      actor: FatwaActor,
      fatwaId: string,
    ): Promise<FatwaRecord | null> {
      await holds(actor, FATWA_PERMISSIONS.publish);
      return idOk(fatwaId) ? deps.staff.publishedFatwa(actor.accountId, fatwaId) : null;
    },

    /* ---- Categories — read by any stage, maintained under `fatwa.publish` */

    async categories(actor: FatwaActor): Promise<readonly FatwaCategoryRecord[]> {
      const held = await Promise.all(
        Object.values(FATWA_PERMISSIONS).map((key) =>
          deps.authority.permits(actor.accountId, key),
        ),
      );
      if (!held.some((answer) => answer === true)) throw new FatwaRefusal('denied');
      return deps.staff.categories(actor.accountId);
    },

    async createCategory(
      actor: FatwaActor,
      input: z.input<typeof categoryCreateSchema>,
    ): Promise<{ readonly id: string }> {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.publish,
        categoryCreateSchema,
        input,
      );
      const id = ids();
      await run(deps.workflow.createCategory({ actorId: actor.accountId, id, value }));
      return { id };
    },

    async updateCategory(actor: FatwaActor, input: z.input<typeof categoryUpdateSchema>) {
      const value = await authorised(
        actor,
        FATWA_PERMISSIONS.publish,
        categoryUpdateSchema,
        input,
      );
      await run(deps.workflow.updateCategory({ actorId: actor.accountId, value }));
    },
  };
}

export type FatwaWorkflowService = ReturnType<typeof createFatwaWorkflowService>;
