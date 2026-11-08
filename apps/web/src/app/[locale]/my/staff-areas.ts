import type { PermissionKey, ResolvedSession } from '@minhaj/contracts/identity';

import { NO_STAFF_AREAS, type MyStaffAreas } from '@/components/my/sections';
import { reachableSurfaces } from '../admin/surfaces';

/**
 * THE RULE FOR OFFERING THE TEACHER AREA AND THE ADMINISTRATION from My
 * Minhaj (owner direction 2026-11-08) — PURE, so it is proved by unit test;
 * `./staff.ts` wires it to this request's session and Identity.
 *
 * ONE QUESTION, THE SAME ONE THE AREAS ASK. The input is the session's
 * permissions as Identity & Access's authorisation service evaluates them —
 * live assignments of active roles, nothing cached — exactly as the
 * administration's shell reads them (`admin/layout.tsx`). The administration
 * is offered when that set opens at least one administrative surface
 * (`reachableSurfaces`, the shell's own filter); the Teacher area when it
 * carries `teaching.perform`, the permission whose live assignments the
 * Teacher gate asks Identity for.
 *
 * NOTHING ELSE COUNTS. A People profile, a teacher's public profile, a
 * Learning scope, a client claim, a query value: none is an input here, so
 * none can turn a link on — a profile alone grants nothing.
 *
 * A LINK IS A CONVENIENCE, NEVER A CONTROL. `/teacher` and `/admin` keep their
 * own gates, and every action beneath re-checks its own permission.
 *
 * FAIL CLOSED. No session, or any failure to ask, offers neither area.
 */

const TEACHING: PermissionKey = 'teaching.perform';

/** The staff areas a set of held permissions opens. */
export function staffAreasFrom(permissions: ReadonlySet<string>): MyStaffAreas {
  return {
    teacher: permissions.has(TEACHING),
    admin: reachableSurfaces(permissions).length > 0,
  };
}

/** The staff areas for a session, asked of Identity's `evaluate` — or none. */
export async function decideStaffAreas(
  session: ResolvedSession | null,
  evaluate: (
    session: ResolvedSession,
  ) => Promise<{ readonly permissions: ReadonlySet<string> }>,
): Promise<MyStaffAreas> {
  if (session === null) return NO_STAFF_AREAS;
  try {
    return staffAreasFrom((await evaluate(session)).permissions);
  } catch {
    return NO_STAFF_AREAS;
  }
}
