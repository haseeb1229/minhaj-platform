'use client';

import { useActionState } from 'react';

import { Alert, Button } from '@/components/ui';

/**
 * The one Client Component the authentication and administration surfaces use.
 *
 * Server Components by default (ARCHITECTURE.md §7); this opts out because a
 * form needs pending state and a result to announce, and both are genuinely
 * client concerns. Everything else on these pages stays on the server, so the
 * JavaScript an authentication page ships is this and nothing more.
 *
 * PROGRESSIVE ENHANCEMENT. The underlying `<form action={…}>` submits and works
 * with JavaScript disabled; `useActionState` adds the pending and result states
 * on top rather than being the mechanism.
 *
 * GENERIC OVER ITS STATE since Chunk 2. Identity and administration have
 * different failure vocabularies, and widening one union to hold both would
 * mean every call site could pass a failure the other's messages do not
 * describe. The shape they share — a status, an optional failure key — is what
 * this component actually depends on, so that is what it asks for.
 */
export interface FormActionState {
  readonly status: 'idle' | 'success' | 'error';
  /** Keys a message table; never a provider message and never a token. */
  readonly failure?: string;
  readonly retryAfter?: number;
}

export function ActionForm<State extends FormActionState>({
  action,
  submitLabel,
  pendingLabel,
  messages,
  children,
  tone = 'primary',
  preserveInput = false,
}: {
  readonly action: (state: State, form: FormData) => Promise<State>;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  /** Message for each outcome. Keyed by failure, with `success` and a default. */
  readonly messages: Readonly<Record<string, string>>;
  readonly children: React.ReactNode;
  readonly tone?: 'primary' | 'secondary' | 'destructive';
  /**
   * Keep what was typed when the action returns. React resets an action form's
   * uncontrolled fields once the action settles, which is right for a form
   * that succeeds by navigating away — and wrong for a long editorial form a
   * refusal sends back: the reason would appear above empty fields. Opting in
   * cancels that reset, so the author corrects the one field and saves again.
   */
  readonly preserveInput?: boolean;
}) {
  const [state, submit, pending] = useActionState<State, FormData>(action, {
    status: 'idle',
  } as Awaited<State>);

  const message =
    state.status === 'success'
      ? messages['success']
      : state.status === 'error'
        ? (messages[state.failure ?? 'unknown'] ?? messages['unknown'])
        : undefined;

  return (
    <form
      action={submit}
      className="flex flex-col gap-4"
      noValidate
      {...(preserveInput ? { onReset: (event) => event.preventDefault() } : {})}
    >
      {message === undefined ? null : (
        <Alert tone={state.status === 'success' ? 'success' : 'error'}>{message}</Alert>
      )}

      {children}

      <Button tone={tone} disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
