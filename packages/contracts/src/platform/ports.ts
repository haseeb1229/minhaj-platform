/**
 * Layer-0 platform ports.
 *
 * Infrastructure is consumed through abstractions and owns no business
 * invariants (DOMAIN_MODEL.md §1.1, §2 rule 7). These interfaces are what a
 * bounded context depends on; the adapters behind them are private and are
 * never named by a context.
 *
 * Browser-safe: types only. The implementations are server-only, and the
 * boundary that keeps them there is the `exports` map plus the `server-only`
 * marker on each adapter — not this file.
 */

/* ===========================================================================
 * Email — the shared provider contract (ARCHITECTURE.md §4.6.1)
 * ========================================================================= */

/**
 * One outbound message, already rendered.
 *
 * The provider adapter receives finished content. It never decides WHETHER to
 * send, to whom, or what the message says — the originating context owns all
 * three, and an adapter that made any of those decisions would have become the
 * business layer.
 */
export interface OutboundMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /**
   * Stable across retries of the SAME message, so a provider that supports
   * idempotency cannot deliver it twice.
   */
  readonly idempotencyKey: string;
}

/**
 * How a send failed, in the only terms the retry policy needs.
 *
 * `transient` is retried with backoff; `permanent` never is. Collapsing the
 * two would either retry a rejected address forever or abandon a message on a
 * momentary network fault.
 */
export type DeliveryFailureClass = 'transient' | 'permanent';

export interface DeliveryAccepted {
  readonly outcome: 'accepted';
  /** The provider's own identifier, for correlating later provider events. */
  readonly providerMessageId: string;
}

export interface DeliveryRejected {
  readonly outcome: 'rejected';
  readonly failureClass: DeliveryFailureClass;
  /**
   * A short, normalised code — never a provider message body.
   *
   * Provider prose can contain the recipient address and occasionally the
   * content that was rejected, and this value reaches logs and an operator
   * surface (SECURITY_BASELINE.md §19.2).
   */
  readonly failureCode: string;
}

export type DeliveryOutcome = DeliveryAccepted | DeliveryRejected;

/** THE provider boundary. No business context may import a provider SDK. */
export interface EmailProviderPort {
  /** A stable name for the configured provider, for operator surfaces. */
  readonly providerName: string;
  /** Whether real sending is configured in this environment. */
  readonly available: boolean;
  send(message: OutboundMessage): Promise<DeliveryOutcome>;
}

/* ===========================================================================
 * Email — durable delivery state
 * ========================================================================= */

/** The security and account-service messages Identity owns. Never optional. */
export type IdentityDeliveryPurpose =
  | 'identity.email-verification'
  | 'identity.password-reset'
  | 'identity.email-change'
  | 'identity.password-changed'
  | 'identity.email-changed'
  | 'identity.account-closed'
  | 'identity.sessions-revoked'
  | 'identity.second-factor-changed';

/**
 * Message categories this platform sends.
 *
 * `newsletter.confirmation` is the double opt-in link Personalisation &
 * Notifications owns (DOMAIN_MODEL.md §14.5) — MARKETING mail, sent under the
 * marketing suppression scope, and a different class from every Identity
 * purpose, which no marketing unsubscribe or suppression can touch.
 */
/** Learning's service mail (Phase 23) — transactional, never marketing. */
export type LearningDeliveryPurpose =
  | 'learning.booking-confirmed'
  | 'learning.session-rescheduled'
  | 'learning.session-cancelled'
  | 'learning.class-reminder';

export type DeliveryPurpose =
  IdentityDeliveryPurpose | 'newsletter.confirmation' | LearningDeliveryPurpose;

export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed';

/**
 * A delivery the platform owes someone.
 *
 * NOTE WHAT IS ABSENT: the recipient address, and the message. Layer 0 records
 * THAT a message of a given purpose is owed and how delivery went; it never
 * learns who it is for or what it says.
 *
 * `sourceReference` is an opaque handle back to the OWNING context's
 * authoritative state. At send time the dispatcher hands it back to that owner,
 * which resolves the current recipient and renders the content. That is not
 * indirection for its own sake — it means a delivery retried an hour later goes
 * to the address the account has NOW, and a closed account's outstanding mail
 * resolves to nothing rather than to a stale address (ARCHITECTURE.md §4.6.1).
 */
export interface DeliveryRecord {
  readonly id: string;
  readonly purpose: DeliveryPurpose;
  readonly sourceReference: string;
  readonly idempotencyKey: string;
  readonly status: DeliveryStatus;
  readonly attemptCount: number;
}

export interface EnqueueDelivery {
  readonly purpose: DeliveryPurpose;
  /**
   * Used ONLY to derive the keyed digest and never stored in clear. It is
   * accepted here so the store can recognise the same recipient across
   * deliveries without holding the address.
   */
  readonly recipient: string;
  readonly sourceReference: string;
  readonly idempotencyKey: string;
}

/**
 * Durable delivery state.
 *
 * Recipients are stored as a keyed digest: a raw address in an infrastructure
 * table is personal data nobody asked to keep, and a delivery table is exactly
 * the sort of place nobody thinks to look (SECURITY_BASELINE.md §19.2).
 */
export interface EmailDeliveryStorePort {
  /**
   * Records an owed message. Idempotent on `idempotencyKey`: enqueuing the
   * same message twice yields one row, so a retried relay cannot duplicate it.
   */
  enqueue(delivery: EnqueueDelivery): Promise<DeliveryRecord>;

  /**
   * Claims due deliveries under a LEASE.
   *
   * The lease is what makes a crashed dispatcher recoverable and a second
   * dispatcher safe: a claimed row becomes claimable again only once its lease
   * expires, so two processes can never send the same message concurrently
   * (ARCHITECTURE.md §3.5.1).
   */
  claimDue(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
  }): Promise<readonly DeliveryRecord[]>;

  markSent(input: {
    readonly id: string;
    readonly providerMessageId: string;
  }): Promise<void>;

  /** Schedules the next attempt, or gives up when the budget is spent. */
  markAttemptFailed(input: {
    readonly id: string;
    readonly failureClass: DeliveryFailureClass;
    readonly failureCode: string;
    readonly retryAfterSeconds: number | null;
  }): Promise<void>;

  /** The message is no longer owed — the address must not be written to. */
  markSuppressed(id: string): Promise<void>;

  /** Terminal, with no further attempt: the owner has nothing to send. */
  markAbandoned(input: { readonly id: string; readonly reason: string }): Promise<void>;

  findByIdempotencyKey(key: string): Promise<DeliveryRecord | null>;

  /** Operator view: pending, failed and suppressed mail. */
  summarise(): Promise<DeliverySummary>;

  /**
   * One bounded page of deliveries, for the operator surface.
   *
   * NOTE WHAT IT CANNOT RETURN: a recipient, a subject, a body or a token.
   * Layer 0 never learns any of them, so an operator screen built on this
   * shows what a stuck message IS and how it failed, and nothing about who it
   * was for (SECURITY_BASELINE.md §19.2).
   */
  listForOperator(input: {
    readonly status: DeliveryStatus | null;
    readonly limit: number;
    readonly offset: number;
  }): Promise<{
    readonly items: readonly DeliveryOperatorRecord[];
    readonly more: boolean;
  }>;

  /**
   * Puts a failed delivery back on the schedule, NOW.
   *
   * The one operator MUTATION this surface has, and deliberately the only one:
   * it changes when a message is next attempted and nothing about what it says
   * or who it reaches. It does not reset the attempt count, so a message that
   * has exhausted its budget cannot be retried forever by pressing a button.
   *
   * Returns false when the delivery is not in a state a retry means anything
   * for — already sent, or suppressed, which is a provider's decision and not
   * an operator's to overrule.
   */
  rescheduleDelivery(id: string): Promise<boolean>;

  /**
   * The purpose of the message a provider event names, by the provider's own
   * message id — so a complaint is scoped by WHAT was complained about. Null
   * when no delivery carries that id.
   */
  purposeOfProviderMessage(providerMessageId: string): Promise<DeliveryPurpose | null>;
}

export interface DeliverySummary {
  readonly pending: number;
  readonly failed: number;
  readonly suppressed: number;
}

/** A delivery as the operator surface shows it. Privacy-safe by construction. */
export interface DeliveryOperatorRecord {
  readonly id: string;
  readonly purpose: DeliveryPurpose;
  readonly status: DeliveryStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date | null;
  readonly failureClass: DeliveryFailureClass | null;
  /** A normalised CODE, never a provider message body. */
  readonly failureCode: string | null;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
}

/**
 * What an owning context returns when asked to resolve one of its deliveries.
 */
export interface ResolvedDelivery {
  readonly recipient: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * The owner's answer when the dispatcher asks what to send.
 *
 * THREE OUTCOMES, because two were not enough. `null` used to mean both "there
 * is nothing left to send" and "there is nothing to send YET", and the
 * dispatcher could only treat it as the first — so it abandoned the delivery
 * permanently. That is right for a token that was used or expired and wrong
 * for one whose issuance simply has not committed, which is a state the
 * platform creates on purpose: a token delivery is made durable BEFORE the
 * token is minted, so the two can never separate the dangerous way round
 * (ARCHITECTURE.md §4.6.1).
 *
 *   - `send`         — here is the message
 *   - `not-yet`      — owed, but not resolvable yet; try again on schedule
 *   - `nothing-owed` — genuinely finished; abandon it
 */
export type DeliveryResolution =
  | { readonly outcome: 'send'; readonly message: ResolvedDelivery }
  | { readonly outcome: 'not-yet' }
  | { readonly outcome: 'nothing-owed' };

/**
 * The seam between the Layer-4 dispatcher and a delivery's owner.
 *
 * The owner decides eligibility and content; Layer 0 sends. Neither knows the
 * other's rules (ARCHITECTURE.md §4.6.1).
 */
export interface DeliverySourcePort {
  resolve(delivery: DeliveryRecord): Promise<DeliveryResolution>;
}

/* ===========================================================================
 * Email — provider safety
 * ========================================================================= */

export type SuppressionReason = 'bounce' | 'complaint';

/**
 * Suppression scope.
 *
 * Typed from the first row so the distinction is structural: a future
 * marketing unsubscribe can never suppress verification, password reset or
 * account-security mail (ARCHITECTURE.md §4.6.1).
 */
export type SuppressionScope = 'transactional' | 'marketing';

/**
 * The scope a provider's bounce or complaint suppresses, by what it was about.
 *
 * A COMPLAINT about a newsletter message is a marketing complaint: anybody can
 * submit somebody else's address to `/newsletter`, and the confirmation that
 * person then marks as spam must never be able to silence their verification,
 * password-reset or account-security mail (ARCHITECTURE.md §4.6.1). Every other
 * complaint — and one whose message cannot be identified — is about account
 * mail and stays transactional. A BOUNCE says the mailbox does not take mail at
 * all, whatever was sent, so it is transactional whatever the purpose.
 */
export function suppressionScopeOf(
  reason: SuppressionReason,
  purpose: DeliveryPurpose | null,
): SuppressionScope {
  return reason === 'complaint' && purpose !== null && purpose.startsWith('newsletter.')
    ? 'marketing'
    : 'transactional';
}

/**
 * READ-ONLY, deliberately.
 *
 * Suppression is WRITTEN in exactly one place: the Layer-0 operation that
 * applies a provider event's effect and marks the event processed, in one
 * transaction (`ProviderEventPort.complete`). A standalone `suppress` here
 * would be a second write path into security-relevant state — one with no
 * caller, and without the atomicity that stops an applied suppression from
 * being forgotten or a forgotten one from being reported as applied.
 */
export interface EmailSuppressionPort {
  isSuppressed(input: {
    readonly recipient: string;
    readonly scope: SuppressionScope;
  }): Promise<boolean>;

  /**
   * How many addresses are suppressed, by reason and scope.
   *
   * COUNTS, not rows. An operator needs to know that complaints are rising and
   * that transactional suppression is or is not involved; listing the
   * suppressed recipients — even as keyed digests — would put a set of people
   * who bounced or complained on a screen, which is personal data nobody asked
   * this surface to display (SECURITY_BASELINE.md §19.2).
   */
  summarise(): Promise<readonly SuppressionCount[]>;
}

export interface SuppressionCount {
  readonly reason: SuppressionReason;
  readonly scope: SuppressionScope;
  readonly count: number;
}

/**
 * Inbound provider events (protocol class B, SECURITY_BASELINE.md §7.2).
 *
 * Only the identifiers and the type are kept — no arbitrary provider payload
 * is stored.
 */
/**
 * What a provider event is owed, beyond being recorded.
 *
 * `null` where the event type is one this platform records but does not act
 * on — which is most of them.
 */
export interface ProviderEventEffect {
  readonly recipient: string;
  readonly reason: SuppressionReason;
  readonly scope: SuppressionScope;
}

/**
 * Whether an event still needs its effect applied.
 *
 * TWO STATES, NOT ONE. "Seen before" and "finished" are different facts, and
 * conflating them is a data-loss bug rather than a tidiness one: a delivery
 * that recorded the event and then failed before its effect left a row that
 * said "already handled" about work nobody had done, and the provider's own
 * retry — the one mechanism that would have fixed it — was answered with
 * success (SECURITY_BASELINE.md §7.2).
 */
export type ProviderEventAdmission = 'process' | 'already-processed';

export interface ProviderEventPort {
  /**
   * Admits an event for processing, recording it if it is new.
   *
   * `'process'` for an event never seen AND for one recorded by an attempt
   * that did not finish. `'already-processed'` only once the effect is known
   * to have been applied.
   */
  admit(input: {
    readonly provider: string;
    readonly eventId: string;
    readonly type: string;
  }): Promise<ProviderEventAdmission>;

  /**
   * Applies the event's effect and marks it processed, ATOMICALLY.
   *
   * One transaction, so the two cannot separate across a crash in either
   * direction: no suppression without the completion that records it, and no
   * completion claiming an effect that did not land. Both tables belong to the
   * same Layer-0 concern, so this is single-owner atomicity and not a
   * cross-owner transaction (ARCHITECTURE.md §3.1.2.1).
   */
  complete(input: {
    readonly provider: string;
    readonly eventId: string;
    readonly effect: ProviderEventEffect | null;
  }): Promise<void>;
}

/* ===========================================================================
 * Auditing
 * ========================================================================= */

/**
 * One audit record.
 *
 * Actor and target are an identifier plus a type STRING, never a foreign key.
 * An audit record must stay readable and truthful after its subject is
 * renamed, closed or purged, and a foreign key would either block a lawful
 * purge or destroy the evidence the record exists to preserve
 * (SECURITY_BASELINE.md §13.3, DOMAIN_MODEL.md §6.2.1).
 */
export interface AuditEvent {
  readonly action: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  /**
   * WHICH FIELDS CHANGED and enough context to hold the actor accountable —
   * never a wholesale serialisation of the record, and never a credential,
   * token or message body (SECURITY_BASELINE.md §13.4, §19.2).
   */
  readonly before?: Readonly<Record<string, string>> | undefined;
  readonly after?: Readonly<Record<string, string>> | undefined;
  readonly authorisingSource?: string | undefined;
  readonly ipAddress?: string | undefined;
}

export interface AuditPort {
  record(event: AuditEvent): Promise<void>;
}

/* ===========================================================================
 * Rate limiting
 * ========================================================================= */

export interface RateLimitRule {
  /** Window length in seconds. */
  readonly window: number;
  /** Requests permitted within the window. */
  readonly max: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the window frees up, when denied. */
  readonly retryAfter: number | null;
}

/**
 * Atomic rate-limit consumption.
 *
 * One contract, two callers: the application's own mutations and Better Auth's
 * `customStorage.consume`, so there are never two limiters that can disagree
 * (ARCHITECTURE.md §4.5). Check and increment happen in ONE step — a separate
 * read and write cannot enforce a limit under concurrency.
 */
export interface RateLimiterPort {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
  /** Bounded removal of windows that have already expired. */
  purgeExpired(limit: number): Promise<number>;
}
