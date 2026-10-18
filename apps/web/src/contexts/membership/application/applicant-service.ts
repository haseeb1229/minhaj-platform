import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  MEMBERSHIP_EXPORT_SCHEMA,
  MEMBERSHIP_EXPORT_VERSION,
  applicationSubmitSchema,
  membershipAccountIdSchema,
  versionedRecordSchema,
  type ApplicationRecord,
  type MembershipApplicantPort,
  type MembershipExport,
  type MembershipExportPort,
  type MembershipRecord,
  type OwnMembershipState,
} from '@minhaj/contracts/membership';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import { MembershipRefusal, asMembershipRefusal } from '../domain/refusal.ts';

/** Who is acting — the account Layer 4 resolved from the session, and nothing else. */
export interface MembershipActor {
  readonly accountId: string;
}

/** A purpose-scoped, digested limiter key, built at Layer 4. */
export type MembershipLimitKey = (purpose: string, subject: string) => string;

/**
 * Each self-service act's own budget, per account. Generous for a person, a
 * wall for a script: an application is rare, so its window is a day.
 */
export const MEMBERSHIP_RATE_RULES: Readonly<
  Record<'submit' | 'withdraw' | 'close' | 'export', RateLimitRule>
> = Object.freeze({
  submit: Object.freeze({ window: 86_400, max: 10 }),
  withdraw: Object.freeze({ window: 3_600, max: 20 }),
  close: Object.freeze({ window: 3_600, max: 10 }),
  export: Object.freeze({ window: 3_600, max: 10 }),
});

/**
 * A person's OWN Membership — the capability behind `/my/membership` and the
 * Membership export (DOMAIN_MODEL.md §17.2; DELIVERY_PLAN.md Phase 26).
 *
 * THE APPLICANT IS THE SESSION, NEVER THE FORM. Every method takes the actor
 * Layer 4 resolved from the session, and the adapter carries that account in
 * every query's own predicate, so a guessed application or Membership id
 * reaches only the caller's own rows — somebody else's answers exactly like
 * one that does not exist (SECURITY_BASELINE.md §3.4 rule 4). No field of any
 * input names an account.
 *
 * NO STAFF PATH EXISTS. No permission is asked or conferred here: applying,
 * withdrawing one's own open application and closing one's own Membership are
 * acts of ownership. Starting a review, deciding, and closing somebody else's
 * Membership are the operator's, behind `membership.administer`, elsewhere.
 *
 * NOTHING IS COPIED FROM THE ACCOUNT. An application names the account and the
 * type, and holds its state and instants — no name, address, free text or
 * upload, so nothing here accepts one.
 *
 * EVERY WRITE SPENDS ITS OWN BUDGET, keyed by a digest of the account id under
 * a purpose of its own, after the input parsed — a malformed request spends
 * nothing and a busy form cannot exhaust another act's allowance.
 */
export function createMembershipApplicantService(deps: {
  readonly applicant: MembershipApplicantPort;
  readonly exporter: MembershipExportPort;
  readonly limiter: RateLimiterPort;
  readonly key: MembershipLimitKey;
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asMembershipRefusal);

  function account(actor: MembershipActor): string {
    const parsed = membershipAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new MembershipRefusal('denied');
    return parsed.data;
  }

  async function spend(
    operation: keyof typeof MEMBERSHIP_RATE_RULES,
    accountId: string,
  ): Promise<void> {
    const decision = await deps.limiter.consume(
      deps.key(`membership-${operation}`, accountId),
      MEMBERSHIP_RATE_RULES[operation],
    );
    if (!decision.allowed) throw new MembershipRefusal('rate-limited');
  }

  function versioned(input: unknown) {
    const parsed = versionedRecordSchema.safeParse(input);
    if (!parsed.success) throw new MembershipRefusal('invalid');
    return parsed.data;
  }

  return {
    /** Everything `/my/membership` shows: published types and the account's own records. */
    async state(actor: MembershipActor): Promise<OwnMembershipState> {
      return run(deps.applicant.state(account(actor)));
    },

    /**
     * Applies for a PUBLISHED type. Idempotent: an open application of the same
     * account and type answers with its id and `created: false`, and owes no
     * second acknowledgement.
     */
    async submit(
      actor: MembershipActor,
      input: unknown,
    ): Promise<{ readonly applicationId: string; readonly created: boolean }> {
      const accountId = account(actor);
      const parsed = applicationSubmitSchema.safeParse(input);
      if (!parsed.success) throw new MembershipRefusal('invalid');
      await spend('submit', accountId);
      return run(
        deps.applicant.submit({
          id: ids(),
          accountId,
          membershipTypeId: parsed.data.membershipTypeId,
        }),
      );
    },

    /** Withdraws the person's own OPEN application. Version-checked. */
    async withdraw(actor: MembershipActor, input: unknown): Promise<ApplicationRecord> {
      const accountId = account(actor);
      const value = versioned(input);
      await spend('withdraw', accountId);
      return run(deps.applicant.withdraw({ accountId, ...value }));
    },

    /** Closes the person's own ACTIVE Membership. Version-checked; never reopened. */
    async closeOwn(actor: MembershipActor, input: unknown): Promise<MembershipRecord> {
      const accountId = account(actor);
      const value = versioned(input);
      await spend('close', accountId);
      return run(deps.applicant.closeOwn({ accountId, ...value }));
    },

    /**
     * Everything Membership holds about the signed-in account, as one
     * deterministic document of typed identifiers and instants — never a type's
     * words, an address or another person.
     */
    async export(actor: MembershipActor): Promise<MembershipExport> {
      const accountId = account(actor);
      await spend('export', accountId);
      const collected = await run(deps.exporter.collect(accountId));
      return {
        schema: MEMBERSHIP_EXPORT_SCHEMA,
        version: MEMBERSHIP_EXPORT_VERSION,
        generatedAt: now().toISOString(),
        applications: collected.applications,
        memberships: collected.memberships,
      };
    },
  };
}

export type MembershipApplicantService = ReturnType<
  typeof createMembershipApplicantService
>;
