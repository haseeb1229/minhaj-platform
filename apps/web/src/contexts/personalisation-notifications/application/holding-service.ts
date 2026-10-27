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
 * A SINGLE BIT. Whether at least one person saved, read or watched the target,
 * and nothing about who, how many or when: the caller decides only whether it
 * may withdraw something automatically or must leave it for a person
 * (MIGRATION_STRATEGY.md §7.2). No actor is taken because nothing personal is
 * returned; the question is asked by Layer 4 on the caller's own authority.
 *
 * Only the targets this context's tables can name are asked about: a Video, a
 * Work and an Article. A malformed id is refused rather than answered `false`.
 */
export function createHoldingService(deps: { readonly holdings: PersonalHoldingPort }) {
  function held(ask: (id: string) => Promise<boolean>) {
    return async (id: string): Promise<boolean> => {
      const parsed = personalIdSchema.safeParse(id);
      if (!parsed.success) throw new PersonalRefusal('invalid');
      return ask(parsed.data).catch(asRefusal);
    };
  }
  return {
    videoHeld: held((id) => deps.holdings.videoHeld(id)),
    workHeld: held((id) => deps.holdings.workHeld(id)),
    articleHeld: held((id) => deps.holdings.articleHeld(id)),
  };
}

export type HoldingService = ReturnType<typeof createHoldingService>;
