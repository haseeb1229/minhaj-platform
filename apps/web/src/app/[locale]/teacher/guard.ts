import 'server-only';

import { notFound } from 'next/navigation';

import type { ResolvedSession } from '@minhaj/contracts/identity';
import type { LearningActor } from '@minhaj/contracts/learning';

import { learningRuntime } from '@/composition/learning';
import { requireActiveSession } from '../my/guard';

/**
 * THE guard every `/teacher` surface runs first (ROUTE_MAP.md §6).
 *
 * It resolves the session through Identity's chokepoint exactly as `/my`
 * does, then asks Learning — which asks Identity, LIVE — whether this account
 * holds a current `teaching.perform` assignment NOW. A revoked assignment
 * stops answering on the next request (DOMAIN_MODEL.md §13.2).
 *
 * A SIGNED-IN VISITOR WHO IS NOT A TEACHER GETS 404, NOT 403. A 403 confirms
 * the area exists and that somebody may use it; for a privileged surface that
 * is a map handed to anyone with an account (SECURITY_BASELINE.md §1.5).
 *
 * NOT ACTIVATED IS NOT A 404. A teacher whose platform has not switched live
 * learning on is told so, honestly, on every page of the area — the routes
 * exist, their content does not yet.
 *
 * Route protection is navigational convenience, not a security boundary —
 * every mutation re-checks independently in its own Server Action, and every
 * teaching read re-asks Identity inside the service (§3.4 rule 2).
 */
export interface TeacherGate {
  readonly session: ResolvedSession;
  readonly actor: LearningActor;
  /** Live learning is activated; the area's content may be read. */
  readonly activated: boolean;
}

export async function requireTeacher(
  locale: string,
  returnPath: string,
): Promise<TeacherGate> {
  const session = await requireActiveSession(locale, returnPath);
  const actor = { accountId: session.account.id };
  const access = await learningRuntime().teaching.access(actor);
  if (access === 'not-a-teacher') notFound();
  return { session, actor, activated: access === 'teacher' };
}
