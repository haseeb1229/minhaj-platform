import 'server-only';

import { cache } from 'react';

import { donationsReadRuntime } from '@/composition/donations-read';

/**
 * The giving page's one public read, shared by `generateMetadata` and the page
 * body through React's request cache, so the catalogue and the availability
 * are asked once per request.
 *
 * SESSION-FREE BY CONSTRUCTION. `donationsReadRuntime()` reaches the published
 * campaigns and the activation record and stops: no Identity, no session, no
 * cookie, no donation and no provider secret is on this path
 * (ARCHITECTURE.md §8.1).
 */
export const readDonatePage = cache(() => donationsReadRuntime().page.page());
