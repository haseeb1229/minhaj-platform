// FIXTURE — MUST PASS. The future realtime transport calling an approved
// context-owned service hosted in server-core (ARCHITECTURE.md §3.1 rule 1,
// §3.3).
//
// The service persists internally, through Messaging's own port. The realtime
// process therefore CAUSES persistence while never holding the means to
// perform it: no database package, no Prisma, no driver, no adapter, no
// client, delegate, transaction handle or raw-query facility (§3.1.2).
import { createMessagingService } from '@fixture/model-a-server-core';
import type { MessagingService, MessageStore } from '@fixture/model-a-server-core';

export function attach(store: MessageStore): MessagingService {
  return createMessagingService(store);
}
