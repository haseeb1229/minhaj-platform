'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * THE mega-menu framework (ROUTE_MAP.md §3.2, INFORMATION_ARCHITECTURE.md §3).
 *
 * ONE framework, nine menus. Every primary domain with a mega menu renders its
 * own panel inside this component rather than writing a second disclosure with
 * its own keyboard bugs.
 *
 * TWO TRIGGER SHAPES, one behaviour.
 *
 *   - BUTTON ONLY (`link` absent): the visible label IS the button. Explore is
 *     shaped this way — it is a gateway, and its landing is the panel's
 *     overview link.
 *   - LINK AND BUTTON (`link` present): the domain's name is an ordinary link to
 *     its landing, and a separate, compact button beside it discloses the panel
 *     (the "disclosure navigation with top-level links" pattern). The landing
 *     stays one Tab stop and one click away, and the panel never has to be
 *     opened to reach it; `label` is then the button's accessible name.
 *
 * WHY THE PANEL IS `children` RATHER THAN DATA. Everything inside it — every
 * column heading, every link, every translated label — is rendered on the
 * SERVER and handed here as already-rendered markup. This component ships the
 * open/closed behaviour and nothing else, so the browser never receives the
 * route registry, the menu grouping or the message catalogue
 * (ARCHITECTURE.md §13.8: minimal client JavaScript).
 *
 * WHY IT IS NOT A DIALOG. A mega menu is a disclosure attached to the page: it
 * does not trap focus, Tab moves through it and then out of it, and closing it
 * on focus leaving is what makes that predictable. Marking it `aria-modal`
 * would promise a trap that must not exist here — the mobile drawer is the
 * surface that genuinely is modal, and it lives in its own component.
 *
 * ONE AT A TIME, IN PRACTICE. Opening another menu means pressing somewhere
 * outside this one, or tabbing out of it — and both close it. So the panels
 * never stack, without the menus having to know about one another.
 *
 * NOT HOVER-ONLY. It opens on activation — pointer, Enter or Space, all through
 * a real `<button>`. A menu that opened on hover alone is unusable by keyboard
 * and unreliable by touch.
 *
 * POSITIONED AGAINST THE NAVIGATION BAR, not against its own trigger: the
 * wrapper is deliberately not a containing block, so the panel spans the bar
 * beneath it at any trigger position and in either direction, and can never be
 * pushed past the viewport's edge by a trigger near the end of the row.
 */
export function DisclosureMenu({
  label,
  link,
  currentPrefix,
  children,
}: {
  /**
   * The trigger's visible text when there is no `link`; otherwise the
   * disclosure button's accessible name. Translated on the server.
   */
  readonly label: string;
  /** The domain's landing, rendered as a link beside the button. */
  readonly link?: { readonly href: string; readonly text: string };
  /**
   * The locale-prefixed path this domain owns. While the visitor is on it or
   * beneath it, the trigger is marked as the current section.
   */
  readonly currentPrefix: string;
  /** The panel, rendered on the server. */
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = `${useId()}-panel`;
  const pathname = usePathname();
  const here = pathname === currentPrefix;
  const within = here || pathname.startsWith(`${currentPrefix}/`);

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

  /*
   * THE CURRENT-SECTION MARKER. A thin accent rule under the trigger, plus the
   * weight change, so the state is never colour alone. It is decorative: the
   * link's `aria-current` is what assistive technology hears.
   */
  const marker = within
    ? 'after:absolute after:start-3 after:end-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[color:var(--color-accent)]'
    : '';

  return (
    <div
      ref={containerRef}
      className="flex items-stretch"
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
      {link === undefined ? (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          className={`relative inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)] aria-expanded:bg-[color:var(--color-surface-sunken)] ${within ? 'font-semibold' : 'font-medium'} ${marker}`}
        >
          {label}
          <Chevron open={open} />
        </button>
      ) : (
        <>
          <a
            href={link.href}
            {...(within
              ? { 'aria-current': here ? ('page' as const) : ('true' as const) }
              : {})}
            className={`relative inline-flex min-h-11 items-center rounded-s-[var(--radius-control)] ps-3 pe-1.5 py-2 text-sm no-underline transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)] ${within ? 'font-semibold' : 'font-medium'} ${marker}`}
          >
            {link.text}
          </a>
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={label}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex min-h-11 min-w-7 items-center justify-center rounded-e-[var(--radius-control)] pe-2 ps-0.5 text-[color:var(--color-foreground-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-surface-sunken)] hover:text-[color:var(--color-foreground)] active:bg-[color:var(--color-border)] aria-expanded:bg-[color:var(--color-surface-sunken)] aria-expanded:text-[color:var(--color-foreground)]"
          >
            <Chevron open={open} />
          </button>
        </>
      )}

      <div
        id={panelId}
        /*
         * `hidden` rather than a class that merely moves it off-screen: a
         * closed panel must be out of the tab order and out of the
         * accessibility tree, not invisible but still focusable.
         */
        hidden={!open}
        className="absolute start-0 end-0 top-full z-[var(--layer-header)] mt-px rounded-b-[var(--radius-panel)] border border-t-2 border-[color:var(--color-border)] border-t-[color:var(--color-accent-rule)] bg-[color:var(--color-surface-raised)] p-6 shadow-[var(--shadow-raised)]"
      >
        {children}
      </div>
    </div>
  );
}

/** Decorative: the state it hints at is already announced by `aria-expanded`. */
function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12 12"
      className={`size-3 shrink-0 transition-transform duration-[var(--duration-fast)] ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}
