import { z } from 'zod';

import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_JUZ_MAX,
  QURAN_SURAH_MAX,
  quranIdSchema,
  quranRefSchema,
  quranSlugSchema,
  type QuranPage,
  type QuranPublicReaderPort,
  type QuranRef,
} from '@minhaj/contracts/quran';

/**
 * The PUBLIC Quran read service — every public Quran page, the Listen
 * catalogue and the sitemap read through this, with no actor, no session and no
 * permission: a public Quran is anonymous public knowledge (ARCHITECTURE.md
 * §8.1).
 *
 * THE SAME PORT, GUARDED. It is a `QuranPublicReaderPort` in every respect, so
 * a page cannot tell it from the adapter — except that a malformed argument
 * never reaches a query. A number outside the structural ranges, a slug or an
 * identifier that does not parse, or a reversed range resolves to ABSENT — `null`,
 * nothing, an empty page — exactly as an unpublished work does, so an address a
 * visitor typed can be neither an error nor a probe.
 *
 * VISIBILITY IS THE ADAPTER'S. This service decides nothing about what is
 * public: the reader returns nothing while the corpus is inactive and no
 * layered work that is unpublished or lacks a registered source. Guarding the
 * arguments is the only thing added here.
 */

const surahOk = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= QURAN_SURAH_MAX;
const ayahOk = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= QURAN_AYAH_NUMBER_MAX;
const juzOk = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= QURAN_JUZ_MAX;
const idOk = (value: string) => quranIdSchema.safeParse(value).success;
const slugOk = (value: string) => quranSlugSchema.safeParse(value).success;
const refOk = (ref: QuranRef) => quranRefSchema.safeParse(ref).success;

const offsetSchema = z.number().int().min(0).max(25_000);
const offsetOk = (value: number) => offsetSchema.safeParse(value).success;

/** The most rows one enumeration (search, sitemap) may ask for at once. */
const ENUMERATION_MAX = 1_000;
const limitOk = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= ENUMERATION_MAX;

/** A range of one Surah: both ends real Ayah numbers, in order. */
const rangeOk = (surah: number, from: number, to: number) =>
  surahOk(surah) && ayahOk(from) && ayahOk(to) && from <= to;

const emptyPage = <T>(offset: number): QuranPage<T> => ({
  items: [],
  total: 0,
  offset: offsetOk(offset) ? offset : 0,
});

const none = async <T>(): Promise<readonly T[]> => [];
const absent = async (): Promise<null> => null;

export function createQuranReadService(
  reader: QuranPublicReaderPort,
): QuranPublicReaderPort {
  return {
    availability: () => reader.availability(),

    surahs: () => reader.surahs(),
    surah: (number) => (surahOk(number) ? reader.surah(number) : absent()),
    ayat: (surah, from, to) =>
      rangeOk(surah, from, to) ? reader.ayat(surah, from, to) : none(),
    ayah: (ref) =>
      refOk(ref) ? reader.ayah({ surah: ref.surah, ayah: ref.ayah }) : absent(),
    juzList: () => reader.juzList(),
    juz: (number) => (juzOk(number) ? reader.juz(number) : absent()),
    juzAyat: async (number, offset) =>
      juzOk(number) && offsetOk(offset)
        ? reader.juzAyat(number, offset)
        : emptyPage(offset),

    translations: () => reader.translations(),
    translation: (slug) => (slugOk(slug) ? reader.translation(slug) : absent()),
    transliterations: () => reader.transliterations(),
    transliteration: (slug) => (slugOk(slug) ? reader.transliteration(slug) : absent()),
    tafsirs: () => reader.tafsirs(),
    tafsir: (slug) => (slugOk(slug) ? reader.tafsir(slug) : absent()),

    translationTexts: (workId, surah, from, to) =>
      idOk(workId) && rangeOk(surah, from, to)
        ? reader.translationTexts(workId, surah, from, to)
        : none(),
    transliterationTexts: (workId, surah, from, to) =>
      idOk(workId) && rangeOk(surah, from, to)
        ? reader.transliterationTexts(workId, surah, from, to)
        : none(),
    tafsirEntries: (workId, surah, from, to) =>
      idOk(workId) && rangeOk(surah, from, to)
        ? reader.tafsirEntries(workId, surah, from, to)
        : none(),
    tafsirEntryPage: async (workId, offset) =>
      idOk(workId) && offsetOk(offset)
        ? reader.tafsirEntryPage(workId, offset)
        : emptyPage(offset),

    recitations: () => reader.recitations(),
    recitation: (slug) => (slugOk(slug) ? reader.recitation(slug) : absent()),
    recitationsByReciter: (personId) =>
      idOk(personId) ? reader.recitationsByReciter(personId) : none(),
    recitationSegments: (recitationId, surah) =>
      idOk(recitationId) && (surah === null || surahOk(surah))
        ? reader.recitationSegments(recitationId, surah)
        : none(),

    tajweedRules: () => reader.tajweedRules(),
    tajweedRule: (slug) => (slugOk(slug) ? reader.tajweedRule(slug) : absent()),

    topicAyat: async (topicId, offset) =>
      idOk(topicId) && offsetOk(offset)
        ? reader.topicAyat(topicId, offset)
        : emptyPage(offset),

    ayahSitemap: (offset, limit) =>
      offsetOk(offset) && limitOk(limit) ? reader.ayahSitemap(offset, limit) : none(),
    ayahSitemapCount: () => reader.ayahSitemapCount(),

    searchAyah: (ref) =>
      refOk(ref) ? reader.searchAyah({ surah: ref.surah, ayah: ref.ayah }) : absent(),
    searchAyahScopes: (after, limit) =>
      (after === null || refOk(after)) && limitOk(limit)
        ? reader.searchAyahScopes(after, limit)
        : none(),
    publicAyahTargets: (refs) => {
      const valid = refs
        .filter(refOk)
        .map((ref) => ({ surah: ref.surah, ayah: ref.ayah }));
      return valid.length === 0 ? none() : reader.publicAyahTargets(valid);
    },
    // Malformed citations are dropped, never queried; the batch bound is the
    // adapter's, which refuses rather than silently answering for fewer.
    searchAyahRecords: (refs) => {
      const valid = refs
        .filter(refOk)
        .map((ref) => ({ surah: ref.surah, ayah: ref.ayah }));
      return valid.length === 0 ? none() : reader.searchAyahRecords(valid);
    },

    segmentAsset: (recitationId, segmentId) =>
      idOk(recitationId) && idOk(segmentId)
        ? reader.segmentAsset(recitationId, segmentId)
        : absent(),
  };
}
