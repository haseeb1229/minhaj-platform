// PROHIBITED: a bounded context naming the mail provider SDK directly.
//
// It acquires the decision of whether to send, what to say and where — in a
// place with no delivery record, no suppression check, no idempotency key and
// no retry (ARCHITECTURE.md §4.6, §4.6.1).
import { Resend } from 'resend';

export function announce(): unknown {
  return Resend;
}
