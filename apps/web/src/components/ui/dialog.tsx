'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { Icon } from './icon';
import { trapFocusIndex } from './interaction';

/**
 * DIALOG AND SHEET (R2) — one modal surface, built on the browser's own
 * `<dialog>` opened with `showModal()`.
 *
 * WHAT THE PLATFORM GIVES, AND WHAT THIS ADDS. A modal `<dialog>` makes the
 * rest of the page inert (no pointer, no focus, hidden from assistive
 * technology) and turns Escape into a `cancel` event. On top of that this
 * component keeps focus INSIDE (Tab and Shift+Tab wrap rather than escaping to
 * the browser chrome), moves focus in on open, puts it back on the control
 * that opened it on close, closes on a press on the backdrop, and locks the
 * page's scroll for as long as it is open (`.shell-scroll-locked`).
 *
 *   `variant="modal"`  centred, for a short task (the search palette).
 *   `variant="sheet"`  full height against an inline edge — the END by
 *                      default, which is the left in Urdu and Arabic.
 *
 * THE CONTENTS ARE SERVER-RENDERED, handed in as `children`. Uncontrolled
 * with a `trigger` (the dialog renders its own opening button), or controlled
 * with `open`/`onOpenChange` when something else opens it, such as a keyboard
 * shortcut. Initial focus goes to an element marked `data-autofocus`, else to
 * the close button.
 *
 * A dialog is for a task that needs protected focus; a disclosure (the
 * mega-navigation) is not a dialog and does not trap.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const LAYOUTS = {
  modal:
    'mx-auto mt-[12dvh] mb-auto max-h-[76dvh] w-[min(40rem,calc(100vw-2rem))] rounded-panel',
  'sheet-end':
    'my-0 ms-auto me-0 h-dvh max-h-none w-[min(26rem,100vw)] border-s border-border',
  'sheet-start':
    'my-0 ms-0 me-auto h-dvh max-h-none w-[min(26rem,100vw)] border-e border-border',
} as const;

export interface DialogProps {
  /** The dialog's name, shown as its heading unless `hideTitle`. */
  readonly title: ReactNode;
  readonly hideTitle?: boolean;
  /** The close button's accessible name. */
  readonly closeLabel: string;
  readonly variant?: 'modal' | 'sheet';
  /** The edge a sheet opens from. */
  readonly side?: 'end' | 'start';
  /** An opening button the dialog renders itself (uncontrolled use). */
  readonly trigger?: {
    readonly label: ReactNode;
    /** The button's name when `label` is an icon. */
    readonly ariaLabel?: string;
    readonly className: string;
  };
  /** Controlled use: whether the dialog is open… */
  readonly open?: boolean;
  /** …and how it asks to change. */
  readonly onOpenChange?: (open: boolean) => void;
  readonly children: ReactNode;
}

export function Dialog({
  title,
  hideTitle = false,
  closeLabel,
  variant = 'modal',
  side = 'end',
  trigger,
  open: controlled,
  onOpenChange,
  children,
}: DialogProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const base = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    if (!open) {
      if (dialog.open) dialog.close();
      return undefined;
    }

    returnRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const root = document.documentElement;
    root.classList.add('shell-scroll-locked');
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? closeRef.current)?.focus();

    return () => {
      root.classList.remove('shell-scroll-locked');
      if (dialog.open) dialog.close();
      const back = returnRef.current;
      returnRef.current = null;
      // Back to the control that opened it, if it is still on the page.
      if (back !== null && back.isConnected) back.focus();
    };
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    ].filter((element) => element.getClientRects().length > 0);
    const target = trapFocusIndex(
      focusable.indexOf(document.activeElement as HTMLElement),
      focusable.length,
      event.shiftKey,
    );
    if (target === null) return;
    event.preventDefault();
    focusable[target]?.focus();
  }

  /** Escape: the browser's `cancel`, turned into an ordinary close. */
  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    setOpen(false);
  }

  /** A press on the backdrop lands on the `<dialog>` itself, never on its contents. */
  function onClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) setOpen(false);
  }

  const layout = variant === 'modal' ? LAYOUTS.modal : LAYOUTS[`sheet-${side}`];
  const dialogId = `${base}-dialog`;

  return (
    <>
      {trigger === undefined ? null : (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={dialogId}
          {...(trigger.ariaLabel === undefined
            ? {}
            : { 'aria-label': trigger.ariaLabel })}
          onClick={() => setOpen(true)}
          className={trigger.className}
        >
          {trigger.label}
        </button>
      )}
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={`${base}-title`}
        onKeyDown={onKeyDown}
        onCancel={onCancel}
        onClose={() => {
          if (open) setOpen(false);
        }}
        onClick={onClick}
        className={`border-0 bg-surface-raised p-0 text-foreground shadow-overlay backdrop:bg-ink/55 ${layout}`}
      >
        <div className="flex h-full max-h-[inherit] min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            <h2
              id={`${base}-title`}
              className={
                hideTitle ? 'sr-only' : 'font-serif text-subheading font-semibold'
              }
            >
              {title}
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              className="ms-auto inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong px-3 text-sm font-medium transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border"
            >
              <Icon name="close" size={16} />
              {closeLabel}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-6">
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}

/** A sheet: a `Dialog` against an inline edge, full height. */
export function Sheet(props: Omit<DialogProps, 'variant'>) {
  return <Dialog {...props} variant="sheet" />;
}
