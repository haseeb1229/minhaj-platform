'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

import { Button, TextLink } from '@/components/ui';
import {
  readCourseStanding,
  sendLearning,
  type CourseStanding,
  type LearningWrite,
} from './requests';

/**
 * A person's own Learning controls on a PUBLIC Course page — enrol, or on a
 * live Course request a trial class (DELIVERY_PLAN.md Phase 22;
 * ARCHITECTURE.md §8.2).
 *
 * THE PAGE IS THE SAME FOR EVERYBODY. The server renders this island as an
 * empty frame whatever the request carries — no session is read and no
 * personal value is in the HTML, so the public document stays shareable by any
 * cache (§8.1, SECURITY_BASELINE.md §17). Only after the page has mounted does
 * the browser ask `/api/my/learning/state`, a private `no-store` answer, and
 * fill the frame in.
 *
 * A PAGE NEVER BREAKS BECAUSE OF IT. Signed out, it offers "sign in to enrol"
 * with a return to this Course; if the private answer fails, it renders
 * nothing.
 *
 * ENROLMENT AND A TRIAL REQUEST ARE DIFFERENT ACTS, AND SAY SO. Enrolling
 * makes the person a learner on the Course. A trial request is a REQUEST: it
 * enrols nobody and schedules nothing, so the island never presents it as a
 * booked or confirmed class — it says, in words, that it has not been
 * scheduled.
 *
 * Labels arrive as a plain object built on the server from the public message
 * catalogue: this module reaches no server code and no translation provider.
 */

export interface LearningIslandLabels {
  readonly heading: string;
  readonly privacy: string;
  readonly signedOutPrompt: string;
  readonly signedOutLivePrompt: string;
  readonly signInToEnrol: string;
  readonly signInToRequestTrial: string;
  readonly sessionEnded: string;
  readonly enrol: string;
  readonly enrolHelp: string;
  readonly enrolled: string;
  readonly enrolledStatus: string;
  readonly continueLearning: string;
  readonly requestTrial: string;
  readonly trialHelp: string;
  readonly trialRequested: string;
  readonly trialRequestedStatus: string;
  readonly trialManage: string;
  readonly working: string;
  /** One message per refusal category; `unavailable` is the fallback. */
  readonly failures: Readonly<Record<string, string>> & { readonly unavailable: string };
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'signed-out'; readonly ended: boolean }
  | { readonly kind: 'ready'; readonly standing: CourseStanding };

interface Status {
  readonly tone: 'neutral' | 'success' | 'error';
  readonly text: string;
}

const PANEL =
  'flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] ' +
  'bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]';

const STATUS_TONES: Record<Status['tone'], string> = {
  neutral: 'text-[color:var(--color-foreground-muted)]',
  success: 'text-[color:var(--color-foreground)]',
  error: 'font-medium text-[color:var(--color-error)]',
};

export function LearningIsland({
  courseId,
  live,
  signInHref,
  myCourseHref,
  myLearningHref,
  labels,
}: {
  readonly courseId: string;
  readonly live: boolean;
  /** The sign-in page, returning to this Course's public page. */
  readonly signInHref: string;
  /** This Course in the person's own My Learning. */
  readonly myCourseHref: string;
  readonly myLearningHref: string;
  readonly labels: LearningIslandLabels;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const id = useId();
  const headingId = `${id}-heading`;

  useEffect(() => {
    const controller = new AbortController();
    void readCourseStanding(courseId, controller.signal).then((read) => {
      if (controller.signal.aborted) return;
      if (read.state === 'failed') setPhase({ kind: 'hidden' });
      else if (read.state === 'signed-out')
        setPhase({ kind: 'signed-out', ended: false });
      else setPhase({ kind: 'ready', standing: read.value });
    });
    return () => controller.abort();
  }, [courseId]);

  async function act(
    run: () => Promise<LearningWrite>,
    change: Partial<CourseStanding>,
    success: string,
  ) {
    if (busy) return;
    setBusy(true);
    setStatus({ tone: 'neutral', text: labels.working });
    const result = await run();
    if (result.ok) {
      setPhase((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', standing: { ...current.standing, ...change } }
          : current,
      );
      setStatus({ tone: 'success', text: success });
    } else if (result.failure === 'no-session') {
      setStatus(null);
      setPhase({ kind: 'signed-out', ended: true });
    } else {
      setStatus({
        tone: 'error',
        text: labels.failures[result.failure] ?? labels.failures.unavailable,
      });
    }
    setBusy(false);
  }

  const frame = (body: ReactNode) => (
    <div className="flex flex-col gap-3">
      {body}
      <p
        role="status"
        aria-live="polite"
        className={`text-sm empty:hidden ${status === null ? '' : STATUS_TONES[status.tone]}`}
      >
        {status?.text}
      </p>
    </div>
  );

  if (phase.kind === 'loading' || phase.kind === 'hidden') return frame(null);

  if (phase.kind === 'signed-out') {
    return frame(
      <section aria-labelledby={headingId} className={PANEL}>
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-sm">
          {phase.ended ? labels.sessionEnded : labels.signedOutPrompt}
        </p>
        {live ? <p className="text-sm">{labels.signedOutLivePrompt}</p> : null}
        <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <TextLink href={signInHref}>{labels.signInToEnrol}</TextLink>
          {live ? (
            <TextLink href={signInHref}>{labels.signInToRequestTrial}</TextLink>
          ) : null}
        </p>
      </section>,
    );
  }

  const { standing } = phase;

  return frame(
    <section aria-labelledby={headingId} className={PANEL}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {labels.privacy}
        </p>
      </div>

      {standing.enrolled ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            <span aria-hidden="true">✓ </span>
            {labels.enrolled}
          </p>
          <p className="text-sm">
            <TextLink href={myCourseHref}>{labels.continueLearning}</TextLink>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="self-start">
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => sendLearning('enrolments', courseId),
                  { enrolled: true },
                  labels.enrolledStatus,
                )
              }
            >
              {labels.enrol}
            </Button>
          </div>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {labels.enrolHelp}
          </p>
        </div>
      )}

      {!live ? null : standing.trialRequested ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{labels.trialRequested}</p>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {labels.trialHelp}
          </p>
          <p className="text-sm">
            <TextLink href={myLearningHref}>{labels.trialManage}</TextLink>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="self-start">
            <Button
              type="button"
              tone="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => sendLearning('trials', courseId),
                  { trialRequested: true },
                  labels.trialRequestedStatus,
                )
              }
            >
              {labels.requestTrial}
            </Button>
          </div>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {labels.trialHelp}
          </p>
        </div>
      )}
    </section>,
  );
}
