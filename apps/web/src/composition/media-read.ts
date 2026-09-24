import 'server-only';

import { createMediaPublicReader } from '@minhaj/database';

import { createMediaReadService } from '@/contexts/media';

/**
 * The PUBLIC Media composition root — every Watch page reads through this.
 *
 * A SEPARATE ROOT FROM `./media.ts`, AND THE SPLIT IS A SECURITY BOUNDARY. The
 * administrative runtime wires Identity in; importing it would put the session
 * service and the authentication library into the module graph of an anonymous
 * page. This root reaches Media's public reader and stops: no Identity, no
 * session, nothing that could read or write a cookie, and no method that
 * returns a draft (ARCHITECTURE.md §8.1).
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

type MediaReadRuntime = ReturnType<typeof createMediaReadService>;

let runtime: MediaReadRuntime | null = null;

export function mediaReadRuntime(): MediaReadRuntime {
  return (runtime ??= createMediaReadService(createMediaPublicReader()));
}
