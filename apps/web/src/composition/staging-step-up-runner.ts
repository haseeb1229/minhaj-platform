import 'server-only';

import {
  createAuditWriter,
  createAuthorizationPersistence,
  createAuthorizationReader,
  createHostStepUpSessions,
} from '@minhaj/database';

import {
  createHostStepUpService,
  type HostStepUpService,
} from '../contexts/identity-access/index.ts';

/**
 * The STAGING HOST STEP-UP tooling's composition root — Layer 4
 * (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP; SECURITY_BASELINE.md §8.1).
 *
 * THE ONLY ROOT that composes Identity's host-issued step-up. The tool
 * (`scripts/identity/host-step-up.ts`) runs under plain Node in the operations
 * image as the RUNTIME principal, started by the owner-side command
 * `staging-step-up` after the whole staging guard; it holds no database
 * capability of its own. The web process never imports this module — an
 * architecture test holds that — so no request path can reach the service.
 *
 * THE DEPLOYMENT is read from this process's environment: the service refuses
 * to exist unless it declares, exactly, `MINHAJ_DEPLOYMENT_ENVIRONMENT=staging`
 * and `PUBLIC_INDEXING_ENABLED=false`.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */
export function composeStagingStepUpRunner(
  env: Record<string, string | undefined> = process.env,
): HostStepUpService {
  return createHostStepUpService({
    deployment: {
      environment: env['MINHAJ_DEPLOYMENT_ENVIRONMENT'],
      publicIndexing: env['PUBLIC_INDEXING_ENABLED'],
    },
    authorization: createAuthorizationPersistence(),
    reader: createAuthorizationReader(),
    sessions: createHostStepUpSessions(),
    audit: createAuditWriter(),
  });
}
