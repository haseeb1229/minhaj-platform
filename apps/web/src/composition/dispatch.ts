import 'server-only';

import { after } from 'next/server';

import type { DeliveryRecord } from '@minhaj/contracts/platform';

import { failureLabel, isTransientDatabaseFailure } from './failure-label';
import { isLearningDeliveryPurpose } from '@/contexts/learning';
import { isMembershipDeliveryPurpose } from '@/contexts/membership';
import { identityRuntime } from './identity';
import { learningRuntime } from './learning';
import { appLogger } from './logging';
import { membershipRuntime } from './membership';
import { personalisationRuntime } from './personalisation';

/**
 * The outbound-communication dispatcher.
 *
 * Layer 4, and deliberately so. It is the only place that knows BOTH an
 * owner's rules and the platform's provider, which is exactly what lets the
 * two stay ignorant of each other: Identity decides what is owed and what it
 * says, the Layer-0 concern sends and records, and neither imports the other
 * (ARCHITECTURE.md §4.6.1).
 *
 * WHY THIS SHAPE AND NOT A QUEUE. Durable rows plus bounded scheduled dispatch
 * is the whole mechanism. No Redis, no queue product, no worker platform, no
 * event bus (§4.6.1, §8.5). What a queue would buy here is delivery semantics
 * the database already provides through a lease.
 *
 * IT IS NOT ATOMIC WITH ANYTHING. Sending is derived work. The authoritative
 * change committed already; this runs afterwards, and a failure degrades
 * delivery rather than correctness (§8.5).
 */

export interface DispatchSummary {
  readonly relayed: number;
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
  readonly abandoned: number;
  /** Owed, but not resolvable yet. Back on the schedule, not given up on. */
  readonly deferred: number;
}

/** How long a claim is held. Comfortably longer than a provider timeout. */
const LEASE_SECONDS = 60;

/** Deliveries per tick. Bounded so one tick cannot monopolise the process. */
const BATCH = 20;

/**
 * Identifies a failure without disclosing anything it carries.
 *
 * The CLASS ALONE is not operable. "PrismaClientKnownRequestError" names the
 * library that objected and nothing an operator can act on — a constraint
 * collision, a missing row and a deadlock are one word here and three
 * different repairs. Neither is Prisma's `code` enough on its own: everything
 * the driver rejects arrives as `P2010`, so a query that can NEVER succeed
 * logs exactly like a busy moment. `failure-label.ts` goes one level down for
 * the database's own numeric code and says which of the two this was
 * (SECURITY_BASELINE.md §19.2 — identifiers only, never a message or payload).
 */

/**
 * Runs one dispatch tick.
 *
 * Safe to call concurrently: the claim is a lease, so a second caller takes
 * different rows rather than the same ones.
 */
export async function dispatchOnce(): Promise<DispatchSummary> {
  const { identity, deliveries, suppression, provider } = identityRuntime();

  // Identity's committed notification intents become deliveries first, so a
  // notification committed in the same transaction as its security change is
  // picked up by this same tick rather than the next one.
  const relayed =
    (await identity.relayPendingIntents(BATCH)) +
    // THE THIRD OWNER (Phase 23). Learning's committed class intents — a
    // confirmed trial, a moved or cancelled class, a due reminder — become
    // deliveries by the same tick, after Learning re-checks what is still
    // owed and Identity resolves each recipient's current address.
    (await learningRuntime().communication.relayPendingIntents(BATCH)) +
    // THE FOURTH OWNER (Phase 26). Membership's committed application and
    // Membership intents — received, under review, decided, withdrawn by the
    // applicant, closed — become deliveries by the same tick, after
    // Membership re-checks that the record still stands where the message
    // says and Identity resolves each recipient's current address.
    (await membershipRuntime().communication.relayPendingIntents(BATCH));

  const claimed = await deliveries.claimDue({
    limit: BATCH,
    leaseSeconds: LEASE_SECONDS,
  });

  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let abandoned = 0;
  let deferred = 0;

  for (const delivery of claimed) {
    const outcome = await dispatchOne(delivery);

    if (outcome === 'sent') sent += 1;
    else if (outcome === 'failed') failed += 1;
    else if (outcome === 'suppressed') suppressed += 1;
    else if (outcome === 'deferred') deferred += 1;
    else abandoned += 1;
  }

  return {
    relayed,
    claimed: claimed.length,
    sent,
    failed,
    suppressed,
    abandoned,
    deferred,
  };

  async function dispatchOne(
    delivery: DeliveryRecord,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'abandoned' | 'deferred'> {
    // The OWNER resolves it. For a token message this re-materialises the SAME
    // outstanding token from Better Auth's own record — no mint, no rotation,
    // no expiry extension, and no bearer material was ever written anywhere
    // else to be read back (ARCHITECTURE.md §4.6.1).
    //
    // FOUR OWNERS, ONE PROVIDER. The newsletter confirmation is
    // Personalisation's marketing message; a class confirmation, change or
    // reminder is Learning's service mail; an application or Membership
    // update is Membership's service mail; everything else is Identity's
    // security and account service mail. Each owner resolves only its own,
    // and only the newsletter is ever withheld by a marketing suppression.
    const newsletter = delivery.purpose === 'newsletter.confirmation';
    const resolution = newsletter
      ? await personalisationRuntime().newsletter.resolveDelivery(delivery)
      : isLearningDeliveryPurpose(delivery.purpose)
        ? await learningRuntime().communication.resolveDelivery(delivery)
        : isMembershipDeliveryPurpose(delivery.purpose)
          ? await membershipRuntime().communication.resolveDelivery(delivery)
          : await identity.resolveDelivery(delivery);

    if (resolution.outcome === 'nothing-owed') {
      // Nothing is owed any more: the token was used or expired, the account
      // closed, the address changed. Retrying would produce the same answer
      // more slowly.
      await deliveries.markAbandoned({ id: delivery.id, reason: 'nothing_to_send' });
      return 'abandoned';
    }

    if (resolution.outcome === 'not-yet') {
      // Owed, but not resolvable yet — a token delivery whose issuance has not
      // committed. Abandoning it here would discard the message the ordering
      // in `issueAndEnqueue` exists to protect, so it goes back on the
      // schedule and the owner is asked again.
      await deliveries.markAttemptFailed({
        id: delivery.id,
        failureClass: 'transient',
        failureCode: 'awaiting_source',
        retryAfterSeconds: null,
      });
      return 'deferred';
    }

    const resolved = resolution.message;

    if (
      await suppression.isSuppressed({
        recipient: resolved.recipient,
        // Marketing mail is withheld by ANY bounce or complaint; security and
        // account-service mail only by a transactional one, so no newsletter
        // state can ever withhold a verification or reset message.
        scope: newsletter ? 'marketing' : 'transactional',
      })
    ) {
      // The provider already told us this address rejects mail. Writing to it
      // again damages sending reputation for everyone else on the domain.
      await deliveries.markSuppressed(delivery.id);
      return 'suppressed';
    }

    const outcome = await provider.send({
      to: resolved.recipient,
      subject: resolved.subject,
      html: resolved.html,
      text: resolved.text,
      // The SAME key the row carries, so an ambiguous outcome — the request
      // arrived but the response did not — cannot produce a second message.
      idempotencyKey: delivery.idempotencyKey,
    });

    if (outcome.outcome === 'accepted') {
      await deliveries.markSent({
        id: delivery.id,
        providerMessageId: outcome.providerMessageId,
      });
      return 'sent';
    }

    await deliveries.markAttemptFailed({
      id: delivery.id,
      failureClass: outcome.failureClass,
      failureCode: outcome.failureCode,
      retryAfterSeconds: null,
    });
    return 'failed';
  }
}

/* ===========================================================================
 * What actually runs a tick
 * ========================================================================= */

/**
 * Runs a tick AFTER the current response has been sent.
 *
 * Called by the Server Actions that enqueue mail, so a verification link is on
 * its way within the same request rather than at the next scheduled tick. The
 * person waiting for it is the reason.
 *
 * It runs after the response, deliberately. Sending is derived work
 * (ARCHITECTURE.md §8.5): the authoritative change has already committed, and
 * making someone wait for a provider round-trip to see "check your email"
 * would put an external service on the critical path of a form submission.
 *
 * A failure here does not propagate, and that is the correct behaviour rather
 * than laziness: the delivery row is durable and already scheduled, so the
 * retry happens regardless. Throwing would turn a transient provider fault
 * into a failed request for an operation that in fact succeeded.
 *
 * It is NOT, however, discarded. `transient` says whether this will clear on
 * its own — a deadlock victim will, an invalid statement never will — so a
 * permanent fault in the dispatch path cannot spend a week being read as load.
 */
export function dispatchAfterResponse(): void {
  after(async () => {
    try {
      await dispatchOnce();
    } catch (error) {
      reportDispatchFailure(error, 'Outbound dispatch tick failed.');
    }
  });
}

/**
 * Logs a dispatch failure at a severity that matches what it is.
 *
 * Contention is expected under load and the next tick handles it; anything
 * else is a defect, and logging the two at the same level is how the second
 * hides inside the first.
 */
function reportDispatchFailure(error: unknown, message: string): void {
  const transient = isTransientDatabaseFailure(error);
  const detail = { error: failureLabel(error), transient };

  if (transient) appLogger().warn(detail, message);
  else appLogger().error(detail, message);
}

/**
 * How often the retry sweep runs, in milliseconds.
 *
 * The `after`-response tick above covers the FIRST attempt at everything. This
 * sweep exists for the second and later ones: a message whose first attempt hit
 * a provider outage must eventually go out even if nobody submits another form
 * (ARCHITECTURE.md §4.6.1 — bounded retry with backoff).
 *
 * Sixty seconds is comfortably shorter than the smallest backoff step, so a due
 * delivery waits for its own schedule rather than for this interval.
 */
const SWEEP_MS = 60_000;

let sweep: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the retry sweep for this process.
 *
 * Called once from `instrumentation.ts`, which Next runs per server process —
 * NOT from `identityRuntime()`, because a function that returns services should
 * not also start timers, and a caller reading configuration should not
 * discover it has started a background job.
 *
 * SAFE WITH MANY INSTANCES. Claiming is a lease, so a second process takes
 * different rows rather than the same ones, and a crashed process's claim
 * expires and becomes due again (§3.5.1). No coordination, no leader election,
 * no queue product.
 *
 * `unref()` so the timer never holds the process open: a container that has
 * been asked to stop must stop.
 */
export function startDispatchSweep(): void {
  if (sweep !== null) return;

  sweep = setInterval(() => {
    void dispatchOnce().catch((error: unknown) => {
      reportDispatchFailure(error, 'Scheduled outbound dispatch failed.');
    });
  }, SWEEP_MS);

  sweep.unref();
}

/** Stops the sweep. For tests and for an orderly shutdown. */
export function stopDispatchSweep(): void {
  if (sweep === null) return;

  clearInterval(sweep);
  sweep = null;
}
