import { requirePermittedAction } from '@/composition/authorization';
import { leadImagePreviewPolicy } from '@/composition/editorial';
import { storageRuntime } from '@/composition/storage';
import { refuseEditorialBytes, serveLeadImage } from '../../../../serve';

/**
 * `/assets/editorial/previews/{family}/{recordId}/{assetId}` — an
 * ADMINISTRATIVE preview of a lead image before its record is public
 * (Phase 30-R), so a reviewer sees what they approve.
 *
 * A SEPARATE ROUTE WITH A SEPARATE POLICY: the public route never builds a
 * policy that consults a permission. THREE INDEPENDENT CONDITIONS, ALL
 * REQUIRED: a live `content.read`, checked here and re-read by the policy; the
 * asset named by that record's CURRENT revision; and Storage's own technical
 * decision. `private, no-store`, and one identical 404 for every refusal.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly family: string;
      readonly recordId: string;
      readonly assetId: string;
    }>;
  },
): Promise<Response> {
  const { family, recordId, assetId } = await params;
  // A refusal here is a 404, never a sign-in redirect: this is not a page.
  const permitted = await requirePermittedAction('en', 'content.read');
  if (permitted.state === 'denied') return refuseEditorialBytes();
  return serveLeadImage(
    await storageRuntime(),
    assetId,
    leadImagePreviewPolicy({ family, recordId, assetId }, permitted.session.account.id),
    { ifNoneMatch: null, preview: true },
  );
}
