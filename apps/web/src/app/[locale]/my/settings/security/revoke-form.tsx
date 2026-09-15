'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui';
import { revokeSessionAction } from '../../../(identity)/actions';

/**
 * Sign one session out.
 *
 * The form carries the session's ID. Revoking needs its TOKEN, but a token is a
 * live bearer credential: rendering one per device would mean a saved copy of
 * this page — a browser cache, a screenshot, a support screen-share — handed
 * over every session the person has. The id is resolved back to a token inside
 * the adapter, against the caller's own session list only.
 *
 * A Client Component for the same reason the other forms are: pending state and
 * a result to announce. It is a POST bound to a Server Action, never a link —
 * signing a device out is a mutation (ROUTE_MAP.md §2.4).
 */
export function RevokeSessionForm({
  locale,
  sessionId,
  label,
  pendingLabel,
  failureLabel,
}: {
  readonly locale: string;
  readonly sessionId: string;
  readonly label: string;
  readonly pendingLabel: string;
  readonly failureLabel: string;
}) {
  const [state, submit, pending] = useActionState(revokeSessionAction, {
    status: 'idle' as const,
  });

  return (
    <form action={submit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="sessionId" value={sessionId} />

      <Button tone="secondary" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </Button>

      {state.status === 'error' ? (
        <p role="alert" className="text-xs text-[color:var(--color-error)]">
          {failureLabel}
        </p>
      ) : null}
    </form>
  );
}
