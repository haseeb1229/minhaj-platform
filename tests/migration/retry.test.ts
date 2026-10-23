import { describe, expect, it } from 'vitest';

import {
  BACKOFF_CAP_MS,
  backoffMs,
  classifyOutcome,
  classifyStatus,
  isRetryEligible,
  parseRetryAfter,
  retryDecision,
} from '../../apps/web/src/contexts/migration-provenance/domain/retry.ts';

const NOW = new Date('2026-10-20T12:00:00Z');
const zero = () => 0;

describe('retry classification', () => {
  it('retries exactly 408, 429, 500, 502, 503 and 504', () => {
    for (const code of [408, 429, 500, 502, 503, 504])
      expect(classifyStatus(code).retryable).toBe(true);
    for (const code of [
      400, 401, 403, 404, 405, 409, 410, 418, 422, 451, 501, 505, 599, 301, 302,
    ])
      expect(classifyStatus(code).retryable).toBe(false);
  });

  it('classifies access failures as never retry-eligible', () => {
    expect(classifyStatus(401).classification).toBe('access-denied');
    expect(classifyStatus(403).classification).toBe('access-denied');
    expect(isRetryEligible('access-denied')).toBe(false);
  });

  it('names permanent failures precisely', () => {
    expect(classifyStatus(404).classification).toBe('not-found');
    expect(classifyStatus(410).classification).toBe('gone');
    expect(classifyStatus(422).classification).toBe('client-error');
    expect(classifyStatus(429).classification).toBe('rate-limited');
    expect(classifyStatus(408).classification).toBe('timeout');
    expect(classifyStatus(503).classification).toBe('server-error');
    expect(classifyStatus(302).classification).toBe('redirect-refused');
  });

  it('retries network failures and timeouts but never a policy refusal', () => {
    expect(
      classifyOutcome({
        kind: 'failure',
        classification: 'network',
        requestedUrl: 'u',
        detail: 'd',
      }).retryable,
    ).toBe(true);
    expect(
      classifyOutcome({
        kind: 'failure',
        classification: 'timeout',
        requestedUrl: 'u',
        detail: 'd',
      }).retryable,
    ).toBe(true);
    for (const classification of [
      'redirect-refused',
      'address-refused',
      'scope-refused',
      'too-large',
      'unsupported-type',
    ] as const)
      expect(
        classifyOutcome({
          kind: 'refused',
          classification,
          requestedUrl: 'u',
          detail: 'd',
        }),
      ).toEqual({
        classification,
        retryable: false,
        httpStatus: null,
      });
  });
});

describe('Retry-After', () => {
  it('accepts delta-seconds', () => {
    expect(parseRetryAfter('0', NOW)).toBe(0);
    expect(parseRetryAfter('120', NOW)).toBe(120_000);
    expect(parseRetryAfter(' 7 ', NOW)).toBe(7_000);
  });

  it('accepts an IMF-fixdate HTTP-date in the future', () => {
    expect(parseRetryAfter('Tue, 20 Oct 2026 12:00:30 GMT', NOW)).toBe(30_000);
  });

  it('returns null for malformed, negative, past and absurd values', () => {
    for (const value of [
      '',
      '-5',
      '1.5',
      'soon',
      '5s',
      '0x10',
      'Tue, 20 Oct 2026 11:00:00 GMT',
      '86401',
      '99999999999999999999',
      'Tuesday, 20-Oct-26 12:00:30 GMT',
      null,
    ])
      expect(parseRetryAfter(value, NOW)).toBeNull();
  });
});

describe('backoff', () => {
  it('doubles from 500 ms, adds at most 50% jitter, and caps at 30 s', () => {
    expect(backoffMs(1, zero)).toBe(500);
    expect(backoffMs(2, zero)).toBe(1000);
    expect(backoffMs(3, zero)).toBe(2000);
    expect(backoffMs(1, () => 1)).toBe(750);
    expect(backoffMs(2, () => 0.5)).toBe(1250);
    expect(backoffMs(10, zero)).toBe(BACKOFF_CAP_MS);
    expect(backoffMs(60, () => 1)).toBe(BACKOFF_CAP_MS);
  });
});

describe('retryDecision', () => {
  const transient = classifyStatus(503);
  it('gives up on a permanent failure and when the attempt budget is spent', () => {
    expect(
      retryDecision({
        failure: classifyStatus(404),
        attempt: 1,
        maxAttempts: 5,
        retryAfter: null,
        now: NOW,
        random: zero,
      }),
    ).toEqual({ kind: 'give-up' });
    expect(
      retryDecision({
        failure: transient,
        attempt: 3,
        maxAttempts: 3,
        retryAfter: null,
        now: NOW,
        random: zero,
      }),
    ).toEqual({ kind: 'give-up' });
  });

  it('waits what a valid Retry-After asks', () => {
    expect(
      retryDecision({
        failure: classifyStatus(429),
        attempt: 1,
        maxAttempts: 3,
        retryAfter: '12',
        now: NOW,
        random: zero,
      }),
    ).toEqual({ kind: 'wait', ms: 12_000 });
  });

  it('defers instead of sleeping beyond 300 s', () => {
    expect(
      retryDecision({
        failure: classifyStatus(429),
        attempt: 1,
        maxAttempts: 3,
        retryAfter: '301',
        now: NOW,
        random: zero,
      }),
    ).toEqual({
      kind: 'defer',
      until: new Date(NOW.getTime() + 301_000),
    });
    expect(
      retryDecision({
        failure: classifyStatus(429),
        attempt: 1,
        maxAttempts: 3,
        retryAfter: '300',
        now: NOW,
        random: zero,
      }),
    ).toEqual({ kind: 'wait', ms: 300_000 });
  });

  it('falls back to backoff when Retry-After is malformed', () => {
    expect(
      retryDecision({
        failure: transient,
        attempt: 2,
        maxAttempts: 3,
        retryAfter: 'later',
        now: NOW,
        random: zero,
      }),
    ).toEqual({ kind: 'wait', ms: 1000 });
  });
});
