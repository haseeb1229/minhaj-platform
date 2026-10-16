/**
 * Learning — THE public interface (DOMAIN_MODEL.md §13).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends
 * on the ports in `@minhaj/contracts/learning` and is handed their
 * implementations by Layer 4.
 *
 * PHASE 22 DELIVERS COURSES AND PATHS: the catalogue's administration, its
 * public reads and search projection, a person's own Enrolments, lesson
 * Progress and trial-class REQUESTS, and this context's export and part of
 * account closure. It depends on Layer 0 and, through Layer-4 answers, on
 * People and Taxonomy only — no Media, Library or Global Network relation is
 * needed, so none is taken. Teaching authority, classes, availability and
 * booking confirmation are Phase 23's.
 */
export { createLearningService, type LearningService } from './application/service.ts';
export {
  createLearningReadService,
  type LearningReadService,
} from './application/read-service.ts';
export {
  createLearnerService,
  learnerCourseBodySchema,
  LEARNER_WRITE_RULE,
  type LearnerService,
  type LearningLimitKey,
} from './application/learner-service.ts';
export {
  createLearningAccountService,
  LEARNING_EXPORT_RULE,
  type LearningAccountService,
} from './application/account-service.ts';
export {
  coursePath,
  createLearningSearchProjection,
  learningPathPath,
} from './application/search-projection.ts';
export {
  LEARNING_REFUSAL_REASONS,
  LearningRefusal,
  learningFailure,
  type LearningRefusalReason,
} from './application/refusal.ts';

/* ---- Phase 23 — teacher experience & live classes ------------------------ */
export {
  createTeachingService,
  attendanceMarkSchema,
  TEACHING_WRITE_RULE,
  type TeachingService,
} from './application/teaching-service.ts';
export {
  createClassAdminService,
  createSessionSchema,
  type ClassAdminService,
} from './application/class-admin-service.ts';
export {
  createClassLearnerService,
  type ClassLearnerService,
} from './application/class-learner-service.ts';
export {
  createClassReadService,
  readAvailabilityFilter,
  type ClassReadService,
  type PublicLiveSchedule,
  type PublicTeacherDirectory,
} from './application/class-read-service.ts';
export {
  createClassCommunicationService,
  isLearningDeliveryPurpose,
  type ClassCommunicationService,
} from './application/class-communication-service.ts';
export {
  CLASS_MAIL_AUDIENCES,
  CLASS_MAIL_LOCALES,
  describeClassTime,
  renderClassMail,
} from './application/class-mail.ts';
export { reschedule, resolveSchedule, resolveWindow } from './application/scheduling.ts';
