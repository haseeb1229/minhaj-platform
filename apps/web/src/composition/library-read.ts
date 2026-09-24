import 'server-only';

import { createLibraryPublicReader } from '@minhaj/database';

import { createLibraryReadService } from '@/contexts/library';

/**
 * The PUBLIC Library composition root.
 *
 * A SEPARATE ROOT FROM `./library.ts`, AND THE SPLIT IS A SECURITY BOUNDARY
 * RATHER THAN TIDINESS — the same split People has, for the same reason.
 *
 * The administrative runtime in `./library.ts` wires Identity in, because every
 * Library mutation is permission-checked. Anything importing it therefore
 * reaches `@/composition/identity`, and through it the session service and the
 * authentication library.
 *
 * ARCHITECTURE.md §8.1 says "the anonymous public render tree must never read
 * session-derived state", and ROUTE_MAP.md §36 of this phase's contract adds
 * that the public Work, listing and READER graph has no session dependency at
 * all. The strongest available form of that guarantee is not a rule about what a
 * page calls — it is a module graph in which the capability is ABSENT. Every
 * public Library surface imports THIS file, so the public tree reaches Library's
 * reader and stops: no Identity, no session, no Better Auth, no authorisation
 * service, and nothing that could read or write a cookie.
 *
 * WHAT IT HANDS OVER IS ALSO NARROWER. `createLibraryReadService` exposes five
 * reads, none of which returns a draft Work, an unpublished Edition, a private
 * asset identifier or an account identifier. A public page could not render
 * withheld state from it even if it tried, because the shape it receives has no
 * field carrying any.
 *
 * SERVER-ONLY. The marker travels with the file, so a Client Component that
 * imports this — directly or through any chain — fails the build rather than
 * pulling database code into the browser. The reader's preference island is a
 * Client Component for exactly that reason: it receives resolved content as
 * props and reaches nothing.
 *
 * IT DOES REACH `@minhaj/database`, and that is Model A working as specified.
 * Layer 4 is the only place that knows both a port and its adapter
 * (ARCHITECTURE.md §3.1.1); the context receives an interface and can reach
 * neither the Prisma client nor the SQL behind it.
 */

type LibraryReadRuntime = ReturnType<typeof createLibraryReadService>;

let runtime: LibraryReadRuntime | null = null;

/**
 * Builds the public Library runtime once per process.
 *
 * Lazy, because constructing it opens no connection: the Prisma client behind
 * the adapter is itself lazily constructed, so importing this module costs
 * nothing until something actually reads a Work. That is what keeps a BUILD free
 * of any database dependency even where a module graph reaches this file
 * (ARCHITECTURE.md §8.3.1).
 */
export function libraryReadRuntime(): LibraryReadRuntime {
  return (runtime ??= createLibraryReadService(createLibraryPublicReader()));
}

/**
 * The owners' names and content-language facts a Library page resolves, from
 * the ONE public implementation the Watch pages share
 * (`./public-references.ts`).
 */
export {
  contentLanguages as libraryContentLanguages,
  referenceNames as libraryReferenceNames,
  type ContentLanguage,
} from './public-references';
