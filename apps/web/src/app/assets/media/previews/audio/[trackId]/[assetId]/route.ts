import { requirePermittedAction } from '@/composition/authorization';
import { mediaPreviewAudioPolicy } from '@/composition/media';
import { storageRuntime } from '@/composition/storage';
import { refuseMediaBytes, serveAudio } from '../../../../serve';

/**
 * `/assets/media/previews/audio/{trackId}/{assetId}` — an ADMINISTRATIVE preview
 * of a track's file before it is public (Phase 11).
 *
 * A SEPARATE ROUTE WITH A SEPARATE POLICY. Privileged listening is a different
 * authority from public playback, so it is a different address: the public
 * route never builds a policy that consults a permission, and this one never
 * builds one that allows on publication alone. That separation is also what
 * keeps Identity out of the public byte path's module graph.
 *
 * THREE INDEPENDENT CONDITIONS, ALL REQUIRED:
 *
 *   1. a LIVE `media.administer`, checked here and re-read by the policy — not a
 *      role name, not a profile, not what the session was issued with;
 *   2. the asset is ALREADY RECORDED against this exact track, so this is not a
 *      general file reader for anyone holding the permission;
 *   3. Storage's own technical decision: a quarantined or infected file is
 *      refused to an administrator exactly as to anybody else.
 *
 * `requirePermittedAction` rather than a step-up, for the reason Library's
 * preview gives: listening to a file already attached to a record the caller
 * may already edit changes nothing about privilege, credentials or content.
 *
 * ONE REFUSAL FOR EVERY CAUSE — no session, no permission, wrong track,
 * unrelated asset, quarantined bytes — the same 404.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly trackId: string; readonly assetId: string }> },
): Promise<Response> {
  const { trackId, assetId } = await params;

  // The locale only shapes a sign-in redirect a PAGE would follow; this is not
  // a page, and a refusal here is a 404, never a redirect.
  const permitted = await requirePermittedAction('en', 'media.administer');
  if (permitted.state === 'denied') return refuseMediaBytes();

  return serveAudio(
    await storageRuntime(),
    assetId,
    mediaPreviewAudioPolicy({ trackId, assetId }, permitted.session.account.id),
    { range: request.headers.get('range'), ifRange: request.headers.get('if-range') },
  );
}
