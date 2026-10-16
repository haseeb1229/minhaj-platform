/**
 * Learning's persistence adapter — semantically owned by that context
 * (ARCHITECTURE.md §3.1.1) and physically here. It reads and writes only its
 * own tables; Topic, Language, Person and User are reached only as the typed
 * foreign keys its rows hold, and no Prisma capability leaves it.
 */
export { LearningDataError } from './errors.ts';
export { createLearningPersistence } from './catalogue.ts';
export { createLearningPublicReader } from './reader.ts';
export { createLearner } from './learner.ts';
export { createLearningExport, createLearningDisposition } from './account.ts';
export { createLearningActivation } from './activation.ts';
export { createTeaching } from './teaching.ts';
export { createClassAdmin } from './admin.ts';
export { createClassLearner } from './learner-classes.ts';
export { createClassPublicReader } from './public-classes.ts';
export { createClassCommunication } from './communication.ts';
