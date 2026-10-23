import type { ErrorClassification, FetchOutcome } from '@minhaj/contracts/migration';

/**
 * THE RETRY POLICY (MIGRATION_STRATEGY.md §4.2) — pure, so every branch is
 * proved by a unit test and every wait is the caller's injected `sleep`.
 *
 * Only a transient failure is retried: 408, 429, 500, 502, 503, 504, and a
 * network failure or timeout. A 401 or 403 is an access decision and is never
 * retried — retrying it edges toward circumventing that decision — and no
 * other 4xx is retried either: it is pointless load on the source.
 */

export interface FailureClass {
  readonly classification: ErrorClassification;
  /** Worth another attempt now (within the source's attempt budget). */
  readonly retryable: boolean;
  readonly httpStatus: number | null;
}

const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** Is this an HTTP status the platform treats as a success with a body to keep? */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

/** The classification of one non-success HTTP status. */
export function classifyStatus(status: number): FailureClass {
  const httpStatus =
    Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const retryable = TRANSIENT_STATUSES.has(status);
  if (status === 408) return { classification: 'timeout', retryable, httpStatus };
  if (status === 429) return { classification: 'rate-limited', retryable, httpStatus };
  if (status >= 500 && status <= 599)
    return { classification: 'server-error', retryable, httpStatus };
  if (status === 401 || status === 403)
    return { classification: 'access-denied', retryable: false, httpStatus };
  if (status === 404)
    return { classification: 'not-found', retryable: false, httpStatus };
  if (status === 410) return { classification: 'gone', retryable: false, httpStatus };
  // A redirect reaching the pipeline is one the safe fetch boundary did not follow.
  if (status >= 300 && status <= 399)
    return { classification: 'redirect-refused', retryable: false, httpStatus };
  // A success the adapter could not use, or anything else a server should not send.
  if (isSuccessStatus(status))
    return { classification: 'parse-failed', retryable: false, httpStatus };
  return { classification: 'client-error', retryable: false, httpStatus };
}

/** The classification of one failed fetch exchange. */
export function classifyOutcome(outcome: FetchOutcome): FailureClass {
  switch (outcome.kind) {
    case 'response':
      return classifyStatus(outcome.status);
    case 'refused':
      // A policy refusal (scope, address, redirect, size, type) is final.
      return {
        classification: outcome.classification,
        retryable: false,
        httpStatus: null,
      };
    case 'failure':
      return {
        classification: outcome.classification,
        retryable: true,
        httpStatus: null,
      };
  }
}

/** Is this classification ever worth a person's "retry"? Access failures never are. */
export function isRetryEligible(classification: ErrorClassification): boolean {
  return (
    classification === 'network' ||
    classification === 'timeout' ||
    classification === 'rate-limited' ||
    classification === 'server-error' ||
    classification === 'asset-unavailable' ||
    classification === 'target-unavailable'
  );
}

/** Backoff: 500 ms doubling per attempt, up to 50% jitter, never above 30 s. */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 30_000;
/** A server asking for a longer pause than this defers the item instead of holding the run. */
export const RETRY_DEFER_THRESHOLD_MS = 300_000;
/** A Retry-After further away than a day is not believed. */
export const RETRY_AFTER_ABSURD_MS = 86_400_000;

/**
 * `Retry-After` as milliseconds from `now`: delta-seconds or an IMF-fixdate
 * HTTP-date (RFC 9110 §10.2.3). `null` — fall back to backoff — for anything
 * malformed, negative (a date in the past) or absurd (beyond a day).
 */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (text.length === 0 || text.length > 64) return null;
  let ms: number;
  if (/^[0-9]+$/.test(text)) {
    ms = Number(text) * 1000;
  } else if (
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(
      text,
    )
  ) {
    const at = Date.parse(text);
    if (Number.isNaN(at)) return null;
    ms = at - now.getTime();
  } else {
    return null;
  }
  if (!Number.isFinite(ms) || ms < 0 || ms > RETRY_AFTER_ABSURD_MS) return null;
  return ms;
}

/** Exponential backoff for the `attempt`-th failure (1-based), with injected jitter. */
export function backoffMs(attempt: number, random: () => number): number {
  const exponent = Math.max(0, Math.min(attempt, 30) - 1);
  const base = BACKOFF_BASE_MS * 2 ** exponent;
  const jitter = Math.min(Math.max(random(), 0), 1) * 0.5 * base;
  return Math.min(BACKOFF_CAP_MS, Math.round(base + jitter));
}

export type RetryDecision =
  /** Not transient, or the attempt budget is spent: record the failure. */
  | { readonly kind: 'give-up' }
  /** Wait this long, then try again in this run. */
  | { readonly kind: 'wait'; readonly ms: number }
  /** The server asked for a long pause: leave the item pending until then. */
  | { readonly kind: 'defer'; readonly until: Date };

/**
 * What to do after the `attempt`-th failed attempt (1-based) of at most
 * `maxAttempts`. A valid Retry-After is respected; beyond the defer threshold
 * the item is deferred rather than slept on; otherwise exponential backoff.
 */
export function retryDecision(input: {
  readonly failure: FailureClass;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryAfter: string | null;
  readonly now: Date;
  readonly random: () => number;
}): RetryDecision {
  if (!input.failure.retryable || input.attempt >= input.maxAttempts)
    return { kind: 'give-up' };
  const asked = parseRetryAfter(input.retryAfter, input.now);
  if (asked !== null) {
    if (asked > RETRY_DEFER_THRESHOLD_MS)
      return { kind: 'defer', until: new Date(input.now.getTime() + asked) };
    return { kind: 'wait', ms: asked };
  }
  return { kind: 'wait', ms: backoffMs(input.attempt, input.random) };
}
