'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * The mobile navigation drawer.
 *
 * GENUINELY MODAL, which is why it is a separate component from the mega menu
 * rather than the same one at a different width. It covers the page, so focus
 * must not escape it, the page behind it must not scroll, and Escape must
 * close it — three obligations the disclosure menu deliberately does not have
 * (ARCHITECTURE.md §13.6).
 *
 * ITS CONTENTS ARE SERVER-RENDERED, handed in as `children`. Only the open and
 * closed behaviour is client code.
 *
 * NO DUPLICATE HIDDEN LINKS. The desktop navigation and this drawer are shown
 * and hidden by CSS at one breakpoint each, so exactly one of them is in the
 * tab order at any width; the drawer's own contents are `hidden` while it is
 * closed, which removes them from the tab order and from the accessibility tree
 * rather than merely from view.
 */
export function MobileNav({
  openLabel,
  closeLabel,
  title,
  children,
}: {
  readonly openLabel: string;
  readonly closeLabel: string;
  /** The drawer's accessible name. */
  readonly title: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerId = `${useId()}-drawer`;

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  /**
   * Locks the page behind the drawer.
   *
   * Through a class rather than an inline style, so the rule lives in the
   * stylesheet with every other layout decision and the cleanup is the removal
   * of one token. The effect's teardown runs on unmount as well as on close, so
   * a navigation while the drawer is open cannot leave the document locked.
   */
  useEffect(() => {
    if (!open) return undefined;

    const root = document.documentElement;
    root.classList.add('shell-scroll-locked');

    return () => root.classList.remove('shell-scroll-locked');
  }, [open]);

  /** Focus goes INTO the drawer when it opens, to its first control. */
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  /**
   * The focus trap.
   *
   * Hand-written because there is one dialog in the application and a
   * dependency for it would be a framework carried for a single consumer
   * (§56 of the phase contract). The list is recomputed on each Tab rather than
   * cached, and it holds only what is RENDERED: the drawer's sections are
   * native disclosures whose closed contents have no box and cannot take
   * focus, so a cached or unfiltered list would name a "last" element focus
   * can never reach — and the trap would leak at exactly that edge.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const drawer = drawerRef.current;
    if (drawer === null) return;

    const focusable = [
      ...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary'),
    ].filter((element) => element.getClientRects().length > 0);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;

    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-3 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)] lg:hidden"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
        {openLabel}
      </button>

      {/*
       * The scrim. `aria-hidden` and not focusable: it is the click target for
       * "dismiss", and a screen reader has Escape and the close button.
       */}
      <div
        hidden={!open}
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 z-[var(--layer-overlay)] bg-[color:var(--color-foreground)]/40"
      />

      <div
        ref={drawerRef}
        id={drawerId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        hidden={!open}
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 end-0 z-[var(--layer-overlay)] flex w-[min(24rem,100vw)] flex-col gap-5 overflow-y-auto overscroll-contain border-s border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-raised)]"
      >
        <div className="flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-3 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)]"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
            {closeLabel}
          </button>
        </div>

        {children}
      </div>
    </>
  );
}
