'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';

import { Alert, Button, Field, TextArea } from '@/components/ui';
import { reviewManyAction, type ReviewBatchState } from './actions';

/**
 * The staging list's bulk review: the page's pending rows, selected by
 * checkbox, approved or rejected together with one optional note.
 *
 * THE SAME MECHANISM AS EVERY ADMINISTRATION FORM. A `<form>` whose action is
 * a Server Action, with `useActionState` adding the pending and result states
 * on top — it submits without JavaScript too, the pressed button naming the
 * decision. This component exists only because the result is richer than one
 * message: how many revisions were decided, and each one left as it was with
 * the refusal that names why, read as text.
 *
 * NOT THE CONTROL. The action re-checks `migration.administer` live, and the
 * service decides, checks and audits every item exactly as a single review;
 * a row's checkbox is only offered while its review is pending.
 */

const IDLE: ReviewBatchState = { status: 'idle' };

export function ReviewBatchForm({
  locale,
  titles,
  labels,
  messages,
  children,
}: {
  readonly locale: string;
  /** The titles of this page's revisions, by id, to name a refused one. */
  readonly titles: Readonly<Record<string, string>>;
  readonly labels: {
    readonly note: string;
    readonly approve: string;
    readonly reject: string;
    readonly pending: string;
    readonly decided: string;
    readonly refused: string;
    readonly unknownRevision: string;
  };
  /** A message per outcome word: `success`, each failure and refusal, and `unknown`. */
  readonly messages: Readonly<Record<string, string>>;
  /** The table of rows, each pending one carrying its checkbox and version. */
  readonly children: ReactNode;
}) {
  const [state, submit, pending] = useActionState(reviewManyAction, IDLE);

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
        <div className="flex flex-col gap-2 text-sm" data-testid="review-batch-outcome">
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
                <li key={item.stagedRecordId}>
                  {titles[item.stagedRecordId] === undefined ? (
                    labels.unknownRevision
                  ) : (
                    <bdi>{titles[item.stagedRecordId]}</bdi>
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

      <Field id="review-batch-note" label={labels.note}>
        {(props) => <TextArea {...props} name="note" rows={2} maxLength={500} />}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button name="decision" value="approve" disabled={pending} aria-busy={pending}>
          {labels.approve}
        </Button>
        <Button
          name="decision"
          value="reject"
          tone="secondary"
          disabled={pending}
          aria-busy={pending}
        >
          {labels.reject}
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
