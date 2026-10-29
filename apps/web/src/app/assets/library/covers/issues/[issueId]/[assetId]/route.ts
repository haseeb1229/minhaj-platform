import { libraryCoverPolicy } from '@/composition/library-assets';
import { storageRuntime } from '@/composition/storage';
import { servePhoto } from '@/app/assets/media/serve';

/**
 * `/assets/library/covers/issues/{issueId}/{assetId}` — a public magazine
 * issue's cover (Phase 30-R).
 *
 * Two independent allows: Storage's custody, and Library's decision that this
 * asset IS the cover of this issue, published within a published Magazine. The
 * still-image posture a Photo has, and one identical 404 for every refusal.
 * No session is read.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly issueId: string; readonly assetId: string }> },
): Promise<Response> {
  const { issueId, assetId } = await params;

  return servePhoto(
    await storageRuntime(),
    assetId,
    libraryCoverPolicy({ owner: 'issue', ownerId: issueId, assetId }),
    { ifNoneMatch: request.headers.get('if-none-match'), preview: false },
  );
}
