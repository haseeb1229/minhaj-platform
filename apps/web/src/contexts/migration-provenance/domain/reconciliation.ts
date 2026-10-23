import type { RunCounts } from '@minhaj/contracts/migration';

/**
 * RUN RECONCILIATION (MIGRATION_STRATEGY.md §6.1) — the arithmetic a run must
 * satisfy before anything it staged may be published. Pure: the adapter
 * counts, this decides.
 *
 * The equations, and why each holds for an honest run:
 *
 *  1. `pending = 0` — every discovered item reached a terminal outcome.
 *  2. `discovered = staged + unchanged + rejected + errored + excluded` — and
 *     therefore no item is lost between discovery and its outcome.
 *  3. `inconsistent = 0` — no item claims evidence its row does not carry.
 *  4. `fetched ≤ discovered`, and `fetched ≥ staged + rejected + unchanged`:
 *     a staged, rejected or unchanged item had its evidence obtained.
 *  5. `staged + rejected ≤ parsed ≤ staged + rejected + errored + excluded`:
 *     every staged or rejected item was parsed (the database's own CHECK),
 *     and an item parsed but not staged must have ended `errored` or
 *     `excluded` — an unchanged item is detected by checksum BEFORE parsing,
 *     so it is never parsed in that run.
 *  6. `fetched ≥ parsed` — nothing is parsed without evidence.
 *  7. `reviewPending + approved + reviewRejected + superseded = staged +
 *     rejected` — every revision this run produced is in exactly one review
 *     state (each staged or rejected item produced exactly one revision).
 *  8. `published ≤ approved + superseded` — only an approved revision is
 *     published, and a published one may since have been superseded by a
 *     later run's revision of the same record.
 *  9. `mapped = published` — every published entry wrote its legacy mapping.
 */
export interface Reconciliation {
  readonly balanced: boolean;
  /** Machine-readable descriptions of each failed equation; empty when balanced. */
  readonly discrepancies: readonly string[];
}

const FIELDS = Object.freeze([
  'discovered',
  'pending',
  'fetched',
  'parsed',
  'staged',
  'unchanged',
  'rejected',
  'errored',
  'excluded',
  'inconsistent',
  'reviewPending',
  'approved',
  'reviewRejected',
  'superseded',
  'published',
  'mapped',
  'merged',
] as const satisfies readonly (keyof RunCounts)[]);

export function reconcile(counts: RunCounts): Reconciliation {
  const discrepancies: string[] = [];
  for (const field of FIELDS) {
    const value = counts[field];
    if (!Number.isSafeInteger(value) || value < 0)
      discrepancies.push(`${field}-not-a-count`);
  }
  if (discrepancies.length > 0) return { balanced: false, discrepancies };

  const terminal =
    counts.staged + counts.unchanged + counts.rejected + counts.errored + counts.excluded;
  const produced = counts.staged + counts.rejected;
  const reviewed =
    counts.reviewPending + counts.approved + counts.reviewRejected + counts.superseded;

  if (counts.pending !== 0) discrepancies.push(`pending=${counts.pending}`);
  // With `pending = 0` (checked above) this is equation 2 exactly.
  if (counts.discovered !== terminal + counts.pending)
    discrepancies.push(
      `discovered=${counts.discovered}≠outcomes=${terminal + counts.pending}`,
    );
  if (counts.inconsistent !== 0)
    discrepancies.push(`inconsistent=${counts.inconsistent}`);
  if (counts.fetched > counts.discovered)
    discrepancies.push(`fetched=${counts.fetched}>discovered=${counts.discovered}`);
  if (counts.fetched < produced + counts.unchanged)
    discrepancies.push(
      `fetched=${counts.fetched}<obtained=${produced + counts.unchanged}`,
    );
  if (counts.parsed < produced)
    discrepancies.push(`parsed=${counts.parsed}<staged+rejected=${produced}`);
  if (counts.parsed > produced + counts.errored + counts.excluded)
    discrepancies.push(
      `parsed=${counts.parsed}>accounted=${produced + counts.errored + counts.excluded}`,
    );
  if (counts.fetched < counts.parsed)
    discrepancies.push(`fetched=${counts.fetched}<parsed=${counts.parsed}`);
  if (reviewed !== produced)
    discrepancies.push(`revisions=${reviewed}≠staged+rejected=${produced}`);
  if (counts.published > counts.approved + counts.superseded)
    discrepancies.push(
      `published=${counts.published}>approved=${counts.approved + counts.superseded}`,
    );
  if (counts.mapped !== counts.published)
    discrepancies.push(`mapped=${counts.mapped}≠published=${counts.published}`);

  return { balanced: discrepancies.length === 0, discrepancies };
}

/** The stored reconciliation detail's bound (the run's column). */
export const RECONCILIATION_DETAIL_MAX = 2000;

/**
 * The verdict, its discrepancies and the counts as one JSON string of at most
 * 2000 characters: discrepancies are dropped from the end (and the drop
 * counted) until it fits, so the stored detail is always valid JSON.
 */
export function reconciliationDetail(counts: RunCounts): string {
  const verdict = reconcile(counts);
  const shape = (kept: readonly string[]) =>
    JSON.stringify({
      balanced: verdict.balanced,
      discrepancies: kept,
      omitted: verdict.discrepancies.length - kept.length,
      counts: Object.fromEntries(FIELDS.map((field) => [field, counts[field]])),
    });
  let kept = verdict.discrepancies.map((entry) => entry.slice(0, 120));
  let detail = shape(kept);
  while (detail.length > RECONCILIATION_DETAIL_MAX && kept.length > 0) {
    kept = kept.slice(0, -1);
    detail = shape(kept);
  }
  if (detail.length > RECONCILIATION_DETAIL_MAX)
    return JSON.stringify({
      balanced: verdict.balanced,
      omitted: verdict.discrepancies.length,
    });
  return detail;
}
