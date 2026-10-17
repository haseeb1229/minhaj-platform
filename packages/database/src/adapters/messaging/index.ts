/**
 * Messaging's persistence adapter — semantically owned by that context
 * (ARCHITECTURE.md §3.1.1) and physically here. It reads and writes only its
 * own tables; Course, User and Asset are reached only as the typed foreign
 * keys its rows hold, and no Learning, Identity or People table is read. No
 * Prisma capability leaves it: the surface is the port's factory and the one
 * refusal type.
 */
export { MessagingDataError } from './errors.ts';
export { createMessagingPersistence } from './persistence.ts';
