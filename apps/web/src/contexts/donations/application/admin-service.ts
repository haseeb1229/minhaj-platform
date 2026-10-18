import 'server-only';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  CREATE_REPLAY_WINDOW_SECONDS,
  DONATION_LIMITS,
  campaignCreateSchema,
  campaignCurrencyPolicySchema,
  campaignTranslationSchema,
  donationAccountIdSchema,
  donationCampaignIdSchema,
  donationCurrencySchema,
  donationIdSchema,
  donationQuerySchema,
  donationVersionSchema,
  formatExactAmount,
  isCapturedState,
  parseExactAmount,
  refundRequestSchema,
  sameScope,
  type CampaignLabel,
  type DonationAuthorityPort,
  type DonationCampaignPort,
  type DonationCampaignRecord,
  type DonationLedgerPort,
  type DonationRecord,
  type DonationRefundPort,
  type DonationRefundRecord,
  type DonationStaffPort,
  type PaymentProviderPort,
  type RefundSubmission,
  type StaffDonation,
  type StaffDonationDetail,
  type StaffDonationPage,
} from '@minhaj/contracts/donations';

import { DonationsRefusal, asDonationsRefusal } from '../domain/refusal.ts';
import {
  observeAndApply,
  refundKey,
  refundMatches,
  sha256Hex,
  type DonationObservationOutcome,
  type DonationsActor,
} from './shared.ts';

/** The three keys Donations' administration asks for — exactly these, nothing implied. */
const READ = 'donations.read';
const ADMINISTER = 'donations.administer';
const REFUND = 'donations.refund';

/* ===========================================================================
 * Inputs
 * ========================================================================= */

const versioned = {
  id: donationCampaignIdSchema,
  expectedVersion: donationVersionSchema,
};

const reorderSchema = z
  .object({
    ...versioned,
    displayOrder: z.number().int().min(0).max(DONATION_LIMITS.displayOrder),
  })
  .strict();

const translationChangeSchema = z
  .object({ ...versioned, translation: campaignTranslationSchema })
  .strict();

/** Operator-typed decimal TEXT, parsed exactly in the policy's own currency. */
const amountTextSchema = z.string().trim().min(1).max(20);

const currencyPolicyChangeSchema = z
  .object({
    ...versioned,
    currency: donationCurrencySchema,
    minimum: amountTextSchema,
    maximum: amountTextSchema,
    /** Up to three suggestions; blank entries (empty form fields) are dropped. */
    suggested: z.array(z.string().max(20)).max(DONATION_LIMITS.suggestions),
  })
  .strict();

const currencyRemovalSchema = z
  .object({ ...versioned, currency: donationCurrencySchema })
  .strict();

const transitionSchema = z
  .object({ ...versioned, to: z.enum(['published', 'archived']) })
  .strict();

const reconcileSchema = z
  .object({ id: donationIdSchema, expectedVersion: donationVersionSchema })
  .strict();

const exportQuerySchema = donationQuerySchema.omit({ offset: true });

/* ===========================================================================
 * CSV
 * ========================================================================= */

/** The export's fixed column order. Asserted by test. */
export const DONATION_CSV_COLUMNS = Object.freeze([
  'id',
  'createdAt',
  'campaignId',
  'campaign',
  'state',
  'environment',
  'currency',
  'amount',
  'captured',
  'refunded',
  'reserved',
  'dispute',
  'attention',
  'donor',
  'checkoutReference',
  'paymentReference',
  'succeededAt',
  'updatedAt',
  'version',
] as const);

/**
 * One CSV cell, safe to open in a spreadsheet: a cell a spreadsheet would read
 * as a formula (`=`, `+`, `-`, `@`, tab, carriage return) is prefixed with a
 * single quote, and every cell is quoted with embedded quotes doubled.
 */
export function csvCell(value: string): string {
  const inert = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${inert.replaceAll('"', '""')}"`;
}

/** A provider reference reduced to its last six characters — enough to match, not to act. */
export function redactReference(reference: string | null): string {
  return reference === null ? '' : `…${reference.slice(-6)}`;
}

function campaignTitle(label: CampaignLabel): string {
  return (
    label.translations.find((entry) => entry.locale === label.primaryLocale)?.title ??
    label.translations[0]?.title ??
    ''
  );
}

function csvRow(row: StaffDonation): string {
  const currency = row.expected.currency;
  const money = (minor: bigint | null) =>
    minor === null ? '' : formatExactAmount(minor, currency);
  const cells: Record<(typeof DONATION_CSV_COLUMNS)[number], string> = {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    campaignId: row.campaignId,
    campaign: campaignTitle(row.campaign),
    state: row.state,
    environment: row.scope.environment,
    currency,
    amount: money(row.expected.minor),
    captured: money(row.capturedMinor),
    refunded: money(row.refundedMinor),
    reserved: money(row.refundReservedMinor),
    dispute: row.dispute,
    attention: row.attention ?? '',
    donor: row.linked ? 'linked' : 'anonymous',
    checkoutReference: redactReference(row.checkoutReference),
    paymentReference: redactReference(row.paymentReference),
    succeededAt: row.succeededAt?.toISOString() ?? '',
    updatedAt: row.updatedAt.toISOString(),
    version: String(row.version),
  };
  return DONATION_CSV_COLUMNS.map((column) => csvCell(cells[column])).join(',');
}

/* ===========================================================================
 * The service
 * ========================================================================= */

export type DonationRefundSubmission = 'accepted' | 'rejected' | 'unknown' | 'replayed';

/**
 * Donations' administration — campaigns, the donation records, operator
 * reconciliation, and refunds (DOMAIN_MODEL.md §17.3; DELIVERY_PLAN.md
 * Phase 27).
 *
 * THREE KEYS, AND NONE IMPLIES ANOTHER. Every read asks Identity, live, for
 * `donations.read`; every campaign change and reconciliation for
 * `donations.administer`; a refund for `donations.refund` — externally gated,
 * bundled into no role — and Layer 4 additionally demands a privileged actor
 * with a live `donation-refund` step-up. Each is asked BEFORE anything is
 * parsed, so a caller without the key learns nothing of the rules.
 *
 * MONEY IS TEXT IN, `bigint` THROUGH, TEXT OUT. An operator's amounts are
 * parsed exactly in the currency they belong to, and exported exactly.
 *
 * THIS SERVICE PASSING IS NECESSARY, NEVER SUFFICIENT. The adapter re-checks
 * versions, states and the refundable remainder under the donation's lock and
 * commits each act's audit row with it; the database's triggers refuse a
 * refund by anybody without the key and a live step-up, and any refund beyond
 * the captured amount, a third time.
 */
export function createDonationsAdminService(deps: {
  readonly campaigns: DonationCampaignPort;
  readonly staff: DonationStaffPort;
  readonly refunds: DonationRefundPort;
  readonly ledger: Pick<
    DonationLedgerPort,
    'donation' | 'applyObservation' | 'applyRefundObservation'
  >;
  readonly provider: PaymentProviderPort | null;
  readonly authority: DonationAuthorityPort;
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asDonationsRefusal);

  /** Identity's live answer for one key. Anything but `true` is a refusal. */
  async function holds(actor: DonationsActor, permission: string): Promise<string> {
    const parsed = donationAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new DonationsRefusal('denied');
    if ((await deps.authority.permits(parsed.data, permission)) !== true)
      throw new DonationsRefusal('denied');
    return parsed.data;
  }

  /** Permission first, parsing second: an unauthorised caller learns nothing of the rules. */
  async function authorised<S extends z.ZodType>(
    actor: DonationsActor,
    permission: string,
    schema: S,
    input: unknown,
  ): Promise<{ readonly actorId: string; readonly value: z.output<S> }> {
    const actorId = await holds(actor, permission);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new DonationsRefusal('invalid');
    return { actorId, value: parsed.data };
  }

  /** The configured provider, bound to the same scope as the donation. */
  function providerFor(donation: DonationRecord): PaymentProviderPort {
    const provider = deps.provider;
    if (provider === null || !sameScope(provider.scope(), donation.scope))
      throw new DonationsRefusal('provider-unavailable');
    return provider;
  }

  /** Submits a reserved refund under its own key, and records what the provider said. */
  async function submitRefund(
    provider: PaymentProviderPort,
    donation: DonationRecord,
    paymentReference: string,
    refund: DonationRefundRecord,
    actorId: string,
  ): Promise<{
    readonly refund: DonationRefundRecord;
    readonly submission: DonationRefundSubmission;
  }> {
    let submission: RefundSubmission;
    try {
      submission = await provider.requestRefund({
        refundId: refund.id,
        donationId: donation.id,
        paymentReference,
        amount: refund.amount,
        idempotencyKey: refundKey(refund.id),
      });
    } catch {
      submission = { outcome: 'unknown' };
    }

    if (
      submission.outcome === 'accepted' &&
      refundMatches(submission.observation, {
        scope: donation.scope,
        refundId: refund.id,
        paymentReference,
        currency: donation.expected.currency,
        amount: refund.amount,
      })
    ) {
      const applied = await run(
        deps.ledger.applyRefundObservation({
          refundId: refund.id,
          observation: submission.observation,
          now: now(),
        }),
      );
      // A settled refund is confirmed against the payment itself, so the
      // donation's refunded total is the provider's, never this platform's sum.
      if (submission.observation.state === 'succeeded')
        await run(
          observeAndApply(
            { provider, ledger: deps.ledger },
            applied.donation,
            'operator',
            actorId,
            now(),
          ),
        );
      return { refund: applied.refund, submission: 'accepted' };
    }

    // An acceptance that does not describe exactly this refund is not trusted:
    // it stays requested and reconciliation reads the provider again.
    const outcome = submission.outcome === 'rejected' ? 'rejected' : 'unknown';
    const recorded = await run(
      deps.refunds.recordSubmission({ refundId: refund.id, outcome, now: now() }),
    );
    return { refund: recorded, submission: outcome };
  }

  const isDonationId = (value: unknown): value is string =>
    donationIdSchema.safeParse(value).success;
  const isCampaignId = (value: unknown): value is string =>
    donationCampaignIdSchema.safeParse(value).success;

  return {
    /* ---- Campaigns ----------------------------------------------------- */

    async campaigns(actor: DonationsActor): Promise<readonly DonationCampaignRecord[]> {
      await holds(actor, READ);
      return run(deps.campaigns.campaigns());
    },

    /** One campaign, or `null` when the id is malformed or names nothing. */
    async campaign(
      actor: DonationsActor,
      id: string,
    ): Promise<DonationCampaignRecord | null> {
      await holds(actor, READ);
      if (!isCampaignId(id)) return null;
      return run(deps.campaigns.campaign(id));
    },

    /** A new draft campaign. */
    async createCampaign(
      actor: DonationsActor,
      input: unknown,
    ): Promise<DonationCampaignRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        campaignCreateSchema,
        input,
      );
      return run(deps.campaigns.createCampaign({ id: ids(), actorId, value }));
    },

    async reorderCampaign(
      actor: DonationsActor,
      input: unknown,
    ): Promise<DonationCampaignRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        reorderSchema,
        input,
      );
      return run(deps.campaigns.reorderCampaign({ actorId, ...value }));
    },

    /** Adds or replaces one locale's words. */
    async saveTranslation(
      actor: DonationsActor,
      input: unknown,
    ): Promise<DonationCampaignRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        translationChangeSchema,
        input,
      );
      return run(deps.campaigns.saveTranslation({ actorId, ...value }));
    },

    /**
     * Adds or replaces one currency's policy from decimal TEXT, parsed exactly
     * in that currency — `1.005` USD or `1.5` JPY is refused, never rounded.
     */
    async saveCurrencyPolicy(
      actor: DonationsActor,
      input: unknown,
    ): Promise<DonationCampaignRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        currencyPolicyChangeSchema,
        input,
      );
      const exact = (text: string): bigint => {
        const minor = parseExactAmount(text.trim(), value.currency);
        if (minor === null) throw new DonationsRefusal('invalid');
        return minor;
      };
      const policy = campaignCurrencyPolicySchema.safeParse({
        currency: value.currency,
        minimumMinor: exact(value.minimum),
        maximumMinor: exact(value.maximum),
        suggestedMinor: value.suggested
          .map((text) => text.trim())
          .filter((text) => text !== '')
          .map(exact),
      });
      if (!policy.success) throw new DonationsRefusal('invalid');
      return run(
        deps.campaigns.saveCurrencyPolicy({
          actorId,
          id: value.id,
          expectedVersion: value.expectedVersion,
          policy: policy.data,
        }),
      );
    },

    async removeCurrencyPolicy(
      actor: DonationsActor,
      input: unknown,
    ): Promise<DonationCampaignRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        currencyRemovalSchema,
        input,
      );
      return run(deps.campaigns.removeCurrencyPolicy({ actorId, ...value }));
    },

    /** Publishes or archives; a campaign that has been public never returns to draft. */
    async transitionCampaign(
      actor: DonationsActor,
      input: unknown,
    ): Promise<DonationCampaignRecord> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        transitionSchema,
        input,
      );
      return run(deps.campaigns.transitionCampaign({ actorId, ...value }));
    },

    /* ---- Records ------------------------------------------------------- */

    /** One bounded, filtered page of donations. An audited access. */
    async donations(actor: DonationsActor, query: unknown): Promise<StaffDonationPage> {
      const { actorId, value } = await authorised(
        actor,
        READ,
        donationQuerySchema,
        query,
      );
      return run(deps.staff.donations(actorId, value));
    },

    /** One donation with its refunds, or `null`. An audited financial-detail access. */
    async donation(
      actor: DonationsActor,
      id: string,
    ): Promise<StaffDonationDetail | null> {
      const actorId = await holds(actor, READ);
      if (!isDonationId(id)) return null;
      return run(deps.staff.donation(actorId, id));
    },

    /**
     * The filtered records as CSV, bounded, newest first, in a fixed column
     * order: exact amounts, provider references reduced to their last six
     * characters, and the donor only as `linked` or `anonymous`. Audited.
     */
    async exportCsv(actor: DonationsActor, query: unknown): Promise<string> {
      const { actorId, value } = await authorised(actor, READ, exportQuerySchema, query);
      const rows = await run(deps.staff.exportRows(actorId, value));
      return [
        DONATION_CSV_COLUMNS.map((column) => csvCell(column)).join(','),
        ...rows.map(csvRow),
      ]
        .map((line) => `${line}\r\n`)
        .join('');
    },

    /**
     * Makes a donation due and reads the provider's truth for it now. Audited;
     * a provider that does not answer leaves it scheduled for the sweep.
     */
    async reconcile(
      actor: DonationsActor,
      input: unknown,
    ): Promise<{
      readonly donation: DonationRecord;
      readonly outcome: DonationObservationOutcome;
    }> {
      const { actorId, value } = await authorised(
        actor,
        ADMINISTER,
        reconcileSchema,
        input,
      );
      if (deps.provider === null) throw new DonationsRefusal('provider-unavailable');
      const donation = await run(
        deps.staff.requestReconcile({ actorId, ...value, now: now() }),
      );
      return run(
        observeAndApply(
          { provider: deps.provider, ledger: deps.ledger },
          donation,
          'operator',
          actorId,
          now(),
        ),
      );
    },

    /**
     * A full or partial refund of a captured donation, in its own currency.
     * Reserved first (under the donation's lock, idempotent by operation id),
     * then requested from the provider under the refund's own key; an answer
     * that is not a clear acceptance or refusal stays `requested` and is
     * reconciled — never retried blind.
     */
    async refund(
      actor: DonationsActor,
      form: unknown,
    ): Promise<{
      readonly refund: DonationRefundRecord;
      readonly submission: DonationRefundSubmission;
    }> {
      const { actorId, value } = await authorised(
        actor,
        REFUND,
        refundRequestSchema,
        form,
      );
      const donation = await run(deps.ledger.donation(value.donationId));
      if (donation === null) throw new DonationsRefusal('not-found');
      const provider = providerFor(donation);

      const minor = parseExactAmount(value.amount, donation.expected.currency);
      if (minor === null) throw new DonationsRefusal('invalid');
      if (
        donation.capturedMinor === null ||
        !isCapturedState(donation.state) ||
        donation.state === 'charged_back' ||
        donation.paymentReference === null
      )
        throw new DonationsRefusal('invalid-state');
      if (minor > donation.capturedMinor - donation.refundReservedMinor)
        throw new DonationsRefusal('over-refund');
      const capabilities = provider.capabilities();
      if (
        minor === donation.capturedMinor
          ? !capabilities.fullRefund
          : !capabilities.partialRefund
      )
        throw new DonationsRefusal('invalid');

      const amount = { currency: donation.expected.currency, minor };
      const reserved = await run(
        deps.refunds.reserve({
          refundId: ids(),
          operationId: value.operationId,
          requestDigest: sha256Hex(
            [donation.id, amount.currency, amount.minor.toString()].join('\n'),
          ),
          donationId: donation.id,
          expectedVersion: value.expectedVersion,
          amount,
          actorId,
        }),
      );

      // A repeated form submission: the same refund, re-asked under its own
      // key only while it is still unanswered and the provider still holds
      // that key — otherwise it is reconciliation's to resolve.
      if (!reserved.created) {
        const repeatable =
          reserved.refund.state === 'requested' &&
          now().getTime() - reserved.refund.requestedAt.getTime() <=
            CREATE_REPLAY_WINDOW_SECONDS * 1000;
        if (!repeatable) return { refund: reserved.refund, submission: 'replayed' };
      }
      return submitRefund(
        provider,
        donation,
        donation.paymentReference,
        reserved.refund,
        actorId,
      );
    },
  };
}

export type DonationsAdminService = ReturnType<typeof createDonationsAdminService>;
