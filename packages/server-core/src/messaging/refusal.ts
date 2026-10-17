import 'server-only';

import { MessagingRefusal, type MessagingRefusalReason } from './types.ts';

/**
 * The database's floor, told in the service's own refusal vocabulary.
 *
 * The persistence adapter answers through its port's outcomes wherever the
 * port has one; where it has none — a rule the migration enforced beneath the
 * adapter's own questions, typically a race lost to a concurrent writer — it
 * throws its `MessagingDataError`. This host cannot import that class (it
 * never depends on `@minhaj/database`), so the error is recognised by SHAPE:
 * its name and a string reason, nothing more. A forged error with that shape
 * can only ever turn into one of the refusals below, never into success.
 *
 * ONLY PERSON-FACING REASONS ARE MAPPED. Each one says something a caller can
 * honestly hear: a kind switched off underneath them or a participant row that
 * vanished is the same `not-found` the access decision already gives (so the
 * race cannot be used to probe); a write that met a closed conversation is
 * `closed`; a duplicate lost race is `conflict`; a malformed or unavailable
 * input is `invalid`. Every other reason — `immutable`, `evidence`, `open`,
 * `not-disposing` — means this service asked for something its own rules
 * forbid, which is a defect, so it is rethrown unchanged as an outage rather
 * than dressed up as a refusal the person could act on.
 */
const PERSON_FACING: ReadonlyMap<string, MessagingRefusalReason> = new Map([
  ['invalid', 'invalid'],
  ['not-activated', 'not-found'],
  ['closed', 'closed'],
  ['not-participant', 'not-found'],
  ['attachment-unavailable', 'invalid'],
  ['conflict', 'conflict'],
]);

/** The refusal a persistence data error stands for, or `null` when it is none. */
export function dataRefusal(error: unknown): MessagingRefusal | null {
  if (!(error instanceof Error) || error.name !== 'MessagingDataError') return null;
  const reason = (error as { reason?: unknown }).reason;
  if (typeof reason !== 'string') return null;
  const mapped = PERSON_FACING.get(reason);
  return mapped === undefined ? null : new MessagingRefusal(mapped);
}

/**
 * Runs one persistence write, turning a person-facing data error into its
 * refusal; anything else — another reason, an outage — propagates as thrown.
 */
export async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw dataRefusal(error) ?? error;
  }
}
