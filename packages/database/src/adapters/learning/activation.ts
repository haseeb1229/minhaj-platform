import 'server-only';

import type { LearningActivationPort } from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import { refuse } from './shared.ts';

/**
 * The fail-closed live-learning gate (DELIVERY_PLAN.md Phase 23). ONE row at
 * most, written by the owner/operator and never by the runtime, which holds
 * SELECT alone; the migration's triggers refuse every window, session and
 * Booking while it is absent (51281), and every adapter here asks the same
 * question first. A migrated database holds no row: live learning is OFF by
 * default.
 */
export function createLearningActivation(): LearningActivationPort {
  const db = getDatabaseClient();

  return {
    async activeMode() {
      try {
        const row = await db.liveLearningActivation.findFirst({
          select: { authority: true },
        });
        if (row === null) return null;
        // The CHECK admits two values; anything else fails closed to the
        // stricter reading, exactly as Fatwa's activation does.
        return row.authority === 'approved' ? 'approved' : 'fixture';
      } catch (error) {
        refuse(error);
      }
    },
  };
}
