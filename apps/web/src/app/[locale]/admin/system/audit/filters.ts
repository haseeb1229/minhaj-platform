/**
 * The audit record's filters, read from the query (R2).
 *
 * Every value is validated to the shape the record can hold before it reaches
 * the read, and a value that does not fit is dropped — the filter is simply
 * not applied — rather than passed on: the listing is the audit record, and
 * nothing a URL says should widen or bend it.
 *
 *   `action`  a PREFIX of action names: letters, digits, `.`, `_`, `-`;
 *   `actor`   an account identifier: letters, digits, `_`, `-`;
 *   `from`    a calendar day, `YYYY-MM-DD`, inclusive, from 00:00 UTC;
 *   `to`      a calendar day, inclusive — the read's exclusive end is the
 *             following midnight, UTC.
 *
 * A range given backwards is put the right way round rather than answering
 * nothing.
 */

type Query = Record<string, string | string[] | undefined>;

export interface AuditFilters {
  readonly action: string | null;
  readonly actorId: string | null;
  /** The days as entered, for the form and the pager's links. */
  readonly fromDay: string | null;
  readonly toDay: string | null;
  /** The bounds the read takes. */
  readonly from: Date | null;
  readonly to: Date | null;
}

const ACTION = /^[A-Za-z0-9._-]{1,128}$/;
const ACTOR = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function single(query: Query, key: string): string | null {
  const raw = query[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** A real calendar day as UTC midnight, or `null`. 2026-02-30 is not a day. */
export function utcDay(value: string | null): Date | null {
  if (value === null) return null;
  const match = DAY.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

export function readAuditFilters(query: Query): AuditFilters {
  const action = single(query, 'action');
  const actor = single(query, 'actor');
  let fromDay = single(query, 'from');
  let toDay = single(query, 'to');
  let from = utcDay(fromDay);
  let to = utcDay(toDay);
  if (from === null) fromDay = null;
  if (to === null) toDay = null;
  if (from !== null && to !== null && from > to) {
    [from, to] = [to, from];
    [fromDay, toDay] = [toDay, fromDay];
  }
  return {
    action: action !== null && ACTION.test(action) ? action : null,
    actorId: actor !== null && ACTOR.test(actor) ? actor : null,
    fromDay,
    toDay,
    from,
    to: to === null ? null : new Date(to.getTime() + DAY_MS),
  };
}
