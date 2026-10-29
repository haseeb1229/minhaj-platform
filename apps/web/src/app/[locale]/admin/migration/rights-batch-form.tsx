'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';

import { Alert, Button, Field, Select, TextArea, TextInput } from '@/components/ui';
import { rightsManyAction, type RightsBatchState } from './actions';

/**
 * Phase 30-R. A run's bulk RIGHTS review: the page's restricted acquisitions,
 * selected by checkbox, cleared for release together under one licence, one
 * stated evidence and one rights holder — after an explicit confirmation.
 *
 * THE SAME MECHANISM AS THE BULK REVIEW. A `<form>` whose action is a Server
 * Action, with `useActionState` adding the pending and result states; it
 * submits without JavaScript too. The result names how many acquisitions were
 * cleared and each one left as it was, with the refusal that says why.
 *
 * NOT THE CONTROL. The action re-checks `migration.administer` live, and the
 * service decides, checks and audits every acquisition on its own; the
 * database refuses anything but owned or licensed material as eligible.
 */

const IDLE: RightsBatchState = { status: 'idle' };

export function RightsBatchForm({
  locale,
  urls,
  labels,
  defaults,
  messages,
  children,
}: {
  readonly locale: string;
  /** The original URLs of this page's acquisitions, by id, to name a refused one. */
  readonly urls: Readonly<Record<string, string>>;
  readonly labels: {
    readonly legend: string;
    readonly licence: string;
    readonly organisationOwned: string;
    readonly licensed: string;
    readonly evidence: string;
    readonly evidenceHelp: string;
    readonly rightsHolder: string;
    readonly confirm: string;
    readonly submit: string;
    readonly pending: string;
    readonly decided: string;
    readonly refused: string;
    readonly unknownAcquisition: string;
  };
  readonly defaults: { readonly evidence: string; readonly rightsHolder: string };
  /** A message per outcome word: `success`, each failure and refusal, and `unknown`. */
  readonly messages: Readonly<Record<string, string>>;
  /** The table of rows, each restricted one carrying its checkbox and version. */
  readonly children: ReactNode;
}) {
  const [state, submit, pending] = useActionState(rightsManyAction, IDLE);

  const message =
    state.status === 'success'
      ? messages['success']
      : state.status === 'error'
        ? (messages[state.failure ?? 'unknown'] ?? messages['unknown'])
        : undefined;
  const refused = state.refused ?? [];
  const count = new Intl.NumberFormat(locale);

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      {message === undefined ? null : (
        <Alert tone={state.status === 'success' ? 'success' : 'error'}>{message}</Alert>
      )}

      {state.decided === undefined ? null : (
        <div className="flex flex-col gap-2 text-sm" data-testid="rights-batch-outcome">
          <dl className="flex flex-wrap gap-x-6 gap-y-1">
            <div className="flex gap-2">
              <dt className="font-medium">{labels.decided}</dt>
              <dd>{count.format(state.decided)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">{labels.refused}</dt>
              <dd>{count.format(refused.length)}</dd>
            </div>
          </dl>
          {refused.length === 0 ? null : (
            <ul
              className="flex list-disc flex-col gap-1 ps-6"
              aria-label={labels.refused}
            >
              {refused.map((item) => (
                <li key={item.provenanceId}>
                  {urls[item.provenanceId] === undefined ? (
                    labels.unknownAcquisition
                  ) : (
                    <bdi dir="ltr" className="break-all">
                      {urls[item.provenanceId]}
                    </bdi>
                  )}
                  {' — '}
                  {messages[item.reason] ?? messages['unknown']}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <input type="hidden" name="locale" value={locale} />
      {children}

      <fieldset className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-4">
        <legend className="px-1 text-sm font-semibold">{labels.legend}</legend>
        <Field id="rights-batch-licence" label={labels.licence}>
          {(props) => (
            <Select {...props} name="licence" defaultValue="organisation-owned">
              <option value="organisation-owned">{labels.organisationOwned}</option>
              <option value="licensed">{labels.licensed}</option>
            </Select>
          )}
        </Field>
        <Field
          id="rights-batch-evidence"
          label={labels.evidence}
          help={labels.evidenceHelp}
        >
          {(props) => (
            <TextArea
              {...props}
              name="licenceEvidence"
              rows={3}
              minLength={10}
              maxLength={1000}
              required
              defaultValue={defaults.evidence}
            />
          )}
        </Field>
        <Field id="rights-batch-holder" label={labels.rightsHolder}>
          {(props) => (
            <TextInput
              {...props}
              name="rightsHolder"
              maxLength={200}
              required
              defaultValue={defaults.rightsHolder}
            />
          )}
        </Field>
        <div className="flex items-start gap-2 text-sm">
          <input
            id="rights-batch-confirm"
            type="checkbox"
            name="confirm"
            required
            className="mt-1"
          />
          <label htmlFor="rights-batch-confirm">{labels.confirm}</label>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} aria-busy={pending}>
          {labels.submit}
        </Button>
        {pending ? (
          <span role="status" className="text-sm">
            {labels.pending}
          </span>
        ) : null}
      </div>
    </form>
  );
}
