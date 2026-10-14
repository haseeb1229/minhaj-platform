import 'server-only';

import { createLearningPublicReader } from '@minhaj/database';

import { createLearningReadService, type LearningReadService } from '@/contexts/learning';

/**
 * The PUBLIC Learning composition root — every Learn page reads through this.
 *
 * A SEPARATE ROOT FROM `./learning.ts`, AND THE SPLIT IS A SECURITY BOUNDARY. The
 * authenticated runtime wires Identity in; importing it would put the session
 * service and the authentication library into the module graph of an anonymous
 * page. This root reaches Learning's public reader and stops: no Identity, no
 * session, nothing that could read or write a cookie, and no method that
 * returns a draft, a lesson body or anybody's enrolment (ARCHITECTURE.md §8.1).
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

let runtime: LearningReadService | null = null;

export function learningReadRuntime(): LearningReadService {
  return (runtime ??= createLearningReadService(createLearningPublicReader()));
}
