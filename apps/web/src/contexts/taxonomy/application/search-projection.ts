import type { SearchScopeSource } from '@minhaj/contracts/search';
import type { TaxonomyReaderPort } from '@minhaj/contracts/taxonomy';

/**
 * Taxonomy's search projection — defined HERE, by the owner (DELIVERY_PLAN.md
 * Phase 17: "Topic names and descriptions per locale").
 *
 * ONE DOCUMENT PER STORED TRANSLATION. An Urdu reader searching in Urdu finds
 * the Urdu name; an untranslated locale contributes nothing rather than a copy
 * of the English one presented as Urdu.
 *
 * NO CONTENT LANGUAGE. A Topic's Urdu name is Urdu TEXT, but a Topic is not
 * content written in Urdu — it is a label the interface renders
 * (DOMAIN_MODEL.md §6.3). The content-language filter therefore does not
 * select Topics, and it never would have been honest for it to.
 *
 * A Topic is tagged with ITSELF, so filtering a search by a topic finds that
 * topic's own hub first among what is classified under it.
 */
export function createTopicSearchSource(reader: TaxonomyReaderPort): SearchScopeSource {
  return {
    async project(id) {
      const record = await reader.searchTopic(id);
      if (record === null) return null;

      return {
        stamp: record.stamp,
        documents: record.translations.map((translation) => ({
          kind: 'topic' as const,
          resourceId: record.id,
          textLanguage: translation.locale,
          contentLanguage: null,
          title: translation.name,
          summary: translation.description ?? '',
          body: '',
          year: null,
          topicIds: [record.id],
        })),
      };
    },

    list(input) {
      return reader.searchTopics(input);
    },
  };
}
