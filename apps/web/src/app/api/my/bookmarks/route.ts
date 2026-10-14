import { z } from 'zod';

import { personalTargetSchema } from '@minhaj/contracts/personalisation';

import { personalisationRuntime } from '@/composition/personalisation';
import { answer, personalMutation } from '../personal-transport';

/**
 * `POST /api/my/bookmarks` — `{ action: 'add' | 'remove', target }`.
 *
 * Saving asks the target's owner whether it is public now; removing never does,
 * so a person can always let go of something that has since been withdrawn.
 * Both are idempotent and answer `{ ok: true }`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.strictObject({
  action: z.enum(['add', 'remove']),
  target: personalTargetSchema,
});

export async function POST(request: Request): Promise<Response> {
  return personalMutation(
    request,
    { operation: 'personal-bookmark', schema },
    async (actor, value) => {
      const saved = personalisationRuntime().saved;
      if (value.action === 'add') await saved.bookmark(actor, value.target);
      else await saved.unbookmark(actor, value.target);
      return answer(200, { ok: true });
    },
  );
}
