/**
 * Recognises the stable SQL Server refusals emitted by the migration's
 * cross-table final-administrator triggers.
 *
 * Prisma and the MSSQL driver wrap server errors differently for model writes
 * and raw writes, so the number may live on the outer error, its metadata or a
 * nested cause. The invariant has both a stable number and a stable message;
 * either is sufficient, and unrelated database failures are never collapsed.
 */
export function isFinalAdministratorDatabaseError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];

  for (let depth = 0; depth < 8 && pending.length > 0; depth += 1) {
    const current = pending.shift();
    if (current === null || current === undefined || seen.has(current)) continue;
    seen.add(current);

    const text =
      typeof current === 'string'
        ? current
        : current instanceof Error
          ? current.message
          : '';
    if (
      /\b5102[01]\b/.test(text) ||
      text.includes('final usable Platform Administrator') ||
      text.includes('Platform Administrator invariant lock')
    ) {
      return true;
    }

    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      for (const key of ['code', 'number', 'message', 'meta', 'cause', 'originalError']) {
        if (key in record) pending.push(record[key]);
      }
    }
  }

  return false;
}
