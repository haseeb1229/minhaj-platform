import 'server-only';

import { createPeopleReader } from '@minhaj/database';

import {
  createPeopleReadService,
  type PeopleReadService,
} from '@/contexts/people-contributors';

/**
 * The PUBLIC People composition root.
 *
 * A SECOND ROOT BESIDE `./people.ts`, AND THE SPLIT IS A SECURITY BOUNDARY
 * RATHER THAN TIDINESS.
 *
 * The full runtime in `./people.ts` wires Identity in, because the
 * administrative surface projects capabilities and the closure coordinator
 * releases links. Anything importing it therefore reaches
 * `@/composition/identity`, and through it the session service and the
 * authentication library.
 *
 * ARCHITECTURE.md §8.1 says "the anonymous public render tree must never read
 * session-derived state". The strongest available form of that guarantee is not
 * a rule about what a page calls — it is a module graph in which the capability
 * is ABSENT. The contributor profile, the two author aliases and the sitemap
 * partitions import THIS file, so the public tree reaches People's reader and
 * stops: no Identity, no session, no Better Auth, no authorisation service, and
 * nothing that could read a cookie.
 *
 * WHAT IT HANDS OVER IS ALSO NARROWER. `PeopleReadService` has three methods,
 * all reads, none of which returns a draft record or a linked account
 * identifier. A public page could not render private state from it even if it
 * tried, because the shape it receives has no field carrying any.
 *
 * SERVER-ONLY. The marker travels with the file, so a Client Component that
 * imports this — directly or through any chain — fails the build rather than
 * pulling database code into the browser.
 *
 * IT DOES REACH `@minhaj/database`, and that is Model A working as specified.
 * Layer 4 is the only place that knows both a port and its adapter
 * (ARCHITECTURE.md §3.1.1); the context receives an interface and can reach
 * neither the Prisma client nor the SQL behind it. What a public page must not
 * hold is raw database CAPABILITY, and it holds none — `createPeopleReader()`
 * returns four read methods.
 */

export interface PeopleReadRuntime {
  readonly people: PeopleReadService;
}

let runtime: PeopleReadRuntime | null = null;

/**
 * Builds the public People runtime once per process.
 *
 * Lazy, because constructing it opens no connection: the Prisma client behind
 * the adapter is itself lazily constructed, so importing this module costs
 * nothing until something actually reads a contributor. That is what keeps a
 * BUILD free of any database dependency even where a module graph reaches this
 * file (ARCHITECTURE.md §8.3.1).
 */
export function peopleReadRuntime(): PeopleReadRuntime {
  if (runtime !== null) return runtime;

  runtime = { people: createPeopleReadService({ reader: createPeopleReader() }) };

  return runtime;
}
