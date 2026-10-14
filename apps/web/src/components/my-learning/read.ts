import 'server-only';

import { appLogger } from '@/composition/logging';

/**
 * One Learning read for a My Minhaj page, with its failure kept visible rather
 * than thrown — so a page whose read fails says so inside its own frame and
 * navigation, never as a blank screen or a count of zero that reads as "you
 * are on no course". The failure is logged by operation name only: never an
 * account, a Course or a lesson (SECURITY_BASELINE.md §19.2).
 */
export type LearningRead<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

export async function learningRead<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<LearningRead<T>> {
  try {
    return { ok: true, value: await work() };
  } catch {
    appLogger().error({ operation }, 'Learning read failed.');
    return { ok: false };
  }
}
