'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { StepUpPurpose } from '@minhaj/contracts/identity';

import { Alert, Button, Field, Panel, SectionHeading, TextInput } from '@/components/ui';
import { STEP_UP_GRANTED, stepUpAnchor } from '@/components/ui/step-up-event';
import { grantStepUpAction, type StepUpActionState } from './actions';

/**
 * THE step-up prompt.
 *
 * Present on every administrative surface that can change something, and
 * present even when a grant is already live — because a grant expires in
 * minutes and a person who has just been refused needs the remedy on the same
 * screen, not a hunt for where to re-prove themselves.
 *
 * IT IS NOT THE CONTROL. Earning a grant here authorises nothing by itself:
 * the action still re-checks the permission, the privileged posture and the
 * grant, server-side, at submit time. This is the form that lets somebody
 * satisfy one of those three (SECURITY_BASELINE.md §8.1).
 *
 * SCOPED. `purpose` says which class of operation the grant covers, so proving
 * yourself to edit a role does not silently authorise changing an account's
 * status.
 *
 * RESUMING (R2, audit F35). Two things happen once a grant is earned:
 *
 *   - the prompt announces it (`STEP_UP_GRANTED`), and any form on the page
 *     that was refused for want of exactly this proof sends its held
 *     submission again, so the person does not redo the change — the server
 *     re-checks it from the start, as it would any submission;
 *   - if the page named itself as `returnTo` and the reader has since moved
 *     elsewhere, they are taken back there. The action validates the address
 *     against the purpose and drops anything else; the page reopens at this
 *     prompt's own anchor (`stepUpAnchor`), and the prompt, seeing that
 *     anchor, says the confirmation worked. None of this grants anything.
 */
const IDLE: StepUpActionState = { status: 'idle' };

export interface StepUpLabels {
  readonly title: string;
  readonly description: string;
  readonly password: string;
  readonly code: string;
  readonly codeHelp: string;
  readonly submit: string;
  readonly pending: string;
  readonly granted: string;
  readonly invalidCredentials: string;
  readonly invalidCode: string;
  readonly rateLimited: string;
  readonly unavailable: string;
  readonly checkFields: string;
}

export function StepUpPrompt({
  locale,
  purpose,
  labels,
  returnTo,
}: {
  readonly locale: string;
  readonly purpose: StepUpPurpose;
  readonly labels: StepUpLabels;
  /** This page's own address (and anchor), to resume at after confirming. */
  readonly returnTo?: string;
}) {
  const [state, submit, pending] = useActionState(grantStepUpAction, IDLE);
  const anchor = stepUpAnchor(purpose);
  const [resumed, setResumed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== 'success') return;
    window.dispatchEvent(new CustomEvent(STEP_UP_GRANTED, { detail: { purpose } }));
    if (state.resume === undefined) return;
    const here = window.location.pathname + window.location.search;
    if (state.resume.split('#', 1)[0] !== here) router.push(state.resume);
  }, [state, purpose, router]);

  // Arriving at this prompt's anchor means the grant was just earned and the
  // page reloaded around it. Say so once, then drop the anchor so a reload
  // later does not repeat a stale "confirmed".
  useEffect(() => {
    if (window.location.hash !== `#${anchor}`) return;
    setResumed(true);
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
  }, [anchor]);

  const failure =
    state.status !== 'error'
      ? undefined
      : state.failure === 'invalid-credentials'
        ? labels.invalidCredentials
        : state.failure === 'invalid-code'
          ? labels.invalidCode
          : state.failure === 'rate-limited'
            ? labels.rateLimited
            : state.failure === 'invalid-input'
              ? labels.checkFields
              : labels.unavailable;

  return (
    <div id={anchor} className="scroll-mt-6">
      <Panel>
        <form action={submit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="purpose" value={purpose} />
          {returnTo === undefined ? null : (
            <input type="hidden" name="returnTo" value={returnTo} />
          )}

          <SectionHeading>{labels.title}</SectionHeading>
          <p className="text-sm text-foreground-muted">{labels.description}</p>

          {state.status === 'success' || (resumed && state.status === 'idle') ? (
            <Alert tone="success">{labels.granted}</Alert>
          ) : null}
          {failure === undefined ? null : <Alert tone="error">{failure}</Alert>}

          <Field id={`step-up-password-${purpose}`} label={labels.password}>
            {(props) => (
              <TextInput
                {...props}
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            )}
          </Field>

          {/*
           * The code is OPTIONAL in the form and REQUIRED by the service whenever
           * a factor is enrolled. It is not marked required here because the one
           * account that legitimately has none — a bootstrapped administrator
           * mid-setup — would otherwise be unable to submit the form at all.
           */}
          <Field
            id={`step-up-code-${purpose}`}
            label={labels.code}
            help={labels.codeHelp}
          >
            {(props) => (
              <TextInput
                {...props}
                name="code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
              />
            )}
          </Field>

          <Button tone="secondary" disabled={pending} aria-busy={pending}>
            {pending ? labels.pending : labels.submit}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
