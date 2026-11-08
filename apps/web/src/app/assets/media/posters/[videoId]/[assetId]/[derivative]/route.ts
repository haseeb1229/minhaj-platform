import { videoPosterPolicy } from '@/composition/media-assets';
import { storageRuntime } from '@/composition/storage';
import { serveDerivative } from '@/app/assets/derivative';

/**
 * `/assets/media/posters/{videoId}/{assetId}/{width}w.webp` — one WebP
 * derivative of a published Video's first-party poster (Rebaseline R2).
 * Media's poster policy decides about the SOURCE exactly as the poster route
 * beside it does. Imports no Identity.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly videoId: string;
      readonly assetId: string;
      readonly derivative: string;
    }>;
  },
): Promise<Response> {
  const { videoId, assetId, derivative } = await params;
  return serveDerivative(
    await storageRuntime(),
    request,
    assetId,
    derivative,
    videoPosterPolicy({ videoId, assetId }),
  );
}
