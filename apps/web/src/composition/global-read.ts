import 'server-only';

import { createGlobalPublicReader } from '@minhaj/database';

import {
  createGlobalReadService,
  type GlobalReadService,
} from '@/contexts/global-network';

/**
 * The PUBLIC Global Network composition root — every directory page reads
 * through this.
 *
 * A SEPARATE ROOT FROM `./global.ts`, AND THE SPLIT IS A SECURITY BOUNDARY. The
 * administrative runtime wires Identity in; importing it would put the session
 * service and the authentication library into the module graph of an anonymous
 * page. This root reaches Global's public reader and stops: no Identity, no
 * session, nothing that could read or write a cookie, no personal location, and
 * no method that returns a draft or a record under a withheld ancestor
 * (ARCHITECTURE.md §8.1).
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

let runtime: GlobalReadService | null = null;

export function globalReadRuntime(): GlobalReadService {
  return (runtime ??= createGlobalReadService(createGlobalPublicReader()));
}
