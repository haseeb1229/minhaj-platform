import { libraryAssetPolicy } from '@/composition/library-assets';
import { refuseAsset, serveLibraryAsset } from '../../../../serve';

/**
 * `/assets/library/editions/{editionId}/{purpose}/{assetId}` — the PUBLIC bytes of
 * one Edition (§24, §27, §28, §45).
 *
 * NOT LOCALE-PREFIXED, for the reason Phase 7 gave: an asset is bytes, it has no
 * interface locale, and three URLs for one object would be three addresses for one
 * file. It sits under `/assets` with the rest of the platform's bytes, which is also
 * why `apps/web/src/proxy.ts` excludes that prefix from locale routing.
 *
 * IT IMPORTS NO IDENTITY. `@/composition/library-assets` reaches Library's relation
 * read and nothing else — no session service, no Better Auth, no authorisation
 * service and nothing that could read a cookie. So the public reading and download
 * paths cannot acquire a session dependency by accident, and a signed-in visitor
 * receives exactly what an anonymous one does (§36).
 *
 * THE PURPOSE IS AN OPERATION, NEVER AN AUTHORITY. It is matched against a fixed
 * two-value allowlist, and each value is then checked against ITS OWN field on the
 * Edition's relation. So:
 *
 *   - `read` needs `reading = allowed` AND this asset to be the recorded readable
 *     one;
 *   - `download` needs `download = allowed` AND this asset to be the recorded
 *     download one.
 *
 * Reading online does not imply downloadable, a file existing implies neither, and
 * `preview` — the administrative purpose — is NOT reachable here at all: this route
 * never constructs a policy that accepts it (§26, §27).
 *
 * NOTHING ELSE IN THE REQUEST IS READ. No query parameter, no header, no cookie, no
 * body, no filename and no declared type. The handler does not name the request
 * object, so there is no `?public=true` to find and no bypass to construct — the
 * caller-supplied identifiers are looked UP, and a value that does not match the
 * stored relation is a refusal rather than an instruction (§45).
 *
 * A NON-PUBLIC WORK OR EDITION IS A 404, and so is a clean but unrelated asset, a
 * quarantined one, a stale relation and an identifier that is not a UUID. One answer
 * for all of them.
 */
export const dynamic = 'force-dynamic';

/**
 * The two public purposes, and the disposition each one implies.
 *
 * A fixed map rather than a parsed string: an unrecognised purpose cannot become a
 * third behaviour, because there is no code path for one.
 */
const PUBLIC_PURPOSES = {
  read: 'inline',
  download: 'attachment',
} as const;

function isPublicPurpose(value: string): value is keyof typeof PUBLIC_PURPOSES {
  return Object.hasOwn(PUBLIC_PURPOSES, value);
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly editionId: string;
      readonly purpose: string;
      readonly assetId: string;
    }>;
  },
): Promise<Response> {
  const { editionId, purpose, assetId } = await params;

  if (!isPublicPurpose(purpose)) return refuseAsset();

  return serveLibraryAsset(
    assetId,
    // The identifiers are handed to the POLICY, which validates their shape and
    // resolves the Edition's own relation. They are never used to build a path, a
    // filename or a query fragment here.
    libraryAssetPolicy({ editionId, assetId, purpose }),
    PUBLIC_PURPOSES[purpose],
  );
}
