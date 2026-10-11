import { serveAudio } from '@/app/assets/media/serve';
import { recitationAssetPolicy } from '@/composition/quran-assets';
import { storageRuntime } from '@/composition/storage';

/**
 * `/assets/quran/recitations/{recitationId}/{segmentId}/{assetId}` — the PUBLIC
 * audio of one segment of a publicly visible Recitation (Phase 18).
 *
 * NOT LOCALE-PREFIXED, for the reason Phase 7 gave: an asset is bytes and has no
 * interface locale. It sits under `/assets`, which the request proxy excludes
 * from locale routing.
 *
 * IT IMPORTS NO IDENTITY. `@/composition/quran-assets` reaches Quran's public
 * reader and Storage, nothing else — no session service, no authentication
 * library, nothing that could read a cookie — so a signed-in listener receives
 * exactly what an anonymous one does and the response varies with no session.
 *
 * THE IDENTIFIERS ARE LOOKED UP, NEVER TRUSTED. All three come from the path and
 * all three are handed to Quran's policy, which refuses unless the asset IS the
 * one recorded against that exact segment of that exact Recitation, and the
 * corpus and the Recitation are public now. A clean asset of another segment, a
 * replaced file, an orphaned upload, a draft's audio and a malformed identifier
 * are all the same 404.
 *
 * SERVED LIKE EVERY OTHER RECORDING ON THE PLATFORM — one byte-serving
 * implementation with the two independent allows, byte ranges decided only
 * AFTER both owners allowed, `private, no-store`, same-origin resource policy,
 * and inline playback only: no filename and no download is offered or implied.
 * No query parameter, cookie, body or filename is read.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      readonly recitationId: string;
      readonly segmentId: string;
      readonly assetId: string;
    }>;
  },
): Promise<Response> {
  const { recitationId, segmentId, assetId } = await params;

  return serveAudio(
    await storageRuntime(),
    assetId,
    recitationAssetPolicy({ recitationId, segmentId, assetId }),
    {
      range: request.headers.get('range'),
      ifRange: request.headers.get('if-range'),
    },
  );
}
