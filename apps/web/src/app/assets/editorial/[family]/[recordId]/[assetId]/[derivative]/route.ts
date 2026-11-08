import { leadImagePolicy } from '@/composition/editorial-assets';
import { storageRuntime } from '@/composition/storage';
import { serveDerivative } from '@/app/assets/derivative';

/**
 * `/assets/editorial/{family}/{recordId}/{assetId}/{width}w.webp` — one WebP
 * derivative of a published record's lead image (Rebaseline R2). Editorial's
 * policy decides about the SOURCE exactly as the lead-image route beside it
 * does, then Storage serves the derivative (`app/assets/derivative.ts`).
 * Imports no Identity.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly family: string;
      readonly recordId: string;
      readonly assetId: string;
      readonly derivative: string;
    }>;
  },
): Promise<Response> {
  const { family, recordId, assetId, derivative } = await params;
  return serveDerivative(
    await storageRuntime(),
    request,
    assetId,
    derivative,
    leadImagePolicy({ family, recordId, assetId }),
  );
}
