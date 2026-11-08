import { photoAssetPolicy } from '@/composition/media-assets';
import { storageRuntime } from '@/composition/storage';
import { serveDerivative } from '@/app/assets/derivative';

/**
 * `/assets/media/photos/{photoId}/{assetId}/{width}w.webp` — one WebP
 * derivative of a published Photo (Rebaseline R2). Media's photo policy decides
 * about the SOURCE exactly as the photo route beside it does. Imports no
 * Identity.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly photoId: string;
      readonly assetId: string;
      readonly derivative: string;
    }>;
  },
): Promise<Response> {
  const { photoId, assetId, derivative } = await params;
  return serveDerivative(
    await storageRuntime(),
    request,
    assetId,
    derivative,
    photoAssetPolicy({ photoId, assetId }),
  );
}
