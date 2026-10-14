import { z } from 'zod';

import { noteRemovalSchema, noteWriteSchema } from '@minhaj/contracts/personalisation';

import { personalisationRuntime } from '@/composition/personalisation';
import { answer, personalMutation } from '../personal-transport';

/**
 * `POST /api/my/notes` —
 * `{ action: 'write', target, body, expectedVersion }` or
 * `{ action: 'remove', target, expectedVersion }`.
 *
 * A note is private plain text under the version that was read: a write
 * answers `{ ok: true, version }`, a removal `{ ok: true, version: 0 }`, and a
 * stale version is a `conflict`. The text is never echoed and never logged.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  noteWriteSchema.extend({ action: z.literal('write') }),
  noteRemovalSchema.extend({ action: z.literal('remove') }),
]);

export async function POST(request: Request): Promise<Response> {
  return personalMutation(
    request,
    { operation: 'personal-note', schema },
    async (actor, value) => {
      const saved = personalisationRuntime().saved;
      if (value.action === 'remove') {
        await saved.removeNote(actor, {
          target: value.target,
          expectedVersion: value.expectedVersion,
        });
        return answer(200, { ok: true, version: 0 });
      }
      const written = await saved.writeNote(actor, {
        target: value.target,
        body: value.body,
        expectedVersion: value.expectedVersion,
      });
      return answer(200, { ok: true, version: written.version });
    },
  );
}
