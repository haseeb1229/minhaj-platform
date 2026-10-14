import 'server-only';

import {
  createLearner,
  createLearningDisposition,
  createLearningExport,
  createLearningPersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import {
  createLearnerService,
  createLearningAccountService,
  createLearningService,
  type LearnerService,
  type LearningAccountService,
  type LearningLimitKey,
  type LearningService,
} from '@/contexts/learning';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { ownerReferences } from './owner-references';

/**
 * The AUTHENTICATED Learning composition root — Layer 4.
 *
 * The only place that knows both Learning's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). Three services leave it:
 *
 *   - `learning` — the catalogue's administration, under a LIVE `hasPermission`
 *     read on every call, so a revoked Learning role denies the next action. No
 *     profile is on this path: a TeacherProfile, or being named as a Course's
 *     teacher, grants nothing (DOMAIN_MODEL.md §13.2).
 *   - `learner` — a signed-in person's own Enrolments, Progress and trial
 *     requests, scoped to the session's account and rate-limited per account.
 *   - `account` — the person's Learning export and this context's part of a
 *     closed account's disposition; Identity answers only which accounts are
 *     closed.
 *
 * REFERENCES ARE ANSWERED BY THEIR OWNERS' PUBLIC READS — People for teachers,
 * Taxonomy for topics and content languages — through the one implementation
 * Media and the Library share (`./owner-references.ts`).
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./learning-read.ts` is the root for those,
 * and it reaches no Identity at all.
 */

interface LearningRuntime {
  readonly learning: LearningService;
  readonly learner: LearnerService;
  readonly account: LearningAccountService;
}

let runtime: LearningRuntime | null = null;

export function learningRuntime(): LearningRuntime {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const limiter = createRateLimiter(configuration);
  const key: LearningLimitKey = (purpose, subject) =>
    rateLimitKey({ purpose, subject, configuration });

  return (runtime = {
    learning: createLearningService({
      persistence: createLearningPersistence(),
      authority: {
        permits: (accountId, permission) =>
          identityRuntime().authorization.hasPermission(accountId, permission),
      },
      references: ownerReferences,
    }),
    learner: createLearnerService({ learner: createLearner(), limiter, key }),
    account: createLearningAccountService({
      exports: createLearningExport(),
      disposition: createLearningDisposition(),
      // Identity's OWN answer about its own lifecycle, and nothing more.
      accounts: {
        closedAccounts: (ids) => identityRuntime().administration.closedAccounts(ids),
      },
      limiter,
      key,
    }),
  });
}
