/**
 * WHICH MODULES THE MY MINHAJ HOME SHOWS — PURE, so the rule is proved by unit
 * test.
 *
 * EVERY SECTION HAS ITS MODULE, ALWAYS (owner direction 2026-11-08). Classes,
 * Learning, Saved, the Quran reading position, History, Messages,
 * Notifications, Questions, Membership and Donations are on the home page for
 * every account, each saying honestly what is there — or that nothing is yet —
 * with its ways onward. R2 showed a module only with something in it
 * (historical, superseded 2026-11-08 by owner direction).
 *
 * TWO MODULES STILL COME AND GO, because they are not sections: "Make My
 * Minhaj yours" while a first step is open, and "Continue" while there is
 * something to pick up. The person's chosen interests appear once chosen.
 *
 * A READ THAT FAILED IS NOT "NOTHING". The page names the parts it could not
 * show in one notice, and the module says it cannot be shown; it never turns
 * an outage into an empty state.
 */

export type DashboardModule =
  | 'start'
  | 'continue'
  | 'classes'
  | 'learning'
  | 'saved'
  | 'interests'
  | 'quran'
  | 'history'
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
 * The modules, in reading order: begin (while a step is open), continue
 * (while there is something to pick up), then every section — classes,
 * learning, what is kept, the person's interests once chosen, the Quran
 * position and history — then what is waiting and the account's standing.
 * See `dashboardColumns` for where each sits.
 */
export function dashboardModules(signals: DashboardSignals): readonly DashboardModule[] {
  const steps = startSteps(signals);
  return [
    ...(steps.interests || steps.save ? (['start'] as const) : []),
    ...(signals.continuing > 0 ? (['continue'] as const) : []),
    'classes',
    'learning',
    'saved',
    ...(signals.interests > 0 ? (['interests'] as const) : []),
    'quran',
    'history',
    'messages',
    'notifications',
    'questions',
    'membership',
    'giving',
  ];
}

/** Side by side in the main column on a wide screen: two short modules. */
const PAIRED: ReadonlySet<DashboardModule> = new Set<DashboardModule>([
  'quran',
  'history',
]);

const SIDE: ReadonlySet<DashboardModule> = new Set<DashboardModule>([
  'messages',
  'notifications',
  'questions',
  'membership',
  'giving',
]);

/**
 * The modules split into the wide main column, the pair beneath it and the
 * narrow side column.
 */
export function dashboardColumns(modules: readonly DashboardModule[]): {
  readonly main: readonly DashboardModule[];
  readonly paired: readonly DashboardModule[];
  readonly side: readonly DashboardModule[];
} {
  return {
    main: modules.filter((module) => !SIDE.has(module) && !PAIRED.has(module)),
    paired: modules.filter((module) => PAIRED.has(module)),
    side: modules.filter((module) => SIDE.has(module)),
  };
}

/** A course's progress as a whole percentage, for a meter beside its words. */
export function lessonPercent(completed: number, lessons: number): number {
  if (!Number.isFinite(lessons) || lessons <= 0) return 0;
  const bounded = Math.min(Math.max(0, completed), lessons);
  return Math.round((bounded / lessons) * 100);
}
