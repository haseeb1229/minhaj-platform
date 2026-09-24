import { requirePermittedAction } from '@/composition/authorization';
import { mediaPreviewPhotoPolicy } from '@/composition/media';
import { storageRuntime } from '@/composition/storage';
import { refuseMediaBytes, servePhoto } from '../../../../serve';

/**
 * `/assets/media/previews/photos/{photoId}/{assetId}` — an ADMINISTRATIVE
 * preview of a Photo's image before it is public (Phase 12).
 *
 * A SEPARATE ROUTE WITH A SEPARATE POLICY, as for audio: the public route never
 * builds a policy that consults a permission, and this one never allows on
 * publication alone — which also keeps Identity out of the public route's
 * module graph.
 *
 * THREE INDEPENDENT CONDITIONS, ALL REQUIRED:
 *
 *   1. a LIVE `media.administer`, checked here and re-read by the policy;
 *   2. the asset is ALREADY RECORDED against this exact Photo, so this is not a
 *      general image reader for anyone holding the permission;
 *   3. Storage's own technical decision: a quarantined or infected file is
 *      refused to an administrator exactly as to anybody else.
 *
 * `private, no-store`, and ONE REFUSAL FOR EVERY CAUSE — the same 404.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ readonly photoId: string; readonly assetId: string }> },
): Promise<Response> {
  const { photoId, assetId } = await params;

  // The locale only shapes a sign-in redirect a PAGE would follow; this is not
  // a page, and a refusal here is a 404, never a redirect.
  const permitted = await requirePermittedAction('en', 'media.administer');
  if (permitted.state === 'denied') return refuseMediaBytes();

  return servePhoto(
    await storageRuntime(),
    assetId,
    mediaPreviewPhotoPolicy({ photoId, assetId }, permitted.session.account.id),
    { ifNoneMatch: null, preview: true },
  );
}
