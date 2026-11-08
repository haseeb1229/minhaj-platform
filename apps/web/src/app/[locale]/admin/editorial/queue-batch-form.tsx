'use client';

import type { ReactNode } from 'react';
import { useActionState, useRef } from 'react';

import { Alert, Button } from '@/components/ui';
import { approveAndPublishSelected, type EditorialBatchState } from './actions';

/**
 * R2. The review queue's bulk "approve and publish" for one kind: the page's
 * in-review rows, selected by checkbox, approved and published together after
 * an explicit confirmation.
 *
 * THE SAME MECHANISM AS EVERY ADMINISTRATION FORM. A `<form>` whose action is
 * a Server Action, with `useActionState` adding the pending and result states;
 * it submits without JavaScript too. "Select all" only ticks the boxes on this
 * page, and needs script; without it each row is ticked by hand.
 *
 * NOT THE CONTROL. The action re-checks `content.review` and `content.publish`
 * live, and the service runs every record through the single-record workflow
 * — each approval and publication refused and audited on its own.
 */

const IDLE: EditorialBatchState = { status: 'idle' };

export function QueueBatchForm({
  locale,
  kind,
  titles,
  labels,
  messages,
  children,
}: {
  readonly locale: string;
  readonly kind: string;
  /** The titles of this page's records, by id, to name a refused one. */
  readonly titles: Readonly<Record<string, string>>;
  readonly labels: {
    readonly selectAll: string;
    readonly confirm: string;
    readonly submit: string;
    readonly pending: string;
    readonly decided: string;
    readonly refused: string;
    readonly unknownRecord: string;
  };
  /** A message per outcome word: `success`, each failure and refusal, and `unknown`. */
  readonly messages: Readonly<Record<string, string>>;
  /** The rows, each in-review one carrying its checkbox and version. */
  readonly children: ReactNode;
}) {
  const [state, submit, pending] = useActionState(approveAndPublishSelected, IDLE);
  const form = useRef<HTMLFormElement>(null);

  const message =
    state.status === 'success'
      ? messages['success']
      : state.status === 'error'
        ? (messages[state.failure ?? 'unknown'] ?? messages['unknown'])
        : undefined;
  const refused = state.refused ?? [];
  const count = new Intl.NumberFormat(locale);
  const confirmId = `queue-batch-confirm-${kind}`;

  return (
    <form ref={form} action={submit} className="flex flex-col gap-4" noValidate>
      {message === undefined ? null : (
        <Alert tone={state.status === 'success' ? 'success' : 'error'}>{message}</Alert>
      )}

      {state.decided === undefined ? null : (
        <div className="flex flex-col gap-2 text-sm">
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
                <li key={item.id}>
                  {titles[item.id] === undefined ? (
                    labels.unknownRecord
                  ) : (
                    <bdi>{titles[item.id]}</bdi>
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
      <input type="hidden" name="kind" value={kind} />
      <div>
        <Button
          type="button"
          tone="secondary"
          onClick={() => {
            form.current
              ?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="id"]')
              .forEach((box) => {
                box.checked = true;
              });
          }}
        >
          {labels.selectAll}
        </Button>
      </div>
      {children}

      <div className="flex items-start gap-2 text-sm">
        <input id={confirmId} type="checkbox" name="confirm" required className="mt-1" />
        <label htmlFor={confirmId}>{labels.confirm}</label>
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
