'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * WHAT A CHANGE DID, SAID ALOUD — AND WHERE FOCUS GOES (My Minhaj Part 1).
 *
 * THE GAP THIS CLOSES. Removing a bookmark, marking a notification read or
 * clearing history re-renders the page without the row — and without the form
 * that was pressed, so its own "done" message is never seen, and keyboard
 * focus falls back to the document. This island sits at a FIXED place in the
 * page frame, so it outlives every row: when the server's answer changes the
 * list (`value`), it says the new state (`message`) in a polite live region
 * and, if the focused control has gone, moves focus to the list's own status
 * line (`focusId`), else to the page's heading.
 *
 * SHARED BY THE PRIVATE AREAS. My Minhaj and, since the Teacher area's R2
 * rebuild, the Teacher area's pages use it the same way; with no status line
 * to take focus, it falls back to the page's own `h1` in its `main`.
 *
 * PRESENTATION ONLY. It holds no permission, reads nothing and submits
 * nothing; `value` and `message` are what the server rendered. It says nothing
 * on the first render — only a change the person made since is news.
 *
 * NOT A `role="status"`. The live region is `aria-live` alone, so the forms'
 * own status messages stay the only `status` in the page's `main`.
 */
export function ChangeAnnouncer({
  value,
  message,
  focusId,
}: {
  /** What the list is now — its total, its order — as the server rendered it. */
  readonly value: string;
  /** The words for the list as it is now. */
  readonly message: string;
  /** The element that names the list's state, focused when focus was lost. */
  readonly focusId: string;
}) {
  const [seen, setSeen] = useState(value);
  const [said, setSaid] = useState<{ readonly text: string; readonly turn: number }>({
    text: '',
    turn: 0,
  });
  // Adjusting state while rendering, React's own pattern for a changed prop.
  if (seen !== value) {
    setSeen(value);
    setSaid((previous) => ({ text: message, turn: previous.turn + 1 }));
  }

  const announced = useRef(0);
  useEffect(() => {
    if (said.turn === announced.current) return;
    announced.current = said.turn;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const target =
      document.getElementById(focusId) ?? document.querySelector<HTMLElement>('main h1');
    if (target === null) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: false });
  }, [said, focusId]);

  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {said.text === '' ? null : <span key={said.turn}>{said.text}</span>}
    </p>
  );
}
