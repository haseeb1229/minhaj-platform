import 'server-only';

import { randomUUID } from 'node:crypto';

import type { z } from 'zod';

import {
  applicationDecisionSchema,
  applicationQuerySchema,
  membershipAccountIdSchema,
  membershipIdSchema,
  membershipQuerySchema,
  membershipTypeCreateSchema,
  membershipTypeLabelChangeSchema,
  membershipTypeOrderSchema,
  membershipTypeTransitionSchema,
  versionedRecordSchema,
  type MembershipAccountsPort,
  type MembershipAuthorityPort,
  type MembershipCataloguePort,
  type MembershipStaffPort,
  type MembershipTypeRecord,
  type StaffApplication,
  type StaffApplicationPage,
  type StaffMembership,
  type StaffMembershipPage,
} from '@minhaj/contracts/membership';

import { MembershipRefusal, asMembershipRefusal } from '../domain/refusal.ts';
import type { MembershipActor } from './applicant-service.ts';

/** The two keys Membership's administration asks for — exactly these, nothing implied. */
const READ = 'membership.read';
const ADMINISTER = 'membership.administer';

/**
 * Membership's administration — the type catalogue, the application queue and
 * its decisions, and the members list (DOMAIN_MODEL.md §17.2; DELIVERY_PLAN.md
 * Phase 26).
 *
 * TWO KEYS, AND NEITHER IMPLIES THE OTHER. Every read asks Identity, live,
 * for `membership.read`; every change for `membership.administer` — and asks
 * BEFORE anything is parsed, so a caller without the key learns nothing of the
 * rules. Only the exact Membership key is ever asked: `people.*`, `global.*`,
 * `content.*` or any other context's authority confers nothing here, and no
 * role name, profile or administrator status is consulted.
 *
 * DECISIONS ARE NOT TAKEN FOR A CLOSED ACCOUNT. Before a review begins or an
 * approval is made, Identity is asked whether the applicant's account is
 * closed; a closed account's application is the account-closure disposition's
 * to withdraw, not an operator's to advance. A rejection stays open to the
 * operator either way — it creates nothing.
 *
 * THIS SERVICE PASSING IS NECESSARY, NEVER SUFFICIENT. Every write is
 * version-checked, state-checked and serialised again in the adapter's own
 * transaction, which commits its audit row and the applicant's owed message
 * with the change or not at all; the database refuses an illegal transition a
 * third time.
 *
 * NO PAYMENT, NO QUESTIONNAIRE. An approval creates the Membership and nothing
 * else: no amount, no form, no note. An operator sees an applicant by account
 * id here; Layer 4 resolves a display name, never an address.
 */
export function createMembershipAdminService(deps: {
  readonly catalogue: MembershipCataloguePort;
  readonly staff: MembershipStaffPort;
  readonly authority: MembershipAuthorityPort;
  readonly accounts: MembershipAccountsPort;
  readonly ids?: () => string;
}) {
  const ids = deps.ids ?? randomUUID;
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asMembershipRefusal);

  /** Identity's live answer for one key. Anything but `true` is a refusal. */
  async function holds(actor: MembershipActor, permission: string): Promise<string> {
    const parsed = membershipAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new MembershipRefusal('denied');
    if ((await deps.authority.permits(parsed.data, permission)) !== true)
      throw new MembershipRefusal('denied');
    return parsed.data;
  }

  /** Permission first, parsing second: an unauthorised caller learns nothing of the rules. */
  async function authorised<S extends z.ZodType>(
    actor: MembershipActor,
    permission: string,
    schema: S,
    input: unknown,
  ): Promise<{ readonly actorId: string; readonly value: z.output<S> }> {
    const actorId = await holds(actor, permission);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new MembershipRefusal('invalid');
    return { actorId, value: parsed.data };
  }

  /**
   * The applicant of an application the operator is about to advance — refused
   * `not-found` when there is none, `applicant-closed` when Identity reports
   * that account closed.
   */
  async function openApplicant(id: string): Promise<void> {
    const applicant = await run(deps.staff.applicantOf(id));
    if (applicant === null) throw new MembershipRefusal('not-found');
    const closed = await deps.accounts.closedAccounts([applicant]);
    if (closed.includes(applicant)) throw new MembershipRefusal('applicant-closed');
  }

  const isId = (value: unknown): value is string =>
    membershipIdSchema.safeParse(value).success;

  return {
    /* ---- The type catalogue ------------------------------------------- */

    /** Every type in every state, with its counts. */
    async types(actor: MembershipActor): Promise<readonly MembershipTypeRecord[]> {
      await holds(actor, READ);
      return run(deps.catalogue.types());
    },

    /** One type, or `null` when the id is malformed or names nothing. */
    async type(actor: MembershipActor, id: string): Promise<MembershipTypeRecord | null> {
      await holds(actor, READ);
      if (!isId(id)) return null;
      return run(deps.catalogue.type(id));
    },

    /** A new draft, beginning with its primary locale's words. */
    async createType(
      actor: MembershipActor,
      input: unknown,
    ): Promise<MembershipTypeRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        membershipTypeCreateSchema,
        input,
      );
      return run(deps.catalogue.createType({ id: ids(), actorId, value }));
    },

    async reorderType(
      actor: MembershipActor,
      input: unknown,
    ): Promise<MembershipTypeRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        membershipTypeOrderSchema,
        input,
      );
      return run(deps.catalogue.reorderType({ actorId, ...value }));
    },

    /** Adds or replaces one locale's words; a translation is never deleted. */
    async saveLabel(
      actor: MembershipActor,
      input: unknown,
    ): Promise<MembershipTypeRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        membershipTypeLabelChangeSchema,
        input,
      );
      return run(deps.catalogue.saveLabel({ actorId, ...value }));
    },

    /** Publishes or archives; a type that has been public never returns to draft. */
    async transitionType(
      actor: MembershipActor,
      input: unknown,
    ): Promise<MembershipTypeRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        membershipTypeTransitionSchema,
        input,
      );
      return run(deps.catalogue.transitionType({ actorId, ...value }));
    },

    /* ---- Applications -------------------------------------------------- */

    /** One bounded page of the queue, oldest first. An audited access. */
    async applications(
      actor: MembershipActor,
      query: unknown,
    ): Promise<StaffApplicationPage> {
      const { actorId, value } = await authorised(
        actor,
        READ,
        applicationQuerySchema,
        query,
      );
      return run(deps.staff.applications(actorId, value));
    },

    /** One application, or `null` when the id is malformed or names nothing. An audited access. */
    async application(
      actor: MembershipActor,
      id: string,
    ): Promise<StaffApplication | null> {
      const actorId = await holds(actor, READ);
      if (!isId(id)) return null;
      return run(deps.staff.application(actorId, id));
    },

    /** `submitted` → `under_review`. Refused for a closed applicant. */
    async startReview(actor: MembershipActor, input: unknown): Promise<StaffApplication> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        versionedRecordSchema,
        input,
      );
      await openApplicant(value.id);
      return run(deps.staff.startReview({ actorId, ...value }));
    },

    /**
     * `under_review` → `approved` (creating the Membership in the same
     * transaction) or `rejected`. An approval is refused for a closed applicant;
     * a rejection is not.
     */
    async decide(actor: MembershipActor, input: unknown): Promise<StaffApplication> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        applicationDecisionSchema,
        input,
      );
      if (value.decision === 'approve') await openApplicant(value.id);
      return run(deps.staff.decide({ actorId, ...value, membershipId: ids() }));
    },

    /* ---- Memberships --------------------------------------------------- */

    /** One bounded page of Memberships, most recently activated first. An audited access. */
    async memberships(
      actor: MembershipActor,
      query: unknown,
    ): Promise<StaffMembershipPage> {
      const { actorId, value } = await authorised(
        actor,
        READ,
        membershipQuerySchema,
        query,
      );
      return run(deps.staff.memberships(actorId, value));
    },

    /** An ACTIVE Membership, closed by an operator. Version-checked; never reopened. */
    async closeMembership(
      actor: MembershipActor,
      input: unknown,
    ): Promise<StaffMembership> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        versionedRecordSchema,
        input,
      );
      return run(deps.staff.closeMembership({ actorId, ...value }));
    },
  };
}

export type MembershipAdminService = ReturnType<typeof createMembershipAdminService>;
