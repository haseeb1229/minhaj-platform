import 'server-only';

import { randomBytes, randomUUID } from 'node:crypto';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  activationPermits,
  checkRequestedMoney,
  donationAccountIdSchema,
  donationStartSchema,
  donationStatusTokenSchema,
  parseExactAmount,
  sameScope,
  type CheckoutResumption,
  type DonationActivationReaderPort,
  type DonationCatalogueReaderPort,
  type DonationDonorPort,
  type DonationLedgerPort,
  type DonationRecord,
  type DonationStatusView,
  type PaymentProviderPort,
  type PublicDonationCampaign,
} from '@minhaj/contracts/donations';
import type { RateLimiterPort } from '@minhaj/contracts/platform';

import { DonationsRefusal, asDonationsRefusal } from '../domain/refusal.ts';
import {
  checkoutDestination,
  ensureCheckout,
  observeAndApply,
  sha256Hex,
  spend,
  type CheckoutAttempt,
  type DonationsActor,
  type DonationsLimitKey,
} from './shared.ts';

/** What a successful start hands the action: where to send the browser. */
export interface DonationStartResult {
  readonly checkoutUrl: string;
}

/** A fresh status token: 32 random bytes, base64url — 43 characters. */
function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The donor-visible line text: the campaign title in the request locale, else its primary locale. */
function checkoutLabelOf(
  campaign: PublicDonationCampaign,
  locale: Locale,
): string | null {
  const translation =
    campaign.translations.find((entry) => entry.locale === locale) ??
    campaign.translations.find((entry) => entry.locale === campaign.primaryLocale);
  return translation?.title ?? null;
}

/**
 * Giving — the donor's side of a donation (DOMAIN_MODEL.md §17.3;
 * DELIVERY_PLAN.md Phase 27).
 *
 * THE BROWSER REQUESTS, THE SERVER DECIDES. A form names a campaign, a
 * currency and decimal text; the server parses it exactly, checks it against
 * the campaign's CURRENT policy and the provider's capability, and creates the
 * donation's expected money itself. Nothing a browser sends afterwards — a
 * return visit, a query string, a claimed outcome — moves a donation: only
 * provider truth read server-to-server does.
 *
 * ONE FORM, ONE DONATION. The form's operation id makes a double submit the
 * same donation (the database's unique key), answered with the same checkout
 * while it is open — never a second payment.
 *
 * THE STATUS TOKEN IS A NARROW BEARER. It is minted here and handed to the
 * caller exactly once — as soon as the donation is durable and BEFORE the
 * provider is asked, so a donor whose first checkout creation ends ambiguous
 * still holds the way back to it — and only its digest is stored. It reads one donation's status, asks the provider
 * again, and asks to abandon an open checkout — nothing else, and nothing
 * personal.
 *
 * NO PAYMENT CREDENTIAL. Checkout is provider-hosted; no card, wallet or bank
 * detail exists anywhere on this path.
 */
export function createDonationsDonorService(deps: {
  readonly donor: DonationDonorPort;
  readonly catalogue: DonationCatalogueReaderPort;
  readonly activation: DonationActivationReaderPort;
  readonly ledger: Pick<DonationLedgerPort, 'applyObservation'>;
  readonly provider: PaymentProviderPort | null;
  readonly limiter: RateLimiterPort;
  readonly key: DonationsLimitKey;
  /** The site's own origin; return URLs are built from it and nothing else. */
  readonly baseUrl: string;
  readonly ids?: () => string;
  readonly clock?: () => Date;
  readonly tokens?: () => string;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const tokens = deps.tokens ?? mintToken;
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asDonationsRefusal);

  /** The provider, only while an activation row permits exactly its scope. */
  async function activeProvider(): Promise<PaymentProviderPort> {
    const provider = deps.provider;
    if (provider === null) throw new DonationsRefusal('not-activated');
    const activation = await run(deps.activation.activation());
    if (!activationPermits(activation, provider.scope()))
      throw new DonationsRefusal('not-activated');
    return provider;
  }

  function client(clientAddress: string): string {
    if (typeof clientAddress !== 'string' || clientAddress === '')
      throw new DonationsRefusal('invalid');
    return clientAddress;
  }

  /** The browser's destination for a create attempt, or the refusal it names. */
  function destinationOf(attempt: CheckoutAttempt): string {
    if (attempt.outcome === 'created') return attempt.checkoutUrl;
    if (attempt.outcome === 'rejected') throw new DonationsRefusal('amount-refused');
    throw new DonationsRefusal('provider-unavailable');
  }

  /**
   * A repeated submission of the same form: the same checkout while it is
   * open, the original create re-asked under its own key while that is
   * unresolved — and never a second donation or a second checkout.
   */
  async function resume(
    provider: PaymentProviderPort,
    donation: DonationRecord,
  ): Promise<string> {
    if (donation.state !== 'pending') throw new DonationsRefusal('already-submitted');
    if (!sameScope(donation.scope, provider.scope()))
      throw new DonationsRefusal('provider-unavailable');

    if (donation.createState === 'pending' || donation.createState === 'ambiguous')
      return destinationOf(
        await run(
          ensureCheckout(
            { provider, donor: deps.donor, baseUrl: deps.baseUrl },
            donation,
            now(),
          ),
        ),
      );
    if (donation.createState !== 'created' || donation.checkoutReference === null)
      throw new DonationsRefusal('already-submitted');

    let resumption: CheckoutResumption;
    try {
      resumption = await provider.resumeCheckout(donation.checkoutReference);
    } catch {
      throw new DonationsRefusal('provider-unavailable');
    }
    if (resumption.outcome === 'closed') throw new DonationsRefusal('already-submitted');
    if (resumption.outcome !== 'open') throw new DonationsRefusal('provider-unavailable');
    const url = checkoutDestination(
      provider.scope(),
      provider.checkoutOrigin(),
      resumption.checkoutUrl,
    );
    if (url === null) throw new DonationsRefusal('provider-unavailable');
    return url;
  }

  /** The donation a presented token names, or null for anything malformed or unknown. */
  async function byToken(token: unknown): Promise<{
    readonly digest: string;
    readonly donation: DonationRecord;
  } | null> {
    const parsed = donationStatusTokenSchema.safeParse(token);
    if (!parsed.success) return null;
    const digest = sha256Hex(parsed.data);
    const donation = await run(deps.donor.donationByToken(digest));
    return donation === null ? null : { digest, donation };
  }

  return {
    /**
     * Begins a donation and returns the provider's hosted checkout to send the
     * browser to. Order: shape, budgets, availability, exact money, policy and
     * capability, then the durable donation, then the provider.
     */
    async start(input: {
      readonly form: unknown;
      readonly locale: Locale;
      readonly clientAddress: string;
      readonly account: DonationsActor | null;
      /**
       * Receives the status token once, only when THIS call created the
       * donation (a duplicate submission has none to give: the browser already
       * holds it from the first), before the provider is called.
       */
      readonly issueStatusToken: (token: string) => Promise<void>;
    }): Promise<DonationStartResult> {
      const parsed = donationStartSchema.safeParse(input.form);
      const locale = localeSchema.safeParse(input.locale);
      if (!parsed.success || !locale.success) throw new DonationsRefusal('invalid');
      let accountId: string | null = null;
      if (input.account !== null) {
        const account = donationAccountIdSchema.safeParse(input.account?.accountId);
        if (!account.success) throw new DonationsRefusal('denied');
        accountId = account.data;
      }
      const form = parsed.data;

      await spend(deps.limiter, deps.key, 'start-client', client(input.clientAddress));
      if (accountId !== null)
        await spend(deps.limiter, deps.key, 'start-account', accountId);

      const provider = await activeProvider();

      const minor = parseExactAmount(form.amount, form.currency);
      if (minor === null) throw new DonationsRefusal('invalid');
      const expected = { currency: form.currency, minor };

      const campaign = (await run(deps.catalogue.publishedCampaigns())).find(
        (candidate) => candidate.id === form.campaignId,
      );
      if (campaign === undefined) throw new DonationsRefusal('campaign-unavailable');
      if (
        checkRequestedMoney(campaign.currencies, expected) !== 'ok' ||
        !provider.capabilities().currencies.includes(expected.currency)
      )
        throw new DonationsRefusal('amount-refused');
      const checkoutLabel = checkoutLabelOf(campaign, locale.data);
      if (checkoutLabel === null) throw new DonationsRefusal('campaign-unavailable');

      const token = tokens();
      const begun = await run(
        deps.donor.begin({
          id: ids(),
          operationId: form.operationId,
          requestDigest: sha256Hex(
            [
              campaign.id,
              expected.currency,
              expected.minor.toString(),
              accountId ?? '',
            ].join('\n'),
          ),
          campaignId: campaign.id,
          locale: locale.data,
          checkoutLabel,
          donorAccountId: accountId,
          expected,
          statusTokenDigest: sha256Hex(token),
          scope: provider.scope(),
        }),
      );

      if (!begun.created) return { checkoutUrl: await resume(provider, begun.donation) };

      await input.issueStatusToken(token);

      const checkoutUrl = destinationOf(
        await run(
          ensureCheckout(
            { provider, donor: deps.donor, baseUrl: deps.baseUrl },
            begun.donation,
            now(),
          ),
        ),
      );
      return { checkoutUrl };
    },

    /** What the token holder may read; `null` for a malformed or unknown token alike. */
    async status(
      token: unknown,
      clientAddress: string,
    ): Promise<DonationStatusView | null> {
      await spend(deps.limiter, deps.key, 'status', client(clientAddress));
      const parsed = donationStatusTokenSchema.safeParse(token);
      if (!parsed.success) return null;
      return run(deps.donor.statusByToken(sha256Hex(parsed.data)));
    },

    /**
     * Asks the provider again, on the donor's request, about a pending
     * checkout — bounded by its own budget. It changes nothing on its own:
     * only what the provider reports is applied, through the one ledger rule.
     */
    async check(
      token: unknown,
      clientAddress: string,
    ): Promise<DonationStatusView | null> {
      await spend(deps.limiter, deps.key, 'check', client(clientAddress));
      const found = await byToken(token);
      if (found === null) return null;
      const { digest, donation } = found;
      if (
        deps.provider !== null &&
        donation.state === 'pending' &&
        donation.createState === 'created'
      )
        await run(
          observeAndApply(
            { provider: deps.provider, ledger: deps.ledger },
            donation,
            'donor-check',
            null,
            now(),
          ),
        );
      return run(deps.donor.statusByToken(digest));
    },

    /**
     * Asks to abandon a still-pending checkout. The request is recorded, the
     * provider is asked to end the session, and then the provider's truth is
     * read and applied — so a payment that completed first WINS: the donation
     * succeeds, never "cancelled" over captured money.
     */
    async cancel(
      token: unknown,
      clientAddress: string,
    ): Promise<DonationStatusView | null> {
      await spend(deps.limiter, deps.key, 'cancel', client(clientAddress));
      const found = await byToken(token);
      if (found === null) return null;
      const { digest, donation } = found;
      if (donation.state !== 'pending') return run(deps.donor.statusByToken(digest));

      const marked = await run(
        deps.donor.markCancelRequested({ id: donation.id, now: now() }),
      );
      const provider = deps.provider;
      if (
        provider !== null &&
        marked.createState === 'created' &&
        marked.checkoutReference !== null &&
        sameScope(marked.scope, provider.scope())
      ) {
        try {
          await provider.cancelCheckout(marked.checkoutReference);
        } catch {
          // The answer does not matter: what the provider reports next does.
        }
        await run(
          observeAndApply(
            { provider, ledger: deps.ledger },
            marked,
            'donor-check',
            null,
            now(),
          ),
        );
      }
      return run(deps.donor.statusByToken(digest));
    },
  };
}

export type DonationsDonorService = ReturnType<typeof createDonationsDonorService>;
