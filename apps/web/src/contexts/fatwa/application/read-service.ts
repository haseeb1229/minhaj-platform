import {
  FATWA_MAX_OFFSET,
  FATWA_SORTS,
  fatwaCategorySlugSchema,
  fatwaIdSchema,
  fatwaSlugSchema,
  type FatwaBrowseFilter,
  type FatwaPublicReaderPort,
} from '@minhaj/contracts/fatwa';

/**
 * The PUBLIC Fatwa read service — every public Fatwa page, the Fatwa sitemap
 * and the topic hub read through this, with no actor, no session and no
 * permission: a published ruling is anonymous public knowledge
 * (ARCHITECTURE.md §8.1). It cannot reach a question at all — the port it
 * wraps has no method that returns one.
 *
 * THE SAME PORT, GUARDED. A slug, identifier, sort or offset that does not
 * parse never reaches a query; it resolves to ABSENT — `null`, nothing, an
 * empty page — exactly as an unpublished ruling does, so an address a visitor
 * typed can be neither an error nor a probe. An unknown filter NEVER broadens a
 * listing: a category or topic that is not a well-formed id yields nothing.
 *
 * VISIBILITY IS THE ADAPTER'S. The reader returns nothing while the service is
 * not activated, and no ruling that was never published or has been withdrawn.
 */

const idOk = (value: string | null) =>
  value === null || fatwaIdSchema.safeParse(value).success;
const slugOk = (value: string) => fatwaSlugSchema.safeParse(value).success;
const categorySlugOk = (value: string) =>
  fatwaCategorySlugSchema.safeParse(value).success;
const offsetOk = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= FATWA_MAX_OFFSET;

/** The most rows one enumeration (search, sitemap) may ask for at once. */
const ENUMERATION_MAX = 1_000;
const limitOk = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= ENUMERATION_MAX;

export function createFatwaReadService(
  reader: FatwaPublicReaderPort,
): FatwaPublicReaderPort {
  return {
    availability: () => reader.availability(),
    categories: () => reader.categories(),
    category: async (slug) => (categorySlugOk(slug) ? reader.category(slug) : null),
    async browse(filter: FatwaBrowseFilter) {
      if (
        !(FATWA_SORTS as readonly string[]).includes(filter.sort) ||
        !idOk(filter.categoryId) ||
        !idOk(filter.topicId) ||
        !offsetOk(filter.offset)
      ) {
        return {
          items: [],
          total: 0,
          offset: offsetOk(filter.offset) ? filter.offset : 0,
        };
      }
      return reader.browse(filter);
    },
    fatwa: async (slug) => (slugOk(slug) ? reader.fatwa(slug) : null),
    publicId: async (slug) => (slugOk(slug) ? reader.publicId(slug) : null),
    sitemap: async (offset, limit) =>
      offsetOk(offset) && limitOk(limit) ? reader.sitemap(offset, limit) : [],
    searchRecord: async (id) => (idOk(id) ? reader.searchRecord(id) : null),
    searchScopes: (after, limit) => reader.searchScopes(after, limit),
    publicTargets: (ids) => reader.publicTargets(ids),
    searchRecords: (ids) => reader.searchRecords(ids),
  };
}
