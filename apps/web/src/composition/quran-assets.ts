import 'server-only';

import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import type {
  PublicRecitationSegment,
  QuranPublicReaderPort,
} from '@minhaj/contracts/quran';
import { createQuranPublicReader } from '@minhaj/database';

import {
  createRecitationAssetPolicy,
  type RecitationAssetRequest,
} from '@/contexts/quran';
import { storageRuntime } from './storage';

/**
 * The PUBLIC serving policy — Quran's business half of the two allows for a
 * recitation segment's audio (DELIVERY_PLAN.md §3).
 *
 * A COMPOSITION ROOT OF ITS OWN, for the reason `./media-assets.ts` gives: the
 * public byte route's module graph must contain NO Identity, no session service
 * and nothing that could read a cookie. `./quran.ts` wires Identity in for the
 * administration; this reaches Quran's public reader and Storage, and stops. A
 * signed-in listener receives exactly what an anonymous one does.
 *
 * STORAGE STILL DECIDES INDEPENDENTLY. What this produces is the business
 * decision; `StorageServicePort.open` applies the technical one — clean custody,
 * bytes present — and returns nothing unless both permit.
 */

let reader: QuranPublicReaderPort | null = null;

function publicReader(): QuranPublicReaderPort {
  return (reader ??= createQuranPublicReader());
}

/** The decision for one public request for a segment's audio. */
export function recitationAssetPolicy(
  request: RecitationAssetRequest,
): AssetAuthorizationPort {
  return createRecitationAssetPolicy({ reader: publicReader(), request });
}

/** How many assets one servability question names — Storage's own bound. */
const SERVABLE_QUESTION = 100;

/**
 * Which of these public segments' audio Storage could serve RIGHT NOW — for a
 * whole recitation page in bounded questions.
 *
 * The page offers a player only where pressing play can work, so a segment
 * whose bytes are missing after a restore, or were never cleared, is shown as
 * honestly unavailable rather than as a control that fails. Every segment
 * passed here comes from Quran's PUBLIC reader, so this answers a TECHNICAL
 * question only; the byte route still makes both decisions per request.
 *
 * AN OUTAGE IS NOT A CONTENT STATE. Storage failing to answer propagates to the
 * page's error boundary; it is never swallowed into a guess.
 */
/**
 * The segments among these whose audio can be played now, in their order —
 * what a public page offers a player for (see `servableSegments`).
 */
export async function playableSegments<
  S extends Pick<PublicRecitationSegment, 'id' | 'assetId'>,
>(segments: readonly S[]): Promise<readonly S[]> {
  const servable = await servableSegments(segments);
  return segments.filter((segment) => servable.has(segment.id));
}

export async function servableSegments(
  segments: readonly Pick<PublicRecitationSegment, 'id' | 'assetId'>[],
): Promise<ReadonlySet<string>> {
  const assets = [...new Set(segments.map((segment) => segment.assetId))];
  if (assets.length === 0) return new Set();
  const storage = await storageRuntime();
  const servable = new Set<string>();
  for (let start = 0; start < assets.length; start += SERVABLE_QUESTION) {
    for (const id of await storage.servable(
      assets.slice(start, start + SERVABLE_QUESTION),
    ))
      servable.add(id);
  }
  return new Set(
    segments.flatMap((segment) => (servable.has(segment.assetId) ? [segment.id] : [])),
  );
}
