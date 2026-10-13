import 'server-only';

import type { FatwaPublicReaderPort } from '@minhaj/contracts/fatwa';
import { createFatwaPublicReader } from '@minhaj/database';

import { createFatwaReadService } from '@/contexts/fatwa';

/**
 * The PUBLIC Fatwa composition root — every public Fatwa page, the topic hub's
 * Fatwa section and the Fatwa sitemap read through this.
 *
 * A SEPARATE ROOT FROM `./fatwa.ts`, AND THE SPLIT IS A SECURITY BOUNDARY. The
 * workflow runtime wires Identity in; importing it would put the session
 * service into the module graph of an anonymous page. This root reaches
 * Fatwa's public reader and stops: no Identity, no session, nothing that could
 * read or write a cookie, and — because the reader has no such method — no way
 * to reach a private question, a draft, a review note or a withdrawn ruling
 * (ARCHITECTURE.md §8.1).
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

interface FatwaReadRuntime {
  readonly reader: FatwaPublicReaderPort;
}

let runtime: FatwaReadRuntime | null = null;

export function fatwaReadRuntime(): FatwaReadRuntime {
  return (runtime ??= { reader: createFatwaReadService(createFatwaPublicReader()) });
}
