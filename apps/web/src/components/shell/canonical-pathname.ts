import { localizedPath, splitLocalePath } from '@minhaj/contracts';
import { usePathname } from 'next/navigation';

/**
 * The current page's CANONICAL pathname — the address the visitor sees.
 *
 * English is served by rewriting `/library` to `/en/library` internally
 * (Rebaseline R1), and Next may report that internal path. Every link the
 * platform renders is built by `localizedPath`, so a "current page" comparison
 * must normalise through the same contract: `/en/library` → `/library`,
 * `/ur/library` → `/ur/library`.
 */
export function useCanonicalPathname(): string {
  const parts = splitLocalePath(usePathname());
  return localizedPath(parts.locale, parts.rest);
}
