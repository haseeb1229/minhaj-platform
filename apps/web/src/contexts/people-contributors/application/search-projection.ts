import type { PeopleReaderPort } from '@minhaj/contracts/people';
import type { SearchScopeSource } from '@minhaj/contracts/search';

/**
 * People & Contributors' search projection — defined by the owner
 * (DELIVERY_PLAN.md Phase 17: "Person and profile records").
 *
 * WHAT A VISITOR COULD ALREADY READ, AND NOTHING MORE. A result is built from
 * the same published Person and the same ACTIVE facets as `/people/{slug}`;
 * the account link, draft facets and archived facets never enter the record the
 * reader returns, so they cannot enter the index either.
 *
 * ONE DOCUMENT PER GENUINE TRANSLATION. The name variants and facet prose
 * written in that locale travel with it, so a historical author found by an
 * alternative spelling of their name is found in the language that spelling
 * belongs to.
 *
 * NO CONTENT LANGUAGE. A Person's translations are keyed by interface locale;
 * a contributor record is not "content written in Urdu", and the content
 * language filter is not the way to find people.
 */
export function createPersonSearchSource(reader: PeopleReaderPort): SearchScopeSource {
  return {
    async project(id) {
      const record = await reader.searchPerson(id);
      if (record === null) return null;

      return {
        stamp: record.stamp,
        documents: record.translations.map((translation) => {
          const variants = record.nameVariants
            .filter((variant) => variant.locale === translation.locale)
            .map((variant) => variant.value);
          const prose = record.facetProse
            .filter((entry) => entry.locale === translation.locale)
            .map((entry) => entry.text);

          return {
            kind: 'person' as const,
            resourceId: record.id,
            textLanguage: translation.locale,
            contentLanguage: null,
            title: translation.name,
            summary: translation.biography ?? '',
            body: [...variants, ...prose].join('\n'),
            year: null,
            topicIds: [],
          };
        }),
      };
    },

    list(input) {
      return reader.searchPeople(input);
    },
  };
}
