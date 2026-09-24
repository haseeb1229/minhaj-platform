import { photoAssetPolicy } from '@/composition/media-assets';
import { storageRuntime } from '@/composition/storage';
import { servePhoto } from '../../../serve';

/**
 * `/assets/media/photos/{photoId}/{assetId}` — the PUBLIC image of one
 * published Photo (Phase 12).
 *
 * NOT LOCALE-PREFIXED, like every byte route: an image has no interface locale.
 *
 * IT IMPORTS NO IDENTITY. `@/composition/media-assets` reaches Media's relation
 * read and Storage and nothing else, so a signed-in visitor receives exactly
 * what an anonymous one does and the response varies with no session.
 *
 * THE IDENTIFIERS ARE LOOKED UP, NEVER TRUSTED. Media's policy refuses unless
 * the asset IS the one recorded against that exact Photo and the Photo is
 * published; Storage refuses unless the bytes are clean and present. A draft's
 * or an archived Photo's image, another Photo's image, a replaced image, an
 * orphaned upload and a malformed identifier are all the same 404.
 *
 * WHAT ELSE IS READ: `If-None-Match`, and only AFTER both owners have allowed —
 * it decides whether to resend the bytes, never whether they may be seen. No
 * query parameter, cookie, body or filename is read, and no query can change
 * which asset is served.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly photoId: string; readonly assetId: string }> },
): Promise<Response> {
  const { photoId, assetId } = await params;

  return servePhoto(
    await storageRuntime(),
    assetId,
    photoAssetPolicy({ photoId, assetId }),
    { ifNoneMatch: request.headers.get('if-none-match'), preview: false },
  );
}
