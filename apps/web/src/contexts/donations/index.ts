/**
 * Donations — THE public interface (bounded context, DOMAIN_MODEL.md §17.3).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no HTTP client, no transaction handle — the
 * context depends on the ports in `@minhaj/contracts/donations`, including the
 * provider-neutral `PaymentProviderPort`, and is handed their implementations
 * by Layer 4.
 *
 * PHASE 27 DELIVERS DONATIONS BEHIND A PAYMENT PROVIDER: operator-managed
 * campaigns with exact per-currency policies; a donation begun anonymously or
 * while signed in, paid on the provider's hosted checkout, and moved only by
 * provider truth verified server-to-server; a narrow anonymous status token;
 * webhook verification, deduplication and reconciliation; refunds behind an
 * externally gated key and a step-up; a linked donor's payment
 * acknowledgement mail; and this context's export and part of account
 * closure.
 *
 * NOT ECOMMERCE, AND NO PAYMENT CREDENTIAL. No cart, order, subscription,
 * saved instrument, card, wallet or bank detail exists anywhere here; no tax,
 * Gift Aid or zakat claim is made. It depends on no other business context —
 * Identity's answers arrive through Layer 4.
 */
export {
  DONATIONS_REFUSAL_REASONS,
  DonationsRefusal,
  asDonationsRefusal,
  donationsFailure,
  isDonationsRefusalReason,
  type DonationsRefusalReason,
} from './domain/refusal.ts';
export {
  DONATIONS_RATE_RULES,
  checkoutDestination,
  type DonationObservationOutcome,
  type DonationsActor,
  type DonationsLimitKey,
} from './application/shared.ts';
export {
  createDonationsPublicService,
  type DonationAvailability,
  type DonationsPage,
  type DonationsPublicService,
} from './application/public-service.ts';
export {
  createDonationsDonorService,
  type DonationStartResult,
  type DonationsDonorService,
} from './application/donor-service.ts';
export {
  createDonationsOwnerService,
  type DonationsOwnerService,
} from './application/owner-service.ts';
export {
  DONATION_CSV_COLUMNS,
  createDonationsAdminService,
  csvCell,
  redactReference,
  type DonationRefundSubmission,
  type DonationsAdminService,
} from './application/admin-service.ts';
export {
  createDonationsLedgerService,
  type DonationReconcileSummary,
  type DonationWebhookOutcome,
  type DonationsLedgerService,
} from './application/ledger-service.ts';
export {
  createDonationsAccountService,
  type DonationsAccountService,
  type DonationsDispositionProgress,
} from './application/account-service.ts';
export {
  createDonationsCommunicationService,
  isDonationDeliveryPurpose,
  type DonationsCommunicationService,
} from './application/communication-service.ts';
export {
  DONATION_MAIL_LOCALES,
  donationMailLocale,
  renderDonationMail,
} from './application/donations-mail.ts';
