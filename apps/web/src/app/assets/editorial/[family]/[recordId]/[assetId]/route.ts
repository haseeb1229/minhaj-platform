import { leadImagePolicy } from '@/composition/editorial-assets';
import { storageRuntime } from '@/composition/storage';
import { serveLeadImage } from '../../../serve';

/**
 * `/assets/editorial/{family}/{recordId}/{assetId}` — the PUBLIC lead image of
 * one published Article, Page, NewsArticle or PressRelease (Phase 30-R).
 *
 * NOT LOCALE-PREFIXED, like every byte route, and IT IMPORTS NO IDENTITY: the
 * response varies with no session.
 *
 * THE IDENTIFIERS ARE LOOKED UP, NEVER TRUSTED. Editorial's policy refuses
 * unless the record is published and its published revision names exactly
 * this asset; Storage refuses unless the bytes are clean and present. A
 * draft's image, a replaced image, another record's image and a malformed
 * identifier are all the same 404. Only `If-None-Match` is read, and only
 * after both owners have allowed.
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
    }>;
  },
): Promise<Response> {
  const { family, recordId, assetId } = await params;
  return serveLeadImage(
    await storageRuntime(),
    assetId,
    leadImagePolicy({ family, recordId, assetId }),
    { ifNoneMatch: request.headers.get('if-none-match'), preview: false },
  );
}
