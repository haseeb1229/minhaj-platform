import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';

/**
 * Membership — MembershipType, MembershipApplication and Membership
 * (DOMAIN_MODEL.md §17.2, DELIVERY_PLAN.md Phase 26).
 *
 * AN ORGANISATIONAL RELATIONSHIP, NOT AN ACCOUNT. A Membership is modelled
 * separately from User: it begins only when an operator approves an
 * application, and it has its own lifecycle. Closing the digital account is
 * not resigning the Membership (DOMAIN_MODEL.md §17.2).
 *
 * NO PAYMENT CODE PATH WHATSOEVER. No amount, currency, fee, dues, price,
 * invoice, receipt, checkout, provider, transaction or payment state exists
 * here, and none may be added: joining is an organisational act, and any
 * future fee arrangement would be a separate explicit decision. Membership
 * depends on no Donations or payment concept.
 *
 * DATA-MINIMISED. An application holds the applicant's account, the requested
 * type, its workflow state and its instants — no name, address, phone, age,
 * guardian, identity document, free text, note or upload. The account already
 * is the applicant; nothing of it is copied.
 *
 * PLAIN TEXT ONLY. A type's operator-authored words render as text nodes.
 */

/* ===========================================================================
 * Identifiers
 * ========================================================================= */

export const membershipIdSchema = z.uuid();

/** An account id as Identity issues it — opaque here, never parsed. */
export const membershipAccountIdSchema = z.string().min(1).max(36);

export const membershipVersionSchema = z.number().int().positive().max(2_147_483_646);

/* ===========================================================================
 * Controlled vocabularies (each mirrored by a database CHECK)
 * ========================================================================= */

/** A MembershipType's own lifecycle — no review, no schedule, no hard deletion. */
export const MEMBERSHIP_TYPE_STATES = Object.freeze([
  'draft',
  'published',
  'archived',
] as const);
export type MembershipTypeState = (typeof MEMBERSHIP_TYPE_STATES)[number];

/** Where a type may go next. A type that has been public never returns to draft. */
export const MEMBERSHIP_TYPE_TRANSITIONS: Readonly<
  Record<MembershipTypeState, readonly MembershipTypeState[]>
> = Object.freeze({
  draft: Object.freeze(['published'] as const),
  published: Object.freeze(['archived'] as const),
  archived: Object.freeze(['published'] as const),
});

export const APPLICATION_STATUSES = Object.freeze([
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'withdrawn',
] as const);
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The two OPEN statuses: at most one such application per account and type. */
export const OPEN_APPLICATION_STATUSES = Object.freeze([
  'submitted',
  'under_review',
] as const satisfies readonly ApplicationStatus[]);

export function isOpenApplication(status: ApplicationStatus): boolean {
  return status === 'submitted' || status === 'under_review';
}

/** Who withdrew an application: the applicant, or Membership's account-closure disposition. */
export const WITHDRAWAL_SOURCES = Object.freeze([
  'applicant',
  'account-closure',
] as const);
export type WithdrawalSource = (typeof WITHDRAWAL_SOURCES)[number];

export const MEMBERSHIP_STATUSES = Object.freeze(['active', 'closed'] as const);
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Who closed a Membership: the member themselves, or an operator. */
export const CLOSURE_SOURCES = Object.freeze(['member', 'operator'] as const);
export type ClosureSource = (typeof CLOSURE_SOURCES)[number];

/**
 * The applicant-facing service mail Membership owes — TRANSACTIONAL, never
 * marketing. One per lifecycle point, each owed at most once per record.
 */
export const MEMBERSHIP_COMMUNICATION_PURPOSES = Object.freeze([
  'membership.application.submitted',
  'membership.application.under-review',
  'membership.application.approved',
  'membership.application.rejected',
  'membership.application.withdrawn',
  'membership.closed',
] as const);
export type MembershipCommunicationPurpose =
  (typeof MEMBERSHIP_COMMUNICATION_PURPOSES)[number];

export const MEMBERSHIP_INTENT_STATES = Object.freeze([
  'pending',
  'relayed',
  'abandoned',
] as const);
export type MembershipIntentState = (typeof MEMBERSHIP_INTENT_STATES)[number];

/**
 * The application status each application purpose describes. A message is
 * owed only while the application still stands at that status: a later
 * transition owes its own, newer message instead.
 */
export const PURPOSE_STATUS: Readonly<
  Record<Exclude<MembershipCommunicationPurpose, 'membership.closed'>, ApplicationStatus>
> = Object.freeze({
  'membership.application.submitted': 'submitted',
  'membership.application.under-review': 'under_review',
  'membership.application.approved': 'approved',
  'membership.application.rejected': 'rejected',
  'membership.application.withdrawn': 'withdrawn',
});

/**
 * The idempotency key of one intent. Each purpose happens at most once to one
 * application or Membership, so the purpose and the record are the whole key:
 * a retried or replayed transition can never owe a second message.
 */
export function membershipIntentKey(
  purpose: MembershipCommunicationPurpose,
  recordId: string,
): string {
  return `${purpose}:${recordId}`;
}

/* ===========================================================================
 * Bounds
 * ========================================================================= */

export const MEMBERSHIP_LIMITS = Object.freeze({
  title: 160,
  summary: 600,
  description: 4000,
  guidance: 2000,
  /** Highest display position an operator may give a type. */
  displayOrder: 9999,
  /** Types an operator may hold at once — public or not. */
  types: 50,
});

/** One administrative listing page. */
export const MEMBERSHIP_PAGE = 25;

/** The bounded history a person sees of their own applications and Memberships. */
export const OWN_HISTORY = 50;

/* ===========================================================================
 * Inputs — every one strict, every one parsed by the service
 * ========================================================================= */

const text = (max: number) => z.string().trim().max(max);

/** One locale's operator-authored words for a type. */
export const membershipTypeLabelSchema = z
  .object({
    locale: localeSchema,
    title: text(MEMBERSHIP_LIMITS.title).min(1),
    summary: text(MEMBERSHIP_LIMITS.summary).min(1),
    description: text(MEMBERSHIP_LIMITS.description).min(1),
    /** Optional concise joining guidance; an empty answer is no guidance. */
    guidance: text(MEMBERSHIP_LIMITS.guidance).transform((value) =>
      value.length === 0 ? null : value,
    ),
  })
  .strict();
export type MembershipTypeLabelInput = z.output<typeof membershipTypeLabelSchema>;

const displayOrderSchema = z.number().int().min(0).max(MEMBERSHIP_LIMITS.displayOrder);

export const membershipTypeCreateSchema = z
  .object({
    primaryLocale: localeSchema,
    displayOrder: displayOrderSchema,
    label: membershipTypeLabelSchema,
  })
  .strict()
  .refine((value) => value.label.locale === value.primaryLocale, {
    message: 'A type begins with its primary locale.',
  });
export type MembershipTypeCreate = z.output<typeof membershipTypeCreateSchema>;

export const membershipTypeOrderSchema = z
  .object({
    id: membershipIdSchema,
    expectedVersion: membershipVersionSchema,
    displayOrder: displayOrderSchema,
  })
  .strict();

export const membershipTypeLabelChangeSchema = z
  .object({
    id: membershipIdSchema,
    expectedVersion: membershipVersionSchema,
    label: membershipTypeLabelSchema,
  })
  .strict();

export const membershipTypeTransitionSchema = z
  .object({
    id: membershipIdSchema,
    expectedVersion: membershipVersionSchema,
    to: z.enum(['published', 'archived']),
  })
  .strict();

export const applicationSubmitSchema = z
  .object({ membershipTypeId: membershipIdSchema })
  .strict();

/** A versioned act on one record: withdraw, start review, close. */
export const versionedRecordSchema = z
  .object({ id: membershipIdSchema, expectedVersion: membershipVersionSchema })
  .strict();

export const applicationDecisionSchema = z
  .object({
    id: membershipIdSchema,
    expectedVersion: membershipVersionSchema,
    decision: z.enum(['approve', 'reject']),
  })
  .strict();
export type ApplicationDecision = z.output<typeof applicationDecisionSchema>['decision'];

export const applicationQuerySchema = z
  .object({
    /** `open` means submitted or under review. */
    status: z.enum([...APPLICATION_STATUSES, 'open'] as const).nullable(),
    membershipTypeId: membershipIdSchema.nullable(),
    offset: z.number().int().min(0).max(10_000),
  })
  .strict();
export type ApplicationQuery = z.output<typeof applicationQuerySchema>;

export const membershipQuerySchema = z
  .object({
    status: z.enum(MEMBERSHIP_STATUSES).nullable(),
    membershipTypeId: membershipIdSchema.nullable(),
    offset: z.number().int().min(0).max(10_000),
  })
  .strict();
export type MembershipQuery = z.output<typeof membershipQuerySchema>;

/* ===========================================================================
 * Views
 * ========================================================================= */

export interface MembershipTypeLabel {
  readonly locale: Locale;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly guidance: string | null;
}

/** A type as anybody may see it: published, with its words in every locale it has. */
export interface PublicMembershipType {
  readonly id: string;
  readonly primaryLocale: Locale;
  readonly displayOrder: number;
  readonly labels: readonly MembershipTypeLabel[];
}

/** A type as a person's own records or an operator name it — any state. */
export interface MembershipTypeReference extends PublicMembershipType {
  readonly state: MembershipTypeState;
}

/** A type as an operator manages it. */
export interface MembershipTypeRecord extends MembershipTypeReference {
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly archivedAt: Date | null;
  /** Submitted or under review. */
  readonly openApplications: number;
  readonly activeMemberships: number;
}

export interface ApplicationRecord {
  readonly id: string;
  readonly membershipTypeId: string;
  readonly status: ApplicationStatus;
  readonly withdrawalSource: WithdrawalSource | null;
  readonly version: number;
  readonly submittedAt: Date;
  readonly reviewStartedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly withdrawnAt: Date | null;
  /** The Membership an approval created, when there is one. */
  readonly membershipId: string | null;
}

export interface MembershipRecord {
  readonly id: string;
  readonly membershipTypeId: string;
  readonly sourceApplicationId: string;
  readonly status: MembershipStatus;
  readonly closureSource: ClosureSource | null;
  readonly version: number;
  readonly activatedAt: Date;
  readonly closedAt: Date | null;
}

/** Everything `/my/membership` shows, all of it the signed-in account's own. */
export interface OwnMembershipState {
  /** Published types, in display order. */
  readonly available: readonly PublicMembershipType[];
  /** The account's applications, newest first, bounded by `OWN_HISTORY`. */
  readonly applications: readonly ApplicationRecord[];
  /** The account's Memberships, newest first, bounded by `OWN_HISTORY`. */
  readonly memberships: readonly MembershipRecord[];
  /** Every type the account's own records name, whatever its state now. */
  readonly types: readonly MembershipTypeReference[];
}

/** An application as an operator sees it: the applicant by account id only. */
export interface StaffApplication extends ApplicationRecord {
  readonly applicantAccountId: string;
}

export interface StaffApplicationPage {
  readonly rows: readonly StaffApplication[];
  readonly total: number;
}

export interface StaffMembership extends MembershipRecord {
  readonly memberAccountId: string;
}

export interface StaffMembershipPage {
  readonly rows: readonly StaffMembership[];
  readonly total: number;
}

/* ===========================================================================
 * Durable communication intent
 * ========================================================================= */

/**
 * One durable service-mail intent Membership owns: safe identifiers, a
 * purpose, an instant and a key — never an address, a name or a body. The
 * recipient is resolved by Identity at dispatch, at Layer 4.
 */
export interface MembershipCommunicationIntentRecord {
  readonly id: string;
  readonly purpose: MembershipCommunicationPurpose;
  readonly recipientAccountId: string;
  readonly applicationId: string | null;
  readonly membershipId: string | null;
  readonly dueAt: Date;
  readonly state: MembershipIntentState;
  readonly idempotencyKey: string;
}

/* ===========================================================================
 * Export
 * ========================================================================= */

export const MEMBERSHIP_EXPORT_SCHEMA = 'minhaj.membership.export';
export const MEMBERSHIP_EXPORT_VERSION = 1;

/**
 * A person's own Membership data, by typed identifier and instant — never a
 * type's words (public or operator-owned), never an address, never a message.
 */
export interface MembershipExport {
  readonly schema: typeof MEMBERSHIP_EXPORT_SCHEMA;
  readonly version: typeof MEMBERSHIP_EXPORT_VERSION;
  readonly generatedAt: string;
  readonly applications: readonly {
    readonly id: string;
    readonly membershipTypeId: string;
    readonly status: ApplicationStatus;
    readonly withdrawalSource: WithdrawalSource | null;
    readonly submittedAt: string;
    readonly reviewStartedAt: string | null;
    readonly decidedAt: string | null;
    readonly withdrawnAt: string | null;
  }[];
  readonly memberships: readonly {
    readonly id: string;
    readonly membershipTypeId: string;
    readonly sourceApplicationId: string;
    readonly status: MembershipStatus;
    readonly closureSource: ClosureSource | null;
    readonly activatedAt: string;
    readonly closedAt: string | null;
  }[];
}

/** The collected rows an export is built from, before the service stamps it. */
export type MembershipExportRows = Pick<MembershipExport, 'applications' | 'memberships'>;
