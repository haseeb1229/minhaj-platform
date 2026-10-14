/**
 * Learning's persistence adapter — semantically owned by that context
 * (ARCHITECTURE.md §3.1.1) and physically here. It reads and writes only its
 * own tables; Topic, Language, Person and User are reached only as the typed
 * foreign keys its rows hold, and no Prisma capability leaves it.
 */
export { LearningDataError } from './shared.ts';
export { createLearningPersistence } from './catalogue.ts';
export { createLearningPublicReader } from './reader.ts';
export { createLearner } from './learner.ts';
export { createLearningExport, createLearningDisposition } from './account.ts';
