import 'server-only';

import type { HadithPublicReaderPort } from '@minhaj/contracts/hadith';
import { createHadithPublicReader } from '@minhaj/database';

import { createHadithReadService } from '@/contexts/hadith';

/**
 * The PUBLIC Hadith composition root — every public Hadith page and the Hadith
 * sitemap read through this.
 *
 * A SEPARATE ROOT FROM `./hadith.ts`, AND THE SPLIT IS A SECURITY BOUNDARY. The
 * administrative runtime wires Identity in; importing it would put the session
 * service and the authentication library into the module graph of an anonymous
 * page. This root reaches Hadith's public reader and stops: no Identity, no
 * session, nothing that could read or write a cookie, and no method that
 * returns an unverified, conflicted or withdrawn citation, a draft, an
 * unsourced work or anything at all while no collection is activated
 * (ARCHITECTURE.md §8.1).
 *
 * THE READER IS GUARDED. A malformed number, slug or identifier from an address
 * resolves to absent before any query is made.
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

interface HadithReadRuntime {
  readonly reader: HadithPublicReaderPort;
}

let runtime: HadithReadRuntime | null = null;

export function hadithReadRuntime(): HadithReadRuntime {
  return (runtime ??= { reader: createHadithReadService(createHadithPublicReader()) });
}
