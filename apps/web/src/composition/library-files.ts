import 'server-only';

import { storageRuntime } from './storage';

/**
 * LIBRARY PART 2 — which downloadable Editions' files Storage could serve RIGHT
 * NOW, and what each is ("PDF, 2.4 MB"), for one page of `/library/downloads`.
 *
 * A TECHNICAL QUESTION ONLY, asked about files Library's public read already
 * named as downloadable — the business decision is Library's and was made in
 * that read. A file Storage cannot serve (never cleared, or its bytes missing
 * after a restore) is answered absent, so the page states it as unavailable
 * instead of offering a link that fails; the byte route
 * (`/assets/library/editions/{editionId}/download/{assetId}`) still makes BOTH
 * decisions per request, and nothing here changes it or what it allows.
 *
 * ITS OWN MODULE, so the public byte route's composition is untouched, and
 * session-free like every public Library root: it reaches Storage and stops.
 * An outage is not a content state: Storage failing to answer propagates to
 * the page's error boundary, as `./media-assets.ts`'s questions do.
 */

/** How many assets one servability question names — Storage's own bound. */
const QUESTION = 100;

export async function servableDownloadFiles(
  assetIds: readonly string[],
): Promise<
  ReadonlyMap<string, { readonly mediaType: string; readonly byteSize: number }>
> {
  const unique = [...new Set(assetIds)];
  const files = new Map<
    string,
    { readonly mediaType: string; readonly byteSize: number }
  >();
  if (unique.length === 0) return files;
  const storage = await storageRuntime();
  for (let start = 0; start < unique.length; start += QUESTION) {
    const answer = await storage.servableFiles(unique.slice(start, start + QUESTION));
    for (const [id, file] of answer) files.set(id, file);
  }
  return files;
}
