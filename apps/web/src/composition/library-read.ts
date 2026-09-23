import 'server-only';

import type { Locale } from '@minhaj/contracts';
import { createLibraryPublicReader } from '@minhaj/database';

import { createLibraryReadService } from '@/contexts/library';
import { peopleReadRuntime } from './people-read';
import { taxonomyRuntime } from './taxonomy';

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

/* ===========================================================================
 * Cross-context resolution, at the ONE layer allowed to do it
 * ========================================================================= */

/**
 * The CONTENT languages an Edition can be in, with the two facts a page needs.
 *
 * WHY THIS IS A TAXONOMY READ RATHER THAN A LIBRARY COLUMN. `direction` IS DOMAIN
 * DATA and "only the content language can say so" (DOMAIN_MODEL.md §9.1). An
 * Edition stores a typed reference to a Language; the direction and the
 * language's own name belong to Taxonomy, which owns the vocabulary. Copying
 * either into `Edition` would be a second copy that goes stale the day Taxonomy
 * corrects one.
 *
 * RETIRED LANGUAGES ARE INCLUDED, deliberately. A published Edition may
 * reference a language Taxonomy has since retired; the Edition is still real and
 * still has to render right-to-left if that is what it is. Retirement governs
 * what may be CHOSEN for a new Edition — which is the question
 * `@/composition/library`'s `validLanguage` asks — not what may be displayed.
 *
 * ONE READ PER REQUEST, not one per Edition. A Work with six Editions in four
 * languages resolves all four here and then looks each one up in a map, which is
 * the difference between one query and six (§49).
 */
export interface ContentLanguage {
  readonly code: string;
  /** The language's own name in its own script. Never a translation of it. */
  readonly name: string;
  readonly direction: 'ltr' | 'rtl';
}

export async function libraryContentLanguages(): Promise<
  ReadonlyMap<string, ContentLanguage>
> {
  const languages = await taxonomyRuntime().taxonomy.listLanguages({
    includeRetired: true,
  });

  return new Map(
    languages.map((language) => [
      language.code,
      {
        code: language.code,
        name: language.nativeName,
        direction: language.direction,
      },
    ]),
  );
}

/**
 * The display names for one page of Library references, resolved by their OWNERS.
 *
 * TWO CALLS FOR A WHOLE PAGE, never one per row. Library holds identifiers; a
 * component that resolved each one as it rendered would produce the N+1 that
 * turns a 25-Work listing into fifty round trips (§32, §49).
 *
 * IT REACHES THE PUBLIC READ RUNTIMES ONLY. `@/composition/people` wires Identity
 * in for the administrative surface; importing it here would put the session
 * service and the authentication library into the module graph of an anonymous
 * public page. `@/composition/people-read` is reads over People's own reader, and
 * `@/composition/taxonomy` has no Identity at all.
 *
 * AN UNRESOLVED IDENTIFIER IS SIMPLY ABSENT from the returned maps, and each
 * caller decides what that means. For a contributor it means the row is not
 * rendered — a name this platform cannot produce is not improved by printing a
 * UUID next to a book.
 */
export async function libraryReferenceNames(
  input: {
    readonly personIds: readonly string[];
    readonly topicIds: readonly string[];
  },
  locale: Locale,
): Promise<{
  readonly people: ReadonlyMap<string, { slug: string; name: string }>;
  readonly topics: ReadonlyMap<string, { slug: string; name: string }>;
}> {
  const personIds = [...new Set(input.personIds)];
  const topicIds = [...new Set(input.topicIds)];

  const [people, topics] = await Promise.all([
    personIds.length === 0
      ? Promise.resolve([])
      : peopleReadRuntime().people.contributorReferences(personIds, locale),
    topicIds.length === 0
      ? Promise.resolve([])
      : taxonomyRuntime().taxonomy.topicReferences(topicIds, locale),
  ]);

  return {
    people: new Map(
      people.map((entry) => [entry.id, { slug: entry.slug, name: entry.name }]),
    ),
    topics: new Map(
      topics.map((entry) => [entry.id, { slug: entry.slug, name: entry.name }]),
    ),
  };
}
