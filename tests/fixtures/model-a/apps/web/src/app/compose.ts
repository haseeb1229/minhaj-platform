// FIXTURE — MUST PASS. Layer 4 composition wiring a bounded context's public
// service to the narrow context-owned persistence adapter that fulfils its
// port (ARCHITECTURE.md §3.1.1, §4.1).
//
// This file reaches `packages/database` and reaches it legitimately. What it
// comes away holding is a `MessageStore` — a narrow port — never a client, a
// delegate, a transaction handle or a raw-query facility, so it has caused
// persistence to be possible without possessing raw database capability.
import { createMessageStore } from '@fixture/model-a-database';
import { createMessagingService } from '../contexts/messaging';
import type { MessagingService } from '../contexts/messaging';

export const messaging: MessagingService = createMessagingService(createMessageStore());
