import { audioAssetPolicy } from '@/composition/media-assets';
import { storageRuntime } from '@/composition/storage';
import { serveAudio } from '../../../serve';

/**
 * `/assets/media/audio/{trackId}/{assetId}` — the PUBLIC bytes of one published
 * AudioTrack (Phase 11).
 *
 * NOT LOCALE-PREFIXED, for the reason Phase 7 gave: an asset is bytes and has no
 * interface locale. It sits under `/assets`, which the request proxy excludes
 * from locale routing.
 *
 * IT IMPORTS NO IDENTITY. `@/composition/media-assets` reaches Media's relation
 * read and Storage, nothing else — no session service, no authentication
 * library, nothing that could read a cookie — so a signed-in listener receives
 * exactly what an anonymous one does and the response varies with no session.
 *
 * THE IDENTIFIERS ARE LOOKED UP, NEVER TRUSTED. Both come from the path and both
 * are handed to Media's policy, which refuses unless the asset IS the one
 * recorded against that exact track and the track is published. A clean asset
 * of another track, a replaced file, an orphaned upload, a draft's file and a
 * malformed identifier are all the same 404.
 *
 * WHAT ELSE IS READ: `Range` and `If-Range`, and only AFTER both owners have
 * allowed — they choose which bytes of an authorised file to send, never
 * whether to send them. No query parameter, cookie, body or filename is read.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly trackId: string; readonly assetId: string }> },
): Promise<Response> {
  const { trackId, assetId } = await params;

  return serveAudio(
    await storageRuntime(),
    assetId,
    audioAssetPolicy({ trackId, assetId }),
    {
      range: request.headers.get('range'),
      ifRange: request.headers.get('if-range'),
    },
  );
}
