import 'server-only';

import { appLogger } from '@/composition/logging';

/**
 * One owner read for a My Minhaj Personalisation page, with its failure kept
 * visible rather than thrown.
 *
 * A page whose read fails says so in the reader's language, inside its own
 * frame and navigation — not a blank screen, and never a count of zero that
 * reads as "you have nothing". The failure is logged by operation name only:
 * never an account, a target or anything the person keeps (§19.2).
 */
export type PersonalRead<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

export async function personalRead<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<PersonalRead<T>> {
  try {
    return { ok: true, value: await work() };
  } catch {
    appLogger().error({ operation }, 'Personalisation read failed.');
    return { ok: false };
  }
}
