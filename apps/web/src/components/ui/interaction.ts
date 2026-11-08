/**
 * THE KEYBOARD AND SCROLL DECISIONS behind the client primitives (R2), as pure
 * functions — so the rules a keyboard visitor depends on are unit-tested here
 * rather than trusted to each island.
 */

export type Direction = 'ltr' | 'rtl';

/**
 * ROVING FOCUS across a row (tabs, the mega-navigation triggers): which item a
 * key moves to, or `null` when the key is not the row's to handle.
 *
 * The arrows follow what the visitor SEES: in a right-to-left row ArrowLeft
 * moves to the next item, because the next item is on the left. Home and End
 * go to the ends; the row wraps around at either end.
 */
export function rovingIndex(
  key: string,
  current: number,
  count: number,
  direction: Direction,
): number | null {
  if (count <= 0) return null;
  const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case forward:
      return (current + 1) % count;
    case backward:
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * THE FOCUS TRAP of a modal surface: on Tab from the last focusable element (or
 * Shift+Tab from the first) focus wraps to the other end. Returns the index to
 * focus, or `null` to let the browser move focus normally. Focus found outside
 * the list is brought back in at the end it would have entered from.
 */
export function trapFocusIndex(
  active: number,
  count: number,
  shift: boolean,
): number | null {
  if (count === 0) return null;
  if (active === -1) return shift ? count - 1 : 0;
  if (shift && active === 0) return count - 1;
  if (!shift && active === count - 1) return 0;
  return null;
}

/** How near an end (in CSS pixels) counts as AT that end, absorbing subpixel scroll. */
const EDGE_TOLERANCE = 2;

/**
 * Whether a horizontal scroller is at its start and its end. In a right-to-left
 * scroller `scrollLeft` runs from 0 to a NEGATIVE value, so the distance
 * travelled is its magnitude in either direction.
 */
export function scrollEdges(metrics: {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}): { readonly atStart: boolean; readonly atEnd: boolean } {
  const travelled = Math.abs(metrics.scrollLeft);
  const room = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  return {
    atStart: travelled <= EDGE_TOLERANCE,
    atEnd: travelled >= room - EDGE_TOLERANCE,
  };
}

/**
 * The horizontal distance one "next" or "previous" press scrolls: most of the
 * visible width, so one item stays in view for continuity, signed for the
 * reading direction (next is leftwards in a right-to-left scroller).
 */
export function scrollStep(
  towards: 'next' | 'previous',
  clientWidth: number,
  direction: Direction,
): number {
  const step = Math.max(1, Math.round(clientWidth * 0.85));
  const sign = (towards === 'next' ? 1 : -1) * (direction === 'rtl' ? -1 : 1);
  return sign * step;
}
