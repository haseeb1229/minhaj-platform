import { describe, expect, it } from 'vitest';

import type { RunCounts } from '../../packages/contracts/src/migration/index.ts';
import {
  RECONCILIATION_DETAIL_MAX,
  reconcile,
  reconciliationDetail,
} from '../../apps/web/src/contexts/migration-provenance/domain/reconciliation.ts';

/** A balanced run: 10 discovered — 5 staged, 1 rejected, 2 unchanged, 1 errored after parsing, 1 excluded. */
const BALANCED: RunCounts = Object.freeze({
  discovered: 10,
  pending: 0,
  fetched: 10,
  parsed: 7,
  staged: 5,
  unchanged: 2,
  rejected: 1,
  errored: 1,
  excluded: 1,
  inconsistent: 0,
  reviewPending: 6,
  approved: 0,
  reviewRejected: 0,
  superseded: 0,
  published: 0,
  mapped: 0,
  merged: 0,
});

describe('reconcile', () => {
  it('balances an honest run', () => {
    expect(reconcile(BALANCED)).toEqual({ balanced: true, discrepancies: [] });
  });

  it('balances an empty run', () => {
    const empty = Object.fromEntries(
      Object.keys(BALANCED).map((key) => [key, 0]),
    ) as unknown as RunCounts;
    expect(reconcile(empty).balanced).toBe(true);
  });

  it.each<[string, Partial<RunCounts>, RegExp]>([
    ['a pending item', { pending: 1, discovered: 11 }, /^pending=1$/],
    ['a lost item', { discovered: 11 }, /^discovered=11/],
    ['an inconsistent item', { inconsistent: 1 }, /^inconsistent=1$/],
    ['fetched beyond discovered', { fetched: 11 }, /^fetched=11>discovered/],
    ['a staged item never fetched', { fetched: 7 }, /^fetched=7<obtained=8$/],
    ['a staged item never parsed', { parsed: 5 }, /^parsed=5<staged\+rejected=6$/],
    ['a parsed item unaccounted for', { parsed: 9 }, /^parsed=9>accounted=8$/],
    ['a revision in no review state', { reviewPending: 5 }, /^revisions=5/],
    [
      'publication beyond approval',
      { published: 1, mapped: 1 },
      /^published=1>approved=0$/,
    ],
    [
      'a published entry without its mapping',
      { approved: 1, reviewPending: 5, published: 1 },
      /^mapped=0≠published=1$/,
    ],
  ])('flags %s', (_name, change, expected) => {
    const verdict = reconcile({ ...BALANCED, ...change });
    expect(verdict.balanced).toBe(false);
    expect(verdict.discrepancies.some((entry) => expected.test(entry))).toBe(true);
  });

  it('refuses a count that is not a non-negative integer', () => {
    expect(reconcile({ ...BALANCED, staged: -1 }).discrepancies).toEqual([
      'staged-not-a-count',
    ]);
    expect(reconcile({ ...BALANCED, staged: 1.5 }).balanced).toBe(false);
  });

  it('accepts a published revision since superseded', () => {
    expect(
      reconcile({ ...BALANCED, reviewPending: 5, superseded: 1, published: 1, mapped: 1 })
        .balanced,
    ).toBe(true);
  });
});

describe('reconciliationDetail', () => {
  it('is bounded JSON carrying the verdict and the counts', () => {
    const detail = reconciliationDetail(BALANCED);
    expect(detail.length).toBeLessThanOrEqual(RECONCILIATION_DETAIL_MAX);
    const parsed = JSON.parse(detail) as { balanced: boolean; counts: RunCounts };
    expect(parsed.balanced).toBe(true);
    expect(parsed.counts.discovered).toBe(10);
  });

  it('stays bounded and valid for absurd counts', () => {
    const huge = Object.fromEntries(
      Object.keys(BALANCED).map((key) => [key, Number.MAX_SAFE_INTEGER]),
    ) as unknown as RunCounts;
    const detail = reconciliationDetail(huge);
    expect(detail.length).toBeLessThanOrEqual(RECONCILIATION_DETAIL_MAX);
    expect(JSON.parse(detail)).toMatchObject({ balanced: false });
  });
});
