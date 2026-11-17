'use client';

import { useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/forms';
import { Icon } from '@/components/ui/icon';

/** The island has no outside state to follow: only whether it has hydrated. */
const noSubscription = () => () => undefined;

/**
 * SHARE A VIDEO (Watch Part 1) — the device's own share sheet where the
 * browser has one, else the address copied to the clipboard, said in a polite
 * live region. The address is the Video's canonical one, handed over by the
 * page; this island sends nothing anywhere and records nothing about the
 * visit.
 *
 * PRESENT ONLY WITH SCRIPT. Sharing needs the browser's APIs, so the button
 * appears once the island has hydrated — never an inert control on a page read
 * without JavaScript, whose address bar already holds the same address.
 */
export function ShareVideo({
  url,
  title,
  labels,
}: {
  readonly url: string;
  readonly title: string;
  readonly labels: {
    readonly share: string;
    readonly copied: string;
    readonly failed: string;
  };
}) {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [status, setStatus] = useState('');

  async function share() {
    setStatus('');
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setStatus(labels.copied);
      }
    } catch (error) {
      // A visitor closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus(labels.failed);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {hydrated ? (
        <Button type="button" tone="secondary" onClick={() => void share()}>
          <Icon name="share" size={16} className="me-2" />
          {labels.share}
        </Button>
      ) : null}
      <span role="status" aria-live="polite" className="text-sm text-foreground-muted">
        {status}
      </span>
    </span>
  );
}
