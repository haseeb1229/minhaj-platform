import { libraryCoverPolicy } from '@/composition/library-assets';
import { storageRuntime } from '@/composition/storage';
import { serveDerivative } from '@/app/assets/derivative';

/**
 * `/assets/library/covers/issues/{issueId}/{assetId}/{width}w.webp` — one WebP
 * derivative of a published magazine issue's cover (Rebaseline R2). Library's
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
      readonly issueId: string;
      readonly assetId: string;
      readonly derivative: string;
    }>;
  },
): Promise<Response> {
  const { issueId, assetId, derivative } = await params;
  return serveDerivative(
    await storageRuntime(),
    request,
    assetId,
    derivative,
    libraryCoverPolicy({ owner: 'issue', ownerId: issueId, assetId }),
  );
}
