import 'server-only';

/**
 * Recognises the stable SQL Server refusals emitted by the Phase-3B taxonomy
 * triggers.
 *
 * WHY THIS IS NOT A `catch (error) { if (error.number === 51030) }`.
 *
 * Prisma and the MSSQL driver wrap server errors differently depending on how
 * the statement was issued — a model write, a raw write, a write inside an
 * interactive transaction — so the number may live on the outer error, on its
 * `meta`, or on a nested `cause` several levels down. An implementation that
 * read one of those places worked for the call sites that happened to be
 * written first and silently reported every other refusal as "unavailable",
 * which is the same message a connection failure produces.
 *
 * So the error GRAPH is walked, but a refusal is accepted only from the MSSQL
 * driver's structured error number. Message text is deliberately ignored: an
 * arbitrary Error can contain user-controlled text, and a value such as
 * `"topic 51030"` must not acquire the authority to masquerade as a database
 * invariant. Unrelated database failures are never collapsed into one of
 * these: no trusted numeric match means the original error is re-raised.
 *
 * This is the same device `../identity-access/final-administrator.ts` uses for
 * the Phase-2 invariant triggers, for the same reason.
 */

/** What a taxonomy trigger refused, as the context's failure vocabulary names it. */
export type TaxonomyRefusal =
  | 'hierarchy-cycle'
  | 'hierarchy-too-deep'
  | 'hierarchy-lock-unavailable'
  | 'fallback-translation-required';

/**
 * Each invariant's stable SQL Server number.
 *
 * ORDERED, and the order matters in one case only: a lock failure and a cycle
 * refusal come from the same trigger, and a lock failure means the invariant
 * could NOT BE EVALUATED. Reporting that as an ordinary validation refusal
 * would describe a check that did not happen as one that did, so it is
 * recognised separately and surfaces as unavailable.
 */
const SIGNATURES: readonly {
  readonly refusal: TaxonomyRefusal;
  readonly number: number;
}[] = [
  {
    refusal: 'hierarchy-cycle',
    number: 51030,
  },
  {
    refusal: 'hierarchy-lock-unavailable',
    number: 51031,
  },
  {
    refusal: 'hierarchy-too-deep',
    number: 51032,
  },
  {
    refusal: 'fallback-translation-required',
    number: 51033,
  },
];

function refusalForCode(value: unknown): TaxonomyRefusal | null {
  const code =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : null;

  if (code === null) return null;
  return SIGNATURES.find((signature) => signature.number === code)?.refusal ?? null;
}

/**
 * Reads a SQL Server number only from one of the two structured shapes the
 * installed driver exposes.
 *
 * - `mssql.RequestError`: `code === 'EREQUEST'`, numeric `number`;
 * - Prisma's adapter cause: `kind === 'mssql'`, numeric `code`.
 *
 * Neither trusts a free-standing `number`, `code`, string or message.
 */
function refusalOn(record: Record<string, unknown>): TaxonomyRefusal | null {
  if (record['code'] === 'EREQUEST') {
    return refusalForCode(record['number']);
  }

  if (record['kind'] === 'mssql') {
    return refusalForCode(record['code']);
  }

  return null;
}

/**
 * The refusal this error carries, or `null` if it is not one of ours.
 *
 * `null` is the important return value: it means the caller must re-raise the
 * original error rather than translating a connection fault, a deadlock or a
 * constraint violation into a taxonomy validation message.
 */
export function taxonomyRefusalOf(error: unknown): TaxonomyRefusal | null {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];

  for (let visited = 0; visited < 16 && pending.length > 0; visited += 1) {
    const current = pending.shift();
    if (current === null || current === undefined || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      const refusal = refusalOn(record);
      if (refusal !== null) return refusal;

      for (const key of ['meta', 'cause', 'driverAdapterError', 'originalError']) {
        if (key in record) pending.push(record[key]);
      }
    }
  }

  return null;
}
