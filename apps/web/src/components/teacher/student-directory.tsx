'use client';

import { useId, useState, useSyncExternalStore } from 'react';

import { matchesLearner, PROGRESS_STAGES, type ProgressStage } from './student-progress';

/**
 * A TEACHER'S LEARNERS, SEARCHABLE (R2) — the bounded page the service
 * returned, narrowed in the browser by name and by how far each learner is.
 *
 * NOTHING NEW IS READ. The server rendered this page of learners — names from
 * Identity, progress from Learning, the listing audited — and hands the island
 * the same finished words; filtering hides rows already on the page and asks
 * nobody anything. It narrows THIS page only, and says so.
 *
 * PROGRESSIVE ENHANCEMENT. Without JavaScript the whole page is listed and the
 * search controls are not shown, because a control that does nothing is worse
 * than none.
 */

export interface DirectoryCourse {
  readonly id: string;
  readonly title: string;
  readonly lang: string | undefined;
  /** "Lessons complete: 3 of 10". */
  readonly progress: string;
  readonly completed: number;
  readonly total: number;
  readonly stage: ProgressStage;
  /** "Enrolled 3 Oct 2026", formatted on the server in the teacher's zone. */
  readonly enrolled: string;
}

export interface DirectoryRow {
  readonly accountId: string;
  readonly name: string;
  readonly href: string;
  readonly courses: readonly DirectoryCourse[];
}

export interface DirectoryWords {
  readonly label: string;
  readonly search: string;
  readonly stage: string;
  readonly allStages: string;
  readonly stages: Readonly<Record<ProgressStage, string>>;
  /** "Showing {shown} of {total} on this page". */
  readonly shown: string;
  readonly noMatch: string;
}

const subscribe = () => () => undefined;

const STAGE_TONES: Record<ProgressStage, string> = {
  'not-started': 'border-warning/40 bg-warning-surface text-warning',
  'in-progress': 'border-border-strong/60 bg-surface-raised text-foreground-muted',
  completed: 'border-success/40 bg-success-surface text-success',
};

export function StudentDirectory({
  rows,
  words,
  locale,
}: {
  readonly rows: readonly DirectoryRow[];
  readonly words: DirectoryWords;
  readonly locale: string;
}) {
  // True only once hydrated: the server render, and a browser without
  // JavaScript, never show controls that could not work.
  const interactive = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<ProgressStage | 'all'>('all');
  const id = useId();

  const visible = rows.filter((row) =>
    matchesLearner(
      { name: row.name, stages: row.courses.map((course) => course.stage) },
      query,
      stage,
    ),
  );
  const number = new Intl.NumberFormat(locale);

  return (
    <div className="flex flex-col gap-4">
      {interactive ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <label htmlFor={`${id}-search`} className="text-sm font-medium">
              {words.search}
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              className="w-full rounded-control border border-border-strong bg-surface-raised px-3 py-2 text-base"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-56">
            <label htmlFor={`${id}-stage`} className="text-sm font-medium">
              {words.stage}
            </label>
            <select
              id={`${id}-stage`}
              value={stage}
              onChange={(event) =>
                setStage(
                  PROGRESS_STAGES.find((value) => value === event.target.value) ?? 'all',
                )
              }
              className="w-full rounded-control border border-border-strong bg-surface-raised px-3 py-2 text-base"
            >
              <option value="all">{words.allStages}</option>
              {PROGRESS_STAGES.map((value) => (
                <option key={value} value={value}>
                  {words.stages[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      {interactive ? (
        <p role="status" className="text-sm text-foreground-muted">
          {words.shown
            .replace('{shown}', number.format(visible.length))
            .replace('{total}', number.format(rows.length))}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-sm text-foreground-muted">
          {words.noMatch}
        </p>
      ) : (
        <ol
          aria-label={words.label}
          className="rounded-panel border border-border bg-surface-raised px-4 shadow-panel sm:px-5"
        >
          {visible.map((row) => (
            <li
              key={row.accountId}
              className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-6"
            >
              <p className="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken font-serif text-base font-semibold text-foreground-muted"
                >
                  {Array.from(row.name.trim())[0] ?? ''}
                </span>
                <a
                  href={row.href}
                  dir="auto"
                  className="min-w-0 font-semibold wrap-anywhere text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-action"
                >
                  {row.name}
                </a>
              </p>
              <ul className="flex min-w-0 grow flex-col gap-3">
                {row.courses.map((course) => (
                  <li key={course.id} className="flex min-w-0 flex-col gap-1.5">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        lang={course.lang}
                        dir="auto"
                        className="min-w-0 text-sm font-medium wrap-anywhere"
                      >
                        {course.title}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold whitespace-nowrap ${STAGE_TONES[course.stage]}`}
                      >
                        {words.stages[course.stage]}
                      </span>
                    </p>
                    <span
                      aria-hidden="true"
                      className="block h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-sunken"
                    >
                      <span
                        className="block h-full rounded-full bg-action"
                        style={{
                          inlineSize: `${String(
                            course.total === 0
                              ? 0
                              : Math.round(
                                  (Math.min(course.completed, course.total) /
                                    course.total) *
                                    100,
                                ),
                          )}%`,
                        }}
                      />
                    </span>
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-foreground-muted">
                      <span>{course.progress}</span>
                      <span>{course.enrolled}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
