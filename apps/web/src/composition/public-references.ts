import 'server-only';

import type { Locale } from '@minhaj/contracts';

import { peopleReadRuntime } from './people-read';
import { taxonomyRuntime } from './taxonomy';

/**
 * Cross-context NAME resolution for public pages — Layer 4, and session-free.
 *
 * Library (Phases 8–9) and Media (Phase 10) both render records that hold
 * typed references to People contributors, Taxonomy topics and Taxonomy
 * content languages, and both must resolve a whole page of them in a bounded
 * number of owner calls. That resolution is the same for both, so it lives
 * here once rather than in each context's public root.
 *
 * IT REACHES THE PUBLIC READ RUNTIMES ONLY — People's reader and Taxonomy —
 * so no public page importing it acquires a session, the identity service or
 * the authentication library (ARCHITECTURE.md §8.1).
 */

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

export async function contentLanguages(): Promise<ReadonlyMap<string, ContentLanguage>> {
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
export async function referenceNames(
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
