import { portraitAssetPolicy } from '@/composition/people-assets';
import { storageRuntime } from '@/composition/storage';
import { servePhoto } from '@/app/assets/media/serve';

/**
 * `/assets/people/portraits/{personId}/{assetId}` — a published contributor's
 * portrait (Phase 30-R).
 *
 * TWO INDEPENDENT ALLOWS, as for a Photo: Storage's technical decision (clean
 * custody, bytes present) and People's business decision (this asset IS this
 * published Person's portrait). The same still-image posture as a Photo —
 * `private, no-cache` with the checksum as a strong validator, so withdrawing
 * a Person stops the image at the next revalidation — and one identical 404
 * for every refusal. No session is read: an anonymous visitor and a signed-in
 * one receive the same bytes.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ readonly personId: string; readonly assetId: string }> },
): Promise<Response> {
  const { personId, assetId } = await params;

  return servePhoto(
    await storageRuntime(),
    assetId,
    portraitAssetPolicy({ personId, assetId }),
    { ifNoneMatch: request.headers.get('if-none-match'), preview: false },
  );
}
