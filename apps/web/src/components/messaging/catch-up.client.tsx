'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui';
import { checkForMessages } from './requests.client';

/**
 * "Check for new messages" (DELIVERY_PLAN.md Phase 24) — durable catch-up on
 * the person's request, and nothing else.
 *
 * NOT A SUBSCRIPTION. Nothing here polls, holds a connection open or runs on
 * a timer: one press asks the catch-up read what exists after the newest
 * message the page shows. When there is something, the page re-renders from
 * the server — the same authorised read that drew it — so a message appears
 * exactly as a reload would show it. Phase 25's realtime transport replaces
 * the press, not the read.
 *
 * ANNOUNCED. The outcome is spoken through a polite live region, so a screen
 * reader hears "2 new messages" or "No new messages" without hunting for it.
 */

export interface CatchUpLabels {
  readonly button: string;
  readonly checking: string;
  readonly none: string;
  /** Contains `{count}`. */
  readonly found: string;
  readonly more: string;
  readonly failures: Readonly<Record<string, string>>;
}

export function CatchUpButton({
  conversationId,
  after,
  locale,
  labels,
}: {
  readonly conversationId: string;
  /** The newest sequence the page shows. */
  readonly after: number;
  readonly locale: string;
  readonly labels: CatchUpLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  async function check() {
    if (busy) return;
    setBusy(true);
    setAnnouncement(labels.checking);
    const outcome = await checkForMessages(conversationId, after);
    setBusy(false);
    if (outcome.state === 'error') {
      setAnnouncement(
        labels.failures[outcome.failure] ?? labels.failures['unknown'] ?? '',
      );
      return;
    }
    if (outcome.count === 0) {
      setAnnouncement(labels.none);
      return;
    }
    const count = new Intl.NumberFormat(locale).format(outcome.count);
    setAnnouncement(
      `${labels.found.replace('{count}', count)}${outcome.more ? ` ${labels.more}` : ''}`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        tone="secondary"
        onClick={() => void check()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? labels.checking : labels.button}
      </Button>
      <p role="status" aria-live="polite" className="text-sm">
        {announcement}
      </p>
    </div>
  );
}
