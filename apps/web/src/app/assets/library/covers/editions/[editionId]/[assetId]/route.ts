import { libraryCoverPolicy } from '@/composition/library-assets';
import { storageRuntime } from '@/composition/storage';
import { servePhoto } from '@/app/assets/media/serve';

/**
 * `/assets/library/covers/editions/{editionId}/{assetId}` — a public Edition's
 * cover (Phase 30-R).
 *
 * Two independent allows: Storage's custody, and Library's decision that this
 * asset IS the cover of this Edition, published within a published Work. The
 * still-image posture a Photo has — `private, no-cache` with the checksum as a
 * strong validator, so a withdrawn Edition's cover stops at the next
 * revalidation — and one identical 404 for every refusal. No session is read.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ readonly editionId: string; readonly assetId: string }> },
): Promise<Response> {
  const { editionId, assetId } = await params;

  return servePhoto(
    await storageRuntime(),
    assetId,
    libraryCoverPolicy({ owner: 'edition', ownerId: editionId, assetId }),
    { ifNoneMatch: request.headers.get('if-none-match'), preview: false },
  );
}
