'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { rovingIndex, type Direction } from './interaction';

/**
 * IN-PAGE TABS (R2) — the WAI-ARIA tabs pattern, for views that share one
 * address (a reader's settings, a record's "Details · Contents").
 *
 * ROVING FOCUS. The tablist is ONE Tab stop: the selected tab. The arrow keys
 * move between tabs as the visitor sees them (mirrored in Urdu and Arabic),
 * Home and End go to the ends, and moving selects (automatic activation), so
 * the panel always matches the focused tab. Tab from the tablist goes into the
 * panel, which is itself focusable so a text-only panel can be reached.
 *
 * THE PANELS ARE SERVER-RENDERED, handed in as nodes; only the selection is
 * client state. Unselected panels are `hidden`, out of the tab order and the
 * accessibility tree. Tabs that are separate pages use `LinkTabs` instead.
 */
export function Tabs({
  label,
  tabs,
  defaultTab,
}: {
  /** The tablist's accessible name. */
  readonly label: string;
  readonly tabs: readonly {
    readonly id: string;
    readonly label: ReactNode;
    readonly panel: ReactNode;
  }[];
  /** The tab selected first; the first tab when absent or unknown. */
  readonly defaultTab?: string;
}) {
  const base = useId();
  const initial = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === defaultTab),
  );
  const [selected, setSelected] = useState(initial);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction: Direction =
      getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr';
    const next = rovingIndex(event.key, selected, tabs.length, direction);
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab, index) => {
          const active = index === selected;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(index)}
              className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm transition-colors duration-[var(--duration-fast)] hover:text-foreground ${
                active
                  ? 'border-accent font-semibold text-foreground'
                  : 'border-transparent font-medium text-foreground-muted hover:border-border-strong'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={index !== selected}
          tabIndex={0}
          className="min-w-0 rounded-control"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
