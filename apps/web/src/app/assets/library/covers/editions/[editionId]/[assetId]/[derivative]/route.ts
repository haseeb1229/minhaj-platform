import { libraryCoverPolicy } from '@/composition/library-assets';
import { storageRuntime } from '@/composition/storage';
import { serveDerivative } from '@/app/assets/derivative';

/**
 * `/assets/library/covers/editions/{editionId}/{assetId}/{width}w.webp` — one
 * WebP derivative of a published Edition's cover (Rebaseline R2). Library's
 * cover policy decides about the SOURCE exactly as the cover route beside it
 * does. Imports no Identity.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly editionId: string;
      readonly assetId: string;
      readonly derivative: string;
    }>;
  },
): Promise<Response> {
  const { editionId, assetId, derivative } = await params;
  return serveDerivative(
    await storageRuntime(),
    request,
    assetId,
    derivative,
    libraryCoverPolicy({ owner: 'edition', ownerId: editionId, assetId }),
  );
}
