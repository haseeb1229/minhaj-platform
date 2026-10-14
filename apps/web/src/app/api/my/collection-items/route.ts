import { z } from 'zod';

import { collectionMembershipSchema } from '@minhaj/contracts/personalisation';

import { personalisationRuntime } from '@/composition/personalisation';
import { answer, personalMutation } from '../personal-transport';

/**
 * `POST /api/my/collection-items` —
 * `{ action: 'add' | 'remove', collectionId, target, expectedVersion }`.
 *
 * The collection must be the session account's own; anyone else's is
 * `not-found`, exactly like one that does not exist. Membership changes under
 * the collection's version and answers `{ ok: true, version }`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = collectionMembershipSchema.extend({ action: z.enum(['add', 'remove']) });

export async function POST(request: Request): Promise<Response> {
  return personalMutation(
    request,
    { operation: 'personal-collection-item', schema },
    async (actor, value) => {
      const saved = personalisationRuntime().saved;
      const membership = {
        collectionId: value.collectionId,
        target: value.target,
        expectedVersion: value.expectedVersion,
      };
      const changed =
        value.action === 'add'
          ? await saved.addToCollection(actor, membership)
          : await saved.removeFromCollection(actor, membership);
      return answer(200, { ok: true, version: changed.version });
    },
  );
}
