import type { ClassSessionRecord } from '@minhaj/contracts/learning';

/**
 * WHERE A CLASS STANDS, AND WHAT ITS TEACHER MAY STILL DO (R2, audit F38).
 * PURE: the caller supplies "now".
 *
 * THE SERVER RULE IS AUTHORITATIVE. Learning refuses a mark, and a "held",
 * for a class that has not started (`not-started`), a mark on a cancelled
 * class and any change to a closed one. This helper mirrors those rules so a
 * page never OFFERS a control the service would refuse; it grants nothing,
 * and a page rendered a minute before the start simply offers the control on
 * its next load.
 *
 *   upcoming   scheduled, not yet started
 *   live       scheduled, started, not yet ended
 *   ended      scheduled, ended, not yet marked held
 *   completed  marked held
 *   cancelled  cancelled
 */
export type ClassStage = 'upcoming' | 'live' | 'ended' | 'completed' | 'cancelled';

type Timed = Pick<ClassSessionRecord, 'state' | 'startsAt' | 'endsAt'>;

export function classStage(session: Timed, now: Date): ClassStage {
  if (session.state === 'cancelled') return 'cancelled';
  if (session.state === 'completed') return 'completed';
  if (now.getTime() < session.startsAt.getTime()) return 'upcoming';
  return now.getTime() < session.endsAt.getTime() ? 'live' : 'ended';
}

/** The controls a class's page may offer its teacher now. */
export interface ClassControls {
  /** Mark who was present: once the class has begun, and while it is not cancelled. */
  readonly attendance: boolean;
  /** Mark the class held: a scheduled class that has begun. */
  readonly complete: boolean;
  /** Move it, cancel it, or set its meeting link: a scheduled class. */
  readonly change: boolean;
}

export function classControls(session: Timed, now: Date): ClassControls {
  const started = session.startsAt.getTime() <= now.getTime();
  return {
    attendance: session.state !== 'cancelled' && started,
    complete: session.state === 'scheduled' && started,
    change: session.state === 'scheduled',
  };
}
