import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * The locale-free pathname of the current page, for the language control.
 *
 * Built from THE routing configuration so it agrees with the proxy about where
 * a locale prefix ends. Links between locales are NOT built here: every
 * localised address comes from `localizedPath` in `@minhaj/contracts`, which
 * gives English its unprefixed canonical address directly instead of a
 * `/en/…` hop.
 */
export const { usePathname } = createNavigation(routing);
