import { z } from 'zod';
import {
  libraryQuerySchema,
  workSlugSchema,
  type LibraryFacetPage,
  type LibraryPublicReaderPort,
} from '@minhaj/contracts/library';

/**
 * The PUBLIC Library reads.
 *
 * NO ACTOR, NO SESSION, NO PERMISSION — and the SHAPE is what makes that
 * structural rather than a promise. There is no parameter a viewer's identity
 * could arrive through, so no answer this service produces can vary with one
 * (PRODUCT_SCOPE.md §2.1: ordinary public knowledge works without signing in;
 * ARCHITECTURE.md §8.1: the anonymous public render tree reads no
 * session-derived state).
 *
 * EVERY INPUT IS VALIDATED HERE, at the trust boundary, before it reaches a
 * query. A slug arrives from a URL segment and an offset from a query string;
 * both are caller-controlled, and both are parsed rather than trusted
 * (SECURITY_BASELINE.md §9.1). A malformed slug resolves to `null` — the same
 * answer as a slug that names nothing — rather than throwing, because a visitor
 * who mistyped an address should get the 404 the page already knows how to
 * render.
 */

/** Offsets are bounded at BOTH ends: negative is nonsense, unbounded is a walk. */
const browseOffset = z.number().int().min(0).max(25_000);

export function createLibraryReadService(reader: LibraryPublicReaderPort) {
  return {
    works(raw: unknown = {}) {
      return reader.works(libraryQuerySchema.parse(raw));
    },

    work(slug: string) {
      return workSlugSchema.safeParse(slug).success
        ? reader.work(slug)
        : Promise.resolve(null);
    },

    canonicalSlug(slug: string) {
      return workSlugSchema.safeParse(slug).success
        ? reader.canonicalSlug(slug)
        : Promise.resolve(null);
    },

    salePoints(offset = 0) {
      return reader.salePoints(browseOffset.parse(offset));
    },

    /**
     * The navigational facets, each one bounded and each one aggregate.
     *
     * A facet page hands back identifiers; the page that renders it resolves the
     * names in ONE call to the owning context. That split is why `/library/authors`
     * costs two queries rather than one per row (§32, §49) — and it is also why
     * Library never has to hold a copy of a contributor's name.
     */
    contributorFacets(offset = 0): Promise<LibraryFacetPage> {
      return reader.contributorFacets(browseOffset.parse(offset));
    },

    topicFacets(offset = 0): Promise<LibraryFacetPage> {
      return reader.topicFacets(browseOffset.parse(offset));
    },

    languageFacets(offset = 0): Promise<LibraryFacetPage> {
      return reader.languageFacets(browseOffset.parse(offset));
    },

    /**
     * One page of canonical Work URLs for the machine sitemap.
     *
     * A WIDER OFFSET BOUND than a browse, on purpose: the sitemap reads the whole
     * published corpus to exhaustion in bounded pages, and a browse ceiling
     * appropriate for a visitor clicking "next" would silently truncate it.
     */
    sitemap(offset: number, limit: number) {
      return reader.sitemap(
        z.number().int().min(0).max(10_000_000).parse(offset),
        z.number().int().min(1).max(5000).parse(limit),
      );
    },
  };
}
