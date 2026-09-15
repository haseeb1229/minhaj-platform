import 'server-only';

/**
 * Turns a thrown value into a label an operator can act on, WITHOUT disclosing
 * anything it carries.
 *
 * Its own module, and pure, because the alternative is the reason it exists.
 * The dispatcher's sweep must not die of a transient fault, so it catches and
 * logs — and a log line is then the ONLY account of what happened. When that
 * line says less than the failure knew, the failure is not swallowed so much
 * as silently downgraded, and the difference between "the database was busy"
 * and "this query is invalid" disappears into one word that reads like neither.
 *
 * WHAT WENT WRONG THE FIRST TIME. The label was `error.name` plus Prisma's
 * `code`, which for anything the driver rejects is the single value `P2010`,
 * "raw query failed". A genuine defect — a claim whose lock hint was illegal at
 * the isolation level the pooled connection happened to be holding, SQL Server
 * error 650 — logged identically to a deadlock, and so read as ordinary
 * contention for as long as nobody looked. The native code was in the error the
 * whole time, one level further down, and nothing went and got it.
 *
 * WHAT IS SAFE TO SAY. Identifiers, and only identifiers:
 *
 *   - `error.name` — a constructor name;
 *   - Prisma's `code` — a fixed catalogue value (`P2002`, `P2010`, …);
 *   - the driver's `kind` — `mssql`;
 *   - the database's own NUMERIC error code — `650`, `1205`, `2627`.
 *
 * No message, no `meta` payload, no query text, no parameters. Those are the
 * parts that can hold an address, a digest or a value somebody typed
 * (SECURITY_BASELINE.md §19.2) — and the numeric code is strictly more
 * operable than the sentence around it anyway: 1205 is a deadlock and will
 * pass, 650 is a statement that can never succeed and will not.
 */

/** Reads a property off an unknown value without asserting its shape. */
function property(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[name];
}

/**
 * Digs out the database's own error code, if the failure carries one.
 *
 * Prisma's driver adapters wrap the driver's error and hang it off `meta`, so
 * the native cause sits at `meta.driverAdapterError.cause`. Walked
 * DEFENSIVELY: every level is optional, because this runs inside a catch block
 * and a labeller that throws while labelling a failure destroys the only
 * record of the original one.
 */
function nativeCause(error: unknown): string | null {
  const cause = property(
    property(property(error, 'meta'), 'driverAdapterError'),
    'cause',
  );

  const kind = property(cause, 'kind');
  const code = property(cause, 'code');

  // NUMBERS ONLY. A driver's `code` is a string in some engines and can carry
  // a fragment of the statement; a number cannot carry anything but itself.
  if (typeof code !== 'number') return null;

  return typeof kind === 'string' ? `${kind}:${code}` : `${code}`;
}

/**
 * Labels a failure for an internal log line.
 *
 * Shapes, in increasing detail:
 *
 *   - `unknown`                              — not an `Error`
 *   - `PrismaClientKnownRequestError:P2002`  — Prisma classified it
 *   - `PrismaClientKnownRequestError:P2010/mssql:650` — and the engine did too
 */
export function failureLabel(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';

  const code = property(error, 'code');
  const base = typeof code === 'string' ? `${error.name}:${code}` : error.name;

  const native = nativeCause(error);
  return native === null ? base : `${base}/${native}`;
}

/**
 * Does this failure describe ordinary contention?
 *
 * The distinction the dispatcher needs and could not previously make. A
 * deadlock victim (1205), a lock request timeout (1222) and a snapshot update
 * conflict (3960) are the database doing its job under load: the work is
 * undamaged and the next tick picks it up. EVERYTHING ELSE — an illegal lock
 * hint (650), an invalid object (208), a constraint that should not have been
 * reachable (2627) — is a defect that will recur identically on every retry.
 *
 * Both are logged either way. This says which one an operator is reading, so a
 * permanent fault cannot spend a week looking like a busy afternoon.
 */
const TRANSIENT_DATABASE_CODES: ReadonlySet<number> = new Set([1205, 1222, 3960]);

export function isTransientDatabaseFailure(error: unknown): boolean {
  const cause = property(
    property(property(error, 'meta'), 'driverAdapterError'),
    'cause',
  );
  const code = property(cause, 'code');

  if (typeof code === 'number') return TRANSIENT_DATABASE_CODES.has(code);

  // Prisma's own catalogue value for a transaction that must be retried.
  return property(error, 'code') === 'P2034';
}
