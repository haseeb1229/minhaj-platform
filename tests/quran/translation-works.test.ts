import { describe, expect, it } from 'vitest';

import { FIRST_PARTY_TRANSLATIONS } from '../../apps/web/src/components/quran/reference-sources.ts';
import {
  EXTERNAL_TRANSLATIONS_DECISION,
  QURANENC_PROVENANCE,
  TRANSLATION_PROVENANCE,
} from '../../packages/database/src/lifecycle/quran-reference.ts';
import {
  QURANENC_TRANSLATIONS,
  quranEncSourceKey,
} from '../../scripts/migration/adapters/quranenc.ts';
import { authorisedSource } from '../../scripts/migration/sources/catalogue.ts';
import {
  TRANSLATION_WORKS,
  editionFits,
  translationAttribution,
} from '../../scripts/quran/translation-works.ts';

/**
 * The staging reference import's translation works (owner decision
 * 2026-11-10): one declaration on each side of the owner/runtime split, held
 * equal here — every work's migration source in the catalogue, its provenance
 * source registered by the owner side, Irfan-ul-Quran first, QuranEnc's works
 * attributed with the version of their staged edition and named external.
 */

const EDITION = { key: 'english_saheeh', version: '9.8.7', lastUpdate: 1 } as const;

describe('the declared translation works', () => {
  it('reads each work from its own catalogue registration, of its own language', () => {
    const sources = TRANSLATION_WORKS.map((work) => work.source);
    expect(new Set(sources).size).toBe(sources.length);
    for (const work of TRANSLATION_WORKS) {
      expect(work.slug).toBe(work.source);
      const registration = authorisedSource(work.source);
      expect(registration?.contentKind, work.source).toBe('quran.translation');
      expect(registration?.defaultLanguageCode, work.source).toBe(work.language);
    }
    expect(
      TRANSLATION_WORKS.filter((work) => work.quranEnc !== null).map(
        (work) => work.quranEnc?.key,
      ),
    ).toEqual(QURANENC_TRANSLATIONS.map((entry) => entry.key));
  });

  it('registers exactly one provenance source per work, its code the work’s source', () => {
    expect(TRANSLATION_PROVENANCE.map((entry) => entry.code)).toEqual(
      TRANSLATION_WORKS.map((work) => work.source),
    );
    expect(QURANENC_PROVENANCE.map((entry) => [entry.code, entry.key])).toEqual(
      QURANENC_TRANSLATIONS.map((entry) => [quranEncSourceKey(entry), entry.key]),
    );
    for (const entry of TRANSLATION_PROVENANCE) {
      expect(entry.evidence.length, entry.code).toBeLessThanOrEqual(2000);
      expect(entry.title.length, entry.code).toBeLessThanOrEqual(200);
    }
    for (const entry of TRANSLATION_PROVENANCE.filter((each) =>
      each.code.startsWith('quranenc-'),
    )) {
      expect(entry.evidence).toContain(EXTERNAL_TRANSLATIONS_DECISION);
      expect(entry.evidence).toContain('https://quranenc.com/en/home/api/');
      expect(entry.evidence).toContain('not Minhaj-ul-Quran International');
    }
  });

  it('keeps Minhaj-ul-Quran’s own translation first: its slugs sort before every other', () => {
    const firstParty = TRANSLATION_WORKS.filter((work) => work.quranEnc === null);
    expect(firstParty.map((work) => work.slug)).toEqual([...FIRST_PARTY_TRANSLATIONS]);
    const sorted = TRANSLATION_WORKS.map((work) => work.slug).sort();
    expect(sorted.slice(0, firstParty.length).sort()).toEqual(
      [...FIRST_PARTY_TRANSLATIONS].sort(),
    );
  });

  it('attributes a QuranEnc work with its staged edition’s version, as external', () => {
    const saheeh = TRANSLATION_WORKS.find(
      (work) => work.quranEnc?.key === 'english_saheeh',
    );
    const irfan = TRANSLATION_WORKS.find((work) => work.source === 'irfan-ul-quran-en');
    if (saheeh === undefined || irfan === undefined) throw new Error('declared above');
    expect(translationAttribution(saheeh, EDITION)).toContain(
      'v9.8.7, via QuranEnc.com (https://quranenc.com/en/browse/english_saheeh)',
    );
    expect(translationAttribution(saheeh, EDITION)).toContain(
      "not Minhaj-ul-Quran International's",
    );
    expect(translationAttribution(irfan, null)).toBe(
      'Irfan-ul-Quran — translation by Shaykh-ul-Islam Dr Muhammad Tahir-ul-Qadri. © Minhaj-ul-Quran International. Source: irfan-ul-quran.com',
    );
    expect(saheeh).toMatchObject({
      name: 'English Translation - Noor International Center',
      description: 'Issued by Noor International Center.',
      language: 'en',
    });
  });

  it('takes a revision only of the work’s own edition — none for Irfan-ul-Quran', () => {
    const saheeh = TRANSLATION_WORKS.find(
      (work) => work.quranEnc?.key === 'english_saheeh',
    );
    const irfan = TRANSLATION_WORKS.find((work) => work.source === 'irfan-ul-quran-ur');
    if (saheeh === undefined || irfan === undefined) throw new Error('declared above');
    expect(editionFits(saheeh, EDITION)).toBe(true);
    expect(editionFits(saheeh, { ...EDITION, key: 'english_rwwad' })).toBe(false);
    expect(editionFits(saheeh, null)).toBe(false);
    expect(editionFits(irfan, null)).toBe(true);
    expect(editionFits(irfan, EDITION)).toBe(false);
  });
});
