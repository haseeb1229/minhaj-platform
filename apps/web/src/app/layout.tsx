import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { defaultLocale, directionOf } from '@/config/locale';
import '@/styles/globals.css';

/**
 * Root layout — a Server Component, as every component is unless it opts out
 * (ARCHITECTURE.md §7).
 *
 * Deliberately STATIC. An earlier revision read runtime server configuration
 * here and marked the tree `force-dynamic`, which opted every public route out
 * of caching. ARCHITECTURE.md §8 requires the anonymous public tree to remain
 * cacheable, so configuration reading was moved off the render path entirely:
 * the process validates its environment at startup
 * (`apps/web/scripts/start.mjs`), and rendering uses the build-time locale
 * constant.
 *
 * Phase 0B does not implement the caching strategy. It only avoids destroying
 * the capability.
 *
 * Locale-prefixed routing, the locale switcher and translated metadata arrive
 * with the localisation phase (ROUTE_MAP.md §1); `lang` and `dir` are set here
 * so the RTL contract holds from the first render rather than being retrofitted.
 */

export const metadata: Metadata = {
  title: 'One Minhaj — Platform Foundation',
  description: 'Repository and tooling foundation for the One Minhaj digital platform.',
  // Nothing is published yet; the foundation must not be indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang={defaultLocale} dir={directionOf(defaultLocale)}>
      <body>{children}</body>
    </html>
  );
}
