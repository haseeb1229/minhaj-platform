import 'server-only';

import type { QuranPublicReaderPort } from '@minhaj/contracts/quran';
import { createQuranPublicReader } from '@minhaj/database';

import { createQuranReadService } from '@/contexts/quran';

/**
 * The PUBLIC Quran composition root — every public Quran page, the Listen
 * recitation catalogue and the Quran sitemap read through this.
 *
 * A SEPARATE ROOT FROM `./quran.ts`, AND THE SPLIT IS A SECURITY BOUNDARY. The
 * administrative runtime wires Identity in; importing it would put the session
 * service and the authentication library into the module graph of an anonymous
 * page. This root reaches Quran's public reader and stops: no Identity, no
 * session, nothing that could read or write a cookie, and no method that
 * returns a draft, an unsourced work or anything at all while the corpus is
 * inactive (ARCHITECTURE.md §8.1).
 *
 * THE READER IS GUARDED. A malformed number, slug or identifier from an address
 * resolves to absent before any query is made.
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

interface QuranReadRuntime {
  readonly reader: QuranPublicReaderPort;
}

let runtime: QuranReadRuntime | null = null;

export function quranReadRuntime(): QuranReadRuntime {
  return (runtime ??= { reader: createQuranReadService(createQuranPublicReader()) });
}
