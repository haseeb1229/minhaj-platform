import 'server-only';

import { createMediaPersistence } from '@minhaj/database';

import { createMediaService } from '@/contexts/media';
import { identityRuntime } from './identity';
import { ownerReferences } from './owner-references';

/**
 * The ADMINISTRATIVE Media composition root — Layer 4.
 *
 * The only place that knows both Media's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). Media receives three interfaces — persistence,
 * authority, references — and can reach neither the Prisma client nor the SQL
 * behind any of them.
 *
 * THE AUTHORITY PORT IS A LIVE READ, the same `hasPermission` every other
 * administrative runtime uses, so a revoked Media role denies the next action.
 * No profile and no speaker credit is on this path: a profile alone grants
 * nothing (DOMAIN_MODEL.md §4.5).
 *
 * REFERENCES ARE ANSWERED BY THEIR OWNERS' PUBLIC READS — People for speakers,
 * Taxonomy for topics and content languages — through the one implementation
 * the Library shares (`./owner-references.ts`).
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./media-read.ts` is the root for those, and
 * it reaches no Identity at all.
 */
function buildMediaRuntime() {
  return {
    media: createMediaService({
      persistence: createMediaPersistence(),
      authority: {
        permits: (accountId: string, permission: string) =>
          identityRuntime().authorization.hasPermission(accountId, permission),
      },
      references: ownerReferences,
    }),
  };
}

let runtime: ReturnType<typeof buildMediaRuntime> | null = null;

export function mediaRuntime(): ReturnType<typeof buildMediaRuntime> {
  return (runtime ??= buildMediaRuntime());
}
