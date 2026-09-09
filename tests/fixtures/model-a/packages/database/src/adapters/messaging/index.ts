// FIXTURE — MUST PASS. The Messaging context's persistence adapter: physically
// implemented here, semantically owned by Messaging (declared in this
// workspace's package.json), exposing narrow persistence operations and never
// raw Prisma (ARCHITECTURE.md §4.1, §6.3 rule 14).
//
// This module is the encapsulation boundary. Its surface is verified, not
// assumed: `createMessageStore` is annotated with the context-owned port it
// implements, so what a caller receives can be shown to be narrow.
export { createMessageStore } from './message-store';
export type { MessageStore } from '@fixture/model-a-web/contexts/messaging';
