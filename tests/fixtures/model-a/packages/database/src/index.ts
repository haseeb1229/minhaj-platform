// The package's PUBLIC surface: context-owned adapters only. `./client` is
// deliberately absent — publishing it would hand out raw database capability
// (ARCHITECTURE.md §4.1).
export { createMessageStore } from './adapters/messaging';
export type { MessageStore } from './adapters/messaging';
