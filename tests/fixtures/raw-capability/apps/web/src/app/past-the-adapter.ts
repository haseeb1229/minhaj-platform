// FIXTURE — MUST FAIL. The encapsulation boundary is the adapter's PUBLIC
// ENTRY, not its directory. Reaching into the adapter's internals reaches past
// the encapsulation and comes away with what the internals hold.
export { createMessageStore } from '../../../../packages/database/src/adapters/messaging/message-store';
