import { z } from 'zod';

import {
  hadithIdSchema,
  hadithNumberSchema,
  hadithSlugSchema,
  type HadithPage,
  type HadithPublicReaderPort,
} from '@minhaj/contracts/hadith';

/**
 * The PUBLIC Hadith read service — every public Hadith page and the Hadith
 * sitemap read through this, with no actor, no session and no permission: a
 * public Hadith citation is anonymous public knowledge (ARCHITECTURE.md §8.1).
 *
 * THE SAME PORT, GUARDED. It is a `HadithPublicReaderPort` in every respect, so
 * a page cannot tell it from the adapter — except that a malformed argument
 * never reaches a query. A citation number outside the structural range, a slug
 * or an identifier that does not parse, or an offset or limit out of bounds
 * resolves to ABSENT — `null`, nothing, an empty page — exactly as an unmapped
 * citation does, so an address a visitor typed can be neither an error nor a
 * probe.
 *
 * VISIBILITY IS THE ADAPTER'S. This service decides nothing about what is
 * public: the reader returns nothing while no collection is activated, no
 * citation that is withdrawn, conflicted or unverified at its current version,
 * and no layered work that is unpublished or lacks a registered source. Guarding
 * the arguments is the only thing added here.
 */

const idOk = (value: string) => hadithIdSchema.safeParse(value).success;
const slugOk = (value: string) => hadithSlugSchema.safeParse(value).success;
const numberOk = (value: number) => hadithNumberSchema.safeParse(value).success;

/**
 * A ceiling on any listing offset: far beyond every collection's citations put
 * together, and far below anything that could make a query pathological.
 */
const offsetSchema = z.number().int().min(0).max(10_000_000);
const offsetOk = (value: number) => offsetSchema.safeParse(value).success;

/** The most rows one enumeration (search, sitemap) may ask for at once. */
const ENUMERATION_MAX = 1_000;
const limitOk = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= ENUMERATION_MAX;

const emptyPage = <T>(offset: number): HadithPage<T> => ({
  items: [],
  total: 0,
  offset: offsetOk(offset) ? offset : 0,
});

const none = async <T>(): Promise<readonly T[]> => [];
const absent = async (): Promise<null> => null;

export function createHadithReadService(
  reader: HadithPublicReaderPort,
): HadithPublicReaderPort {
  return {
    availability: () => reader.availability(),

    collections: () => reader.collections(),
    collection: (slug) => (slugOk(slug) ? reader.collection(slug) : absent()),
    books: (collectionId) => (idOk(collectionId) ? reader.books(collectionId) : none()),
    book: (collectionId, slug) =>
      idOk(collectionId) && slugOk(slug) ? reader.book(collectionId, slug) : absent(),
    chapters: (bookId) => (idOk(bookId) ? reader.chapters(bookId) : none()),
    chapter: (bookId, slug) =>
      idOk(bookId) && slugOk(slug) ? reader.chapter(bookId, slug) : absent(),
    bookCitations: async (bookId, offset) =>
      idOk(bookId) && offsetOk(offset)
        ? reader.bookCitations(bookId, offset)
        : emptyPage(offset),
    chapterCitations: async (chapterId, offset) =>
      idOk(chapterId) && offsetOk(offset)
        ? reader.chapterCitations(chapterId, offset)
        : emptyPage(offset),

    citation: (collectionSlug, number) =>
      slugOk(collectionSlug) && numberOk(number)
        ? reader.citation(collectionSlug, number)
        : absent(),
    browse: async (offset) =>
      offsetOk(offset) ? reader.browse(offset) : emptyPage(offset),
    topicCitations: async (topicId, offset) =>
      idOk(topicId) && offsetOk(offset)
        ? reader.topicCitations(topicId, offset)
        : emptyPage(offset),

    commentaries: () => reader.commentaries(),
    sciences: () => reader.sciences(),
    science: (slug) => (slugOk(slug) ? reader.science(slug) : absent()),

    citationSitemap: (offset, limit) =>
      offsetOk(offset) && limitOk(limit) ? reader.citationSitemap(offset, limit) : none(),

    searchCitation: (citationId) =>
      idOk(citationId) ? reader.searchCitation(citationId) : absent(),
    searchCitationScopes: (after, limit) =>
      (after === null || idOk(after)) && limitOk(limit)
        ? reader.searchCitationScopes(after, limit)
        : none(),
    publicCitationTargets: (ids) => {
      const valid = ids.filter(idOk);
      return valid.length === 0 ? none() : reader.publicCitationTargets(valid);
    },
    // Malformed identifiers are dropped, never queried; the batch bound is the
    // adapter's, which refuses rather than silently answering for fewer.
    searchCitationRecords: (ids) => {
      const valid = ids.filter(idOk);
      return valid.length === 0 ? none() : reader.searchCitationRecords(valid);
    },
  };
}
