/**
 * WHICH MODULES THE MY MINHAJ HOME SHOWS (R2) — PURE, so "every module
 * renders only with something in it" is proved by unit test.
 *
 * The home page is the person's own: what to continue, what is next, what is
 * waiting. A module with nothing in it is not a module — it is a heading over
 * an apology, and a page of those is the status board this replaces. So each
 * module is chosen from what the reads returned, and a new account, which has
 * nothing yet, is shown how to begin instead of a wall of empties.
 *
 * A READ THAT FAILED IS NOT "NOTHING". The page names the parts it could not
 * show in one notice; it never turns an outage into an empty state.
 */

export type DashboardModule =
  | 'start'
  | 'continue'
  | 'upcoming'
  | 'saved'
  | 'interests'
  | 'messages'
  | 'notifications'
  | 'questions'
  | 'membership'
  | 'giving';

/** What the home page's reads found — counts and flags only, never content. */
export interface DashboardSignals {
  /** Things to continue: the last read, the last watched, a Quran position, a course. */
  readonly continuing: number;
  readonly upcomingClass: boolean;
  readonly saved: number;
  /** Interests the person chose (links to those public sections). */
  readonly interests: number;
  /** Whether the optional interests question was answered or skipped. */
  readonly interestsAnswered: boolean;
  readonly conversations: number;
  readonly notifications: number;
  readonly questions: number;
  /** An active Membership or an application in progress. */
  readonly membership: boolean;
  readonly donations: number;
}

/**
 * The "how to begin" steps still open. Choosing interests and saving a first
 * thing are the two that make the page the person's own; once both are done
 * the module is gone for good.
 */
export function startSteps(signals: DashboardSignals): {
  readonly interests: boolean;
  readonly save: boolean;
} {
  return { interests: !signals.interestsAnswered, save: signals.saved === 0 };
}

/** Whether the account has nothing of its own on this platform yet. */
export function isNewAccount(signals: DashboardSignals): boolean {
  return (
    signals.continuing === 0 &&
    !signals.upcomingClass &&
    signals.saved === 0 &&
    signals.conversations === 0 &&
    signals.notifications === 0 &&
    signals.questions === 0 &&
    !signals.membership &&
    signals.donations === 0
  );
}

/**
 * The modules, in reading order: begin (while a step is open), continue, what
 * is next, what is kept, then what is waiting, then the account's standing.
 * The main column takes the first group and the side column the rest — see
 * `dashboardColumns`.
 */
export function dashboardModules(signals: DashboardSignals): readonly DashboardModule[] {
  const steps = startSteps(signals);
  const shown: DashboardModule[] = [];
  if (steps.interests || steps.save) shown.push('start');
  if (signals.continuing > 0) shown.push('continue');
  if (signals.upcomingClass) shown.push('upcoming');
  if (signals.saved > 0) shown.push('saved');
  if (signals.interests > 0) shown.push('interests');
  if (signals.conversations > 0) shown.push('messages');
  if (signals.notifications > 0) shown.push('notifications');
  if (signals.questions > 0) shown.push('questions');
  if (signals.membership) shown.push('membership');
  if (signals.donations > 0) shown.push('giving');
  return shown;
}

const SIDE: ReadonlySet<DashboardModule> = new Set<DashboardModule>([
  'messages',
  'notifications',
  'questions',
  'membership',
  'giving',
]);

/** The modules split into the wide main column and the narrow side column. */
export function dashboardColumns(modules: readonly DashboardModule[]): {
  readonly main: readonly DashboardModule[];
  readonly side: readonly DashboardModule[];
} {
  return {
    main: modules.filter((module) => !SIDE.has(module)),
    side: modules.filter((module) => SIDE.has(module)),
  };
}

/** A course's progress as a whole percentage, for a meter beside its words. */
export function lessonPercent(completed: number, lessons: number): number {
  if (!Number.isFinite(lessons) || lessons <= 0) return 0;
  const bounded = Math.min(Math.max(0, completed), lessons);
  return Math.round((bounded / lessons) * 100);
}
