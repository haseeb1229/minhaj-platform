import type { StagedTranslationEdition } from '@minhaj/contracts/migration';

import {
  QURANENC_TRANSLATIONS,
  quranEncAttribution,
  quranEncSourceKey,
  type QuranEncTranslation,
} from '../migration/adapters/quranenc.ts';

/**
 * THE TRANSLATION WORKS the staging reference import fills (`reference-runtime
 * translations`), each from the staged revisions of ITS OWN migration source —
 * whose key is also the code of the provenance source the owner side registers
 * for it (`packages/database/src/lifecycle/quran-reference.ts`):
 *
 *   - Irfan-ul-Quran in Urdu and English — Minhaj-ul-Quran's own translation
 *     by Shaykh-ul-Islam Dr Muhammad Tahir-ul-Qadri (owner attestation
 *     2026-10-27), first in every list: the public reader orders works by
 *     slug, and "irfan-…" precedes "quranenc-…" (asserted by the tests);
 *   - QuranEnc's external reference translations (owner decision 2026-11-10),
 *     named and described in QuranEnc's own words, whose attribution states
 *     the publisher, the source and the VERSION their staged text is, and that
 *     they are not Minhaj-ul-Quran's.
 *
 * Nothing here is read from a request: it is the import's own declaration.
 */

export interface TranslationWork {
  /** The staged migration source's key — also its provenance source's code. */
  readonly source: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly language: 'ur' | 'en';
  /**
   * The QuranEnc translation it is, whose every staged revision carries its
   * edition — or null for a source that versions none (Irfan-ul-Quran).
   */
  readonly quranEnc: QuranEncTranslation | null;
}

const IRFAN_ATTRIBUTION =
  'Irfan-ul-Quran — translation by Shaykh-ul-Islam Dr Muhammad Tahir-ul-Qadri. © Minhaj-ul-Quran International. Source: irfan-ul-quran.com';

export const TRANSLATION_WORKS: readonly TranslationWork[] = Object.freeze([
  {
    source: 'irfan-ul-quran-ur',
    slug: 'irfan-ul-quran-ur',
    name: 'عرفان القرآن',
    description: null,
    language: 'ur',
    quranEnc: null,
  },
  {
    source: 'irfan-ul-quran-en',
    slug: 'irfan-ul-quran-en',
    name: 'Irfan-ul-Quran',
    description: null,
    language: 'en',
    quranEnc: null,
  },
  ...QURANENC_TRANSLATIONS.map((translation): TranslationWork => ({
    source: quranEncSourceKey(translation),
    slug: quranEncSourceKey(translation),
    name: translation.title,
    description: translation.description,
    language: translation.language,
    quranEnc: translation,
  })),
]);

/**
 * The work's attribution: Irfan-ul-Quran's own, or QuranEnc's terms' — naming
 * the version of the edition its staged revisions carry.
 */
export function translationAttribution(
  work: TranslationWork,
  edition: StagedTranslationEdition | null,
): string {
  if (work.quranEnc === null) return IRFAN_ATTRIBUTION;
  return quranEncAttribution(work.quranEnc, edition?.version ?? work.quranEnc.version);
}

/**
 * Whether a staged revision's edition is one this work may take: none for an
 * unversioned source, and for a QuranEnc work an edition of ITS OWN key.
 */
export function editionFits(
  work: TranslationWork,
  edition: StagedTranslationEdition | null,
): boolean {
  return work.quranEnc === null
    ? edition === null
    : edition !== null && edition.key === work.quranEnc.key;
}
