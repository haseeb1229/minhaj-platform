'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from './icon';
import { scrollEdges, scrollStep, type Direction } from './interaction';

/**
 * A SHELF (R2) — one horizontal row of covers, posters or cards that scrolls
 * sideways, with "previous" and "next" buttons.
 *
 * NOTHING IS HIDDEN BEHIND IT. Every item is in the server-rendered list and in
 * the tab order: tabbing onto an item scrolls it into view, a touch screen
 * swipes (with scroll snap), and the buttons are a convenience for a pointer.
 * They are real buttons with names, `disabled` at either end, and move by most
 * of the visible width so one item stays in view for continuity — mirrored in
 * Urdu and Arabic, where "next" lies to the left. Smooth only when the visitor
 * has not asked for reduced motion.
 *
 * The items are `children`: each must be an `li` (a `MediaCard` renders one).
 * `size` sets each item's width so a shelf shows a whole number of items.
 *
 * Usage:
 *   <Shelf label="Latest videos" previousLabel="Previous" nextLabel="Next" size="poster"
 *          header={<SectionHeader … />}>
 *     {videos.map((v) => <MediaCard key={v.id} … />)}
 *   </Shelf>
 */

const SIZES = {
  cover: '*:w-[9.5rem] sm:*:w-[11rem]',
  poster: '*:w-[16rem] sm:*:w-[18.5rem]',
  card: '*:w-[17rem] sm:*:w-[20rem]',
} as const;

const BUTTON =
  'inline-flex size-11 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface-raised';

export function Shelf({
  label,
  previousLabel,
  nextLabel,
  size = 'poster',
  header,
  children,
}: {
  /** The list's accessible name, usually the section heading's text. */
  readonly label: string;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly size?: keyof typeof SIZES;
  /** Shown at the inline start of the control row, such as a `SectionHeader`. */
  readonly header?: ReactNode;
  readonly children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });

  const measure = useCallback(() => {
    const list = listRef.current;
    if (list !== null) setEdges(scrollEdges(list));
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list === null) return undefined;
    measure();
    list.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      list.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure]);

  function move(towards: 'next' | 'previous') {
    const list = listRef.current;
    if (list === null) return;
    const direction: Direction =
      getComputedStyle(list).direction === 'rtl' ? 'rtl' : 'ltr';
    // `scroll-behavior` on the list makes this smooth, and the reduced-motion
    // rule in `globals.css` makes it instant.
    list.scrollBy(scrollStep(towards, list.clientWidth, direction), 0);
  }

  const scrollable = !(edges.atStart && edges.atEnd);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">{header}</div>
        {scrollable ? (
          <div className="flex shrink-0 gap-2 max-sm:hidden">
            <button
              type="button"
              onClick={() => move('previous')}
              disabled={edges.atStart}
              className={BUTTON}
            >
              <Icon name="chevron-start" />
              <span className="sr-only">{previousLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => move('next')}
              disabled={edges.atEnd}
              className={BUTTON}
            >
              <Icon name="chevron-end" />
              <span className="sr-only">{nextLabel}</span>
            </button>
          </div>
        ) : null}
      </div>
      <ul
        ref={listRef}
        aria-label={label}
        className={`-mx-1 flex snap-x snap-mandatory scroll-px-1 list-none gap-4 overflow-x-auto overscroll-x-contain px-1 pb-3 motion-safe:scroll-smooth *:shrink-0 *:snap-start ${SIZES[size]}`}
      >
        {children}
      </ul>
    </div>
  );
}
