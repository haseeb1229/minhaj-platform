import { playableSegments } from '@/composition/quran-assets';
import { quranReadRuntime } from '@/composition/quran-read';
import { readSurahSegment } from '@/components/quran/presentation';

/**
 * `GET /api/quran/recitations/{recitation}/{surah}` — what the recitation
 * player needs to play ONE public recitation's audio for ONE Surah (Quran
 * Part 5): each playable segment's range, how its audio is addressed, and the
 * timing of every Ayah where the recitation is timed.
 *
 * PUBLIC DATA ONLY, AND THE SAME FOR EVERYONE. It imports no Identity — the
 * public Quran root and the asset root reach Quran's public reader and
 * Storage's servability, nothing that could read a cookie — so a signed-in
 * listener receives exactly what an anonymous one does. Nothing is answered
 * while the corpus is inactive, for a recitation that is not public now, or
 * for a segment whose bytes Storage could not serve.
 *
 * NO ADDRESS IS SENT. A first-party segment is named by its three identifiers
 * and a streamed one by its allowlisted provider and path; the player derives
 * the one address of each from the contract's own rules, so nothing in this
 * body can point it anywhere else.
 *
 * The slug and the Surah come from the path and are checked before any query:
 * a malformed one is a 404, never a guess. No query string is read.
 */
export const dynamic = 'force-dynamic';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Public, and changed only when an operator changes a recitation: a few
  // minutes in this browser's cache, never a shared cache's.
  'cache-control': 'private, max-age=300',
  'x-robots-tag': 'noindex',
  'x-content-type-options': 'nosniff',
} as const;

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not-found' }), {
    status: 404,
    headers: { ...HEADERS, 'cache-control': 'no-store' },
  });
}

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ readonly recitation: string; readonly surah: string }> },
): Promise<Response> {
  const { recitation: slug, surah: surahSegment } = await params;
  const surah = readSurahSegment(surahSegment);
  if (surah === null) return notFound();

  const reader = quranReadRuntime().reader;
  const recitation = await reader.recitation(slug);
  if (recitation === null) return notFound();

  const [segments, timings] = await Promise.all([
    reader.recitationSegments(recitation.id, surah).then(playableSegments),
    reader.recitationTimings(recitation.id, surah),
  ]);
  const bySegment = new Map<string, [number, number, number][]>();
  for (const timing of timings) {
    const list = bySegment.get(timing.segmentId) ?? [];
    list.push([timing.ayah, timing.startMs, timing.endMs]);
    bySegment.set(timing.segmentId, list);
  }

  return new Response(
    JSON.stringify({
      recitation: recitation.slug,
      surah,
      segments: segments.map((segment) => ({
        id: segment.id,
        startAyah: segment.startAyah,
        endAyah: segment.endAyah,
        audio:
          recitation.stream === null
            ? {
                kind: 'asset',
                recitationId: recitation.id,
                segmentId: segment.id,
                assetId: segment.assetId,
              }
            : { kind: 'stream', stream: recitation.stream, surah },
        timings: segment.timed ? (bySegment.get(segment.id) ?? null) : null,
      })),
    }),
    { status: 200, headers: HEADERS },
  );
}
