'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';

import { Alert, Button, Icon } from '@/components/ui';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * THE NEWSLETTER'S FORMS (News & Events Part 2) — subscribing, confirming and
 * unsubscribing, each posting to its UNCHANGED Server Action. Only how an
 * answer is presented changed: a success replaces the form with one panel —
 * a heading that takes focus, the action's own words in a polite live region
 * and, where it helps, the way onwards — so a used button is never left to be
 * pressed again.
 *
 * ONE ANSWER FOR EVERY ADDRESS. The subscription panel shows the neutral words
 * the action has always answered with, whatever the address's state; nothing
 * here can tell those states apart, because the action never says. Only
 * malformed input, a spent rate budget, an unusable link and an outage are
 * told apart, as before.
 *
 * PROGRESSIVE ENHANCEMENT. The `<form action>` posts without JavaScript and the
 * page renders the answer. "Use another address" (subscribing only) brings
 * back an empty form and puts the cursor in it.
 */
export interface NewsletterFormLabels {
  readonly submit: string;
  readonly pending: string;
  readonly doneHeading: string;
  readonly done: string;
  /** Subscribing only: a fresh form for another address. */
  readonly again?: string;
  /** Keyed by failure, with `unknown` as the default. */
  readonly failures: Readonly<Record<string, string>>;
}

type Action = (state: FormActionState, form: FormData) => Promise<FormActionState>;

export function NewsletterForm({
  action,
  labels,
  next,
  headingLevel,
  children,
}: {
  readonly action: Action;
  readonly labels: NewsletterFormLabels;
  /** The success panel's heading, in the page's outline. */
  readonly headingLevel: 'h2' | 'h3';
  /** Where a reader may go once it is done. */
  readonly next?: { readonly href: string; readonly text: string };
  readonly children: ReactNode;
}) {
  // A fresh round is a fresh form: the action's state starts again at idle.
  const [round, setRound] = useState(0);
  return (
    <Round
      key={round}
      action={action}
      labels={labels}
      next={next}
      headingLevel={headingLevel}
      again={() => setRound((value) => value + 1)}
      focusOnMount={round > 0}
    >
      {children}
    </Round>
  );
}

function Round({
  action,
  labels,
  next,
  headingLevel: Heading,
  again,
  focusOnMount,
  children,
}: {
  readonly action: Action;
  readonly labels: NewsletterFormLabels;
  readonly next: { readonly href: string; readonly text: string } | undefined;
  readonly headingLevel: 'h2' | 'h3';
  readonly again: () => void;
  readonly focusOnMount: boolean;
  readonly children: ReactNode;
}) {
  const [state, submit, pending] = useActionState<FormActionState, FormData>(action, {
    status: 'idle',
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success') heading.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (focusOnMount)
      form.current
        ?.querySelector<HTMLInputElement>('input:not([type="hidden"])')
        ?.focus();
  }, [focusOnMount]);

  if (state.status === 'success')
    return (
      <div className="flex flex-col gap-4 rounded-panel border border-success bg-success-surface p-5">
        <Heading
          ref={heading}
          tabIndex={-1}
          className="flex items-center gap-2 text-subheading font-semibold"
        >
          <Icon name="check" size={20} className="shrink-0 text-success" />
          {labels.doneHeading}
        </Heading>
        <p role="status" className="max-w-[var(--measure-prose)] text-sm">
          {labels.done}
        </p>
        {labels.again === undefined && next === undefined ? null : (
          <p className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {labels.again === undefined ? null : (
              <Button type="button" tone="secondary" onClick={again}>
                {labels.again}
              </Button>
            )}
            {next === undefined ? null : (
              <a
                href={next.href}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
              >
                {next.text}
                <Icon name="arrow-end" size={16} />
              </a>
            )}
          </p>
        )}
      </div>
    );

  const failure =
    state.status === 'error'
      ? (labels.failures[state.failure ?? 'unknown'] ?? labels.failures['unknown'])
      : undefined;

  return (
    <form ref={form} action={submit} className="flex flex-col gap-4" noValidate>
      {failure === undefined ? null : <Alert tone="error">{failure}</Alert>}
      {children}
      <Button disabled={pending} aria-busy={pending}>
        {pending ? labels.pending : labels.submit}
      </Button>
    </form>
  );
}
