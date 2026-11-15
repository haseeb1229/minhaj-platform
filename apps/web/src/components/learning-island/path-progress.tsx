'use client';

import { useEffect, useId, useState } from 'react';

import { ActionLink, TextLink } from '@/components/ui';
import { readPathStanding, type PathCourseStanding } from './requests';

/**
 * A person's own standing on a PUBLIC LearningPath page (Learn Part 2;
 * ARCHITECTURE.md §8.2).
 *
 * THE PAGE IS THE SAME FOR EVERYBODY. The server renders this island as an
 * empty frame whatever the request carries; only after the page has mounted
 * does the browser ask `/api/my/learning/path-state`, a private `no-store`
 * answer built from Learning's existing learner read of the path, and fill the
 * frame in. A failed or unexpected answer renders nothing — the page never
 * breaks because of it.
 *
 * A PATH IS AN ORDER, NOT AN ENROLMENT, AND THIS WRITES NOTHING. It states how
 * many of the path's Courses the person is enrolled on and how many of their
 * lessons they have completed, names the next Course to open, and leads to My
 * Learning. Enrolling stays on each Course's own page, through its own island.
 *
 * Labels arrive as a plain object from the public message catalogue; the
 * count lines are the catalogue's own messages with `{completed}` and
 * `{total}` left in them, filled here with numbers in the page's locale.
 */

export interface PathProgressLabels {
  readonly heading: string;
  readonly privacy: string;
  readonly signedOut: string;
  readonly signIn: string;
  /** "Courses enrolled on: {completed} of {total}", unformatted. */
  readonly enrolled: string;
  /** "Lessons complete: {completed} of {total}", unformatted. */
  readonly lessons: string;
  readonly allComplete: string;
  readonly notStarted: string;
  /** "Next, course {completed} of {total}:", unformatted. */
  readonly next: string;
  readonly open: string;
}

/** One public Course of the path, as the page already shows it. */
export interface PathProgressCourse {
  readonly id: string;
  readonly title: string;
  readonly lang: string;
  readonly href: string;
  readonly lessons: number;
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'ready'; readonly courses: readonly PathCourseStanding[] };

const PANEL =
  'flex flex-col gap-4 rounded-panel border border-border bg-surface-raised p-5 shadow-panel';

/** A count line with its numbers filled in, in the page's locale. */
function counted(template: string, locale: string, completed: number, total: number) {
  const number = new Intl.NumberFormat(locale);
  return template
    .replace('{completed}', number.format(completed))
    .replace('{total}', number.format(total));
}

export function PathProgressIsland({
  pathSlug,
  locale,
  courses,
  signInHref,
  myPathHref,
  labels,
}: {
  readonly pathSlug: string;
  readonly locale: string;
  /** The path's published Courses, in order. */
  readonly courses: readonly PathProgressCourse[];
  /** The sign-in page, returning to this path in My Learning. */
  readonly signInHref: string;
  readonly myPathHref: string;
  readonly labels: PathProgressLabels;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const headingId = `${useId()}-heading`;

  useEffect(() => {
    const controller = new AbortController();
    void readPathStanding(pathSlug, controller.signal).then((read) => {
      if (controller.signal.aborted) return;
      if (read.state === 'failed') setPhase({ kind: 'hidden' });
      else if (read.state === 'signed-out') setPhase({ kind: 'signed-out' });
      else setPhase({ kind: 'ready', courses: read.courses });
    });
    return () => controller.abort();
  }, [pathSlug]);

  if (phase.kind === 'loading' || phase.kind === 'hidden') return null;

  if (phase.kind === 'signed-out')
    return (
      <section aria-labelledby={headingId} className={PANEL}>
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-sm">{labels.signedOut}</p>
        <p>
          <ActionLink href={signInHref} tone="secondary">
            {labels.signIn}
          </ActionLink>
        </p>
      </section>
    );

  // Only the Courses the page shows are counted, each against its own public
  // lesson count — a stale answer can never claim more than the page holds.
  const standing = new Map(phase.courses.map((entry) => [entry.courseId, entry]));
  const enrolled = courses.filter((course) => standing.get(course.id)?.enrolled === true);
  const totalLessons = courses.reduce((sum, course) => sum + course.lessons, 0);
  const completedLessons = courses.reduce((sum, course) => {
    const entry = standing.get(course.id);
    return entry?.enrolled === true
      ? sum + Math.min(entry.completedLessons, course.lessons)
      : sum;
  }, 0);
  const nextIndex = courses.findIndex((course) => {
    const entry = standing.get(course.id);
    return (
      entry?.enrolled !== true ||
      Math.min(entry.completedLessons, course.lessons) < course.lessons
    );
  });
  const next = nextIndex === -1 ? undefined : courses[nextIndex];
  const done = totalLessons > 0 && completedLessons >= totalLessons && next === undefined;

  return (
    <section aria-labelledby={headingId} className={PANEL}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-sm text-foreground-muted">{labels.privacy}</p>
      </div>
      {enrolled.length === 0 ? (
        <p className="text-sm">{labels.notStarted}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">
            {counted(labels.enrolled, locale, enrolled.length, courses.length)}
          </p>
          {totalLessons === 0 ? null : (
            <>
              <p className="text-sm">
                {done
                  ? labels.allComplete
                  : counted(labels.lessons, locale, completedLessons, totalLessons)}
              </p>
              {/* The words carry the meaning; the bar only repeats them. */}
              <progress
                aria-hidden="true"
                value={completedLessons}
                max={totalLessons}
                className="h-2 w-full accent-action"
              />
            </>
          )}
        </div>
      )}
      {next === undefined ? null : (
        <p className="text-sm">
          <span className="text-foreground-muted">
            {counted(labels.next, locale, nextIndex + 1, courses.length)}{' '}
          </span>
          <TextLink href={next.href}>
            <span lang={next.lang} dir="auto" className="wrap-anywhere">
              {next.title}
            </span>
          </TextLink>
        </p>
      )}
      <p>
        <ActionLink href={myPathHref} tone="secondary">
          {labels.open}
        </ActionLink>
      </p>
    </section>
  );
}
