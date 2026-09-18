'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * THE mega-menu framework, proven with Explore (ROUTE_MAP.md §3.2).
 *
 * ONE framework, not one menu. Nine more primary domains arrive in later
 * phases, and each of them gets a menu by rendering its own panel inside this
 * component — not by writing a second disclosure with its own keyboard bugs.
 *
 * WHY THE PANEL IS `children` RATHER THAN DATA. Everything inside it — every
 * section heading, every link, every translated label — is rendered on the
 * SERVER and handed here as already-rendered markup. This component ships the
 * open/closed behaviour and nothing else, so the browser never receives the
 * route registry, the message catalogue, or forty-odd label strings
 * (ARCHITECTURE.md §13.8: minimal client JavaScript).
 *
 * WHY IT IS NOT A DIALOG. A mega menu is a disclosure attached to the page: it
 * does not trap focus, Tab moves through it and then out of it, and closing it
 * on focus leaving is what makes that predictable. Marking it `aria-modal`
 * would promise a trap that must not exist here — the mobile drawer is the
 * surface that genuinely is modal, and it lives in its own component.
 *
 * NOT HOVER-ONLY. It opens on activation — pointer, Enter or Space, all through
 * a real `<button>`. A menu that opened on hover alone is unusable by keyboard
 * and unreliable by touch.
 */
export function DisclosureMenu({
  label,
  children,
}: {
  /** The trigger's visible text, translated on the server. */
  readonly label: string;
  /** The panel, rendered on the server. */
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = `${useId()}-panel`;

  /** Closes, and puts focus back where the person left it. */
  const closeAndRestore = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  /**
   * A pointer press anywhere else closes the menu.
   *
   * `pointerdown` rather than `click`, so the menu is already closed by the
   * time the press lands on whatever was underneath it.
   */
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: PointerEvent) {
      const container = containerRef.current;
      if (container !== null && !container.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          closeAndRestore();
        }
      }}
      /*
       * TAB OUT CLOSES IT.
       *
       * `onBlur` is React's delegated `focusout`, so it fires for anything
       * inside the panel too. If focus has moved somewhere outside this
       * container, the menu has been left behind and closes — which is what
       * makes tabbing through the panel and onward feel ordinary rather than
       * leaving an open panel floating over the page.
       */
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium hover:bg-[color:var(--color-surface-sunken)]"
      >
        {label}
        {/* Decorative: the state it hints at is already announced by
            `aria-expanded`, so a screen reader must not read it twice. */}
        <span aria-hidden="true" className="text-xs">
          {open ? '−' : '+'}
        </span>
      </button>

      <div
        id={panelId}
        /*
         * `hidden` rather than a class that merely moves it off-screen: a
         * closed panel must be out of the tab order and out of the
         * accessibility tree, not invisible but still focusable.
         */
        hidden={!open}
        className="absolute start-0 top-full z-[var(--layer-header)] mt-1 w-[min(60rem,calc(100vw-2rem))] rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
      >
        {children}
      </div>
    </div>
  );
}
