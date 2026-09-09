// FIXTURE — MUST PASS. The service HOST. It hosts the Messaging context's
// service so one implementation is reachable by two processes; Messaging
// remains its semantic owner (ARCHITECTURE.md §3.1).
//
// It reaches the context through the context's PUBLIC interface, and it holds
// no database capability of its own.
export { createMessagingService } from '@fixture/model-a-web/contexts/messaging';
export type {
  MessagingService,
  MessageStore,
} from '@fixture/model-a-web/contexts/messaging';
