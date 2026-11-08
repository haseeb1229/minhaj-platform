import 'server-only';

import type { Locale } from '@minhaj/contracts';

import { NO_STAFF_AREAS, type MyStaffAreas } from '@/components/my/sections';
import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { appLogger } from '@/composition/logging';
import { decideStaffAreas } from './staff-areas';

/**
 * Whether THIS request's own session may enter the Teacher area or the
 * administration — the rule in `./staff-areas.ts`, asked of Identity &
 * Access's authorisation service, live.
 *
 * It never sends anyone away: no active session is simply "neither", and the
 * page beneath still runs its own guard with its own return path. A failure
 * to ask is logged by operation name only and offers neither area.
 */
export async function myStaffAreas(locale: Locale): Promise<MyStaffAreas> {
  const failed = () =>
    appLogger().error({ operation: 'my-staff-areas' }, 'Staff areas read failed.');
  let active: Awaited<ReturnType<typeof requireOwnSession>>;
  try {
    active = await requireOwnSession(locale);
  } catch {
    failed();
    return NO_STAFF_AREAS;
  }
  return decideStaffAreas(active?.session ?? null, async (session) => {
    try {
      return await identityRuntime().authorization.evaluate(session);
    } catch (error) {
      failed();
      throw error;
    }
  });
}
