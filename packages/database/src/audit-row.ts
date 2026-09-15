import 'server-only';

import type { AuditEvent } from '@minhaj/contracts/platform';

/**
 * How an audit event becomes an `AuditLog` row.
 *
 * PACKAGE-INTERNAL, and deliberately not inside either adapter that uses it.
 * The Layer-0 audit writer inserts most records; Identity's own follow-up
 * transaction inserts the ones that have to commit alongside the change they
 * describe. Both must produce the SAME row — same columns, same minimisation,
 * same truncation — and the way to guarantee that is one definition rather
 * than two that agree today.
 *
 * It is not an adapter and holds no database capability: it shapes a value.
 */

/** Keeps a payload well inside `AuditLog.beforeState` / `afterState`. */
const MAX_STATE_LENGTH = 4_000;

/**
 * Serialises a minimised change description.
 *
 * Payloads record WHICH FIELDS CHANGED and enough context to hold the actor
 * accountable — never a wholesale serialisation of the record. A generic audit
 * payload carrying whole records would become a second copy of every sensitive
 * one, under different access rules and a different retention period
 * (SECURITY_BASELINE.md §13.4).
 */
function serialiseState(
  state: Readonly<Record<string, string>> | undefined,
): string | null {
  if (state === undefined) return null;

  const encoded = JSON.stringify(state);
  return encoded.length > MAX_STATE_LENGTH ? encoded.slice(0, MAX_STATE_LENGTH) : encoded;
}

export interface AuditRow {
  readonly action: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly beforeState: string | null;
  readonly afterState: string | null;
  readonly authorisingSource: string | null;
  readonly ipAddress: string | null;
}

export function auditRow(event: AuditEvent): AuditRow {
  return {
    action: event.action,
    actorType: event.actorType,
    actorId: event.actorId,
    targetType: event.targetType,
    targetId: event.targetId,
    beforeState: serialiseState(event.before),
    afterState: serialiseState(event.after),
    authorisingSource: event.authorisingSource ?? null,
    ipAddress: event.ipAddress ?? null,
  };
}
