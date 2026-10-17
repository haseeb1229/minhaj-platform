import 'server-only';

import type { RealtimeAck, RealtimeFailure } from '@minhaj/contracts/messaging';
import {
  MessagingRefusal,
  type MessagingRefusalReason,
} from '@minhaj/server-core/messaging';

/**
 * What a socket is told when an event does not succeed.
 *
 * A PRESENTATION MAP, NOT A DECISION. Messaging decided; this only names its
 * refusal in the transport's smaller vocabulary. Every reason Messaging can
 * give is listed (the `satisfies` makes a new reason a compile error here
 * rather than a silent `unavailable`):
 *
 *   - a reason the transport shares passes through unchanged;
 *   - `too-large` and `unsupported` describe an input the person can fix, so
 *     they are `invalid`;
 *   - `denied` and `unclaimed` belong to support administration, which no
 *     socket reaches; should one ever surface it is the same `not-found` an
 *     inaccessible conversation gives, so it can probe nothing;
 *   - `conflict` (a lost race) and `not-cleared` (an attachment still being
 *     scanned) are transient — `unavailable` says "try again", which is true.
 *
 * Anything that is not a `MessagingRefusal` — an outage, a defect, a thrown
 * driver error — is `unavailable` and names nothing: no stack, no SQL, no
 * permission ever crosses the wire.
 */
const FAILURE_OF = {
  invalid: 'invalid',
  'not-found': 'not-found',
  ended: 'ended',
  closed: 'closed',
  blocked: 'blocked',
  terminal: 'terminal',
  unclaimed: 'not-found',
  'operation-conflict': 'operation-conflict',
  conflict: 'unavailable',
  'rate-limited': 'rate-limited',
  'too-many': 'too-many',
  'too-large': 'invalid',
  unsupported: 'invalid',
  'not-cleared': 'unavailable',
  denied: 'not-found',
} as const satisfies Record<MessagingRefusalReason, RealtimeFailure>;

export function failureOf(error: unknown): RealtimeFailure {
  if (error instanceof MessagingRefusal) {
    return (
      (FAILURE_OF as Record<string, RealtimeFailure | undefined>)[error.reason] ??
      'unavailable'
    );
  }
  return 'unavailable';
}

export function refused(failure: RealtimeFailure): RealtimeAck<never> {
  return { ok: false, failure };
}

export function accepted<T>(value: T): RealtimeAck<T> {
  return { ok: true, value };
}
