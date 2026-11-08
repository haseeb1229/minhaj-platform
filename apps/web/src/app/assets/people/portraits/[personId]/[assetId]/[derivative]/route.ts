import { portraitAssetPolicy } from '@/composition/people-assets';
import { storageRuntime } from '@/composition/storage';
import { serveDerivative } from '@/app/assets/derivative';

/**
 * `/assets/people/portraits/{personId}/{assetId}/{width}w.webp` — one WebP
 * derivative of a public Person's portrait (Rebaseline R2). People's portrait
 * policy decides about the SOURCE exactly as the portrait route beside it
 * does. Imports no Identity.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly personId: string;
      readonly assetId: string;
      readonly derivative: string;
    }>;
  },
): Promise<Response> {
  const { personId, assetId, derivative } = await params;
  return serveDerivative(
    await storageRuntime(),
    request,
    assetId,
    derivative,
    portraitAssetPolicy({ personId, assetId }),
  );
}
