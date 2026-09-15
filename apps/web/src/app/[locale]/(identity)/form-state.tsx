'use client';

import { useActionState } from 'react';

import { Alert, Button } from '@/components/ui';
import type { ActionState } from './actions';

/**
 * The one Client Component the authentication surfaces use.
 *
 * Server Components by default (ARCHITECTURE.md §7); this opts out because a
 * form needs pending state and a result to announce, and both are genuinely
 * client concerns. Everything else on these pages stays on the server, so the
 * JavaScript an authentication page ships is this and nothing more.
 *
 * PROGRESSIVE ENHANCEMENT. The underlying `<form action={…}>` submits and works
 * with JavaScript disabled; `useActionState` adds the pending and result states
 * on top rather than being the mechanism.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  messages,
  children,
  tone = 'primary',
}: {
  readonly action: (state: ActionState, form: FormData) => Promise<ActionState>;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  /** Message for each outcome. Keyed by failure, with `success` and a default. */
  readonly messages: Readonly<Record<string, string>>;
  readonly children: React.ReactNode;
  readonly tone?: 'primary' | 'secondary' | 'destructive';
}) {
  const [state, submit, pending] = useActionState(action, { status: 'idle' });

  const message =
    state.status === 'success'
      ? messages['success']
      : state.status === 'error'
        ? (messages[state.failure ?? 'unknown'] ?? messages['unknown'])
        : undefined;

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
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
