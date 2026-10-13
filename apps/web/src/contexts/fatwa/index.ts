/**
 * Fatwa — THE public interface (bounded context #9, DOMAIN_MODEL.md §12).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends on
 * the ports in `@minhaj/contracts/fatwa` and is handed their implementations by
 * Layer 4.
 *
 * PHASE 20 DELIVERS the private Question and its triage, assignment, drafting
 * and scholar-review workflow; the Fatwa with immutable revisions, a separately
 * written anonymised public question, one step-up-bound publication operation,
 * visible corrections and withdrawal; FatwaCategory mapped onto canonical
 * Topics; the asker's own questions; an anonymous read tally for `popular`;
 * Search's `fatwa` projection; and Fatwa's part of account closure.
 *
 * NOT EDITORIAL, AND NO AI. Fatwa imports no other content context and none
 * imports it; `content.*` confers nothing here. No part of this context
 * generates, drafts, suggests, rewrites or anonymises a ruling or a question.
 */
export {
  FATWA_REFUSAL_REASONS,
  FatwaRefusal,
  fatwaFailure,
  isFatwaRefusalReason,
  type FatwaRefusalReason,
} from './domain/refusal.ts';
export { createFatwaReadService } from './application/read-service.ts';
export {
  QUESTION_RATE_RULE,
  createFatwaAskService,
  type FatwaAskService,
} from './application/ask-service.ts';
export {
  createFatwaWorkflowService,
  type FatwaWorkflowLog,
  type FatwaWorkflowLogDetail,
  type FatwaWorkflowService,
} from './application/workflow-service.ts';
export { FATWA_READ_RULE, createFatwaReadCounter } from './application/read-counter.ts';
export {
  createFatwaDispositionService,
  type FatwaDispositionService,
} from './application/disposition-service.ts';
export {
  createFatwaSearchProjection,
  fatwaPath,
} from './application/search-projection.ts';
