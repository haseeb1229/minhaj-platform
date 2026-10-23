import 'server-only';

import {
  personalIdSchema,
  type PersonalHoldingPort,
} from '@minhaj/contracts/personalisation';

import { PersonalRefusal, asRefusal } from '../domain/refusal.ts';

/**
 * Personalisation's answer to "does anybody hold this?" — for another
 * context's composition, never for a person's own surface.
 *
 * A SINGLE BIT. Whether at least one person saved or watched the target, and
 * nothing about who, how many or when: the caller decides only whether it may
 * withdraw something automatically or must leave it for a person
 * (MIGRATION_STRATEGY.md §7.2). No actor is taken because nothing personal is
 * returned; the question is asked by Layer 4 on the caller's own authority.
 */
export function createHoldingService(deps: { readonly holdings: PersonalHoldingPort }) {
  return {
    /** A malformed id is refused rather than answered `false`. */
    async videoHeld(videoId: string): Promise<boolean> {
      const parsed = personalIdSchema.safeParse(videoId);
      if (!parsed.success) throw new PersonalRefusal('invalid');
      return deps.holdings.videoHeld(parsed.data).catch(asRefusal);
    },
  };
}

export type HoldingService = ReturnType<typeof createHoldingService>;
