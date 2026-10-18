/**
 * Membership — THE public interface (bounded context, DOMAIN_MODEL.md §17.2).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends
 * on the ports in `@minhaj/contracts/membership` and is handed their
 * implementations by Layer 4.
 *
 * PHASE 26 DELIVERS MEMBERSHIP AS AN ORGANISATIONAL RELATIONSHIP: operator-
 * managed MembershipTypes with their public catalogue; a signed-in person's
 * application, its review and decision; the Membership an approval creates,
 * closed by the member or an operator; the applicant's transactional service
 * mail through the shared dispatcher; and this context's export and part of
 * account closure.
 *
 * NOT AN ACCOUNT, AND NO PAYMENT. A Membership begins only when an operator
 * approves an application and is never the login account; closing the account
 * does not resign it. No amount, fee or provider exists anywhere in this
 * context, and it depends on no other business context — Identity's answers
 * (live permission, closed accounts, recipients) arrive through Layer 4.
 */
export {
  MEMBERSHIP_REFUSAL_REASONS,
  MembershipRefusal,
  asMembershipRefusal,
  isMembershipRefusalReason,
  membershipFailure,
  type MembershipRefusalReason,
} from './domain/refusal.ts';
export {
  createMembershipPublicService,
  type MembershipPublicService,
} from './application/public-service.ts';
export {
  MEMBERSHIP_RATE_RULES,
  createMembershipApplicantService,
  type MembershipActor,
  type MembershipApplicantService,
  type MembershipLimitKey,
} from './application/applicant-service.ts';
export {
  createMembershipAdminService,
  type MembershipAdminService,
} from './application/admin-service.ts';
export {
  createMembershipAccountService,
  type MembershipAccountService,
  type MembershipDispositionProgress,
} from './application/account-service.ts';
export {
  createMembershipCommunicationService,
  isMembershipDeliveryPurpose,
  type MembershipCommunicationService,
} from './application/communication-service.ts';
export {
  MEMBERSHIP_MAIL_LOCALES,
  membershipMailLocale,
  renderMembershipMail,
} from './application/membership-mail.ts';
