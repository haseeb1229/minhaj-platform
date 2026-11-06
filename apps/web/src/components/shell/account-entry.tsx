'use client';

import { useEffect, useState } from 'react';

/**
 * THE ACCOUNT ENTRY — a private island in an anonymous header (R1).
 *
 * The header is rendered without reading any session (ARCHITECTURE.md §8.1), so
 * it first renders the entry every visitor shares: a link to My Minhaj, which
 * itself sends a signed-out visitor to sign in. After the page has loaded, this
 * island asks `/api/my/account-state` — same-origin, `no-store`, one boolean —
 * and, for a signed-out browser, relabels the link "Sign in"; for a signed-in
 * one it marks the entry as signed in. Nothing about the person is fetched or
 * shown, and a failed read leaves the shared entry exactly as it was.
 */
type State = 'unknown' | 'signed-in' | 'signed-out';

export function AccountEntry({
  myHref,
  signInHref,
  myLabel,
  signInLabel,
  signedInLabel,
  variant,
}: {
  readonly myHref: string;
  readonly signInHref: string;
  readonly myLabel: string;
  readonly signInLabel: string;
  /** Screen-reader suffix announcing the signed-in state. */
  readonly signedInLabel: string;
  readonly variant: 'bar' | 'drawer';
}) {
  const [state, setState] = useState<State>('unknown');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/my/account-state', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (typeof body === 'object' && body !== null && 'signedIn' in body)
          setState(body.signedIn === true ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        // The shared entry stays: it is correct for everyone.
      });
    return () => controller.abort();
  }, []);

  const signedOut = state === 'signed-out';
  const href = signedOut ? signInHref : myHref;
  const label = signedOut ? signInLabel : myLabel;

  const base =
    variant === 'bar'
      ? 'inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken'
      : 'flex min-h-12 items-center justify-center gap-2 rounded-control border border-border-strong px-4 text-base font-semibold no-underline hover:bg-surface-sunken';

  return (
    <a href={href} className={`${base} text-foreground`}>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className="size-5 shrink-0 text-foreground-muted"
      >
        <circle
          cx="12"
          cy="8.5"
          r="3.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M4.8 19.5c1.3-3.3 4-5 7.2-5s5.9 1.7 7.2 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {state === 'signed-in' ? (
          <circle cx="18.5" cy="6" r="3" className="fill-action" stroke="none" />
        ) : null}
      </svg>
      <span>{label}</span>
      {state === 'signed-in' ? <span className="sr-only">{signedInLabel}</span> : null}
    </a>
  );
}
