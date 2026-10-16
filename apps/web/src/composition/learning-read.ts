import 'server-only';

import {
  createClassPublicReader,
  createLearningActivation,
  createLearningPublicReader,
} from '@minhaj/database';

import {
  createClassReadService,
  createLearningReadService,
  type ClassReadService,
  type LearningReadService,
} from '@/contexts/learning';

/**
 * The PUBLIC Learning composition root — every Learn page reads through this.
 *
 * A SEPARATE ROOT FROM `./learning.ts`, AND THE SPLIT IS A SECURITY BOUNDARY. The
 * authenticated runtime wires Identity in; importing it would put the session
 * service and the authentication library into the module graph of an anonymous
 * page. This root reaches Learning's public readers and stops: no Identity, no
 * session, nothing that could read or write a cookie, and no method that
 * returns a draft, a lesson body, anybody's enrolment, a participant, a window
 * or a meeting address (ARCHITECTURE.md §8.1).
 *
 * Phase 23 adds `liveClassesReadRuntime()`: the activation-aware public live
 * schedule and the operational-teacher facts behind `/learn/live` and
 * `/learn/teachers`. It reads the activation gate and the public class reader
 * and nothing else; Layer 4 (`./learning-teachers.ts`) intersects its answer
 * with Identity's live holders and People's published TeacherProfiles.
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

let runtime: LearningReadService | null = null;
let classes: ClassReadService | null = null;

export function learningReadRuntime(): LearningReadService {
  return (runtime ??= createLearningReadService(createLearningPublicReader()));
}

export function liveClassesReadRuntime(): ClassReadService {
  return (classes ??= createClassReadService({
    reader: createClassPublicReader(),
    activation: createLearningActivation(),
  }));
}
