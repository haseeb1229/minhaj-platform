import type {
  ApplicationDecision,
  ApplicationQuery,
  ApplicationRecord,
  MembershipCommunicationIntentRecord,
  MembershipExportRows,
  MembershipQuery,
  MembershipRecord,
  MembershipTypeCreate,
  MembershipTypeLabelInput,
  MembershipTypeRecord,
  MembershipTypeReference,
  OwnMembershipState,
  PublicMembershipType,
  StaffApplication,
  StaffApplicationPage,
  StaffMembership,
  StaffMembershipPage,
} from './values.ts';

/**
 * The ports the Membership context depends on (DOMAIN_MODEL.md §17.2). Each
 * is implemented by Membership's own persistence adapter, hosted in
 * `packages/database`, or — for the Identity answers — composed at Layer 4.
 *
 * EVERY APPLICANT READ AND WRITE IS KEYED BY THE ACCOUNT. The applicant port's
 * queries carry the account in their own predicate, so another person's
 * application or Membership resolves to nothing — the same answer an id that
 * does not exist gets.
 *
 * EVERY OPERATOR WRITE COMMITS ITS AUDIT ROW, and every owed message its
 * durable intent, IN THE SAME TRANSACTION as the change they describe.
 */

/* ===========================================================================
 * Public — published types only, nothing personal
 * ========================================================================= */

export interface MembershipCatalogueReaderPort {
  /** Published types in display order, then id. Bounded by `MEMBERSHIP_LIMITS.types`. */
  publishedTypes(): Promise<readonly PublicMembershipType[]>;
}

/* ===========================================================================
 * Operator — the type catalogue, under `membership.administer`
 * ========================================================================= */

export interface MembershipCataloguePort {
  /** Every type, any state, in display order then id. Bounded by `MEMBERSHIP_LIMITS.types`. */
  types(): Promise<readonly MembershipTypeRecord[]>;
  type(id: string): Promise<MembershipTypeRecord | null>;
  /** A new draft. Refused `limit` once `MEMBERSHIP_LIMITS.types` exist. Audited. */
  createType(input: {
    readonly id: string;
    readonly actorId: string;
    readonly value: MembershipTypeCreate;
  }): Promise<MembershipTypeRecord>;
  /** Moves the type in display order. Version-checked and audited. */
  reorderType(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly displayOrder: number;
  }): Promise<MembershipTypeRecord>;
  /** Adds or replaces one locale's words. Version-checked and audited. */
  saveLabel(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly label: MembershipTypeLabelInput;
  }): Promise<MembershipTypeRecord>;
  /**
   * Publishes or archives. Publication needs the primary locale's words
   * (`incomplete`); a type that has been public never returns to draft.
   */
  transitionType(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly to: 'published' | 'archived';
  }): Promise<MembershipTypeRecord>;
}

/* ===========================================================================
 * The applicant's own surface — `/my/membership`
 * ========================================================================= */

export interface MembershipApplicantPort {
  state(accountId: string): Promise<OwnMembershipState>;
  /**
   * A new `submitted` application on a PUBLISHED type, with its
   * acknowledgement intent. Idempotent: an open application of the same
   * account and type answers with its id and `created: false`. Refused
   * `already-member` while the account holds an active Membership of the
   * type, and `type-unavailable` when the type is not published.
   */
  submit(input: {
    readonly id: string;
    readonly accountId: string;
    readonly membershipTypeId: string;
  }): Promise<{ readonly applicationId: string; readonly created: boolean }>;
  /** The applicant's own OPEN application, withdrawn. Version-checked. */
  withdraw(input: {
    readonly accountId: string;
    readonly id: string;
    readonly expectedVersion: number;
  }): Promise<ApplicationRecord>;
  /** The member's own ACTIVE Membership, closed by them. Version-checked. */
  closeOwn(input: {
    readonly accountId: string;
    readonly id: string;
    readonly expectedVersion: number;
  }): Promise<MembershipRecord>;
}

/* ===========================================================================
 * Operator — applications and Memberships, under `membership.read` /
 * `membership.administer`
 * ========================================================================= */

export interface MembershipStaffPort {
  /** One bounded page, oldest submission first. The listing is an audited access. */
  applications(actorId: string, query: ApplicationQuery): Promise<StaffApplicationPage>;
  /** One application, or `null`. Opening it is an audited access. */
  application(actorId: string, id: string): Promise<StaffApplication | null>;
  /**
   * The applicant account of one application, or `null` — an identifier the
   * deciding operator already acts on, asked only so the service can ask
   * Identity whether that account is closed before a review or an approval.
   * NOT an access: it returns nothing an operator sees, so it is not audited.
   */
  applicantOf(id: string): Promise<string | null>;
  /** `submitted` → `under_review`, with the applicant's intent. Version-checked and audited. */
  startReview(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
  }): Promise<StaffApplication>;
  /**
   * `under_review` → `approved` or `rejected`, ONE TRANSACTION: an approval
   * creates the Membership (`membershipId`), and both commit with the audit
   * row and the applicant's intent or none of them do. An approval needs a
   * published type (`type-unavailable`) and no active Membership of it.
   */
  decide(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly decision: ApplicationDecision;
    readonly membershipId: string;
  }): Promise<StaffApplication>;
  /** One bounded page, most recently activated first. The listing is an audited access. */
  memberships(actorId: string, query: MembershipQuery): Promise<StaffMembershipPage>;
  /** An ACTIVE Membership, closed by an operator. Version-checked and audited. */
  closeMembership(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
  }): Promise<StaffMembership>;
}

/* ===========================================================================
 * Durable communication intent
 * ========================================================================= */

export interface MembershipCommunicationPort {
  /** Pending intents due by `now`, oldest first, bounded; each is claimed for `leaseSeconds`. */
  claimDue(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<readonly MembershipCommunicationIntentRecord[]>;
  markRelayed(intentId: string): Promise<void>;
  markAbandoned(intentId: string): Promise<void>;
  /**
   * What is owed for one intent NOW: the intent, whether the record it
   * describes still stands where the message says it does, and the type it
   * names — or `null` when the intent no longer exists.
   */
  deliverySource(intentId: string): Promise<{
    readonly intent: MembershipCommunicationIntentRecord;
    readonly owed: boolean;
    readonly type: MembershipTypeReference;
  } | null>;
}

/* ===========================================================================
 * Export and account-closure disposition
 * ========================================================================= */

export interface MembershipExportPort {
  /** The account's own applications and Memberships, in a fixed order. */
  collect(accountId: string): Promise<MembershipExportRows>;
}

export interface MembershipDispositionPort {
  /**
   * For a CLOSED account (the caller asked Identity): its open applications
   * withdrawn as `account-closure`, and its owed mail abandoned and removed —
   * at most `limit` rows per step. Its Memberships are NOT closed: closing the
   * login account is not resigning the organisational relationship. Returns
   * how many rows changed; zero means nothing is left to do.
   */
  disposeAccount(accountId: string, limit: number): Promise<number>;
  /** Accounts after `after` that still hold disposable Membership rows, in id order. */
  accountsWithData(after: string | null, limit: number): Promise<readonly string[]>;
}

/* ===========================================================================
 * What Membership asks Identity — answered at Layer 4
 * ========================================================================= */

export interface MembershipAuthorityPort {
  /** Identity's live answer for one key; anything but `true` is a refusal. */
  permits(accountId: string, permission: string): Promise<boolean>;
}

export interface MembershipAccountsPort {
  /** Of the accounts named, those Identity has CLOSED. */
  closedAccounts(accountIds: readonly string[]): Promise<readonly string[]>;
}

export interface MembershipRecipientPort {
  /** The address and interface locale of each ACTIVE account named; a missing one is owed nothing. */
  recipients(accountIds: readonly string[]): Promise<
    readonly {
      readonly accountId: string;
      readonly email: string;
      readonly locale: string;
    }[]
  >;
}
