// FIXTURE — MUST PASS. The Messaging context's public interface: its service
// and its persistence port, and nothing else.
//
// The nested own-context relative imports below are legal by definition: a
// context's internal structure is its own business (ARCHITECTURE.md §6.3
// rule 4 governs CROSS-context imports).
export { createMessagingService } from './internal/create-message';
export type { MessagingService } from './internal/create-message';
export type { MessageStore } from './internal/message-store-port';
