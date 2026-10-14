import 'server-only';

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import {
  NEWSLETTER_CONFIRMATION_HOURS,
  NEWSLETTER_PERMISSIONS,
  NEWSLETTER_STATES,
  newsletterOperationSchema,
  newsletterSubmissionSchema,
  newsletterTokenSchema,
  type NewsletterCounts,
  type NewsletterIssue,
  type NewsletterOutcome,
  type NewsletterPort,
  type NewsletterState,
  type NewsletterTokenPurpose,
  type NewsletterAdminPage,
} from '@minhaj/contracts/personalisation';
import type {
  DeliveryRecord,
  DeliveryResolution,
  RateLimitRule,
  RateLimiterPort,
} from '@minhaj/contracts/platform';

import { PersonalRefusal, asRefusal } from '../domain/refusal.ts';
import { renderNewsletterConfirmation } from './newsletter-mail.ts';
import { safeOffset, spend, type PersonalActor } from './shared.ts';

/** Submissions per address — a third party cannot mail-bomb somebody else. */
export const NEWSLETTER_ADDRESS_RULE: RateLimitRule = Object.freeze({
  window: 3_600,
  max: 3,
});
/** Submissions per client address. */
export const NEWSLETTER_CLIENT_RULE: RateLimitRule = Object.freeze({
  window: 3_600,
  max: 10,
});
/** Confirm and unsubscribe attempts per client address. */
export const NEWSLETTER_LINK_RULE: RateLimitRule = Object.freeze({
  window: 3_600,
  max: 30,
});

/** Lapsed confirmations retired per sweep run. */
const EXPIRY_BATCH = 200;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * What a newsletter link's GET page may ask — whether the link is still usable
 * — and nothing else. It needs no key and no configuration: a presented token
 * is only ever HASHED and compared. Built for the public pages that render an
 * emailed link, which must reach no session, secret or account.
 */
export function createNewsletterLinkReader(
  newsletter: Pick<NewsletterPort, 'linkIsCurrent'>,
) {
  return {
    async linkStatus(
      purpose: NewsletterTokenPurpose,
      value: unknown,
    ): Promise<'valid' | 'invalid'> {
      const parsed = newsletterTokenSchema.safeParse(value);
      if (!parsed.success) return 'invalid';
      return (await newsletter.linkIsCurrent(purpose, sha256(parsed.data), new Date()))
        ? 'valid'
        : 'invalid';
    },
  };
}

export type NewsletterLinkReader = ReturnType<typeof createNewsletterLinkReader>;

/**
 * The newsletter — double opt-in consent from an address, never an account
 * (DOMAIN_MODEL.md §14.5; SECURITY_BASELINE.md §19.1).
 *
 * SUBMISSION ACTIVATES NOTHING. It stores a pending subscription and owes one
 * confirmation message; only the link in that message confirms it. Every
 * submission answers the same whatever the address's state — new, pending,
 * confirmed, unsubscribed or suppressed — so the form cannot be used to learn
 * who subscribes.
 *
 * LINK TOKENS ARE NEVER STORED. Each issuance draws two fresh random salts;
 * a token is `HMAC(NEWSLETTER_TOKEN_KEY, purpose | subscriber | generation |
 * salt)` — 256 bits nobody without the key can produce — and only its SHA-256
 * is kept. The dispatcher re-derives the same token at send time from the
 * salt, so a retried message carries the same link and nothing mints a second
 * one. Confirm and unsubscribe tokens are separate, single-purpose, and bound
 * to their purpose inside the MAC.
 *
 * CONFIRMATION IS A POST, consumed once, by a statement whose predicate is the
 * check. Unsubscribing never needs an account. Neither touches Identity's
 * verification, reset or security mail, which no newsletter state can reach.
 */
export function createNewsletterService(deps: {
  readonly newsletter: NewsletterPort;
  readonly limiter: RateLimiterPort;
  /** Purpose-scoped limiter key over a subject (address digest or client). */
  readonly key: (purpose: string, subject: string) => string;
  /** The keyed digest of a canonical address, as Layer-0 email computes it. */
  readonly digest: (email: string) => {
    readonly digest: string;
    readonly keyVersion: number;
  };
  readonly tokenKey: { readonly key: string; readonly version: number };
  /** Provider suppression, MARKETING scope — any bounce or complaint wins. */
  readonly suppressed: (email: string) => Promise<boolean>;
  readonly enqueue: (delivery: {
    readonly recipient: string;
    readonly sourceReference: string;
    readonly idempotencyKey: string;
  }) => Promise<void>;
  readonly baseUrl: string;
  readonly authority: {
    permits(actor: PersonalActor, permission: string): Promise<boolean>;
  };
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  function token(
    purpose: NewsletterTokenPurpose,
    subscriberId: string,
    generation: number,
    salt: string,
  ): string {
    return createHmac('sha256', deps.tokenKey.key)
      .update(`newsletter|${purpose}|${subscriberId}|${generation}|${salt}`)
      .digest('base64url');
  }

  const hash = sha256;

  function issue(subscriberId: string, generation: number): NewsletterIssue {
    const confirmSalt = randomBytes(32).toString('base64url');
    const unsubscribeSalt = randomBytes(32).toString('base64url');
    return {
      confirmHash: hash(token('confirm', subscriberId, generation, confirmSalt)),
      confirmSalt,
      unsubscribeHash: hash(
        token('unsubscribe', subscriberId, generation, unsubscribeSalt),
      ),
      unsubscribeSalt,
      tokenKeyVersion: deps.tokenKey.version,
      expiresAt: new Date(now().getTime() + NEWSLETTER_CONFIRMATION_HOURS * 3_600_000),
    };
  }

  /** The hash a presented link would have to match, or null for a malformed one. */
  function presented(value: unknown): string | null {
    const parsed = newsletterTokenSchema.safeParse(value);
    return parsed.success ? hash(parsed.data) : null;
  }

  async function operator(actor: PersonalActor, permission: string): Promise<void> {
    if (!(await deps.authority.permits(actor, permission)))
      throw new PersonalRefusal('denied');
  }

  return {
    /**
     * Accepts a submission. The SAME answer for every address and every state;
     * only malformed input and spent rate budgets are told apart.
     */
    async submit(input: unknown, clientAddress: string): Promise<void> {
      const parsed = newsletterSubmissionSchema.safeParse(input);
      if (!parsed.success) throw new PersonalRefusal('invalid');
      const { email, locale } = parsed.data;
      const { digest, keyVersion } = deps.digest(email);
      await spend(
        deps.limiter,
        deps.key('newsletter-client', clientAddress),
        NEWSLETTER_CLIENT_RULE,
      );
      await spend(
        deps.limiter,
        deps.key('newsletter-address', digest),
        NEWSLETTER_ADDRESS_RULE,
      );

      // An address the provider bounced or that complained is never written
      // to again — and is told nothing different.
      if (await deps.suppressed(email)) return;

      const result = await run(
        deps.newsletter.submit({
          subscriberId: ids(),
          emailDigest: digest,
          digestKeyVersion: keyVersion,
          email,
          locale,
          issue,
          at: now(),
        }),
      );
      if (result.outcome !== 'issued') return;

      // Derived work, after the subscription committed: a failure here leaves
      // it pending, and a later submission issues a fresh link.
      await deps.enqueue({
        recipient: email,
        sourceReference: `newsletter:${result.subscriberId}:${result.generation}`,
        idempotencyKey: `newsletter.confirmation:${result.subscriberId}:${result.generation}`,
      });
    },

    /**
     * Renders an owed confirmation at send time. Only the exact issuance that
     * is still pending and unexpired is owed anything; a resubmission, a
     * confirmation, an unsubscribe or a lapse makes the message moot.
     */
    async resolveDelivery(delivery: DeliveryRecord): Promise<DeliveryResolution> {
      const match = /^newsletter:([0-9a-f-]{36}):([1-9][0-9]{0,9})$/.exec(
        delivery.sourceReference,
      );
      const subscriberId = match?.[1];
      const generation = Number(match?.[2]);
      if (subscriberId === undefined || !Number.isSafeInteger(generation))
        return { outcome: 'nothing-owed' };
      const source = await run(deps.newsletter.deliverySource(subscriberId, generation));
      if (source === null || source.tokenKeyVersion !== deps.tokenKey.version)
        return { outcome: 'nothing-owed' };

      const link = (path: string, purpose: NewsletterTokenPurpose, salt: string) => {
        const url = new URL(`/${source.locale}/newsletter/${path}`, deps.baseUrl);
        url.searchParams.set(
          'token',
          token(purpose, source.subscriberId, generation, salt),
        );
        return url.toString();
      };
      return {
        outcome: 'send',
        message: renderNewsletterConfirmation({
          locale: source.locale,
          recipient: source.email,
          confirmUrl: link('confirm', 'confirm', source.confirmSalt),
          unsubscribeUrl: link('unsubscribe', 'unsubscribe', source.unsubscribeSalt),
        }),
      };
    },

    /** Consumes a confirmation link — once. */
    async confirm(value: unknown, clientAddress: string): Promise<NewsletterOutcome> {
      await spend(
        deps.limiter,
        deps.key('newsletter-link', clientAddress),
        NEWSLETTER_LINK_RULE,
      );
      const tokenHash = presented(value);
      if (tokenHash === null) return 'invalid';
      const at = now();
      const email = await run(deps.newsletter.confirmationAddress(tokenHash, at));
      if (email === null || (await deps.suppressed(email))) return 'invalid';
      return (await run(deps.newsletter.confirm(tokenHash, at)))
        ? 'confirmed'
        : 'invalid';
    },

    /** Unsubscribes — no account, idempotent, and marketing mail only. */
    async unsubscribe(value: unknown, clientAddress: string): Promise<NewsletterOutcome> {
      await spend(
        deps.limiter,
        deps.key('newsletter-link', clientAddress),
        NEWSLETTER_LINK_RULE,
      );
      const tokenHash = presented(value);
      if (tokenHash === null) return 'invalid';
      return (await run(deps.newsletter.unsubscribe(tokenHash, now())))
        ? 'unsubscribed'
        : 'invalid';
    },

    /** Retires lapsed confirmations: the unconfirmed address is dropped. Bounded. */
    async expireLapsed(): Promise<number> {
      return run(deps.newsletter.expireLapsed(now(), EXPIRY_BATCH));
    },

    /* ---- Operators: `newsletter.read` / `newsletter.operate` ------------- */

    async counts(actor: PersonalActor): Promise<NewsletterCounts> {
      await operator(actor, NEWSLETTER_PERMISSIONS.read);
      return run(deps.newsletter.counts());
    },

    async list(
      actor: PersonalActor,
      state: unknown,
      offset: number,
    ): Promise<NewsletterAdminPage> {
      await operator(actor, NEWSLETTER_PERMISSIONS.read);
      const filter = (NEWSLETTER_STATES as readonly string[]).includes(state as string)
        ? (state as NewsletterState)
        : null;
      return run(deps.newsletter.list(filter, safeOffset(offset)));
    },

    async suppress(actor: PersonalActor, input: unknown): Promise<void> {
      await operator(actor, NEWSLETTER_PERMISSIONS.operate);
      const value = newsletterOperationSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await run(deps.newsletter.suppress(actor.accountId, value.data, now()));
    },

    async reinstate(actor: PersonalActor, input: unknown): Promise<void> {
      await operator(actor, NEWSLETTER_PERMISSIONS.operate);
      const value = newsletterOperationSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await run(deps.newsletter.reinstate(actor.accountId, value.data, now()));
    },
  };
}

export type NewsletterService = ReturnType<typeof createNewsletterService>;
