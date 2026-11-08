'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useCanonicalPathname } from '@/components/shell/canonical-pathname';
import { Icon } from '@/components/ui/icon';
import { rovingIndex, type Direction } from '@/components/ui/interaction';

/**
 * THE MEGA-NAVIGATION (R2) — the header's six grouped disclosures.
 *
 * DISCLOSURES, NOT A MENU AND NOT A DIALOG. Each group is a real `<button>`
 * with `aria-expanded`/`aria-controls` and its panel follows it in the DOM, so
 * Tab goes from the button straight into its open panel and on out of it. No
 * `role="menu"` (the links are ordinary links), no focus trap and no
 * `aria-modal`: the drawer on a phone is the modal surface, not this.
 *
 * KEYBOARD. Enter/Space toggles a group; ArrowDown opens it and moves into its
 * first link; ArrowLeft/ArrowRight (as the visitor sees them, so mirrored in
 * Urdu and Arabic), Home and End move between the group buttons; Escape closes
 * and returns focus to the group's button. ONE PANEL AT A TIME: opening a
 * group closes the other, and a press outside or focus leaving the navigation
 * closes it. Never hover-only — activation is always a press.
 *
 * THE PANELS ARE SERVER-RENDERED, handed in as nodes. The browser receives
 * the open/closed behaviour and nothing else: no route registry, no presence
 * policy, no message catalogue (ARCHITECTURE.md §13.8).
 *
 * POSITIONED AGAINST THE HEADER, not the button: nothing between the panel and
 * the `<header>` is a containing block, so every panel spans the header's full
 * width at any trigger position and in either direction.
 */
export interface MegaNavGroup {
  readonly id: string;
  readonly label: string;
  /**
   * The locale-prefixed addresses this group owns. While the visitor is on or
   * beneath one, the group's button carries the current-section marker.
   */
  readonly prefixes: readonly string[];
  /** The panel, rendered on the server. */
  readonly panel: ReactNode;
}

export function MegaNav({
  label,
  currentLabel,
  groups,
}: {
  /** The navigation's accessible name. */
  readonly label: string;
  /** Announced after the button of the group the visitor is inside. */
  readonly currentLabel: string;
  readonly groups: readonly MegaNavGroup[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const enterPanel = useRef<string | null>(null);
  const base = useId();
  const pathname = useCanonicalPathname();
  const current = groups.find((group) =>
    group.prefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ),
  )?.id;

  const panelId = (id: string) => `${base}-panel-${id}`;

  const closeAndReturn = useCallback(
    (id: string) => {
      setOpenId(null);
      triggers.current[groups.findIndex((group) => group.id === id)]?.focus();
    },
    [groups],
  );

  /** A press anywhere outside the navigation closes the open panel. */
  useEffect(() => {
    if (openId === null) return undefined;
    function onPointerDown(event: PointerEvent) {
      const nav = navRef.current;
      if (nav !== null && !nav.contains(event.target as Node)) setOpenId(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openId]);

  /** ArrowDown opened a panel: move into its first link once it is shown. */
  useEffect(() => {
    if (openId === null || enterPanel.current !== openId) return;
    enterPanel.current = null;
    document
      .getElementById(panelId(openId))
      ?.querySelector<HTMLElement>('a[href]')
      ?.focus();
  });

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const group = groups[index];
    if (group === undefined) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      enterPanel.current = group.id;
      setOpenId(group.id);
      return;
    }
    const direction: Direction =
      getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr';
    const next = rovingIndex(event.key, index, groups.length, direction);
    if (next === null) return;
    event.preventDefault();
    triggers.current[next]?.focus();
  }

  return (
    <nav
      ref={navRef}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && openId !== null) {
          event.stopPropagation();
          closeAndReturn(openId);
        }
      }}
      // Focus leaving the whole navigation closes it, so tabbing past the last
      // link of a panel never leaves it open over the page.
      // A press on a panel's own background moves focus nowhere
      // (`relatedTarget` is null) and must not close it; a press outside is
      // the pointer handler's to answer.
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next !== null && !event.currentTarget.contains(next)) setOpenId(null);
      }}
    >
      {/* Wraps rather than overflows if a translation ever outgrows the row. */}
      <ul className="flex list-none flex-wrap items-center gap-0.5 p-0">
        {groups.map((group, index) => {
          const open = openId === group.id;
          const inside = current === group.id;
          return (
            <li key={group.id}>
              <button
                ref={(element) => {
                  triggers.current[index] = element;
                }}
                type="button"
                aria-expanded={open}
                aria-controls={panelId(group.id)}
                onClick={() => setOpenId(open ? null : group.id)}
                onKeyDown={(event) => onTriggerKeyDown(event, index)}
                className={`relative inline-flex min-h-11 items-center gap-1 rounded-control px-2.5 text-[0.9375rem] whitespace-nowrap text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border aria-expanded:bg-surface-sunken xl:px-3 ${
                  inside
                    ? 'font-semibold after:absolute after:start-3 after:end-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-accent'
                    : 'font-medium'
                }`}
              >
                {group.label}
                {inside ? <span className="sr-only">{currentLabel}</span> : null}
                <Icon
                  name="chevron-down"
                  size={16}
                  className={`text-foreground-muted transition-transform duration-[var(--duration-fast)] ${open ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                id={panelId(group.id)}
                // `hidden`, not merely off-screen: a closed panel is out of the
                // tab order and the accessibility tree.
                hidden={!open}
                className="absolute inset-x-0 top-full z-[var(--layer-header)] border-t-2 border-b border-t-accent-rule border-b-border bg-surface-raised shadow-raised"
              >
                {group.panel}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
