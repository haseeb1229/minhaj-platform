'use client';

import { useActionState } from 'react';

import type { StepUpPurpose } from '@minhaj/contracts/identity';

import { Alert, Button, Field, Panel, SectionHeading, TextInput } from '@/components/ui';
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
}: {
  readonly locale: string;
  readonly purpose: StepUpPurpose;
  readonly labels: StepUpLabels;
}) {
  const [state, submit, pending] = useActionState(grantStepUpAction, IDLE);

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
    <Panel>
      <form action={submit} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="purpose" value={purpose} />

        <SectionHeading>{labels.title}</SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {labels.description}
        </p>

        {state.status === 'success' ? (
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
        <Field id={`step-up-code-${purpose}`} label={labels.code} help={labels.codeHelp}>
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
  );
}
