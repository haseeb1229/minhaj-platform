'use client';

import { Sheet } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { useCanonicalPathname } from '@/components/shell/canonical-pathname';
import {
  currentLinkKey,
  type WorkspaceLinkGroup,
} from '@/components/workspace/nav-match';

/**
 * MY MINHAJ'S NAVIGATION (R2) — a grouped column beside the page on a wide
 * screen, and on a narrow one a bar naming where the reader is with one button
 * that opens the same list in a sheet.
 *
 * A CLIENT ISLAND FOR TWO REASONS: `aria-current` needs the path, which a
 * layout is not told, and the sheet's open state lives in the browser. It
 * holds no permission and reads nothing: every entry was chosen by the server
 * (`sections.ts`), and every page re-checks its own session whatever this
 * showed.
 *
 * ONE COPY AT A TIME. The column is `display: none` below `lg` and the bar is
 * `display: none` from `lg`, so assistive technology meets exactly one list;
 * the sheet's copy exists only while the sheet is open (a closed modal
 * `<dialog>` is not rendered).
 *
 * STATE IS NOT COLOUR ALONE: the current entry carries `aria-current`, a
 * heavier weight and a raised surface with its own outline.
 */
export function MyNav({
  label,
  groups,
  menuLabel,
  closeLabel,
  homeLabel,
}: {
  readonly label: string;
  readonly groups: readonly WorkspaceLinkGroup[];
  /** The narrow screen's button that opens the sheet. */
  readonly menuLabel: string;
  readonly closeLabel: string;
  /** Shown in the narrow bar when no entry claims the page. */
  readonly homeLabel: string;
}) {
  const pathname = useCanonicalPathname();
  const links = groups.flatMap((group) => group.links);
  const current = currentLinkKey(pathname, links);
  const here = links.find((link) => link.key === current);

  const list = (
    <ul className="flex flex-col gap-4">
      {groups.map((group) => (
        <li key={group.key} className="flex flex-col gap-0.5">
          {group.label === undefined ? null : (
            <span className="px-3 pt-1 pb-1 text-caption font-semibold text-foreground-muted">
              {group.label}
            </span>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.links.map((link) => {
              const active = link.key === current;
              return (
                <li key={link.key}>
                  <a
                    href={link.href}
                    {...(active ? { 'aria-current': 'page' as const } : {})}
                    className={`flex min-h-11 items-center rounded-control px-3 text-sm no-underline transition-colors duration-[var(--duration-fast)] ${
                      active
                        ? 'bg-surface-raised font-semibold text-foreground ring-1 ring-border-strong/40'
                        : 'text-foreground-muted hover:bg-surface-sunken hover:text-foreground'
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
  );

  return (
    <>
      <nav aria-label={label} className="hidden min-w-0 lg:block">
        {list}
      </nav>

      <div className="flex min-h-12 items-center justify-between gap-3 rounded-panel border border-border bg-surface-raised ps-4 pe-1.5 lg:hidden">
        <span className="min-w-0 truncate text-sm font-semibold">
          {here?.text ?? homeLabel}
        </span>
        <Sheet
          title={label}
          closeLabel={closeLabel}
          side="start"
          trigger={{
            label: (
              <>
                <Icon name="menu" size={20} />
                {menuLabel}
              </>
            ),
            className:
              'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-semibold text-action transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border',
          }}
        >
          <nav aria-label={label}>{list}</nav>
        </Sheet>
      </div>
    </>
  );
}
