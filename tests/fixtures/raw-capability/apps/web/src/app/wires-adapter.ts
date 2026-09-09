// FIXTURE — MUST PASS. The control that keeps the rule honest: composition
// wiring the adapter through its narrow public entry holds no raw capability,
// even though Prisma is two hops further down (ARCHITECTURE.md §3.1.1).
import { createMessageStore } from '../../../../packages/database/src/adapters/messaging';
import type { MessageStore } from '../contexts/messaging';

export const store: MessageStore = createMessageStore();
