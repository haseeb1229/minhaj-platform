import type { ReactNode } from 'react';

import { Sheet } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';

/**
 * THE PHONE AND TABLET NAVIGATION (R2) — the shared `Sheet` primitive, opened
 * from the header's Menu button, against the inline END (the left in Urdu and
 * Arabic).
 *
 * GENUINELY MODAL, unlike the desktop mega-navigation: it covers the page, so
 * the page behind it is inert, its scroll is locked, focus is kept inside and
 * returned to Menu on close, and Escape closes it — all from the one dialog
 * primitive rather than a second hand-written trap (ARCHITECTURE.md §13.6).
 *
 * ITS CONTENTS ARE SERVER-RENDERED, handed in as `children`; while it is
 * closed the native `<dialog>` renders nothing, so no hidden copy of the
 * navigation sits in the tab order.
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
  return (
    <Sheet
      title={title}
      hideTitle
      closeLabel={closeLabel}
      trigger={{
        label: (
          <>
            <Icon name="menu" />
            {/* At the narrowest phones the word yields its room; the button keeps it as its name. */}
            <span className="max-[22.5rem]:sr-only">{openLabel}</span>
          </>
        ),
        className:
          'inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong px-3 text-sm font-medium transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border',
      }}
    >
      {children}
    </Sheet>
  );
}
