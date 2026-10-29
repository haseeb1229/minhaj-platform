import 'server-only';

import type {
  LibraryAssetRequest,
  LibraryPublicReaderPort,
} from '@minhaj/contracts/library';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import { createLibraryPublicReader } from '@minhaj/database';

import { createLibraryAssetPolicy, createLibraryCoverPolicy } from '@/contexts/library';

/**
 * The PUBLIC Library serving policy — Phase 8 as the first real consumer of the
 * Phase-7 default-deny serving mechanism (DELIVERY_PLAN.md Phase 7 §3, Phase 8).
 *
 * WHY THIS IS A THIRD COMPOSITION ROOT. `./library-read.ts` builds the read
 * service a page renders from; `./library.ts` builds the administrative runtime and
 * reaches Identity. This one builds ONE narrow thing: an allow/deny decision over
 * the Edition-to-Asset relation. It is separate from `./library.ts` so the public
 * byte route's module graph contains NO Identity, no session service and nothing
 * that could read a cookie — the same structural guarantee the public render tree
 * has (ARCHITECTURE.md §8.1).
 *
 * IT REACHES `assetRelation` DIRECTLY RATHER THAN THROUGH THE READ SERVICE, and
 * that is the point. `assetRelation` answers with an Edition's publication state
 * and its asset identifiers for ANY Edition, including a draft one. Putting it on
 * the public read service would have handed every public page a way to read a
 * draft Edition's asset identifiers; keeping it here means the only consumer is the
 * decision that immediately checks those states.
 *
 * STORAGE STILL DECIDES INDEPENDENTLY. What this produces is the BUSINESS half.
 * `StorageServicePort.open` applies the technical half — clean custody, matching
 * checksum, bytes actually present — and returns `null` unless BOTH permit. A
 * quarantined or infected asset is refused however emphatically Library says allow
 * (§45).
 */

let reader: LibraryPublicReaderPort | null = null;

function relations(): LibraryPublicReaderPort {
  return (reader ??= createLibraryPublicReader());
}

/**
 * The decision for one public byte request.
 *
 * THE REQUEST IS A REQUEST, NOT AN AUTHORITY. The edition, the asset and the
 * purpose all arrive from the URL, and none of them grants anything: the policy
 * looks up the Edition's own relation and refuses unless the asset it was handed is
 * the one recorded for that exact purpose on that exact Edition. So naming another
 * Edition's file, a clean but unrelated asset, or `download` on an Edition whose
 * download is denied, all produce the same refusal (§28, §45).
 */
export function libraryAssetPolicy(request: LibraryAssetRequest): AssetAuthorizationPort {
  return createLibraryAssetPolicy({ reader: relations(), request });
}

/** Phase 30-R: the decision for one public request for an Edition's or an issue's cover. */
export function libraryCoverPolicy(request: {
  readonly owner: 'edition' | 'issue';
  readonly ownerId: string;
  readonly assetId: string;
}): AssetAuthorizationPort {
  return createLibraryCoverPolicy({ reader: relations(), request });
}
