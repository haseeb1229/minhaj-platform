import 'server-only';

/**
 * Recognises the stable SQL Server refusals emitted by the Phase-5 People
 * triggers.
 *
 * WHY THIS IS NOT A `catch (error) { if (error.number === 51040) }`.
 *
 * Prisma and the MSSQL driver wrap server errors differently depending on how
 * the statement was issued — a model write, a raw write, a write inside an
 * interactive transaction — so the number may live on the outer error, on its
 * `meta`, or on a nested `cause` several levels down. An implementation that
 * read one of those places would work for the call sites that happened to be
 * written first and silently report every other refusal as "unavailable", which
 * is the same message a connection failure produces.
 *
 * So the error GRAPH is walked, but a refusal is accepted only from the MSSQL
 * driver's structured error number. Message text is deliberately ignored: an
 * arbitrary Error can carry user-controlled text, and a contributor biography
 * containing `"51040"` must not acquire the authority to masquerade as a
 * database invariant.
 *
 * This is the same device `../taxonomy/refusals.ts` and
 * `../identity-access/final-administrator.ts` use, for the same reason. It is
 * DUPLICATED rather than shared because the SIGNATURE TABLE is what differs and
 * it is the only part that carries meaning: a shared walker parameterised by a
 * table would put two contexts' invariants in one module, and the next phase
 * would add a third.
 */

/** What a People trigger refused, as the context's failure vocabulary names it. */
export type PeopleRefusal =
  | 'primary-translation-required'
  | 'name-variant-limit'
  | 'duplicate-slug'
  | 'duplicate-variant';

/**
 * Each invariant's stable SQL Server number.
 *
 * Allocated above Phase 3B's 51030–51033 block so a People refusal can never be
 * mistaken for a Taxonomy one — which matters because the two adapters
 * translate refusals into different failure vocabularies, and a collision would
 * make one context report the other's invariant.
 */
const SIGNATURES: readonly {
  readonly refusal: PeopleRefusal;
  readonly number: number;
}[] = [
  {
    refusal: 'primary-translation-required',
    number: 51040,
  },
  {
    refusal: 'name-variant-limit',
    number: 51041,
  },
  {
    refusal: 'duplicate-slug',
    number: 51043,
  },
  {
    refusal: 'duplicate-variant',
    number: 51044,
  },
];

function refusalForCode(value: unknown): PeopleRefusal | null {
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
function refusalOn(record: Record<string, unknown>): PeopleRefusal | null {
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
 * original error rather than translating a connection fault, a deadlock or an
 * unrelated constraint violation into a People validation message.
 */
export function peopleRefusalOf(error: unknown): PeopleRefusal | null {
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
