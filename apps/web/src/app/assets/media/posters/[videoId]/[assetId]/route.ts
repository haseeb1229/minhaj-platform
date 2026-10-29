import { videoPosterPolicy } from '@/composition/media-assets';
import { storageRuntime } from '@/composition/storage';
import { servePhoto } from '../../../serve';

/**
 * `/assets/media/posters/{videoId}/{assetId}` — a published Video's
 * first-party poster (Phase 30-R).
 *
 * OUR OWN COPY, so a Watch card shows a picture without any request to the
 * video's provider; the provider is reached only when a visitor presses play.
 * Two independent allows — Storage's custody and Media's decision that this
 * asset IS this published Video's poster — with a Photo's still-image posture
 * and one identical 404 for every refusal. No session is read.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly videoId: string; readonly assetId: string }> },
): Promise<Response> {
  const { videoId, assetId } = await params;

  return servePhoto(
    await storageRuntime(),
    assetId,
    videoPosterPolicy({ videoId, assetId }),
    { ifNoneMatch: request.headers.get('if-none-match'), preview: false },
  );
}
