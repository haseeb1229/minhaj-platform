import { quranProgressWriteSchema } from '@minhaj/contracts/personalisation';

import { personalisationRuntime } from '@/composition/personalisation';
import { answer, personalMutation } from '../personal-transport';

/**
 * `POST /api/my/quran-progress` — `{ surah, ayah, expectedVersion }`.
 *
 * The one current position in the Quran moves only when the reader says so,
 * under the version they read (0 when none exists yet), so a late or replayed
 * request can never move it backwards. Answers `{ ok: true, version }`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return personalMutation(
    request,
    { operation: 'personal-quran-progress', schema: quranProgressWriteSchema },
    async (actor, value) => {
      const saved = await personalisationRuntime().history.setQuranProgress(actor, value);
      return answer(200, { ok: true, version: saved.version });
    },
  );
}
