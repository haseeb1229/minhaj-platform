'use client';

import type { ReactNode } from 'react';

import { useCanonicalPathname } from '@/components/shell/canonical-pathname';

/**
 * A primary-navigation link that knows when the visitor is inside its section.
 *
 * `aria-current="page"` on the section's own landing and `true` beneath it, so
 * assistive technology hears "current" and the visual marker (a gold rule)
 * shows where the visitor is. Compared against the browser's own address —
 * `/library`, `/ur/library` — which is exactly what `href` was built from.
 */
export function NavLink({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const pathname = useCanonicalPathname();
  const inside = pathname === href || pathname.startsWith(`${href}/`);
  const current = pathname === href ? 'page' : inside ? 'true' : undefined;

  return (
    <a href={href} aria-current={current} className={className}>
      {children}
    </a>
  );
}
