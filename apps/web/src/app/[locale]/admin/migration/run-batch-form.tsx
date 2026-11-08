'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';

import { Alert, Button } from '@/components/ui';
import type { RunBatchState } from './actions';

/**
 * R2. A run-wide act's form: the confirmation of the WHOLE candidate set the
 * page showed (run, size and fingerprint, as hidden fields), the fields the act
 * needs, an explicit confirmation, and the result — how many items were
 * decided, each one left as it was with the refusal that names why, and how
 * many candidates remain for the next confirmation.
 *
 * THE SAME MECHANISM AS THE PAGE-SIZED BULK FORMS. A `<form>` whose action is
 * a Server Action, with `useActionState` adding the pending and result
 * states; it submits without JavaScript too.
 *
 * NOT THE CONTROL. The action re-checks `migration.administer` live; the
 * service re-reads the set, refuses one that moved since, and decides and
 * audits every item on its own.
 */

const IDLE: RunBatchState = { status: 'idle' };

export function RunBatchForm({
  action,
  locale,
  runId,
  confirmation,
  names,
  labels,
  messages,
  children,
}: {
  readonly action: (state: RunBatchState, form: FormData) => Promise<RunBatchState>;
  readonly locale: string;
  readonly runId: string;
  readonly confirmation: { readonly count: number; readonly fingerprint: string };
  /** What to call a refused item this page shows, by id. */
  readonly names: Readonly<Record<string, string>>;
  readonly labels: {
    readonly confirm: string;
    readonly submit: string;
    readonly pending: string;
    readonly decided: string;
    readonly refused: string;
    readonly remaining: string;
    readonly unknownItem: string;
  };
  /** A message per outcome word: `success`, each failure and refusal, and `unknown`. */
  readonly messages: Readonly<Record<string, string>>;
  /** The act's own fields. */
  readonly children?: ReactNode;
}) {
  const [state, submit, pending] = useActionState(action, IDLE);

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
        <div className="flex flex-col gap-2 text-sm" data-testid="run-batch-outcome">
          <dl className="flex flex-wrap gap-x-6 gap-y-1">
            <div className="flex gap-2">
              <dt className="font-medium">{labels.decided}</dt>
              <dd>{count.format(state.decided)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">{labels.refused}</dt>
              <dd>{count.format(refused.length)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">{labels.remaining}</dt>
              <dd>{count.format(state.remaining ?? 0)}</dd>
            </div>
          </dl>
          {refused.length === 0 ? null : (
            <ul
              className="flex list-disc flex-col gap-1 ps-6"
              aria-label={labels.refused}
            >
              {refused.map((item) => (
                <li key={item.id}>
                  {names[item.id] === undefined ? (
                    labels.unknownItem
                  ) : (
                    <bdi className="break-all">{names[item.id]}</bdi>
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
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="expectedCount" value={String(confirmation.count)} />
      <input type="hidden" name="fingerprint" value={confirmation.fingerprint} />
      {children}

      <div className="flex items-start gap-2 text-sm">
        <input
          id={`run-batch-confirm-${runId}`}
          type="checkbox"
          name="confirm"
          required
          className="mt-1"
        />
        <label htmlFor={`run-batch-confirm-${runId}`}>{labels.confirm}</label>
      </div>

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
