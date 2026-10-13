import 'server-only';

import type { FatwaAuthorityPort } from '@minhaj/contracts/fatwa';
import {
  createFatwaDisposition,
  createFatwaOwner,
  createFatwaPublicReader,
  createFatwaStaffReader,
  createFatwaWorkflow,
  createPermissionHolderReader,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import {
  createFatwaAskService,
  createFatwaDispositionService,
  createFatwaReadService,
  createFatwaWorkflowService,
  type FatwaAskService,
  type FatwaDispositionService,
  type FatwaWorkflowLog,
  type FatwaWorkflowService,
} from '@/contexts/fatwa';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { appLogger } from './logging';

/**
 * The AUTHENTICATED Fatwa composition root — Layer 4: the workflow behind
 * `/admin/fatwa`, the asker's capability behind `/my/questions`, and Fatwa's
 * part of account closure.
 *
 * The only place that knows both Fatwa's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). Fatwa receives interfaces and can reach neither the
 * Prisma client nor the SQL behind any of them.
 *
 * THE AUTHORITY PORT IS IDENTITY'S, LIVE. `permits` is the same
 * `hasPermission` every administrative runtime uses, so a revoked Fatwa role
 * denies the next action. `verifyPublication` is Identity's
 * `verifyPrivilegedActor` for exactly `fatwa.publish` and the
 * `fatwa-publication` step-up purpose: only the frozen actor Identity minted,
 * with the permission, a complete second-factor posture and a live grant for
 * that purpose — and the publication procedure checks the grant again before
 * it writes. `answerers` lists the accounts holding `fatwa.answer` now, by
 * name, so triage assigns to a person rather than to an identifier. No profile,
 * contributor record, role name or other context's key is on any path
 * (DOMAIN_MODEL.md §4.5).
 *
 * THE ASKER'S LIMITER IS THE PLATFORM'S, keyed by a digest of the account id
 * under the purpose `fatwa-question` — never by anything the question says.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./fatwa-read.ts` is the root for those, and
 * it reaches no Identity at all.
 */
let holders: ReturnType<typeof createPermissionHolderReader> | null = null;

const authority: FatwaAuthorityPort = {
  permits: (accountId, permission) =>
    identityRuntime().authorization.hasPermission(accountId, permission),
  verifyPublication: (actor) =>
    identityRuntime().authorization.verifyPrivilegedActor({
      actor,
      permission: 'fatwa.publish',
      stepUp: 'fatwa-publication',
    }),
  answerers: async () =>
    (await (holders ??= createPermissionHolderReader()).holders('fatwa.answer', 200)).map(
      (holder) => ({
        accountId: holder.accountId,
        name: holder.name,
      }),
    ),
};

const log: FatwaWorkflowLog = {
  info: (detail, message) => appLogger().info(detail, message),
  warn: (detail, message) => appLogger().warn(detail, message),
};

interface FatwaRuntime {
  readonly workflow: FatwaWorkflowService;
  readonly ask: FatwaAskService;
  readonly disposition: FatwaDispositionService;
}

let runtime: FatwaRuntime | null = null;

export function fatwaRuntime(): FatwaRuntime {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  return (runtime = {
    workflow: createFatwaWorkflowService({
      workflow: createFatwaWorkflow(),
      staff: createFatwaStaffReader(),
      authority,
      log,
    }),
    ask: createFatwaAskService({
      owner: createFatwaOwner(),
      reader: createFatwaReadService(createFatwaPublicReader()),
      limiter: createRateLimiter(configuration),
      key: (accountId) =>
        rateLimitKey({ purpose: 'fatwa-question', subject: accountId, configuration }),
    }),
    disposition: createFatwaDispositionService(createFatwaDisposition()),
  });
}
