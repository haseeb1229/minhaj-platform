import { appLogger } from '@/composition/logging';
import { personalisationRuntime } from '@/composition/personalisation';
import { personalFailure } from '@/contexts/personalisation-notifications';
import { answer, failed, isPrivateRead, readActor } from '../personal-transport';

/**
 * `GET /api/my/quran-position` — the person's ONE current position in the
 * Quran, read back for the reader's "Continue where you stopped" card (Quran
 * Part 1, 2026-11-09). It is MOVED only through `POST /api/my/quran-progress`;
 * this handler changes nothing.
 *
 * ASKED AFTER RENDER. The card is a client island on `/quran/read` and the
 * Quran landing, so those pages stay one document for every visitor
 * (ARCHITECTURE.md §8.1).
 *
 * DATA-MINIMAL. `{ signedIn: false }`, or `{ signedIn: true, position:
 * { surah, ayah } | null }` for the session's own account and nobody else's —
 * no version, no time, no identifier. Private, `no-store` and unindexed; a
 * cross-site read is refused before the session is resolved, the address takes
 * no query at all (nothing a URL carries can name an account or a target), and
 * a signed-out browser gets an ordinary answer rather than an error.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!isPrivateRead(request)) return failed('denied');
  if (new URL(request.url).search !== '') return failed('invalid');

  const resolved = await readActor('personal-quran-position');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return answer(200, { signedIn: false });

  try {
    const progress = await personalisationRuntime().history.quranProgress(resolved.actor);
    return answer(200, {
      signedIn: true,
      position: progress === null ? null : { surah: progress.surah, ayah: progress.ayah },
    });
  } catch (error) {
    const failure = personalFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'personal-quran-position' },
        'Personal state read failed.',
      );
    return failed(failure);
  }
}
