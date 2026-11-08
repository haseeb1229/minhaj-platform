/**
 * HOW FAR A LEARNER IS, AS A TEACHER FILTERS BY IT (R2). PURE.
 *
 * Three words, from the Learning facts a teacher may see — lessons completed
 * of the Course's lessons — and nothing inferred beyond them: no "stalled",
 * because no last-activity date crosses into the Teacher area.
 */
export type ProgressStage = 'not-started' | 'in-progress' | 'completed';

export const PROGRESS_STAGES: readonly ProgressStage[] = [
  'not-started',
  'in-progress',
  'completed',
];

export function progressStage(completed: number, lessons: number): ProgressStage {
  if (lessons > 0 && completed >= lessons) return 'completed';
  return completed > 0 ? 'in-progress' : 'not-started';
}

/** A learner as the directory filters them: a name, and a stage per Course. */
export interface DirectoryLearner {
  readonly name: string;
  readonly stages: readonly ProgressStage[];
}

/**
 * Whether a learner matches a search and a stage filter. The search is a
 * case- and accent-insensitive "contains" on the display name; the stage
 * matches when ANY of the learner's Courses with this teacher is at it.
 */
export function matchesLearner(
  learner: DirectoryLearner,
  query: string,
  stage: ProgressStage | 'all',
): boolean {
  const fold = (value: string) =>
    value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const needle = fold(query.trim());
  if (needle !== '' && !fold(learner.name).includes(needle)) return false;
  return stage === 'all' || learner.stages.includes(stage);
}
