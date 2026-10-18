import 'server-only';

import {
  CREATE_REPLAY_WINDOW_SECONDS,
  sameScope,
  type DonationDonorPort,
  type DonationEventResult,
  type DonationLedgerPort,
  type DonationReconcileClaim,
  type DonationRecord,
  type DonationRefundPort,
  type PaymentProviderPort,
  type ProviderEventNotice,
  type RefundLookup,
  type RefundReconcileClaim,
  type WebhookRejection,
  type WebhookVerification,
} from '@minhaj/contracts/donations';

import {
  RECONCILE_LEASE_SECONDS,
  ensureCheckout,
  observeAndApply,
  refundMatches,
} from './shared.ts';

/** The HTTP answer a provider webhook gets, and why — a category, never content. */
export interface DonationWebhookOutcome {
  readonly status: 200 | 400 | 401 | 500;
  readonly reason: WebhookRejection | 'processed' | 'duplicate' | 'deferred' | 'failure';
}

export interface DonationReconcileSummary {
  /** Donations read against the provider this run. */
  readonly donations: number;
  /** Refunds read against the provider this run. */
  readonly refunds: number;
  /** Items whose reconciliation threw; their lease lapses and they come due again. */
  readonly failed: number;
}

/** The provider could not answer; the event stays admitted-not-processed and is retried. */
class ProviderUnanswered extends Error {}

/**
 * Donations' ledger — how verified provider truth reaches a donation, from
 * webhooks and from reconciliation (SECURITY_BASELINE.md §14).
 *
 * A WEBHOOK IS A HINT, NEVER THE TRUTH. Its signature is verified over the
 * EXACT raw bytes before anything is parsed; it is then admitted once by
 * scope and event id (a duplicate has one effect), located by opaque
 * reference, and only then is the provider asked, server-to-server, what is
 * true now — and that answer is merged by the one convergent rule. The body's
 * amount, currency and state are never used, and the body is never kept.
 *
 * ORDER: verify → admit → (ignored | locate → observe → apply) → complete.
 * When the provider cannot be asked, the donation or refund is deferred and
 * the webhook answers 500, so the provider delivers again; the admitted event
 * stays unprocessed and the next delivery processes it.
 *
 * RECONCILIATION CLOSES EVERY GAP. A lost webhook, an ambiguous create, a
 * stale pending checkout and an unanswered refund come due on the ledger's
 * own schedule. An unresolved create is re-asked ONLY under its original key
 * inside the provider's idempotency retention; past it, it backs off to a
 * person's attention and is never created afresh.
 */
export function createDonationsLedgerService(deps: {
  readonly ledger: DonationLedgerPort;
  /** For an unresolved create's deterministic repeat during reconciliation. */
  readonly donor: Pick<DonationDonorPort, 'recordCheckout' | 'recordCreateOutcome'>;
  /** For a refund request the provider provably never received. */
  readonly refunds: Pick<DonationRefundPort, 'recordSubmission'>;
  readonly provider: PaymentProviderPort | null;
  /** The site's own origin; return URLs are built from it and nothing else. */
  readonly baseUrl: string;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());

  /* ---- One donation's payment truth -------------------------------------- */

  async function observePayment(
    provider: PaymentProviderPort,
    donation: DonationRecord,
    source: 'webhook' | 'reconcile',
  ): Promise<DonationEventResult> {
    const observed = await observeAndApply(
      { provider, ledger: deps.ledger },
      donation,
      source,
      null,
      now(),
    );
    if (observed.outcome === 'unknown') throw new ProviderUnanswered();
    if (observed.outcome === 'not-found') return 'unmatched';
    return observed.outcome;
  }

  /* ---- One refund's truth ------------------------------------------------- */

  async function observeRefund(
    provider: PaymentProviderPort,
    donation: DonationRecord,
    refund: {
      readonly refundId: string;
      readonly refundReference: string | null;
      readonly paymentReference: string;
      readonly amount: RefundReconcileClaim['amount'] | null;
    },
    source: 'webhook' | 'reconcile',
  ): Promise<DonationEventResult> {
    let lookup: RefundLookup;
    try {
      lookup = await provider.observeRefund({
        refundId: refund.refundId,
        refundReference: refund.refundReference,
        paymentReference: refund.paymentReference,
      });
    } catch {
      lookup = { outcome: 'unknown' };
    }
    if (lookup.outcome === 'unknown') throw new ProviderUnanswered();
    if (lookup.outcome === 'not-found') return 'unmatched';
    if (
      !refundMatches(lookup.observation, {
        scope: donation.scope,
        refundId: refund.refundId,
        paymentReference: refund.paymentReference,
        currency: donation.expected.currency,
        amount: refund.amount,
      })
    )
      return 'attention';

    const applied = await deps.ledger.applyRefundObservation({
      refundId: refund.refundId,
      observation: lookup.observation,
      now: now(),
    });
    // A settled refund is confirmed against the payment itself, so the
    // donation's refunded total is the provider's, never this platform's sum.
    if (lookup.observation.state === 'succeeded') {
      const payment = await observePayment(provider, applied.donation, source);
      if (payment === 'applied') return 'applied';
    }
    return applied.changed ? 'applied' : 'unchanged';
  }

  /* ---- Webhooks ----------------------------------------------------------- */

  async function process(
    provider: PaymentProviderPort,
    notice: ProviderEventNotice,
  ): Promise<{
    readonly donationId: string | null;
    readonly result: DonationEventResult;
  }> {
    if (notice.category === 'ignored') return { donationId: null, result: 'ignored' };

    const located = await deps.ledger.locate({
      scope: notice.scope,
      subject: notice.subject,
    });
    if (located === null) return { donationId: null, result: 'unmatched' };
    const donation = await deps.ledger.donation(located.donationId);
    if (donation === null) return { donationId: null, result: 'unmatched' };

    try {
      if (
        notice.category === 'refund' &&
        located.refundId !== null &&
        donation.paymentReference !== null
      ) {
        const result = await observeRefund(
          provider,
          donation,
          {
            refundId: located.refundId,
            refundReference: notice.subject.refundReference,
            paymentReference: donation.paymentReference,
            amount: null,
          },
          'webhook',
        );
        if (result === 'unmatched')
          await deps.ledger.deferRefund({ refundId: located.refundId, now: now() });
        return { donationId: donation.id, result };
      }
      // A payment or dispute event — or a refund made outside this platform,
      // which the payment's own refunded total reveals.
      const result = await observePayment(provider, donation, 'webhook');
      if (result === 'unmatched')
        await deps.ledger.deferDonation({ donationId: donation.id, now: now() });
      return { donationId: donation.id, result };
    } catch (error) {
      if (error instanceof ProviderUnanswered) {
        if (notice.category === 'refund' && located.refundId !== null)
          await deps.ledger.deferRefund({ refundId: located.refundId, now: now() });
        else await deps.ledger.deferDonation({ donationId: donation.id, now: now() });
      }
      throw error;
    }
  }

  /* ---- Reconciliation ----------------------------------------------------- */

  async function reconcileDonation(
    provider: PaymentProviderPort,
    claim: DonationReconcileClaim,
  ): Promise<void> {
    const donation = await deps.ledger.donation(claim.donationId);
    if (donation === null) return;
    const defer = () =>
      deps.ledger.deferDonation({ donationId: donation.id, now: now() });

    // A donation held in another scope cannot be read by this provider; it
    // backs off to a person's attention rather than being guessed at.
    if (!sameScope(donation.scope, provider.scope())) return defer();

    if (donation.createState === 'pending' || donation.createState === 'ambiguous') {
      const attempt = await ensureCheckout(
        { provider, donor: deps.donor, baseUrl: deps.baseUrl },
        donation,
        now(),
      );
      if (attempt.outcome === 'rejected') return;
      if (attempt.outcome === 'created') {
        await settle(attempt.donation);
        return;
      }
      // `pending` was just recorded ambiguous, which reschedules it; an
      // already-ambiguous create, or one past the replay window, backs off.
      if (donation.createState === 'ambiguous' || attempt.outcome === 'window-closed')
        await defer();
      return;
    }

    if (donation.createState === 'created') await settle(donation);

    async function settle(current: DonationRecord): Promise<void> {
      try {
        const result = await observePayment(provider, current, 'reconcile');
        if (result === 'unmatched') await defer();
      } catch (error) {
        if (error instanceof ProviderUnanswered) return defer();
        throw error;
      }
    }
  }

  async function reconcileRefund(
    provider: PaymentProviderPort,
    claim: RefundReconcileClaim,
  ): Promise<void> {
    const defer = () => deps.ledger.deferRefund({ refundId: claim.refundId, now: now() });
    const donation = await deps.ledger.donation(claim.donationId);
    if (donation === null || !sameScope(donation.scope, provider.scope())) return defer();
    try {
      const result = await observeRefund(
        provider,
        donation,
        {
          refundId: claim.refundId,
          refundReference: claim.refundReference,
          paymentReference: claim.paymentReference,
          amount: claim.amount,
        },
        'reconcile',
      );
      // A refund request whose answer was lost and that the provider still
      // does not hold — looked up by this platform's own refund id among the
      // payment's refunds — once the window in which the original request
      // could have been repeated under its key has passed, was never
      // received: it fails and its reservation is released. Never re-submitted.
      if (
        result === 'unmatched' &&
        claim.refundReference === null &&
        now().getTime() - claim.requestedAt.getTime() >=
          CREATE_REPLAY_WINDOW_SECONDS * 1000
      ) {
        await deps.refunds.recordSubmission({
          refundId: claim.refundId,
          outcome: 'rejected',
          now: now(),
        });
        return;
      }
      // Not found yet, or not exactly this refund: it backs off and is read again.
      if (result === 'unmatched' || result === 'attention') await defer();
    } catch (error) {
      if (error instanceof ProviderUnanswered) return defer();
      throw error;
    }
  }

  return {
    /** Verifies, deduplicates and applies one provider webhook. Never throws. */
    async receiveWebhook(input: {
      readonly rawBody: Uint8Array;
      readonly signature: string | null;
    }): Promise<DonationWebhookOutcome> {
      const provider = deps.provider;
      if (provider === null) return { status: 401, reason: 'not-configured' };

      let verification: WebhookVerification;
      try {
        verification = provider.verifyWebhook({
          rawBody: input.rawBody,
          signature: input.signature,
          now: now(),
        });
      } catch {
        return { status: 400, reason: 'malformed' };
      }
      if (verification.outcome !== 'verified') {
        const reason = verification.reason;
        return { status: reason === 'malformed' ? 400 : 401, reason };
      }
      const notice = verification.notice;
      if (!sameScope(notice.scope, provider.scope()))
        return { status: 401, reason: 'wrong-environment' };

      try {
        const admission = await deps.ledger.admitEvent({
          notice: {
            scope: notice.scope,
            eventId: notice.eventId,
            eventType: notice.eventType,
            occurredAt: notice.occurredAt,
            payloadDigest: notice.payloadDigest,
          },
          receivedAt: now(),
        });
        if (admission === 'already-processed')
          return { status: 200, reason: 'duplicate' };

        const { donationId, result } = await process(provider, notice);
        await deps.ledger.completeEvent({
          scope: notice.scope,
          eventId: notice.eventId,
          donationId,
          result,
          now: now(),
        });
        return { status: 200, reason: 'processed' };
      } catch (error) {
        return {
          status: 500,
          reason: error instanceof ProviderUnanswered ? 'deferred' : 'failure',
        };
      }
    },

    /**
     * One bounded reconciliation run: due donations, then due refunds, each
     * under a lease. One item's failure does not stop the others.
     */
    async reconcileDue(limit: number): Promise<DonationReconcileSummary> {
      const provider = deps.provider;
      if (provider === null) return { donations: 0, refunds: 0, failed: 0 };
      let failed = 0;

      const donations = await deps.ledger.claimDueDonations(
        now(),
        limit,
        RECONCILE_LEASE_SECONDS,
      );
      for (const claim of donations) {
        try {
          await reconcileDonation(provider, claim);
        } catch {
          failed += 1;
        }
      }

      const refunds = await deps.ledger.claimDueRefunds(
        now(),
        limit,
        RECONCILE_LEASE_SECONDS,
      );
      for (const claim of refunds) {
        try {
          await reconcileRefund(provider, claim);
        } catch {
          failed += 1;
        }
      }

      return { donations: donations.length, refunds: refunds.length, failed };
    },
  };
}

export type DonationsLedgerService = ReturnType<typeof createDonationsLedgerService>;
