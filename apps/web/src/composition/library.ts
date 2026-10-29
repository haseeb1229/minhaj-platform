import 'server-only';

import type {
  LibraryAssetRequest,
  LibraryPublicReaderPort,
} from '@minhaj/contracts/library';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import {
  createLibraryPersistence,
  createLibraryPublicReader,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import { createLibraryAssetPolicy, createLibraryService } from '@/contexts/library';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { ownerReferences } from './owner-references';
import { storageRuntime } from './storage';

/**
 * The ADMINISTRATIVE Library composition root.
 *
 * Layer 4 is the only place that knows both a port and its adapter
 * (ARCHITECTURE.md §3.1.1). Library receives three interfaces — persistence,
 * authority, references — and can reach neither the Prisma client nor the SQL
 * behind any of them.
 *
 * WHY THE REFERENCE CHECKS LIVE HERE RATHER THAN IN THE CONTEXT. Library must
 * refuse a contributor who is not a Person and a Topic that is not a Topic, and
 * it must do so without reading People's or Taxonomy's tables — "never use
 * another context's private adapter or table". So the context declares WHAT it
 * needs answered and this root decides WHO answers, by calling the owners'
 * public read interfaces. A Library query that joined `Person` directly would
 * compile and would be exactly the boundary violation the architecture gate
 * exists to catch.
 *
 * THE AUTHORITY PORT IS A LIVE READ, never a session projection. It calls the
 * same `hasPermission` the editorial runtime calls, which reads the principal's
 * current permission set — so a revoked Library role denies the next action
 * rather than the next sign-in (SECURITY_BASELINE.md §3.4 rule 2). A contributor
 * relation and a contributor profile are absent from this path entirely: a
 * profile alone grants nothing.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./library-read.ts` is the root for those,
 * and it deliberately reaches no Identity at all.
 */

function buildLibraryRuntime() {
  return {
    library: createLibraryService({
      persistence: createLibraryPersistence(),

      authority: {
        permits: (accountId: string, permission: string) =>
          identityRuntime().authorization.hasPermission(accountId, permission),
      },

      // Answered by the owners' public reads, through the ONE implementation
      // Media shares (`./owner-references.ts`).
      references: ownerReferences,

      // Storage's servable-still-image answer, asked before a cover is recorded.
      images: {
        servableImages: async (ids) => (await storageRuntime()).servableImages(ids),
      },
    }),
  };
}

let runtime: ReturnType<typeof buildLibraryRuntime> | null = null;

export function libraryRuntime(): ReturnType<typeof buildLibraryRuntime> {
  return (runtime ??= buildLibraryRuntime());
}

/**
 * The PRIVILEGED serving policy: an administrator previewing an Edition's file
 * before it is public.
 *
 * WHY THIS AUTHORITY IS DISTINCT FROM THE PUBLIC DECISION. Without it the only way
 * for an operator to check that they attached the right PDF would be to publish the
 * Edition and look — which is a review step performed in production. So the policy
 * has a third purpose, `preview`, and it allows exactly one thing: an asset ALREADY
 * RECORDED against that Edition as its readable or download file, to a caller
 * holding `library.administer` right now.
 *
 * IT IS NOT "ADMINS CAN DOWNLOAD EVERYTHING" (§16, §28). The relation is still
 * checked, so an administrator cannot name an arbitrary asset identifier and
 * receive its bytes; and the permission is re-read LIVE through the same
 * authorisation service the mutations use, so a revoked Library role refuses the
 * next request rather than the next sign-in. No role name is inspected, no profile
 * flag is consulted, and nothing in the request can substitute for the permission
 * (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * STORAGE STILL DECIDES INDEPENDENTLY. A quarantined or infected asset is refused
 * to an administrator exactly as it is to anybody else — which is the case worth
 * being sure about, because an operator checking an upload is precisely who would
 * otherwise be handed an unscanned file (§45).
 */
export function libraryPreviewAssetPolicy(
  request: LibraryAssetRequest,
  accountId: string,
): AssetAuthorizationPort {
  return createLibraryAssetPolicy({
    reader: previewRelations(),
    request,
    previewAuthority: {
      accountId,
      authority: {
        permits: (id: string, permission: string) =>
          identityRuntime().authorization.hasPermission(id, permission),
      },
    },
  });
}

/**
 * The upload budget for one operator — "file upload" is a protected flow
 * (SECURITY_BASELINE.md §15.2), authenticated or not.
 *
 * PER ACCOUNT, because the caller is always signed in here and an account is the
 * subject whose behaviour the limit is about. The subject is digested by the shared
 * limiter before it is stored, so no account identifier sits in clear in an
 * infrastructure table (§19.2).
 *
 * TWENTY IN FIFTEEN MINUTES is far above what cataloguing a book needs and far below
 * what filling a disk or keeping the scanner permanently busy would take. It is a
 * ceiling on abuse, not a workflow control.
 */
const UPLOAD_RULE = { window: 900, max: 20 } as const;

let uploadLimiter: ReturnType<typeof createRateLimiter> | null = null;

export async function consumeLibraryUpload(accountId: string): Promise<boolean> {
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const limiter = (uploadLimiter ??= createRateLimiter(configuration));
  const decision = await limiter.consume(
    rateLimitKey({ purpose: 'library-upload', subject: accountId, configuration }),
    UPLOAD_RULE,
  );
  return decision.allowed;
}

let previewReader: LibraryPublicReaderPort | null = null;

function previewRelations(): LibraryPublicReaderPort {
  return (previewReader ??= createLibraryPublicReader());
}

/**
 * Bounded owner-provided choices for the Library administration forms — the
 * shared owner read (`./owner-references.ts`), invoked only after the page
 * rendering the form has checked `library.read`.
 */
export { ownerReferenceChoices as libraryReferenceChoices } from './owner-references';
