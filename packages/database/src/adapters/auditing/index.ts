import 'server-only';

import type { AuditEvent, AuditPort } from '@minhaj/contracts/platform';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';

/**
 * THE audit writer — the Layer-0 `auditing` concern.
 *
 * Append-oriented: this inserts and does nothing else. There is no update and
 * no delete here, and the runtime principal is DENIED both at the database, so
 * the discipline survives a mistake in this file (SECURITY_BASELINE.md §13.1).
 *
 * NO FOREIGN KEYS. Actor and target are an identifier plus a type STRING. An
 * audit record must stay readable and truthful after its subject is renamed,
 * closed or purged; a foreign key would either block a lawful purge or destroy
 * the very evidence the record exists to preserve (§13.3, DOMAIN_MODEL.md
 * §6.2.1). This is the explicitly permitted historical-identifier pattern, not
 * the prohibited polymorphic relational reference.
 *
 * MOST records are written here. The ones that must commit alongside the
 * security change they describe are written by Identity's own follow-up
 * transaction instead — through the SAME row shaping, so the two cannot
 * produce different records for the same event (`../../audit-row.ts`).
 */

export function createAuditWriter(): AuditPort {
  const prisma = getDatabaseClient();

  return {
    async record(event: AuditEvent): Promise<void> {
      await prisma.auditLog.create({ data: auditRow(event) });
    },
  };
}
