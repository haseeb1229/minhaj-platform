import 'server-only';

import type { Locale } from '@minhaj/contracts';

import { peopleRuntime } from './people';
import { peopleReadRuntime } from './people-read';
import { taxonomyRuntime } from './taxonomy';

/**
 * The Layer-1 reference questions a content context asks, answered ONCE at
 * Layer 4 by the owners' public reads (DOMAIN_MODEL.md §3.3).
 *
 * Library (Phases 8–9) and Media (Phase 10) both hold typed references to
 * People contributors, Taxonomy topics and Taxonomy content languages, and must
 * refuse one the owner does not know — without reading the owner's tables. The
 * questions and their answers are identical for both, so they live here rather
 * than as two copies that could drift: the day one of them started accepting a
 * retired language would be the day nobody noticed.
 *
 * This module decides WHO answers. What a reference MEANS stays with each
 * context's own port (`LibraryReferencesPort`, `MediaReferencesPort`), which this
 * object satisfies structurally.
 */
export const ownerReferences = {
  /**
   * EVERY identifier must resolve, and the count is how that is checked.
   *
   * `contributorReferences` returns a row per identifier it recognises as a
   * published contributor, so a shorter answer means at least one was not — a
   * refusal rather than a silent partial save. The locale is `'en'` because this
   * asks about EXISTENCE, not presentation.
   */
  async validPeople(ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const unique = [...new Set(ids)];
    const found = await peopleReadRuntime().people.contributorReferences(unique, 'en');
    return found.length === unique.length;
  },

  async validTopics(ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const found = await taxonomyRuntime().taxonomy.topicReferences([...ids], 'en');
    return found.length === ids.length;
  },

  /**
   * A RETIRED language is not a valid choice for a new or edited record.
   *
   * Taxonomy owns the vocabulary and owns retirement; the foreign key alone
   * would accept a retired code, because retirement is a status rather than a
   * deletion — which is why the owner is asked.
   */
  async validLanguage(code: string): Promise<boolean> {
    const active = await taxonomyRuntime().taxonomy.listLanguages({
      includeRetired: false,
    });
    return active.some((entry) => entry.code === code);
  },
};

/**
 * Bounded owner-provided choices for an administration form: published
 * contributors narrowed by `query`, active topics and active content languages.
 *
 * THE OWNERS PRODUCE THE OPTIONS. A contributor picker that queried a content
 * context's own tables would be a second, slowly diverging copy of People's
 * directory; asking People means a contributor archived this morning stops
 * being offered this afternoon.
 *
 * Invoked only after the page rendering the form has checked its own read
 * permission. The listing is capped by People's own reader.
 */
export async function ownerReferenceChoices(
  locale: Locale,
  query: string,
): Promise<{
  people: { id: string; name: string }[];
  topics: { id: string; name: string }[];
  languages: { code: string; name: string }[];
}> {
  const [people, topics, languages] = await Promise.all([
    peopleRuntime().people.listPeople({
      query: query || null,
      status: 'published',
      profileKind: null,
      locale,
      offset: 0,
    }),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    taxonomyRuntime().taxonomy.listLanguages({ includeRetired: false }),
  ]);

  return {
    people: people.items.map(({ id, label }) => ({ id, name: label.name })),
    topics: topics.map(({ id, label }) => ({ id, name: label.name })),
    languages: languages.map((entry) => ({
      code: entry.code,
      // The language's OWN name, not a translation of it. A list of content
      // languages that renamed itself per interface locale would make "which
      // language is this record in" a presentation question.
      name: entry.nativeName,
    })),
  };
}
