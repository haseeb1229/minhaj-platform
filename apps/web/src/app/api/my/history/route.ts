import { z } from 'zod';

import {
  personalIdSchema,
  readableTargetSchema,
} from '@minhaj/contracts/personalisation';

import { personalisationRuntime } from '@/composition/personalisation';
import { noContent, personalMutation } from '../personal-transport';

/**
 * `POST /api/my/history` — `{ kind: 'read', target }` or
 * `{ kind: 'watch', videoId }`.
 *
 * Sent ONCE by the island after the page has mounted, and only while the
 * person has history turned on; the store decides again, in the same
 * statement that records, so a page that read a stale setting records nothing.
 * Viewing a page never records anything by itself — this is a POST.
 *
 * QUIET. A history entry is never worth a visible failure: once the request is
 * admitted, every outcome answers 204, and a refusal is logged by operation
 * name only — never the target.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('read'), target: readableTargetSchema }),
  z.strictObject({ kind: z.literal('watch'), videoId: personalIdSchema }),
]);

export async function POST(request: Request): Promise<Response> {
  return personalMutation(
    request,
    { operation: 'personal-history', schema, quiet: true },
    async (actor, value) => {
      const history = personalisationRuntime().history;
      if (value.kind === 'read') await history.recordRead(actor, value.target);
      else await history.recordWatch(actor, value.videoId);
      return noContent();
    },
  );
}
