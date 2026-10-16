import 'server-only';

import {
  createAuditWriter,
  createClassAdmin,
  createClassCommunication,
  createClassLearner,
  createLearner,
  createLearningActivation,
  createLearningDisposition,
  createLearningExport,
  createLearningPersistence,
  createRateLimiter,
  createTeaching,
  rateLimitKey,
} from '@minhaj/database';
import type { LearningTeachingAuthorityPort } from '@minhaj/contracts/learning';

import {
  createClassAdminService,
  createClassCommunicationService,
  createClassLearnerService,
  createLearnerService,
  createLearningAccountService,
  createLearningService,
  createTeachingService,
  type ClassAdminService,
  type ClassCommunicationService,
  type ClassLearnerService,
  type LearnerService,
  type LearningAccountService,
  type LearningLimitKey,
  type LearningService,
  type TeachingService,
} from '@/contexts/learning';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { ownerReferences } from './owner-references';
import { peopleReadRuntime } from './people-read';

/**
 * The AUTHENTICATED Learning composition root — Layer 4.
 *
 * The only place that knows both Learning's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). The services that leave it:
 *
 *   - `learning` — the catalogue's administration (Phase 22), under a LIVE
 *     `hasPermission` read on every call.
 *   - `learner` — a signed-in person's own Enrolments, Progress and trial
 *     requests (Phase 22).
 *   - `teaching` — the Teacher area (Phase 23). Its authority is Identity's,
 *     LIVE: `liveAssignmentsCarrying(account, 'teaching.perform')` is re-asked
 *     on every call and the ids travel into every adapter query beside the
 *     typed scope. No profile, attribution or role name is on this path
 *     (DOMAIN_MODEL.md §13.2).
 *   - `classes` — the operator's class administration under the two
 *     `learning.classes.*` keys; it admits a scope only for an account Identity
 *     reports live for `teaching.perform` AND People reports as a published
 *     TeacherProfile, and grants no Identity key itself.
 *   - `myClasses` — a person's own classes and teachers (Phase 23).
 *   - `communication` — Learning's durable service-mail intent, relayed by
 *     the dispatcher through the shared email concern; Identity resolves the
 *     recipient at relay and at send.
 *   - `account` — the person's Learning export and this context's part of a
 *     closed account's disposition, now including classes.
 *
 * REFERENCES ARE ANSWERED BY THEIR OWNERS' PUBLIC READS — People for teachers,
 * Taxonomy for topics and content languages.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./learning-read.ts` is the root for those,
 * and it reaches no Identity at all.
 */

interface LearningRuntime {
  readonly learning: LearningService;
  readonly learner: LearnerService;
  readonly teaching: TeachingService;
  readonly classes: ClassAdminService;
  readonly myClasses: ClassLearnerService;
  readonly communication: ClassCommunicationService;
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
  const activation = createLearningActivation();
  const audit = createAuditWriter();

  // Identity's answers, LIVE, through its public interface — the only
  // teaching authority there is.
  const authority: LearningTeachingAuthorityPort = {
    permits: (accountId, permission) =>
      identityRuntime().authorization.hasPermission(accountId, permission),
    liveTeachingAssignments: (accountId) =>
      identityRuntime().administration.liveAssignmentsCarrying(
        accountId,
        'teaching.perform',
      ),
  };

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
    teaching: createTeachingService({
      teaching: createTeaching(),
      authority,
      activation,
      audit,
      limiter,
      key,
    }),
    classes: createClassAdminService({
      admin: createClassAdmin(),
      authority,
      activation,
      // People's public answer: which of these accounts hold a published
      // TeacherProfile. Presentation and admission, never authority.
      directory: {
        teacherAccounts: async (accountIds) =>
          (await peopleReadRuntime().people.publicTeachers(accountIds, 'en')).map(
            (entry) => entry.accountId,
          ),
      },
      audit,
    }),
    myClasses: createClassLearnerService({
      classes: createClassLearner(),
      activation,
      limiter,
      key,
    }),
    communication: createClassCommunicationService({
      communication: createClassCommunication(),
      recipients: {
        recipients: (accountIds) =>
          identityRuntime().administration.serviceRecipients(accountIds),
      },
      enqueue: async (delivery) => {
        await identityRuntime().deliveries.enqueue(delivery);
      },
      baseUrl: environment.AUTH_BASE_URL,
    }),
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
