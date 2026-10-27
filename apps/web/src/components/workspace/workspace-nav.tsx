'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { currentLinkKey, type WorkspaceLinkGroup } from './nav-match';

/**
 * A workspace's navigation: the area's sections, or one domain's tabs.
 *
 * A CLIENT ISLAND FOR ONE REASON. A layout is not told the path it is rendering
 * under, and `aria-current="page"` is what announces where the reader is rather
 * than merely showing it. The island reads the path and nothing else: it holds
 * no permission, imports no server root, and every entry it is given was
 * already filtered by the server. Hiding an entry is a kindness, never a
 * control — every page re-checks its own permission (SECURITY_BASELINE.md §3.4).
 *
 * TWO SHAPES, ONE ELEMENT. `sidebar` is a vertical list beside the content from
 * the `lg` breakpoint and a horizontal scroller below it; `tabs` is always a
 * horizontal scroller. There is never a second, hidden copy of the same links.
 * The scroller scrolls INSIDE itself, so a long area never widens the page at
 * 320 pixels, and it is padded so a focus outline is never clipped.
 *
 * STATE IS NOT COLOUR ALONE. The current entry carries `aria-current`, a heavier
 * weight and a border, so it survives monochrome and colour-vision deficiency.
 * No transition: nothing here moves (ARCHITECTURE.md §13.6).
 */
export function WorkspaceNav({
  label,
  groups,
  variant,
}: {
  readonly label: string;
  readonly groups: readonly WorkspaceLinkGroup[];
  readonly variant: 'sidebar' | 'tabs';
}) {
  const pathname = usePathname();
  const current = currentLinkKey(
    pathname,
    groups.flatMap((group) => group.links),
  );
  const list = useRef<HTMLUListElement>(null);

  // On a narrow screen the current entry may start out of view in the
  // scroller. Bring it in by scrolling THE LIST ONLY, sideways — never the page,
  // which may be restoring the reader's own scroll position. The deltas are
  // measured on screen, so the same arithmetic is right in either direction.
  useEffect(() => {
    const element = list.current;
    if (element === null || element.scrollWidth <= element.clientWidth) return;
    const item = element.querySelector('[aria-current="page"]');
    if (item === null) return;
    const bounds = element.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    // Room for the focus outline beside the entry, as the list's padding gives.
    const room = 8;
    if (box.left < bounds.left) element.scrollLeft -= bounds.left - box.left + room;
    else if (box.right > bounds.right)
      element.scrollLeft += box.right - bounds.right + room;
  }, [current]);

  if (variant === 'tabs') {
    return (
      <nav aria-label={label} className="min-w-0">
        <ul
          ref={list}
          className="flex gap-1 overflow-x-auto border-b border-border p-1 pb-0 [scrollbar-width:thin]"
        >
          {groups.flatMap((group) =>
            group.links.map((link) => {
              const here = link.key === current;
              return (
                <li key={link.key} className="shrink-0">
                  <a
                    href={link.href}
                    {...(here ? { 'aria-current': 'page' as const } : {})}
                    className={`flex min-h-11 items-center border-b-2 px-3 text-sm whitespace-nowrap ${
                      here
                        ? 'border-action font-semibold text-foreground'
                        : 'border-transparent text-foreground-muted hover:border-border-strong hover:text-foreground'
                    }`}
                  >
                    {link.text}
                  </a>
                </li>
              );
            }),
          )}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={label} className="min-w-0">
      <ul
        ref={list}
        className="flex gap-1 overflow-x-auto p-1 [scrollbar-width:thin] lg:flex-col lg:gap-5 lg:overflow-visible"
      >
        {groups.map((group) => (
          <li key={group.key} className="flex shrink-0 lg:flex-col lg:gap-1">
            {group.label === undefined ? null : (
              <span className="hidden px-3 text-xs font-semibold text-foreground-muted lg:block">
                {group.label}
              </span>
            )}
            <ul className="flex gap-1 lg:flex-col">
              {group.links.map((link) => {
                const here = link.key === current;
                return (
                  <li key={link.key} className="shrink-0">
                    <a
                      href={link.href}
                      {...(here ? { 'aria-current': 'page' as const } : {})}
                      className={`flex min-h-11 items-center rounded-control border px-3 text-sm whitespace-nowrap lg:whitespace-normal ${
                        here
                          ? 'border-border-strong bg-surface-raised font-semibold text-foreground'
                          : 'border-transparent text-foreground-muted hover:bg-surface-sunken hover:text-foreground'
                      }`}
                    >
                      {link.text}
                    </a>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
