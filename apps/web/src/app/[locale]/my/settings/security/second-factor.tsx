'use client';

import { useActionState } from 'react';

import { Alert, Button, Field, Panel, SectionHeading, TextInput } from '@/components/ui';
import {
  beginEnrolmentAction,
  confirmEnrolmentAction,
  confirmRecoveryCodesAction,
  disableSecondFactorAction,
  regenerateRecoveryCodesAction,
  type SecondFactorState,
} from './actions';

/**
 * Two-step verification, on the account's own security surface.
 *
 * A CLIENT COMPONENT, and for one specific reason: the setup key and the
 * recovery codes come back IN THE ACTION RESULT and are rendered from it. They
 * are never written to a cookie, a session store or any durable row of this
 * platform's, so holding them in component state for the length of one visit is
 * exactly as long as they may exist here. Reloading loses them, which is
 * correct (SECURITY_BASELINE.md §8.2).
 *
 * WHY IT IS REACHABLE WITH AN INCOMPLETE POSTURE. This is where a bootstrapped
 * or recovered administrator completes the setup their privileged capabilities
 * are waiting on. Gating it on the posture it exists to establish would make
 * the bootstrap circular (§8.3).
 */

const IDLE: SecondFactorState = { status: 'idle' };

export interface SecondFactorLabels {
  readonly heading: string;
  readonly help: string;
  readonly stateEnrolled: string;
  readonly stateIncomplete: string;
  readonly stateNone: string;
  readonly stateReenrol: string;
  readonly enrolIntro: string;
  readonly enrolSubmit: string;
  readonly enrolPending: string;
  readonly enrolUri: string;
  readonly enrolUriHelp: string;
  readonly enrolCodes: string;
  readonly enrolCodesHelp: string;
  readonly confirmCodes: string;
  readonly confirmCodesPending: string;
  readonly codesConfirmed: string;
  readonly verifyTitle: string;
  readonly verifyHelp: string;
  readonly code: string;
  readonly verifySubmit: string;
  readonly verifyPending: string;
  readonly verified: string;
  readonly regenerate: string;
  readonly regenerateHelp: string;
  readonly regenerateSubmit: string;
  readonly regeneratePending: string;
  readonly regenerated: string;
  readonly disable: string;
  readonly disableHelp: string;
  readonly disableSubmit: string;
  readonly disablePending: string;
  readonly disabled: string;
  readonly recoveryCode: string;
  readonly password: string;
  readonly invalidCode: string;
  readonly invalidCredentials: string;
  readonly notEnrolled: string;
  readonly alreadyEnrolled: string;
  readonly rateLimited: string;
  readonly unavailable: string;
  readonly checkFields: string;
}

export function SecondFactorSection({
  locale,
  enrolled,
  recoveryCodesConfirmed,
  reenrolmentRequired,
  labels,
}: {
  readonly locale: string;
  readonly enrolled: boolean;
  readonly recoveryCodesConfirmed: boolean;
  readonly reenrolmentRequired: boolean;
  readonly labels: SecondFactorLabels;
}) {
  const [begin, submitBegin, beginPending] = useActionState(beginEnrolmentAction, IDLE);
  const [verify, submitVerify, verifyPending] = useActionState(
    confirmEnrolmentAction,
    IDLE,
  );
  const [codes, submitCodes, codesPending] = useActionState(
    confirmRecoveryCodesAction,
    IDLE,
  );
  const [fresh, submitFresh, freshPending] = useActionState(
    regenerateRecoveryCodesAction,
    IDLE,
  );
  const [off, submitOff, offPending] = useActionState(disableSecondFactorAction, IDLE);

  function messageFor(state: SecondFactorState): string | undefined {
    if (state.status !== 'error') return undefined;
    switch (state.failure) {
      case 'invalid-code':
        return labels.invalidCode;
      case 'invalid-credentials':
        return labels.invalidCredentials;
      case 'not-enrolled':
        return labels.notEnrolled;
      case 'already-enrolled':
        return labels.alreadyEnrolled;
      case 'rate-limited':
        return labels.rateLimited;
      case 'invalid-input':
        return labels.checkFields;
      default:
        return labels.unavailable;
    }
  }

  /**
   * THE state sentence, chosen once.
   *
   * Never colour alone: each state is a sentence that says what is true and
   * what is missing, so it survives monochrome rendering, a screen reader and
   * colour-vision deficiency (SECURITY_BASELINE.md §16.1).
   */
  const summary = reenrolmentRequired
    ? { tone: 'warning' as const, text: labels.stateReenrol }
    : enrolled && recoveryCodesConfirmed
      ? { tone: 'success' as const, text: labels.stateEnrolled }
      : enrolled
        ? { tone: 'warning' as const, text: labels.stateIncomplete }
        : { tone: 'info' as const, text: labels.stateNone };

  // The enrolment payload, if this visit produced one. Never read back from
  // anywhere: it is the action result and nothing else.
  const issuedCodes = fresh.recoveryCodes ?? begin.recoveryCodes;
  const issuanceReceipt = fresh.recoveryCodeReceipt ?? begin.recoveryCodeReceipt;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="second-factor-heading">
      <div id="second-factor-heading">
        <SectionHeading>{labels.heading}</SectionHeading>
      </div>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">{labels.help}</p>

      <Alert tone={summary.tone}>{summary.text}</Alert>

      {/* ---- Not enrolled: begin -------------------------------------- */}
      {!enrolled ? (
        <Panel>
          <form action={submitBegin} className="flex flex-col gap-4" noValidate>
            <input type="hidden" name="locale" value={locale} />

            <p className="text-sm">{labels.enrolIntro}</p>

            {messageFor(begin) === undefined ? null : (
              <Alert tone="error">{messageFor(begin)}</Alert>
            )}

            <Field id="enrol-password" label={labels.password}>
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

            <Button disabled={beginPending} aria-busy={beginPending}>
              {beginPending ? labels.enrolPending : labels.enrolSubmit}
            </Button>
          </form>
        </Panel>
      ) : null}

      {/* ---- The setup key, shown once -------------------------------- */}
      {begin.totpUri === undefined ? null : (
        <Panel>
          <div className="flex flex-col gap-2">
            <SectionHeading>{labels.enrolUri}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {labels.enrolUriHelp}
            </p>
            <code className="block overflow-x-auto rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] p-3 text-xs break-all">
              {begin.totpUri}
            </code>
          </div>
        </Panel>
      )}

      {/* ---- Recovery codes, shown once ------------------------------- */}
      {issuedCodes === undefined ? null : (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{labels.enrolCodes}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {labels.enrolCodesHelp}
            </p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
              {issuedCodes.map((code) => (
                <li
                  key={code}
                  className="rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] px-3 py-2"
                >
                  {code}
                </li>
              ))}
            </ul>

            <form action={submitCodes} className="flex flex-col gap-2" noValidate>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="issuanceReceipt" value={issuanceReceipt ?? ''} />
              {messageFor(codes) === undefined ? null : (
                <Alert tone="error">{messageFor(codes)}</Alert>
              )}
              <Button tone="secondary" disabled={codesPending} aria-busy={codesPending}>
                {codesPending ? labels.confirmCodesPending : labels.confirmCodes}
              </Button>
            </form>
          </div>
        </Panel>
      )}

      {codes.outcome === 'codes-confirmed' ? (
        <Alert tone="success">{labels.codesConfirmed}</Alert>
      ) : null}

      {/* ---- Verify the first code ------------------------------------ */}
      {enrolled && !reenrolmentRequired ? null : (
        <Panel>
          <form action={submitVerify} className="flex flex-col gap-4" noValidate>
            <input type="hidden" name="locale" value={locale} />

            <SectionHeading>{labels.verifyTitle}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {labels.verifyHelp}
            </p>

            {verify.outcome === 'verified' ? (
              <Alert tone="success">{labels.verified}</Alert>
            ) : null}
            {messageFor(verify) === undefined ? null : (
              <Alert tone="error">{messageFor(verify)}</Alert>
            )}

            <Field id="verify-code" label={labels.code}>
              {(props) => (
                <TextInput
                  {...props}
                  name="code"
                  type="text"
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
              )}
            </Field>

            <Button disabled={verifyPending} aria-busy={verifyPending}>
              {verifyPending ? labels.verifyPending : labels.verifySubmit}
            </Button>
          </form>
        </Panel>
      )}

      {/* ---- Enrolled: replace codes, and turn it off ------------------ */}
      {enrolled && !reenrolmentRequired ? (
        <>
          <Panel>
            <form action={submitFresh} className="flex flex-col gap-4" noValidate>
              <input type="hidden" name="locale" value={locale} />

              <SectionHeading>{labels.regenerate}</SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {labels.regenerateHelp}
              </p>

              {fresh.outcome === 'regenerated' ? (
                <Alert tone="success">{labels.regenerated}</Alert>
              ) : null}
              {messageFor(fresh) === undefined ? null : (
                <Alert tone="error">{messageFor(fresh)}</Alert>
              )}

              <Field id="regenerate-password" label={labels.password}>
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

              <Field id="regenerate-code" label={labels.code}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="code"
                    type="text"
                    required
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                )}
              </Field>

              <Button tone="secondary" disabled={freshPending} aria-busy={freshPending}>
                {freshPending ? labels.regeneratePending : labels.regenerateSubmit}
              </Button>
            </form>
          </Panel>

          <Panel>
            <form action={submitOff} className="flex flex-col gap-4" noValidate>
              <input type="hidden" name="locale" value={locale} />

              <SectionHeading>{labels.disable}</SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {labels.disableHelp}
              </p>

              {off.outcome === 'disabled' ? (
                <Alert tone="success">{labels.disabled}</Alert>
              ) : null}
              {messageFor(off) === undefined ? null : (
                <Alert tone="error">{messageFor(off)}</Alert>
              )}

              <Field id="disable-password" label={labels.password}>
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

              <Field id="disable-code" label={labels.code}>
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

              <Field id="disable-recovery" label={labels.recoveryCode}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="recoveryCode"
                    type="text"
                    autoComplete="off"
                  />
                )}
              </Field>

              <Button tone="destructive" disabled={offPending} aria-busy={offPending}>
                {offPending ? labels.disablePending : labels.disableSubmit}
              </Button>
            </form>
          </Panel>
        </>
      ) : null}
    </section>
  );
}
